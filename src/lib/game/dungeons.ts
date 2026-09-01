// Данж: вход, цепочка боссов, ярость и выход. Числа боссов и порядок цепочки —
// в данных; здесь только правила прохождения. Текста для игрока нет.
import { Decimal } from './numbers'
import {
  ALL_DUNGEONS,
  DUNGEONS,
  DUNGEON_BY_ID,
  DUNGEON_CLEAR_XP_BONUS,
  ENRAGE_GROWTH,
  ENRAGE_STEP_SEC,
  HEROIC_CLEAR_XP_BONUS,
  HEROIC_DUNGEONS,
  buildBoss,
  clearKey,
  dungeonView,
  type BossDef,
  type DungeonDef,
  type DungeonDifficulty,
} from '../data/dungeons'
import { ZONE_BY_ID } from '../data/zones'
import { monsterFromTemplate, pushEvent, spawnMonster, type GameState } from './state'
import { currentZone, retreatZone } from './zones'
import type { Rng } from './rng'

export {
  ALL_DUNGEONS,
  DUNGEONS,
  DUNGEON_BY_ID,
  HEROIC_DUNGEONS,
  clearKey,
  dungeonView,
} from '../data/dungeons'
export type { DungeonDef, BossDef, DungeonDifficulty } from '../data/dungeons'
export {
  bossDispel,
  bossFrenzyActive,
  bossSwingTime,
  currentBossAbility,
  punishResourceSpend,
} from './bossAbilities'

/** Данж нужной сложности; сложность по умолчанию — обычная. */
export function dungeonById(
  id: string,
  difficulty: DungeonDifficulty = 'normal',
): DungeonDef | null {
  return dungeonView(id, difficulty)
}

export function activeDungeon(state: GameState): DungeonDef | null {
  const run = state.dungeonRun
  return run ? dungeonView(run.dungeonId, run.difficulty) : null
}

export function currentBoss(state: GameState): BossDef | null {
  const dungeon = activeDungeon(state)
  if (!dungeon || !state.dungeonRun) return null
  return dungeon.bosses[state.dungeonRun.bossIndex] ?? null
}

/**
 * Есть ли за текущим боссом следующий. Нужен привалу: между схватками цепочки
 * герой отдыхает, а после последней — выходит наружу, и отдыхать ему уже не
 * от чего.
 */
export function hasNextBoss(state: GameState): boolean {
  const dungeon = activeDungeon(state)
  if (!dungeon || !state.dungeonRun) return false
  return state.dungeonRun.bossIndex + 1 < dungeon.bosses.length
}

// Почему в данж не войти. Каждый случай — свой код, текст рендерит UI.
export type DungeonBlockReason = 'level' | 'wrong-zone' | 'dead' | 'already-inside'

export interface DungeonStatus {
  dungeonId: string
  /** Сложность строки: обычная и героическая живут двумя статусами. */
  difficulty: DungeonDifficulty
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
  // `dungeon` УЖЕ конкретной сложности — все её отличия (уровень входа, ключ
  // достижения) приехали в него из шаблона, поэтому проверок по сложности
  // здесь нет ни одной.
  const base = {
    dungeonId: dungeon.id,
    difficulty: dungeon.difficulty,
    unlockRequirement: dungeon.unlockRequirement,
    zoneId: dungeon.zoneId,
    cleared: state.dungeonsCleared[clearKey(dungeon.id, dungeon.difficulty)] === true,
  }
  const blocked = (reason: DungeonBlockReason) => ({ ...base, canEnter: false, reason })
  if (state.dungeonRun) return blocked('already-inside')
  if (state.heroState === 'dead') return blocked('dead')
  if (state.level.lt(dungeon.unlockRequirement)) return blocked('level')
  if (currentZone(state).id !== dungeon.zoneId) return blocked('wrong-zone')
  return { ...base, canEnter: true, reason: null }
}

/** Обе лестницы: обычная и героическая. */
export function allDungeonStatuses(state: GameState): DungeonStatus[] {
  return ALL_DUNGEONS.map((d) => dungeonStatus(state, d))
}

// Ставит перед героем указанного босса цепочки: полный HP, сброшенный замах.
function faceBoss(state: GameState, dungeon: DungeonDef, bossIndex: number): GameState {
  const boss = dungeon.bosses[bossIndex]
  const monster = monsterFromTemplate(buildBoss(boss))
  return {
    ...state,
    dungeonRun: { dungeonId: dungeon.id, difficulty: dungeon.difficulty, bossIndex, fightMs: 0 },
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
      difficulty: dungeon.difficulty,
    }),
  }
}

/** Вход в данж выбранной сложности. Недоступный данж состояние не меняет. */
export function enterDungeon(
  state: GameState,
  dungeonId: string,
  difficulty: DungeonDifficulty = 'normal',
): GameState {
  const dungeon = dungeonView(dungeonId, difficulty)
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

  // Цепочка пройдена целиком. Флаг поднимается СВОЙ у каждой сложности:
  // обычная и героическая версии одного данжа — два разных достижения.
  const key = clearKey(dungeon.id, dungeon.difficulty)
  const firstClear = state.dungeonsCleared[key] !== true
  const cleared = leaveDungeon(state, rng, false)
  const log = pushEvent(cleared.combatLog, {
    type: 'dungeon-clear',
    dungeonId: dungeon.id,
    dungeonName: dungeon.name,
    difficulty: dungeon.difficulty,
    firstClear,
  })
  if (!firstClear) return { ...cleared, combatLog: log }
  // ПЕРВОЕ ПРОХОЖДЕНИЕ ОТКРЫВАЕТ ЗОНЫ. Список — в данных данжа: логика только
  // переносит его в сейв, ни одного «если данж такой-то» здесь нет. Героика
  // не открывает ничего (у неё пустой список) — к ней все зоны давно открыты.
  const unlockedZoneIds = { ...state.unlockedZoneIds }
  for (const zoneId of dungeon.opensZoneIds) unlockedZoneIds[zoneId] = true
  return {
    ...cleared,
    dungeonsCleared: { ...state.dungeonsCleared, [key]: true },
    unlockedZoneIds,
    combatLog: log,
  }
}

/**
 * Постоянный бонус к опыту за пройденные данжи. Героика даёт свой, более
 * крупный: число живёт в data/heroic.ts, а не здесь.
 */
export function clearedXpBonus(cleared: Record<string, boolean>): Decimal {
  let bonus = new Decimal(1)
  for (const dungeon of ALL_DUNGEONS) {
    if (cleared[clearKey(dungeon.id, dungeon.difficulty)] !== true) continue
    bonus = bonus.plus(
      dungeon.difficulty === 'heroic' ? HEROIC_CLEAR_XP_BONUS : DUNGEON_CLEAR_XP_BONUS,
    )
  }
  return bonus
}
