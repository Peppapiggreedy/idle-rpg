// Данж: вход, цепочка боссов, ярость и выход. Числа боссов и порядок цепочки —
// в данных; здесь только правила прохождения. Текста для игрока нет.
import { Decimal } from './numbers'
import {
  DUNGEONS,
  DUNGEON_BY_ID,
  DUNGEON_CLEAR_XP_BONUS,
  ENRAGE_GROWTH,
  ENRAGE_STEP_SEC,
  buildBoss,
  type BossDef,
  type DungeonDef,
} from '../data/dungeons'
import { ZONE_BY_ID } from '../data/zones'
import { monsterFromTemplate, pushEvent, spawnMonster, type GameState } from './state'
import { currentZone, retreatZone } from './zones'
import type { Rng } from './rng'

export { DUNGEONS, DUNGEON_BY_ID } from '../data/dungeons'
export type { DungeonDef, BossDef } from '../data/dungeons'

export function dungeonById(id: string): DungeonDef | null {
  return DUNGEON_BY_ID[id] ?? null
}

export function activeDungeon(state: GameState): DungeonDef | null {
  return state.dungeonRun ? dungeonById(state.dungeonRun.dungeonId) : null
}

export function currentBoss(state: GameState): BossDef | null {
  const dungeon = activeDungeon(state)
  if (!dungeon || !state.dungeonRun) return null
  return dungeon.bosses[state.dungeonRun.bossIndex] ?? null
}

// Почему в данж не войти. Каждый случай — свой код, текст рендерит UI.
export type DungeonBlockReason = 'level' | 'wrong-zone' | 'dead' | 'already-inside'

export interface DungeonStatus {
  dungeonId: string
  canEnter: boolean
  reason: DungeonBlockReason | null
  unlockRequirement: number
  zoneId: string
  cleared: boolean // проходил ли герой цепочку целиком хотя бы раз
}

/**
 * Порядок проверок фиксирован: сперва то, что не лечится переходом в зону.
 * Вход только из «своей» зоны — данж это дверь в конкретном месте карты.
 */
export function dungeonStatus(state: GameState, dungeon: DungeonDef): DungeonStatus {
  const base = {
    dungeonId: dungeon.id,
    unlockRequirement: dungeon.unlockRequirement,
    zoneId: dungeon.zoneId,
    cleared: state.dungeonsCleared[dungeon.id] === true,
  }
  const blocked = (reason: DungeonBlockReason) => ({ ...base, canEnter: false, reason })
  if (state.dungeonRun) return blocked('already-inside')
  if (state.heroState === 'dead') return blocked('dead')
  if (state.level.lt(dungeon.unlockRequirement)) return blocked('level')
  if (currentZone(state).id !== dungeon.zoneId) return blocked('wrong-zone')
  return { ...base, canEnter: true, reason: null }
}

export function allDungeonStatuses(state: GameState): DungeonStatus[] {
  return DUNGEONS.map((d) => dungeonStatus(state, d))
}

// Ставит перед героем указанного босса цепочки: полный HP, сброшенный замах.
function faceBoss(state: GameState, dungeon: DungeonDef, bossIndex: number): GameState {
  const boss = dungeon.bosses[bossIndex]
  const monster = monsterFromTemplate(buildBoss(boss))
  return {
    ...state,
    dungeonRun: { dungeonId: dungeon.id, bossIndex, fightMs: 0 },
    monster,
    swingProgress: 0,
    respawnMsLeft: 0,
    activeEffects: [], // эффекты висели на прежнем противнике
    queuedAbilityId: null,
    combatLog: pushEvent(state.combatLog, {
      type: 'boss',
      bossName: boss.name,
      index: bossIndex + 1,
      total: dungeon.bosses.length,
    }),
  }
}

/** Вход в данж. Недоступный данж состояние не меняет вовсе. */
export function enterDungeon(state: GameState, dungeonId: string): GameState {
  const dungeon = dungeonById(dungeonId)
  if (!dungeon) return state
  if (!dungeonStatus(state, dungeon).canEnter) return state
  return faceBoss(state, dungeon, 0)
}

/**
 * Выход наружу: в зону данжа при добровольном выходе и после победы, в зону
 * отката — если героя вынесли. Прогресс цепочки в любом случае не хранится:
 * забег живёт только пока герой внутри.
 */
export function leaveDungeon(state: GameState, rng: Rng, defeated: boolean): GameState {
  if (!state.dungeonRun) return state
  const zone = defeated ? retreatZone(state) : ZONE_BY_ID[state.currentZoneId] ?? retreatZone(state)
  return {
    ...state,
    dungeonRun: null,
    currentZoneId: zone.id,
    monster: spawnMonster(zone, rng),
    swingProgress: 0,
    respawnMsLeft: 0,
    activeEffects: [],
    queuedAbilityId: null,
    combatLog: pushEvent(state.combatLog, { type: 'dungeon-exit', defeated }),
  }
}

/**
 * Множитель урона босса от ярости. До enrageAfterSec — единица; дальше урон
 * растёт на ENRAGE_GROWTH каждые ENRAGE_STEP_SEC. Формула живёт здесь, а её
 * константы — в данных данжа.
 */
export function enrageMultiplier(boss: BossDef, fightMs: number): number {
  const overSec = fightMs / 1000 - boss.enrageAfterSec
  if (overSec < 0) return 1
  const steps = Math.floor(overSec / ENRAGE_STEP_SEC) + 1
  return 1 + steps * ENRAGE_GROWTH
}

/** Сколько игровых секунд осталось до следующего скачка ярости. */
export function secondsToEnrage(boss: BossDef, fightMs: number): number {
  const fightSec = fightMs / 1000
  if (fightSec < boss.enrageAfterSec) return boss.enrageAfterSec - fightSec
  const sinceEnrage = fightSec - boss.enrageAfterSec
  return ENRAGE_STEP_SEC - (sinceEnrage % ENRAGE_STEP_SEC)
}

/**
 * Босс убит: либо следующий в цепочке, либо конец данжа. Первое полное
 * прохождение поднимает флаг достижения — ровно один раз.
 */
export function advanceDungeon(state: GameState, rng: Rng): GameState {
  const dungeon = activeDungeon(state)
  if (!dungeon || !state.dungeonRun) return state
  const nextIndex = state.dungeonRun.bossIndex + 1
  if (nextIndex < dungeon.bosses.length) return faceBoss(state, dungeon, nextIndex)

  // Цепочка пройдена целиком.
  const firstClear = state.dungeonsCleared[dungeon.id] !== true
  const cleared = leaveDungeon(state, rng, false)
  if (!firstClear) {
    return { ...cleared, combatLog: pushEvent(cleared.combatLog, { type: 'dungeon-clear', dungeonName: dungeon.name, firstClear }) }
  }
  return {
    ...cleared,
    dungeonsCleared: { ...state.dungeonsCleared, [dungeon.id]: true },
    combatLog: pushEvent(cleared.combatLog, {
      type: 'dungeon-clear',
      dungeonName: dungeon.name,
      firstClear,
    }),
  }
}

/** Постоянный бонус к опыту за пройденные данжи: +5% за каждый, один раз. */
export function clearedXpBonus(cleared: Record<string, boolean>): Decimal {
  let bonus = new Decimal(1)
  for (const dungeon of DUNGEONS) {
    if (cleared[dungeon.id] === true) bonus = bonus.plus(DUNGEON_CLEAR_XP_BONUS)
  }
  return bonus
}
