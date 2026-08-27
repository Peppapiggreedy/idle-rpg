// Машина анимаций бойца: какое состояние показывать и каким клипом.
//
// Правила выбора — чистые функции, поэтому проверяются в node без three.
// Сам микшер живёт в компоненте: он про three, а решения про игру.

import type { ActorState, ClipMap } from '../data/assets'

/** Сколько длится переход между клипами, с. */
export const CROSSFADE_SEC = 0.15

/**
 * Что показывать бойцу. Порядок проверок — это приоритет:
 * смерть сильнее удара, удар сильнее замаха, замах сильнее покоя.
 */
export function actorState(input: {
  alive: boolean
  /** Идёт ли анимация смерти прямо сейчас. */
  dying: boolean
  /** Недавно получил по себе (в пределах длительности клипа hit). */
  hurt: boolean
  /** Недавно ударил сам. */
  attacking: boolean
}): ActorState {
  if (input.dying || !input.alive) return 'death'
  if (input.attacking) return 'attack'
  if (input.hurt) return 'hit'
  return 'idle'
}

/**
 * Имя клипа под состояние с деградацией.
 *
 * Модель может не иметь нужного клипа — тогда в реестре стоит null, и
 * показывать надо ближайшее осмысленное, а не застывать в T-позе:
 * нет `hit` — продолжаем то, что шло; нет `attack` — тоже; нет `death` —
 * отдаём null, и сцена ограничится вспышкой.
 */
export function clipFor(clips: ClipMap, state: ActorState): string | null {
  const direct = clips[state]
  if (direct) return direct
  if (state === 'death') return null
  // Для attack и hit запасной вариант — покой: он есть у любой модели,
  // и лучше стоящий боец, чем сломанная поза.
  return clips.idle
}

/**
 * Множитель скорости клипа атаки, чтобы она ЗАКАНЧИВАЛАСЬ на ударе.
 *
 * Момент попадания берётся из шины событий, а не из анимации: иначе при
 * смене оружия числа и картинка разъедутся. Здесь только подгонка длины —
 * клип должен уложиться в замах.
 *
 * Потолок нужен обоим краям: у двуручника замах 3.4 с, и растянутая
 * впятеро анимация выглядит как замедленная съёмка; у кинжала с haste
 * замах уходит за десятые доли, и без потолка клип превращается в судорогу.
 */
export const ATTACK_TIMESCALE_MIN = 0.5
export const ATTACK_TIMESCALE_MAX = 4

export function attackTimeScale(clipDurationSec: number, swingTimeSec: number): number {
  if (!Number.isFinite(clipDurationSec) || clipDurationSec <= 0) return 1
  if (!Number.isFinite(swingTimeSec) || swingTimeSec <= 0) return ATTACK_TIMESCALE_MAX
  const raw = clipDurationSec / swingTimeSec
  return Math.min(ATTACK_TIMESCALE_MAX, Math.max(ATTACK_TIMESCALE_MIN, raw))
}
