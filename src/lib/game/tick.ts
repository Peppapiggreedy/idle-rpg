// Тик — конвейер чистых шагов (state, ctx) => state. Порядок фиксирован и важен:
//   1. applyRevive          — мёртвый герой: отсчёт воскрешения; по нулю — полный HP
//                             и откат в последнюю зону, где он выживал
//   2. applyCooldowns       — кулдауны умений и GCD идут игровым временем
//   2a. applyAutocast       — таймер реакции и применение умения по приоритету
//   3. applyPendingKill     — моб, добитый мгновенным умением вне тика
//   4. applyCombat          — удары героя по свинг-таймеру; умение из очереди
//                             ЗАМЕНЯЕТ автоатаку; смерть моба в ctx.killedMonster
//   5. applyEffects         — тики урона по времени; тоже могут убить моба
//   6. applyKillRewards     — золото за убитого + событие kill
//   7. applyLevelUps        — опыт за убитого, перенос остатка + событие levelup
//   8. applyLootDrop        — бросок дропа + событие loot
//   9. applyMonsterAttack   — ответный удар моба по своему свинг-таймеру; может убить героя
//  10. applyRegen           — реген HP (в бою медленный, вне боя быстрый) и маны
//  11. applyRespawn         — взводит таймер после смерти моба ИЛИ ведёт отсчёт и спавнит
//  12. applyAutosaveCounter — копит игровое время для автосейва (сохраняет стор)
// Шаги не знают ни про UI, ни про Svelte; текст для игрока рендерится из событий в UI.
// rng потребляют: удар героя (урон + крит), дроп, удар моба и спавн (уровень + архетип).
import { Decimal } from './numbers'
import { applyXp } from './formulas'
import { rollLoot } from './loot'
import { rollMonsterDamage, rollSwing } from './combat'
import { autoEquipIfBetter } from './equipment'
import type { Rng } from './rng'
import { pushEvent, spawnMonster, type ActiveEffect, type GameState } from './state'
import { ensureStats } from './stats'
import { emit as busEmit } from './events'
import { INVENTORY_SIZE, RESPAWN_DELAY_MS, REVIVE_DELAY_MS } from '../data/balance'
import { ABILITY_BY_ID } from '../data/abilities'
import { currentZone, reviveInZone } from './zones'
import { advanceCooldowns, autocastStep, consumeQueuedAbility } from './abilities'
import { reviveMultiplier } from './talents'
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
  // Воскрешение: полный HP и откат в последнюю зону, где герой выживал
  // (если такой нет — в безопасную). Смена зоны сама спавнит моба и пишет лог.
  const revived = reviveInZone(
    { ...s, combatLog: pushEvent(s.combatLog, { type: 'revive' }) },
    ctx.rng,
  )
  return {
    ...revived,
    heroState: 'alive',
    reviveMsLeft: 0,
    currentHp: s.stats.maxHp,
    // Умения не переживают смерть: очередь и эффекты были на прежнем мобе.
    queuedAbilityId: null,
    activeEffects: [],
  }
}

// Кулдауны умений и GCD идут ИГРОВЫМ временем: множитель скорости из
// отладочной панели ускоряет их ровно так же, как бой.
const applyCooldowns: TickStep = (s, ctx) => advanceCooldowns(s, ctx.dtMs)

// Автокаст: ведёт таймер реакции и жмёт первое доступное умение по приоритету.
// Стоит ПОСЛЕ кулдаунов (иначе умение, освободившееся на этом тике, пришлось
// бы ждать лишний тик) и ДО боя (мгновенное умение бьёт до замаха).
const applyAutocast: TickStep = (s, ctx) => {
  // Между мобами автокаст молчит: бить некого, таймеры взводятся заново.
  if (s.respawnMsLeft > 0) return { ...s, autocastReadyMs: {} }
  return autocastStep(s, ctx.dtMs, ctx.rng, ctx.emitAttack)
}

