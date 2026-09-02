// НЕПРЕРЫВНОСТЬ МЕТРИКИ СРАВНЕНИЯ.
//
// killsPerSecond из estimateCombatRate — единственная мера «лучше» в игре: по
// ней сравниваются предметы, считается прогноз зоны и оффлайн. Значит она
// обязана быть непрерывной и монотонной по каждому стату силы: прибавка к
// силе атаки не может РОНЯТЬ темп убийств, а соседние точки мелкой сетки не
// могут отличаться на десятки процентов. Прежняя модель квантовала цикл
// целыми боями и ударами (floor/ceil), и лишняя единица силы атаки
// перекидывала цикл с привала на смерть — темп падал втрое (откат 4a000e4).
//
// Проверяется на НАСТОЯЩЕЙ estimateCombatRate: статы подменяются прямо в
// блоке, чтобы двигать ровно одну ось и ничего больше.
import { describe, expect, it } from 'vitest'
import { estimateCombatRate } from './combat'
import { Decimal } from './numbers'
import { createInitialState, monsterFromTemplate, type GameState } from './state'
import { ensureStats, type StatBlock } from './stats'
import { representativeMonster, ZONES, type Zone } from '../data/zones'
import { RATE_CONTINUITY_GRID, RATE_CONTINUITY_MAX_STEP } from '../data/balance'
import { averageGear } from './simulate'

/** Зона, куда игра приводит героя этого уровня. */
function zoneFor(level: number): Zone {
  return (
    ZONES.find((z) => level >= z.monsterLevelRange.min && level <= z.monsterLevelRange.max) ??
    ZONES[ZONES.length - 1]
  )
}

/**
 * Одетый по уровню герой против типичного моба зоны. Средний комплект своего
 * уровня, а не `referenceBuild`: тот строит эталонное прохождение (десятки
 * секунд) и по правилам живёт в дорогом наборе, а этот тест — в быстром.
 */
function facing(level: number, zone: Zone): GameState {
  const state = ensureStats({
    ...createInitialState(1),
    level: new Decimal(level),
    equipment: averageGear(level),
    currentZoneId: zoneFor(level).id,
    statsDirty: true,
  })
  return { ...state, monster: monsterFromTemplate(representativeMonster(zone)) }
}

function withStats(state: GameState, patch: Partial<StatBlock>): GameState {
  return { ...state, stats: { ...state.stats, ...patch } }
}

/** Ось сетки: t идёт от 1 - halfWidth до 1 + halfWidth. */
interface Axis {
  id: string
  /** Растёт ли темп по этой оси у модели уже сейчас (крит войдёт в поток позже). */
  grows: boolean
  at: (stats: StatBlock, t: number) => Partial<StatBlock>
}

/** Доля 0..1 вдоль сетки — для осей, у которых опорного значения нет. */
const share = (t: number) => (t - (1 - RATE_CONTINUITY_GRID.halfWidth)) / (2 * RATE_CONTINUITY_GRID.halfWidth)

const AXES: Axis[] = [
  { id: 'сила атаки', grows: true, at: (s, t) => ({ attackPower: s.attackPower.times(t) }) },
  { id: 'крит', grows: false, at: (_s, t) => ({ critChance: share(t) * 0.6 }) },
  {
    id: 'скорость (haste)',
    grows: true,
    at: (s, t) => {
      const haste = share(t) * 0.6
      return {
        haste,
        swingTime: s.weaponSpeed / (1 + haste),
        offhandSwingTime: s.offhandSpeed / (1 + haste),
      }
    },
  },
  { id: 'живучесть (maxHp)', grows: true, at: (s, t) => ({ maxHp: s.maxHp.times(t) }) },
  { id: 'броня', grows: true, at: (_s, t) => ({ damageReduction: share(t) * 0.6 }) },
]

const SCENARIOS: Array<{ name: string; state: () => GameState }> = [
  ...[25, 55, 85].map((level) => ({
    name: `герой ${level} уровня в своей зоне`,
    state: () => facing(level, zoneFor(level)),
  })),
  {
    // Тонкий лёд: низкий порог привала и зона глубже — здесь прежняя модель
    // перекидывала цикл с привала на смерть одной единицей стата.
    name: 'герой 55 уровня, порог привала 0.3, зона на восемь уровней глубже',
    state: () => withStats(facing(55, zoneFor(63)), { restThreshold: 0.3 }),
  },
]

function grid(): number[] {
  const { points, halfWidth } = RATE_CONTINUITY_GRID
  return Array.from({ length: points }, (_, i) => 1 - halfWidth + (2 * halfWidth * i) / (points - 1))
}

describe('killsPerSecond непрерывен и монотонен по статам силы', () => {
  const rows: string[] = []
  for (const scenario of SCENARIOS) {
    for (const axis of AXES) {
      it(`${scenario.name}: ${axis.id}`, () => {
        const base = scenario.state()
        const kps = grid().map((t) =>
          estimateCombatRate(withStats(base, axis.at(base.stats, t))).killsPerSecond.toNumber(),
        )
        // Шаг мерится ДОЛЕЙ ОТ НАИБОЛЬШЕГО темпа на сетке, а не от соседа:
        // у самого края смерти темп уходит в ноль, и «относительно соседа»
        // любая непрерывная функция дала бы бесконечный процент.
        const scale = Math.max(...kps)
        let maxStep = 0
        for (let i = 1; i < kps.length; i += 1) {
          const where = `${axis.id}, точка ${i}: ${kps[i - 1].toFixed(5)} -> ${kps[i].toFixed(5)}`
          // Не убывает: прибавка к стату не может ронять темп.
          expect(kps[i], where).toBeGreaterThanOrEqual(kps[i - 1] * (1 - 1e-9))
          if (scale > 0) {
            const step = (kps[i] - kps[i - 1]) / scale
            maxStep = Math.max(maxStep, step)
            // Без ступенек: соседние точки мелкой сетки близки.
            expect(step, where).toBeLessThanOrEqual(RATE_CONTINUITY_MAX_STEP)
          }
        }
        // Ось не пустая: там, где стат уже входит в модель, темп по ней растёт.
        if (axis.grows) expect(kps[kps.length - 1], axis.id).toBeGreaterThan(kps[0])
        rows.push(`${scenario.name} · ${axis.id}: макс. шаг ${(maxStep * 100).toFixed(2)}%`)
      })
    }
  }
  it('таблица шагов', () => {
    // eslint-disable-next-line no-console
    console.log(rows.join('\n'))
    expect(rows.length).toBe(SCENARIOS.length * AXES.length)
  })
})
