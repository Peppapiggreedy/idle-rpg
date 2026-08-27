// Тик — конвейер чистых шагов (state, ctx) => state. Порядок фиксирован и важен:
//   1. applyRevive          — мёртвый герой: отсчёт воскрешения; по нулю — полный HP
//                             и переход в стартовую зону (свежий моб)
//   2. applyCombat          — удары героя по свинг-таймеру; смерть моба в ctx.killedMonster
//   3. applyKillRewards     — золото за убитого + событие kill
//   4. applyLevelUps        — опыт за убитого, перенос остатка + событие levelup
//   5. applyLootDrop        — бросок дропа (единственный потребитель rng) + событие loot
//   6. applyMonsterAttack   — ответный удар моба по своему свинг-таймеру; может убить героя
//   7. applyRegen           — реген HP (в бою медленный, вне боя быстрый) и маны
//   8. applyRespawn         — взводит таймер после смерти моба ИЛИ ведёт отсчёт и спавнит
//   9. applyAutosaveCounter — копит игровое время для автосейва (сохраняет стор)
// Шаги не знают ни про UI, ни про Svelte; текст для игрока рендерится из событий в UI.
import { Decimal } from './numbers'
import { applyXp } from './formulas'
import { rollLoot } from './loot'
import { rollMonsterDamage, rollSwing } from './combat'
import { autoEquipIfBetter } from './equipment'
import type { Rng } from './rng'
import { pushEvent, spawnMonster, type GameState } from './state'
import { ensureStats } from './stats'
import { emit as busEmit } from './events'
import { INVENTORY_SIZE, RESPAWN_DELAY_MS, REVIVE_DELAY_MS } from '../data/balance'
import { FIRST_MONSTER } from '../data/monsters'
import type { AttackEvent, Monster } from '../types'

// Погрешность накопления долей замаха: 0.05 и подобные не представимы в double.
const SWING_EPS = 1e-9

// Контекст одного тика: вход (dtMs, rng, emit) и факты, которыми шаги обмениваются.
interface TickContext {
  dtMs: number
  rng: Rng
  emitAttack: (event: AttackEvent) => void
  killedMonster: Monster | null
}

type TickStep = (state: GameState, ctx: TickContext) => GameState

const applyRevive: TickStep = (s, ctx) => {
  if (s.heroState !== 'dead') return s
  const left = s.reviveMsLeft - ctx.dtMs
  if (left > 0) return { ...s, reviveMsLeft: left }
  // Воскрешение: полный HP и «последняя зона, где выживал» — пока зон нет,
  // это стартовая: свежий моб с полным здоровьем.
  const monster = spawnMonster(FIRST_MONSTER)
  let combatLog = pushEvent(s.combatLog, { type: 'revive' })
  combatLog = pushEvent(combatLog, { type: 'spawn', monsterName: monster.name })
  return {
    ...s,
    heroState: 'alive',
    reviveMsLeft: 0,
    currentHp: s.stats.maxHp,
    swingProgress: 0,
    monster,
    respawnMsLeft: 0,
    combatLog,
  }
}

const applyCombat: TickStep = (s, ctx) => {
  if (s.heroState === 'dead') return s
  // Во время респауна свинг-таймер стоит: первый удар по новому мобу — через
  // полный замах, без бесплатного «накопленного» удара.
  if (s.respawnMsLeft > 0) return s
  // Прогресс копится ДОЛЕЙ замаха: dt / swingTime. Смена оружия или haste
  // в середине замаха сохраняет долю — без сброса и без мгновенного удара.
  let swingProgress = s.swingProgress + ctx.dtMs / (s.stats.swingTime * 1000)
  let monster = s.monster
  let combatLog = s.combatLog
  // Удар при каждом полном замахе; остаток доли переносится, иначе на
  // медленном тике теряется время между ударами. EPS гасит накопленную
  // погрешность дробей (0.05 не представима в double).
  while (swingProgress >= 1 - SWING_EPS && ctx.killedMonster === null) {
    swingProgress = Math.max(0, swingProgress - 1)
    // Формула удара живёт в combat.ts — здесь только применение результата.
    const { amount, isCrit } = rollSwing(s.stats, ctx.rng)
    const hpLeft = monster.currentHp.minus(amount)
    monster = { ...monster, currentHp: Decimal.max(hpLeft, new Decimal(0)) }
    combatLog = pushEvent(combatLog, { type: 'hit', damage: amount, isCrit })
    ctx.emitAttack({
      sourceId: 'hero',
      targetId: monster.id,
      amount,
      isCrit,
      abilityId: null, // авто-атака
      timestamp: s.playtimeMs.toNumber(),
    })
    if (hpLeft.lte(0)) ctx.killedMonster = monster
  }
  return { ...s, swingProgress, monster, combatLog }
}

const applyKillRewards: TickStep = (s, ctx) => {
  const killed = ctx.killedMonster
  if (!killed) return s
  return {
    ...s,
    gold: s.gold.plus(killed.goldReward),
    combatLog: pushEvent(s.combatLog, {
      type: 'kill',
      monsterName: killed.name,
      gold: killed.goldReward,
      xp: killed.xpReward,
    }),
  }
}

