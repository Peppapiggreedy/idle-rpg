import { describe, expect, it } from 'vitest'
import { createGameLoop, MAX_STEPS_PER_FRAME, STEP_MS } from './loop'

// Ручной планировщик кадров вместо requestAnimationFrame и настоящих часов.
function makeHarness() {
  let time = 0
  let pending: Array<(t: number) => void> = []
  return {
    now: () => time,
    raf: (cb: (t: number) => void) => {
      pending.push(cb)
      return pending.length
    },
    caf: () => {},
    frame(advanceMs: number) {
      time += advanceMs
      const cbs = pending
      pending = []
      for (const cb of cbs) cb(time)
    },
  }
}

describe('createGameLoop', () => {
  it('10 секунд кадрами по 100 мс — ровно 100 шагов по STEP_MS', () => {
    const h = makeHarness()
    let steps = 0
    let totalDt = 0
    const loop = createGameLoop({
      step: (dt) => {
        steps += 1
        totalDt += dt
      },
      now: h.now,
      raf: h.raf,
      caf: h.caf,
    })
    loop.start()
    for (let i = 0; i < 100; i++) h.frame(100)
    expect(steps).toBe(100)
    expect(totalDt).toBe(10_000)
    loop.stop()
  })

  it('копит дробные кадры: 1000 мс кадрами по 16 мс — 10 шагов', () => {
    const h = makeHarness()
    let steps = 0
    const loop = createGameLoop({ step: () => steps++, now: h.now, raf: h.raf, caf: h.caf })
    loop.start()
    for (let i = 0; i < 625; i++) h.frame(16) // 625 * 16 = 10000 мс
    expect(steps).toBe(100)
    loop.stop()
  })

  it('после заморозки вкладки делает не больше MAX_STEPS_PER_FRAME шагов и сбрасывает долг', () => {
    const h = makeHarness()
    let steps = 0
    const loop = createGameLoop({ step: () => steps++, now: h.now, raf: h.raf, caf: h.caf })
    loop.start()
    h.frame(60_000) // «вкладка была заморожена минуту»
    expect(steps).toBe(MAX_STEPS_PER_FRAME)
    steps = 0
    h.frame(STEP_MS) // долг сброшен: следующий кадр даёт обычные 1-2 шага, а не сотни
    expect(steps).toBeLessThanOrEqual(2)
    loop.stop()
  })

  it('setSpeed(10): игровое время течёт в 10 раз быстрее реального', () => {
    const h = makeHarness()
    let steps = 0
    const loop = createGameLoop({ step: () => steps++, now: h.now, raf: h.raf, caf: h.caf })
    loop.start()
    loop.setSpeed(10)
    // 10 кадров по 100 мс реального времени = 10 c игрового = 100 шагов
    for (let i = 0; i < 10; i++) h.frame(100)
    expect(steps).toBe(100)
    loop.stop()
  })

  it('setSpeed(100) уважает лимит шагов за кадр и не копит бесконечный долг', () => {
    const h = makeHarness()
    let steps = 0
    const loop = createGameLoop({ step: () => steps++, now: h.now, raf: h.raf, caf: h.caf })
    loop.start()
    loop.setSpeed(100)
    // Каждый кадр приносит 10 c игрового времени (100 шагов), но за кадр
    // исполняется не больше MAX_STEPS_PER_FRAME; излишек сбрасывается.
    for (let i = 0; i < 5; i++) h.frame(100)
    expect(steps).toBe(5 * MAX_STEPS_PER_FRAME)
    // Возврат к ×1 — обычный темп без накопленного долга.
    loop.setSpeed(1)
    steps = 0
    h.frame(100)
    expect(steps).toBeLessThanOrEqual(2)
    loop.stop()
  })

  it('после stop шаги не выполняются', () => {
    const h = makeHarness()
    let steps = 0
    const loop = createGameLoop({ step: () => steps++, now: h.now, raf: h.raf, caf: h.caf })
    loop.start()
    h.frame(100)
    loop.stop()
    h.frame(1000)
    expect(steps).toBe(1)
  })
})

describe('лимит частоты кадров', () => {
  it('кадры пропускаются, но игровое время не теряется', () => {
    const h = makeHarness()
    let steps = 0
    const loop = createGameLoop({ step: () => (steps += 1), now: h.now, raf: h.raf, caf: h.caf })
    loop.setFpsLimit(30) // не чаще одного кадра в 33.3 мс
    loop.start()
    // Сто кадров по 10 мс = 1000 мс игрового времени. Большинство кадров
    // лимит отбросит, но накопленное время придёт следующим и отыграется.
    for (let i = 0; i < 100; i++) h.frame(10)
    // 1000 мс / STEP_MS = 10 шагов — ровно столько же, сколько без лимита.
    expect(steps).toBe(1000 / STEP_MS)
  })

  it('без лимита и с лимитом за одно и то же время выходит одно и то же', () => {
    const run = (fps: number | null) => {
      const h = makeHarness()
      let steps = 0
      const loop = createGameLoop({ step: () => (steps += 1), now: h.now, raf: h.raf, caf: h.caf })
      loop.setFpsLimit(fps)
      loop.start()
      for (let i = 0; i < 300; i++) h.frame(16) // ~4.8 секунды при 60 кадрах
      return steps
    }
    expect(run(30)).toBe(run(null))
    expect(run(60)).toBe(run(null))
  })

  it('лимит режет число пробуждений и снимается обратно', () => {
    const h = makeHarness()
    const metrics: number[] = []
    const loop = createGameLoop({
      step: () => {},
      onMetrics: (m) => metrics.push(m.fps),
      now: h.now,
      raf: h.raf,
      caf: h.caf,
    })
    loop.setFpsLimit(30)
    loop.start()
    // Секунда кадрами по 10 мс: без лимита было бы 100 пробуждений.
    // Лимит 30 задаёт МИНИМАЛЬНЫЙ промежуток 33.3 мс, а кадры приходят раз
    // в 10 мс — значит просыпаемся на каждом четвёртом, раз в 40 мс, то есть
    // 25 раз за секунду. Достижимая частота всегда НЕ ВЫШЕ запрошенной:
    // лимит — это пол промежутка, а не обещание ровно тридцати кадров.
    for (let i = 0; i < 100; i++) h.frame(10)
    expect(metrics[0]).toBe(25)

    // Снимаем лимит — просыпаемся на каждом кадре.
    metrics.length = 0
    loop.setFpsLimit(null)
    for (let i = 0; i < 100; i++) h.frame(10)
    expect(metrics[0]).toBe(100)
    loop.stop()
  })
})
