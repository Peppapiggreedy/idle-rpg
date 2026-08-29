// Храм испытаний: правила забега. Числа волн и рубежи наград — в данных
// (data/temple.ts), здесь только правила: попытка в сутки, свой поток
// случайности, рекорд и что делает смерть. Текста для игрока нет — коды
// отказа и структурированные события.
import {
  TEMPLE,
  TEMPLES,
  TEMPLE_BY_ID,
  TEMPLE_DAY_MS,
  buildTempleMonster,
  milestoneAt,
  type TempleDef,
} from '../data/temple'
import { ZONE_BY_ID } from '../data/zones'
import { createRng, type Rng } from './rng'
import { monsterFromTemplate, pushEvent, spawnMonster, type GameState } from './state'
import { currentZone, retreatZone } from './zones'
import type { TempleRun } from '../types'

export { TEMPLE, TEMPLES, TEMPLE_BY_ID, TEMPLE_DAY_MS, recipeUnlocked, recipeUnlockWave } from '../data/temple'
export type { TempleDef, TempleMilestone } from '../data/temple'

export function templeById(id: string): TempleDef | null {
  return TEMPLE_BY_ID[id] ?? null
}

export function activeTemple(state: GameState): TempleDef | null {
  return state.templeRun ? templeById(state.templeRun.templeId) : null
}

/**
 * Отметка реального времени, которой МОЖНО доверять.
 *
 * Часы на машине игрока источником правды не являются: их переводят назад и
 * получают вторую попытку в те же сутки. Поэтому наружу ходит не now(), а
 * максимум из него и отметки последнего забега — время для храма идёт только
 * вперёд. Перевод часов ВПЕРЁД правилом не ловится и не должен: приблизить
 * себе завтра игрок волен и без нас, а вот отменить уже потраченный сегодня
 * забег нельзя.
 */
export function templeClock(state: GameState, now: number): number {
  return Math.max(now, state.templeLastRunAtMs)
}

/** Номер суток по отметке времени. */
export function templeDay(ms: number): number {
  return Math.floor(ms / TEMPLE_DAY_MS)
}

/**
 * Сид забега: из идентификатора сейва и номера суток. Отсюда и берётся
 * воспроизводимость — за один день герой встречает тот же поток, сколько бы
 * раз ни перезагрузил страницу. Тот же целочисленный хеш, что в randomSeed.
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

/** Сколько реальных мс осталось до следующей попытки; 0 — попытка есть. */
export function msToNextAttempt(state: GameState, now: number): number {
  if (state.templeLastRunAtMs <= 0) return 0
  const passed = templeClock(state, now) - state.templeLastRunAtMs
  return Math.max(0, TEMPLE_DAY_MS - passed)
}

// Почему в храм не войти. Каждый случай — свой код, текст рендерит UI.
export type TempleBlockReason = 'level' | 'wrong-zone' | 'dead' | 'already-inside' | 'cooldown'

export interface TempleStatus {
  templeId: string
  canEnter: boolean
  reason: TempleBlockReason | null
  unlockRequirement: number
  zoneId: string
  /** Личный рекорд по волнам: он же ключ к открытым рецептам. */
  bestWave: number
  msToNextAttempt: number
}

/**
 * Порядок проверок тот же, что у данжа: сперва то, что не лечится переходом
 * в зону. Кулдаун — ПОСЛЕДНИМ: «приходи завтра» полезно слышать только тому,
 * кто уже дорос и стоит у двери.
 */
export function templeStatus(
  state: GameState,
  temple: TempleDef = TEMPLE,
  now: () => number = Date.now,
): TempleStatus {
  const left = msToNextAttempt(state, now())
  const base = {
    templeId: temple.id,
    unlockRequirement: temple.unlockRequirement,
    zoneId: temple.zoneId,
    bestWave: state.templeBestWave,
    msToNextAttempt: left,
  }
  const blocked = (reason: TempleBlockReason) => ({ ...base, canEnter: false, reason })
  if (state.templeRun || state.dungeonRun) return blocked('already-inside')
  if (state.heroState === 'dead') return blocked('dead')
  if (state.level.lt(temple.unlockRequirement)) return blocked('level')
  if (currentZone(state).id !== temple.zoneId) return blocked('wrong-zone')
  if (left > 0) return blocked('cooldown')
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
export function enterTemple(
  state: GameState,
  temple: TempleDef = TEMPLE,
  now: () => number = Date.now,
): GameState {
  if (!templeStatus(state, temple, now).canEnter) return state
  const stamp = templeClock(state, now())
  const day = templeDay(stamp)
  const run: TempleRun = {
    templeId: temple.id,
    wave: 1,
    day,
    seed: templeSeed(state.saveId, day),
    // Уровень ЗАМОРОЖЕН на входе: взятый посреди забега уровень менял бы
    // числа потока на ходу, и «тот же забег» перестал бы быть тем же.
    level: state.level.toNumber(),
  }
  const started: GameState = {
    ...state,
    // Попытка тратится В МОМЕНТ ВХОДА, а не на выходе: иначе выход до первого
    // удара возвращал бы её, и «одна в сутки» ничего не значило бы.
    templeLastRunAtMs: stamp,
    combatLog: pushEvent(state.combatLog, { type: 'temple-start', templeName: temple.name }),
  }
  return faceWave(started, temple, run)
}

/**
 * Волна пройдена: рекорд и рубеж.
 *
 * Зовётся в момент СМЕРТИ бойца, а не при переходе к следующей волне: между
 * ними герой волен выйти сам, и пройденная волна обязана остаться засчитанной.
 */
export function clearTempleWave(state: GameState): GameState {
  const run = state.templeRun
  const temple = activeTemple(state)
  if (!run || !temple) return state
  const cleared = run.wave
  const record = cleared > state.templeBestWave
  // Рубеж выдаётся РОВНО ОДИН РАЗ, и отдельного счётчика для этого не нужно:
  // награду открывает рекорд, а рекорд по определению берётся однажды.
  const milestone = record ? milestoneAt(temple, cleared) : null
  let combatLog = pushEvent(state.combatLog, { type: 'temple-wave', wave: cleared, record })
  if (milestone) {
    combatLog = pushEvent(combatLog, {
      type: 'temple-reward',
      recipeId: milestone.recipeId,
      wave: cleared,
    })
  }
  return { ...state, templeBestWave: Math.max(state.templeBestWave, cleared), combatLog }
}

/** Следующая волна. Потока симуляции не касается — бросок идёт своим. */
export function advanceTemple(state: GameState): GameState {
  const run = state.templeRun
  const temple = activeTemple(state)
  if (!run || !temple) return state
  return faceWave(state, temple, { ...run, wave: run.wave + 1 })
}

/**
 * Выход наружу: в зону храма при добровольном выходе, в зону отката — если
 * героя вынесли. Забег в любом случае не хранится: он живёт, только пока
 * герой внутри. Рекорд и открытые им рецепты остаются — они уже заработаны.
 */
export function leaveTemple(state: GameState, rng: Rng, defeated: boolean): GameState {
  const run = state.templeRun
  if (!run) return state
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


