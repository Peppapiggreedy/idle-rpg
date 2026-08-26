// Тик — конвейер чистых шагов (state, ctx) => state. Порядок фиксирован и важен:
//   1. applyCombat          — дискретные удары по свинг-таймеру; смерть в ctx.killedMonster
//   2. applyKillRewards     — золото за убитого + событие kill
//   3. applyLevelUps        — опыт за убитого, перенос остатка + событие levelup
//   4. applyLootDrop        — бросок дропа (единственный потребитель rng) + событие loot
//   5. applyRespawn         — взводит таймер после смерти ИЛИ ведёт отсчёт и спавнит
//   6. applyAutosaveCounter — копит игровое время для автосейва (сохраняет стор)
// Шаги не знают ни про UI, ни про Svelte; текст для игрока рендерится из событий в UI.
import { Decimal } from './numbers'
import { applyXp } from './formulas'
import { rollLoot } from './loot'
import type { Rng } from './rng'
import { pushEvent, spawnMonster, type GameState } from './state'
import { ensureStats } from './stats'
import { emit as busEmit } from './events'
import { INVENTORY_SIZE, RESPAWN_DELAY_MS } from '../data/balance'
import { FIRST_MONSTER } from '../data/monsters'
import type { AttackEvent, Monster } from '../types'

// Контекст одного тика: вход (dtMs, rng, emit) и факты, которыми шаги обмениваются.
interface TickContext {
  dtMs: number
  rng: Rng
  emitAttack: (event: AttackEvent) => void
  killedMonster: Monster | null
}

type TickStep = (state: GameState, ctx: TickContext) => GameState

const applyCombat: TickStep = (s, ctx) => {
  // Во время респауна свинг-таймер стоит: первый удар по новому мобу — через
  // полный замах, без бесплатного «накопленного» удара.
  if (s.respawnMsLeft > 0) return s
  const attackSpeedMs = s.stats.attackSpeed * 1000
  let swingTimerMs = s.swingTimerMs + ctx.dtMs
  let monster = s.monster
  let combatLog = s.combatLog
  // Удар при каждом полном замахе; таймер сбрасывается ПЕРЕНОСОМ остатка,
  // иначе на медленном тике теряется время между ударами.
  while (swingTimerMs >= attackSpeedMs && ctx.killedMonster === null) {
    swingTimerMs -= attackSpeedMs
    const isCrit = ctx.rng() < s.stats.critChance
    const amount = isCrit
      ? s.stats.attackPower.times(s.stats.critMultiplier)
      : s.stats.attackPower
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
  return { ...s, swingTimerMs, monster, combatLog }
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
  return {
    ...s,
    inventory: [...s.inventory, item],
    itemSeq: s.itemSeq + 1,
    combatLog: pushEvent(s.combatLog, { type: 'loot', item }),
  }
}

const applyRespawn: TickStep = (s, ctx) => {
  // Смерть на этом тике — взводим таймер; отсчёт начнётся со следующего тика.
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
  applyCombat,
  applyKillRewards,
  applyLevelUps,
  applyLootDrop,
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
export { COMBAT_LOG_SIZE, createInitialState, spawnMonster } from './state'
export type { GameState } from './state'
export { RESPAWN_DELAY_MS } from '../data/balance'