// Мгновенное умение бьёт вне тика и может добить моба. Смерть оформляет
// конвейер — награды, лут и респаун идут обычным путём.
const applyPendingKill: TickStep = (s, ctx) => {
  if (s.respawnMsLeft > 0 || s.heroState === 'dead') return s
  if (s.monster.currentHp.gt(0)) return s
  ctx.killedMonster = s.monster
  return s
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
  // Всё, что замах может изменить, ведём локально и собираем в конце.
  let swung: GameState = s
  while (swingProgress >= 1 - SWING_EPS && ctx.killedMonster === null) {
    swingProgress = Math.max(0, swingProgress - 1)
    // Замах пришёлся на умение из очереди — оно ЗАМЕНЯЕТ автоатаку. Не хватило
    // маны или умение успело уйти в кулдаун — очередь снимается, бьём обычно.
    const withAbility = consumeQueuedAbility(
      { ...swung, monster, combatLog },
      ctx.rng,
      ctx.emitAttack,
    )
    if (withAbility) {
      swung = withAbility
      monster = withAbility.monster
      combatLog = withAbility.combatLog
      if (monster.currentHp.lte(0)) ctx.killedMonster = monster
      continue
    }
    swung = { ...swung, queuedAbilityId: null }
    // Формула удара живёт в combat.ts — здесь только применение результата.
    const { amount, isCrit } = rollSwing(swung.stats, ctx.rng)
    const hpLeft = monster.currentHp.minus(amount)
    monster = { ...monster, currentHp: Decimal.max(hpLeft, new Decimal(0)) }
    combatLog = pushEvent(combatLog, { type: 'hit', damage: amount, isCrit })
    ctx.emitAttack({
      sourceId: 'hero',
      targetId: monster.id,
      amount,
      isCrit,
      abilityId: null, // авто-атака
      timestamp: swung.playtimeMs.toNumber(),
    })
    if (hpLeft.lte(0)) ctx.killedMonster = monster
  }
  return { ...swung, swingProgress, monster, combatLog }
}

// Эффекты умений (урон по времени) тикают игровым временем и могут добить
// моба — поэтому шаг стоит ДО начисления наград.
const applyEffects: TickStep = (s, ctx) => {
  if (s.activeEffects.length === 0) return s
  // Эффекты живут на конкретном мобе: он мёртв или его нет — эффекты снимаются.
  if (ctx.killedMonster || s.respawnMsLeft > 0) return { ...s, activeEffects: [] }
  let monster = s.monster
  let combatLog = s.combatLog
  const remaining: ActiveEffect[] = []
  for (const effect of s.activeEffects) {
    // Интервал между тиками постоянен и живёт в данных умения.
    const intervalMs = (ABILITY_BY_ID[effect.abilityId]?.effect?.tickIntervalSec ?? 1) * 1000
    let { ticksLeft, msToNextTick } = effect
    let msLeft = ctx.dtMs
    // Один жирный тик может прокрутить несколько тиков эффекта; остаток
    // переносится в msToNextTick, как и остаток замаха.
    while (msLeft >= msToNextTick && ticksLeft > 0 && ctx.killedMonster === null) {
      msLeft -= msToNextTick
      msToNextTick = intervalMs
      ticksLeft -= 1
      const hpLeft = monster.currentHp.minus(effect.damagePerTick)
      monster = { ...monster, currentHp: Decimal.max(hpLeft, new Decimal(0)) }
      combatLog = pushEvent(combatLog, {
        type: 'effect',
        abilityId: effect.abilityId,
        damage: effect.damagePerTick,
      })
      ctx.emitAttack({
        sourceId: 'hero',
        targetId: monster.id,
        amount: effect.damagePerTick,
        isCrit: false,
        abilityId: effect.abilityId,
        timestamp: s.playtimeMs.toNumber(),
      })
      if (hpLeft.lte(0)) ctx.killedMonster = monster
    }
    if (ticksLeft > 0) remaining.push({ ...effect, ticksLeft, msToNextTick: msToNextTick - msLeft })
  }
  return { ...s, monster, combatLog, activeEffects: remaining }
}

const applyKillRewards: TickStep = (s, ctx) => {
  const killed = ctx.killedMonster
  if (!killed) return s
  return {
    ...s,
    // Убил моба — значит в этой зоне выживает; сюда же вернёт смерть.
    lastSurvivedZoneId: s.currentZoneId,
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
    // Уровень — источник статов (живучесть), поэтому конвейер надо пересчитать.
    statsDirty: s.statsDirty || leveled.level.gt(s.level),
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
    // Талант «Скорое возвращение» режет простой; множитель живёт в данных.
    reviveMsLeft: REVIVE_DELAY_MS * reviveMultiplier(next.talents),
    queuedAbilityId: null,
    activeEffects: [],
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
  const monster = spawnMonster(currentZone(s), ctx.rng)
  return {
    ...s,
    respawnMsLeft: 0,
    monster,
    activeEffects: [], // эффекты были на прежнем мобе
    combatLog: pushEvent(s.combatLog, { type: 'spawn', monsterName: monster.name }),
  }
}

const applyAutosaveCounter: TickStep = (s, ctx) => {
  return { ...s, msSinceAutosave: s.msSinceAutosave + ctx.dtMs }
}

const PIPELINE: TickStep[] = [
  applyRevive,
  applyCooldowns,
  applyAutocast,
  applyPendingKill,
  applyCombat,
  applyEffects,
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
export {
  COMBAT_LOG_SIZE,
  createInitialState,
  manualOnlySettings,
  defaultAbilitySettings,
  spawnMonster,
  monsterFromTemplate,
  emptyEquipment,
} from './state'
export type { GameState, Equipment } from './state'
export { RESPAWN_DELAY_MS } from '../data/balance'
