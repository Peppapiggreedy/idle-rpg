// Телеметрия интервала решений. Проверяем то, ради чего она есть: медиану,
// порог тревоги и то, что наружу ничего не уходит.
import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { get } from 'svelte/store'
import {
  DECISION_WINDOW,
  gapsOf,
  isAlert,
  medianOf,
  recordDecision,
  refreshTelemetry,
  resetTelemetry,
  telemetry,
} from './telemetry'
import { DECISION_ALERT_SEC, DECISION_MAX_SEC, DECISION_MIN_SEC } from '../data/balance'

beforeEach(() => resetTelemetry())

describe('интервалы', () => {
  it('медиана, а не среднее: один долгий перерыв не красит всю сессию', () => {
    expect(medianOf([10, 20, 30])).toBe(20)
    expect(medianOf([10, 20, 30, 3000])).toBe(25)
    expect(medianOf([])).toBeNull()
  })

  it('интервалы считаются между соседними отметками', () => {
    expect(gapsOf([0, 1000, 3000])).toEqual([1, 2])
    expect(gapsOf([5000])).toEqual([])
  })

  it('первое решение интервала не даёт — сравнивать не с чем', () => {
    recordDecision('zone', 0)
    const snap = get(telemetry)
    expect(snap.count).toBe(1)
    expect(snap.medianSec).toBeNull()
    expect(snap.alert).toBe(false)
  })

  it('медиана появляется со второго решения и считает секунды', () => {
    recordDecision('zone', 0)
    recordDecision('equip', 60_000)
    recordDecision('talent', 120_000)
    expect(get(telemetry).medianSec).toBe(60)
    expect(get(telemetry).count).toBe(3)
  })

  it('«без решения» растёт само, а решение его обнуляет', () => {
    recordDecision('zone', 0)
    refreshTelemetry(45_000)
    expect(get(telemetry).sinceLastSec).toBe(45)
    recordDecision('equip', 50_000)
    expect(get(telemetry).sinceLastSec).toBe(0)
  })
})

describe('тревога', () => {
  it(`срабатывает, когда решать нечего дольше ${DECISION_ALERT_SEC} с`, () => {
    expect(isAlert(null)).toBe(false)
    expect(isAlert(DECISION_ALERT_SEC)).toBe(false)
    expect(isAlert(DECISION_ALERT_SEC + 1)).toBe(true)
  })

  it('здоровое окно уже порога тревоги — иначе порог ничего не ловит', () => {
    expect(DECISION_WINDOW.min).toBe(DECISION_MIN_SEC)
    expect(DECISION_WINDOW.max).toBe(DECISION_MAX_SEC)
    expect(DECISION_MAX_SEC).toBeLessThan(DECISION_ALERT_SEC)
  })

  it('редкие решения поднимают тревогу на живых данных', () => {
    recordDecision('zone', 0)
    recordDecision('equip', 300_000)
    recordDecision('talent', 600_000)
    expect(get(telemetry).medianSec).toBe(300)
    expect(get(telemetry).alert).toBe(true)
  })
})

describe('наружу ничего не уходит', () => {
  // Читаем КОД без комментариев: в комментариях запретные слова как раз
  // и объясняют, почему их тут нет.
  const source = readFileSync(new URL('./telemetry.ts', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n')

  it('в модуле нет ни сети, ни хранилища, ни идентификаторов', () => {
    // Локальная — значит локальная. Привычка «сохраним на всякий случай» и
    // есть то, как безобидный счётчик превращается в слежку.
    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'navigator.send', 'localStorage', 'sessionStorage', 'crypto.randomUUID']) {
      expect(source.includes(forbidden), forbidden).toBe(false)
    }
  })

  it('список видов решений закрытый и совпадает с тем, что меряет прогон', () => {
    // Прогон баланса считает находки, очки талантов и открывшиеся зоны;
    // здесь к ним добавлены настройки, которые снаружи не видны.
    const kinds = ['zone', 'equip', 'talent', 'rest-threshold', 'autocast', 'craft']
    for (const kind of kinds) expect(source).toContain(`'${kind}'`)
  })
})
