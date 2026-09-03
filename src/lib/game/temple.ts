// Храм испытаний: правила забега. Числа волн и рубежи наград — в данных
// (data/temple.ts), здесь только правила: попытка в сутки, свой поток
// случайности, рекорд и что делает смерть. Текста для игрока нет — коды
// отказа и структурированные события.
import {
  TEMPLE,
  TEMPLES,
  TEMPLE_BY_ID,
  buildTempleMonster,
  floorReward,
  milestoneAt,
  type TempleDef,
} from '../data/temple'
import { Decimal } from './numbers'
import { addMaterial } from './crafting'
import { ZONE_BY_ID } from '../data/zones'
import { createRng, type Rng } from './rng'
import { monsterFromTemplate, pushEvent, spawnMonster, type GameState } from './state'
import { currentZone, retreatZone } from './zones'
import type { TempleRun } from '../types'

export { TEMPLE, TEMPLES, TEMPLE_BY_ID, floorReward, recipeUnlocked, recipeUnlockWave } from '../data/temple'
export type { TempleDef, TempleMilestone } from '../data/temple'

export function templeById(id: string): TempleDef | null {
  return TEMPLE_BY_ID[id] ?? null
}

export function activeTemple(state: GameState): TempleDef | null {
  return state.templeRun ? templeById(state.templeRun.templeId) : null
}

/**
 * Сид забега: из идентификатора сейва и ТЕКУЩЕГО РЕКОРДА.
 *
 * Раньше вторым слагаемым был номер суток — так работал кулдаун «одна
 * попытка в день». Кулдауна больше нет, и привязка к часам вместе с ним:
 * часы на машине игрока источником правды не были никогда.
 *
 * Рекорд как слагаемое даёт ровно то, что нужно: пока герой топчется на
 * одном рубеже, лестница повторяется и её можно выучить; побил рекорд —
 * дальше идёт новая. Тот же целочисленный хеш, что в randomSeed.
 */
