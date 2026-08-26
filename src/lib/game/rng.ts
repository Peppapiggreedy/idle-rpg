// Детерминированная случайность. Внутри src/lib/game Math.random не вызывается:
// весь поток случайных чисел выводится из сида, чтобы прогоны воспроизводились.
export type Rng = () => number

// mulberry32: быстрый 32-битный PRNG, один сид -> воспроизводимый поток [0, 1).
export function createRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Свежий сид без Math.random: миллисекунды времени, перемешанные целочисленным
// хешем (обе половины 53-битного Date.now участвуют).
export function randomSeed(now: () => number = Date.now): number {
  const t = now()
  let h = (Math.floor(t / 4294967296) ^ t) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}
