// Как сцена показывает смерть моба.
//
// Задача не «проиграть анимацию», а НЕ НАКОПИТЬ их. Убийства идут с той
// частотой, которую задаёт бой: на сильном герое в слабой зоне, при
// отладочном ускорении и при возврате из оффлайна моб умирает чаще, чем
// длится любая анимация. Очередь анимаций в такой ситуации растёт вечно.
//
// Отсюда правило: сцена сама решает, что показать, по НАБЛЮДАЕМОЙ частоте
// убийств. Всё считается чистой функцией — темп боя проверяется в node,
// а не подбором на глаз в браузере.

import { FAST_KILL_THRESHOLD_PER_SEC } from '../data/balance'

/** Что показать на смерть моба. */
export type DeathMode =
  /** Полная анимация: моб оседает и гаснет. */
  | 'animate'
  /** Короткая вспышка: убийства идут чаще, чем длится анимация. */
  | 'flash'
  /** Ничего: возврат из оффлайна — там показывается отчёт, а не бой. */
  | 'none'

/** Сколько длится полная анимация смерти, мс. */
export const DEATH_ANIM_MS = 420

export interface KillRateMeter {
  /** Отметить убийство в момент now (мс). */
  record(now: number): void
  /** Убийств в секунду по последним отметкам. */
  perSecond(now: number): number
  reset(): void
}

/**
 * Счётчик частоты убийств по скользящему окну.
 * Окно, а не «время с прошлого убийства»: одиночная пауза между двумя
 * быстрыми сериями не должна включать полную анимацию посреди мясорубки.
 */
export function createKillRateMeter(windowMs = 3000): KillRateMeter {
  let stamps: number[] = []
  return {
    record(now) {
      stamps.push(now)
      // Чистим тут же: иначе массив растёт всё время, пока идёт бой.
      const cutoff = now - windowMs
      if (stamps.length > 64 || (stamps.length > 0 && stamps[0] < cutoff)) {
        stamps = stamps.filter((t) => t >= cutoff)
      }
    },
    perSecond(now) {
      const cutoff = now - windowMs
      const recent = stamps.filter((t) => t >= cutoff)
      return recent.length / (windowMs / 1000)
    },
    reset() {
      stamps = []
    },
  }
}

/**
 * Что показать на смерть. Возврат из оффлайна не проигрывает ничего:
 * за восемь часов мобов накопилось столько, что любая анимация — ложь.
 */
export function deathMode(
  killsPerSecond: number,
  options: { offline?: boolean; threshold?: number } = {},
): DeathMode {
  if (options.offline) return 'none'
  const threshold = options.threshold ?? FAST_KILL_THRESHOLD_PER_SEC
  return killsPerSecond > threshold ? 'flash' : 'animate'
}

/**
 * Доля проигранной анимации смерти 0..1 для момента now.
 * По ней меш оседает и гаснет; на единице его убирают со сцены.
 */
export function deathProgress(startedAt: number, now: number, durationMs = DEATH_ANIM_MS): number {
  if (durationMs <= 0) return 1
  return Math.max(0, Math.min(1, (now - startedAt) / durationMs))
}