export function templeSeed(saveId: number, day: number): number {
  let h = ((saveId >>> 0) ^ Math.imul(day | 0, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

/**
 * Поток случайности ОДНОЙ волны: свой, из сида забега и номера волны.
 *
 * Вычерпывать поток симуляции из храма нельзя — тогда ход остального боя
 * зависел бы от того, сколько волн герой прошёл, а сам поток волн перестал
 * бы повторяться после перезагрузки. Поток каждой волны выводится заново,
 * поэтому забег продолжается с той же волны и тем же бойцом.
 */
function waveRng(run: TempleRun): Rng {
  return createRng(templeSeed(run.seed, run.wave))
}

// Почему в храм не войти. Каждый случай — свой код, текст рендерит UI.
//
// Кода 'cooldown' здесь БОЛЬШЕ НЕТ: попытки в сутки не существует. Ходить
// в храм можно сколько угодно, и фарм закрыт не запретом, а построением —
// награда даётся только за этажи ВЫШЕ рекорда, а рекорд нельзя побить дважды.
export type TempleBlockReason = 'level' | 'wrong-zone' | 'dead' | 'already-inside'

export interface TempleStatus {
  templeId: string
  canEnter: boolean
  reason: TempleBlockReason | null
  unlockRequirement: number
  zoneId: string
  /** Личный рекорд: максимальный ПОЛНОСТЬЮ пройденный этаж. */
  bestWave: number
  /** Сколько всего этажей в храме. */
  floors: number
  /** Награда за следующий этаж; null — рекорд уже на потолке. */
  nextReward: { floor: number; dust: number; gold: Decimal } | null
  /** Все этажи взяты: ходить можно, но платить больше нечем. */
  exhausted: boolean
}

/**
 * Порядок проверок тот же, что у данжа: сперва то, что не лечится переходом
 * в зону. Кулдауна среди них больше нет — его не существует.
 */
export function templeStatus(state: GameState, temple: TempleDef = TEMPLE): TempleStatus {
  const best = state.templeBestWave
  const next = best + 1
  const exhausted = best >= temple.floors
  const base = {
    templeId: temple.id,
    unlockRequirement: temple.unlockRequirement,
    zoneId: temple.zoneId,
    bestWave: best,
    floors: temple.floors,
    nextReward: exhausted ? null : { floor: next, ...floorReward(temple, next) },
    exhausted,
  }
  const blocked = (reason: TempleBlockReason) => ({ ...base, canEnter: false, reason })
  if (state.templeRun || state.dungeonRun) return blocked('already-inside')
  if (state.heroState === 'dead') return blocked('dead')
  if (state.level.lt(temple.unlockRequirement)) return blocked('level')
  if (currentZone(state).id !== temple.zoneId) return blocked('wrong-zone')
  return { ...base, canEnter: true, reason: null }
}

/** Ставит перед героем бойца волны. Бросок архетипа — СВОИМ потоком. */
function faceWave(state: GameState, temple: TempleDef, run: TempleRun): GameState {
  const rng = waveRng(run)
  const pool = temple.ladder
  const archetype = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]
  const monster = monsterFromTemplate(buildTempleMonster(temple, archetype, run.level, run.wave))
  return {
    ...state,
    templeRun: run,
    monster,
    swingProgress: 0,
    offhandSwingProgress: 0,
    respawnMsLeft: 0,
    activeEffects: [], // эффекты висели на прежнем противнике
    queuedAbilityId: null,
    combatLog: pushEvent(state.combatLog, { type: 'spawn', monsterName: monster.name }),
  }
}

/** Вход в храм. Недоступный храм состояние не меняет вовсе. */
export function enterTemple(state: GameState, temple: TempleDef = TEMPLE): GameState {
  if (!templeStatus(state, temple).canEnter) return state
  const run: TempleRun = {
    templeId: temple.id,
    wave: 1,
    // Пройденных этажей в этом забеге пока нет: первый ещё впереди.
    cleared: 0,
    seed: templeSeed(state.saveId, state.templeBestWave),
    // Уровень ЗАМОРОЖЕН на входе: взятый посреди забега уровень менял бы
    // числа потока на ходу, и «тот же забег» перестал бы быть тем же.
    level: state.level.toNumber(),
  }
  const started: GameState = {
    ...state,
    combatLog: pushEvent(state.combatLog, { type: 'temple-start', templeName: temple.name }),
  }
  return faceWave(started, temple, run)
}

/**
 * Этаж пройден: отмечается В ЗАБЕГЕ, а не в рекорде.
 *
 * Разница между «отметить» и «засчитать» — это ровно разница между смертью и
 * закрытой вкладкой. Рекорд и награды выдаёт finishTempleRun на ВЫХОДЕ; пока
 * герой внутри, пройденные этажи живут только в самом забеге, и брошенный
 * забег уносит их с собой (см. resumeOutside в game/save.ts).
 *
 * Зовётся в момент СМЕРТИ бойца, а не при переходе к следующему этажу: между
 * ними герой волен выйти сам, и пройденный этаж обязан остаться пройденным.
 */
export function clearTempleWave(state: GameState): GameState {
  const run = state.templeRun
  const temple = activeTemple(state)
  if (!run || !temple) return state
  const cleared = run.wave
  return {
    ...state,
    templeRun: { ...run, cleared: Math.max(run.cleared, cleared) },
    combatLog: pushEvent(state.combatLog, {
      type: 'temple-wave',
      wave: cleared,
      record: cleared > state.templeBestWave,
    }),
  }
}

/**
 * СКОЛЬКО ЗАБЕГ УЖЕ ЗАРАБОТАЛ, прямо сейчас. Та же арифметика, что и в
 * `finishTempleRun`, — второй копии правила «платят только этажи выше
 * рекорда» не существует, — но состояние не меняется: это взгляд, а не
 * начисление. HUD показывает этим числом копилку забега.
 */
export function pendingTempleReward(state: GameState): {
  floors: number
  from: number
  to: number
  dust: number
  gold: Decimal
} {
  const run = state.templeRun
  const temple = activeTemple(state)
  const empty = { floors: 0, from: 0, to: 0, dust: 0, gold: new Decimal(0) }
  if (!run || !temple) return empty
  const to = Math.min(run.cleared, temple.floors)
  const from = state.templeBestWave + 1
  if (to < from) return empty
  let dust = 0
  let gold = new Decimal(0)
  for (let floor = from; floor <= to; floor += 1) {
    const reward = floorReward(temple, floor)
    dust += reward.dust
    gold = gold.plus(reward.gold)
  }
  return { floors: to - from + 1, from, to, dust, gold }
}

/** Что начислил забег. Числа для итогового экрана; текст рендерит UI. */
export interface TempleOutcome {
  /** До какого этажа дошёл забег (последний ПОЛНОСТЬЮ пройденный). */
  reached: number
  /** Какие этажи оплачены: они же новый рекорд. Пусто — рекорд не побит. */
  paidFrom: number
  paidTo: number
  dust: number
  gold: Decimal
  /** Рецепты, открытые взятыми рубежами. */
  recipeIds: string[]
  /** Храм пройден целиком ВПЕРВЫЕ: токен и уникальный рецепт. */
  fullClear: boolean
}

/**
 * ЗАБЕГ ЗАВЕРШЁН С РЕЗУЛЬТАТОМ. Сюда приходит и смерть, и добровольный выход —
 * оба это КОНЕЦ ПОПЫТКИ, и оба засчитываются.
 *
 * Этаж, на котором герой умер, пройденным не считается: clearTempleWave
 * отмечает этаж в момент смерти БОЙЦА, а не героя. Засчитываются этажи под ним.
 *
 * ФАРМ ЗАКРЫТ ПО ПОСТРОЕНИЮ: платят только этажи ВЫШЕ рекорда, а рекорд по
 * определению нельзя побить дважды. Кулдаун для этого не нужен и его нет.
 */
export function finishTempleRun(state: GameState): { state: GameState; outcome: TempleOutcome } {
  const run = state.templeRun
  const temple = activeTemple(state)
  const empty: TempleOutcome = {
    reached: 0,
    paidFrom: 0,
    paidTo: 0,
    dust: 0,
    gold: new Decimal(0),
    recipeIds: [],
    fullClear: false,
  }
  if (!run || !temple) return { state, outcome: empty }

  const reached = Math.min(run.cleared, temple.floors)
  const from = state.templeBestWave + 1
  const outcome: TempleOutcome = { ...empty, reached, paidFrom: from, paidTo: reached }
  if (reached < from) return { state, outcome: { ...outcome, paidFrom: 0, paidTo: 0 } }

  let dust = 0
  let gold = new Decimal(0)
  const recipeIds: string[] = []
  for (let floor = from; floor <= reached; floor += 1) {
    const reward = floorReward(temple, floor)
    dust += reward.dust
    gold = gold.plus(reward.gold)
    const milestone = milestoneAt(temple, floor)
    if (milestone) recipeIds.push(milestone.recipeId)
  }
  // Полная зачистка платит СВЕРХУ и ровно один раз: флаг в состоянии, а не
  // «рекорд равен потолку» — иначе повторный заход выдавал бы токен снова.
  const fullClear = reached >= temple.floors && !state.templeCleared

  let next: GameState = {
    ...state,
    templeBestWave: reached,
    templeCleared: state.templeCleared || reached >= temple.floors,
    enchantDust: state.enchantDust.plus(dust),
    gold: state.gold.plus(gold),
  }
  if (fullClear) next = addMaterial(next, temple.clearReward.materialId)
  next = {
    ...next,
    combatLog: pushEvent(next.combatLog, {
      type: 'temple-result',
      reached,
      dust,
      gold,
      fullClear,
    }),
  }
  for (const recipeId of recipeIds) {
    next = {
      ...next,
      combatLog: pushEvent(next.combatLog, { type: 'temple-reward', recipeId, wave: reached }),
    }
  }
  return { state: next, outcome: { ...outcome, dust, gold, recipeIds, fullClear } }
}

/** Следующая волна. Потока симуляции не касается — бросок идёт своим. */
export function advanceTemple(state: GameState): GameState {
  const run = state.templeRun
  const temple = activeTemple(state)
  if (!run || !temple) return state
  return faceWave(state, temple, { ...run, wave: run.wave + 1 })
}

/**
 * Выход наружу. `credit` разводит ДВА РАЗНЫХ пути, и путать их нельзя:
 *
 *   true  — забег ЗАВЕРШЁН: смерть или добровольный выход. Этажи выше
 *           рекорда оплачены, рекорд поднят, итог ушёл в лог.
 *   false — забег БРОШЕН: закрытая вкладка (resumeOutside при загрузке
 *           сейва). Рекорд не меняется, награды не выдаются, попытку
 *           придётся начинать заново.
 *
 * Если бы смерть шла по второму пути, риск смерти обнулился бы: погибнуть
 * стало бы не дороже, чем закрыть вкладку, и привал между боями потерял бы
 * смысл. Оба пути покрыты тестами.
 */
export function leaveTemple(
  state: GameState,
  rng: Rng,
  defeated: boolean,
  credit = true,
): GameState {
  const run = state.templeRun
  if (!run) return state
  if (credit) state = finishTempleRun(state).state
  const zone = defeated ? retreatZone(state) : ZONE_BY_ID[state.currentZoneId] ?? retreatZone(state)
  return {
    ...state,
    templeRun: null,
    currentZoneId: zone.id,
    monster: spawnMonster(zone, rng),
    swingProgress: 0,
    offhandSwingProgress: 0,
    respawnMsLeft: 0,
    activeEffects: [],
    queuedAbilityId: null,
    combatLog: pushEvent(state.combatLog, { type: 'temple-end', wave: run.wave, defeated }),
  }
}