const applyLevelUps: TickStep = (s, ctx) => {
  const killed = ctx.killedMonster
  if (!killed) return s
  const leveled = applyXp(s.level, s.currentXp, killed.xpReward)
  let combatLog = s.combatLog
  if (leveled.level.gt(s.level)) {
    combatLog = pushEvent(combatLog, { type: 'levelup', level: leveled.level })
  }
  return {
    ...s,
    level: leveled.level,
    currentXp: leveled.currentXp,
    xpToNext: leveled.xpToNext,
    combatLog,
  }
}

const applyLootDrop: TickStep = (s, ctx) => {
  if (!ctx.killedMonster) return s
  // Дроп только при свободном слоте; rng при полном инвентаре не трогаем.
  if (s.inventory.length >= INVENTORY_SIZE) return s
  const item = rollLoot(ctx.rng, s.itemSeq)
  if (!item) return s
  const withItem: GameState = {
    ...s,
    inventory: [...s.inventory, item],
    itemSeq: s.itemSeq + 1,
    combatLog: pushEvent(s.combatLog, { type: 'loot', item }),
  }
  // Автонадевание сравнивает предметы по оценочному урону в секунду.
  return autoEquipIfBetter(withItem, item)
}

const applyMonsterAttack: TickStep = (s, ctx) => {
  // Моб бьёт, только пока оба живы; мирные мобы (damage 0) не бьют вовсе.
  if (s.heroState === 'dead' || s.respawnMsLeft > 0 || ctx.killedMonster) return s
  if (s.monster.damageMax.lte(0)) return s
  let monsterSwing = s.monster.swingProgress + ctx.dtMs / (s.monster.swingTime * 1000)
  let currentHp = s.currentHp
  let combatLog = s.combatLog
  let died = false
  while (monsterSwing >= 1 - SWING_EPS && !died) {
    monsterSwing = Math.max(0, monsterSwing - 1)
    // Формула входящего урона (бросок из диапазона + damageReduction) — в combat.ts.
    const amount = rollMonsterDamage(s.monster, s.stats, ctx.rng)
    currentHp = Decimal.max(currentHp.minus(amount), new Decimal(0))
    combatLog = pushEvent(combatLog, { type: 'hurt', damage: amount, monsterName: s.monster.name })
    ctx.emitAttack({
      sourceId: s.monster.id,
      targetId: 'hero',
      amount,
      isCrit: false,
      abilityId: null,
      timestamp: s.playtimeMs.toNumber(),
    })
    if (currentHp.lte(0)) died = true
  }
  const next = { ...s, currentHp, monster: { ...s.monster, swingProgress: monsterSwing }, combatLog }
  if (!died) return next
  // Смерть героя: 30 игровых секунд простоя, награды не капают.
  return {
    ...next,
    heroState: 'dead',
    reviveMsLeft: REVIVE_DELAY_MS,
    combatLog: pushEvent(next.combatLog, { type: 'death' }),
  }
}

const applyRegen: TickStep = (s, ctx) => {
  if (s.heroState === 'dead') return s
  const dtSec = ctx.dtMs / 1000
  // Вне боя (пауза респауна) HP восстанавливается быстрой ставкой, в бою — медленной.
  const hpRate = s.respawnMsLeft > 0 ? s.stats.hpRegenOutOfCombat : s.stats.hpRegen
  const currentHp = Decimal.min(s.currentHp.plus(hpRate.times(dtSec)), s.stats.maxHp)
  const currentMana = Decimal.min(s.currentMana.plus(s.stats.manaRegen.times(dtSec)), s.stats.maxMana)
  return { ...s, currentHp, currentMana }
}

const applyRespawn: TickStep = (s, ctx) => {
  // Смерть моба на этом тике — взводим таймер; отсчёт начнётся со следующего тика.
  if (ctx.killedMonster) return { ...s, respawnMsLeft: RESPAWN_DELAY_MS }
  if (s.respawnMsLeft <= 0) return s
  const left = s.respawnMsLeft - ctx.dtMs
  if (left > 0) return { ...s, respawnMsLeft: left }
  const monster = spawnMonster(FIRST_MONSTER)
  return {
    ...s,
    respawnMsLeft: 0,
    monster,
    combatLog: pushEvent(s.combatLog, { type: 'spawn', monsterName: monster.name }),
  }
}

const applyAutosaveCounter: TickStep = (s, ctx) => {
  return { ...s, msSinceAutosave: s.msSinceAutosave + ctx.dtMs }
}

const PIPELINE: TickStep[] = [
  applyRevive,
  applyCombat,
  applyKillRewards,
  applyLevelUps,
  applyLootDrop,
  applyMonsterAttack,
  applyRegen,
  applyRespawn,
  applyAutosaveCounter,
]

export function tick(
  state: GameState,
  dtMs: number,
  rng: Rng,
  emitAttack: (event: AttackEvent) => void = busEmit,
): GameState {
  const ctx: TickContext = { dtMs, rng, emitAttack, killedMonster: null }
  // Кеш статов: пересчёт только если источники менялись с прошлого тика.
  let s: GameState = {
    ...ensureStats(state),
    totalTicks: state.totalTicks.plus(1),
    playtimeMs: state.playtimeMs.plus(dtMs),
  }
  for (const step of PIPELINE) s = step(s, ctx)
  return s
}

// Реэкспорт для обратной совместимости импортов (тесты, index).
export { COMBAT_LOG_SIZE, createInitialState, spawnMonster, emptyEquipment } from './state'
export type { GameState, Equipment } from './state'
export { RESPAWN_DELAY_MS } from '../data/balance'
