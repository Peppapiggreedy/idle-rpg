// Процедурная расстановка пропсов зоны.
//
// Чистая функция: на вход конфиг зоны, на выход список «что, где, какого
// размера». Ни three, ни DOM — поэтому расстановка проверяется в node,
// а воспроизводимость видна тестом, а не на глаз.
//
// Случайность берётся из game/rng.ts, как требуют правила проекта, но
// СВОИМ потоком от сида зоны. Вычерпывать поток симуляции отсюда нельзя:
// ход игры стал бы зависеть от того, открыта вкладка или нет.

import { createRng, type Rng } from '../game/rng'
import type { PropCluster, PropShape, SceneConfig } from '../data/scenery'

export interface PlacedProp {
  shape: PropShape
  /** Id пропса из data/assets.ts; null — кластер живёт примитивом. */
  model: string | null
  color: number
  x: number
  z: number
  scale: number
  /** Поворот вокруг вертикали, радианы: одинаковые конусы иначе видны сразу. */
  rotation: number
}

/**
 * Радиус, ближе которого пропсы не ставятся: там дерутся, и куст посреди
 * площадки закрыл бы бой.
 */
export const CLEAR_RADIUS = 4.5

/**
 * Равномерное число в [min, max). randRange из game/rng работает с Decimal,
 * а позиции пропсов неограниченно не растут — это обычные number, как
 * требуют правила проекта. Сам поток случайности при этом тот же самый,
 * из createRng: своего генератора здесь не заводится.
 */
function between(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng()
}

/** Расстановка по кольцу между CLEAR_RADIUS и радиусом площадки. */
export function placeProps(config: SceneConfig, groundRadius: number): PlacedProp[] {
  const rng = createRng(config.seed)
  const placed: PlacedProp[] = []
  const outer = Math.max(CLEAR_RADIUS + 0.5, groundRadius - 0.5)

  for (const cluster of config.props) {
    for (let i = 0; i < cluster.count; i += 1) {
      // Броски строго по порядку: угол, радиус, размер, поворот. Порядок —
      // часть определения вида зоны: переставишь местами, и расстановка
      // сменится при том же сиде.
      const angle = between(rng, 0, Math.PI * 2)
      // Корень равномерно распределяет точки ПО ПЛОЩАДИ кольца; без него
      // всё сбивается к центру, и опушка выглядит вытоптанной.
      const t = Math.sqrt(rng())
      const radius = CLEAR_RADIUS + t * (outer - CLEAR_RADIUS)
      const scale = between(rng, cluster.scaleRange[0], cluster.scaleRange[1])
      const rotation = between(rng, 0, Math.PI * 2)
      placed.push({
        shape: cluster.shape,
        model: cluster.model ?? null,
        color: cluster.color,
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        scale,
        rotation,
      })
    }
  }
  return placed
}

/** Сколько всего пропсов даст конфиг — для бюджета и тестов. */
export function propCount(clusters: PropCluster[]): number {
  return clusters.reduce((sum, c) => sum + c.count, 0)
}

/**
 * Доля подмешивания тревожного света от множителя ярости.
 * 1 (ярости нет) — ноль; дальше растёт и упирается в потолок.
 */
export function enrageTintAmount(multiplier: number, max: number): number {
  if (!Number.isFinite(multiplier) || multiplier <= 1) return 0
  return Math.min(max, (multiplier - 1) * 0.5)
}
