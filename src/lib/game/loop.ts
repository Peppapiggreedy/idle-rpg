// Игровой цикл: requestAnimationFrame + аккумулятор времени с фиксированным
// шагом симуляции. Сам цикл ничего не знает про состояние игры и Svelte —
// он только вызывает переданный колбэк step(dtMs) нужное число раз.

export const STEP_MS = 100
// Защита от «спирали смерти»: после долгой заморозки вкладки не пытаемся
// отыграть весь накопленный долг, а делаем не больше 10 шагов за кадр.
export const MAX_STEPS_PER_FRAME = 10

export interface LoopMetrics {
  fps: number // кадров за последнюю секунду
  tps: number // шагов симуляции за последнюю секунду
}

export interface GameLoopOptions {
  /** Один фиксированный шаг симуляции; вызывается с dtMs = STEP_MS. */
  step: (dtMs: number) => void
  /** Раз в секунду получает свежие FPS/TPS (для дебаг-оверлея). */
  onMetrics?: (m: LoopMetrics) => void
  /** Подменяемые зависимости для тестов; по умолчанию — браузерные. */
  now?: () => number
  raf?: (cb: (t: number) => void) => number
  caf?: (id: number) => void
}

export interface GameLoop {
  start(): void
  stop(): void
  readonly running: boolean
}

export function createGameLoop(opts: GameLoopOptions): GameLoop {
  const now = opts.now ?? (() => performance.now())
  const raf = opts.raf ?? ((cb) => requestAnimationFrame(cb))
  const caf = opts.caf ?? ((id) => cancelAnimationFrame(id))

  let running = false
  let rafId = 0
  let last = 0
  let accumulator = 0

  // Счётчики метрик за текущее односекундное окно.
  let frames = 0
  let ticks = 0
  let windowStart = 0

  function frame(): void {
    if (!running) return
    const t = now()
    accumulator += t - last
    last = t

    let steps = 0
    while (accumulator >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      opts.step(STEP_MS)
      accumulator -= STEP_MS
      steps += 1
    }
    // Не смогли отыграть долг за кадр — сбрасываем его: длинное отсутствие
    // компенсирует оффлайн-прогресс (пункт 4 дорожной карты), не цикл.
    if (accumulator > STEP_MS) accumulator = STEP_MS

    frames += 1
    ticks += steps
    if (t - windowStart >= 1000) {
      opts.onMetrics?.({ fps: frames, tps: ticks })
      frames = 0
      ticks = 0
      windowStart = t
    }

    rafId = raf(frame)
  }

  return {
    get running() {
      return running
    },
    start() {
      if (running) return
      running = true
      last = now()
      windowStart = last
      accumulator = 0
      frames = 0
      ticks = 0
      rafId = raf(frame)
    },
    stop() {
      if (!running) return
      running = false
      caf(rafId)
    },
  }
}
