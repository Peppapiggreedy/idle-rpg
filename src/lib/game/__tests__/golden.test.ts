// Характеризационный (golden) тест: фиксирует поведение игры «как есть».
// Если рефакторинг меняет любой снимок — он изменил поведение, и это провал.
// Осознанное изменение баланса = удалить эталон, перезапустить тест дважды
// и закоммитить новый golden.json с объяснением в PR.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STEP_MS } from '../loop'
import { createRng } from '../rng'
import { sellPrice } from '../loot'
import { createInitialState, tick, type GameState } from '../tick'

const SNAP_DIR = new URL('./__snapshots__/', import.meta.url)
const SNAP_FILE = new URL('./__snapshots__/golden.json', import.meta.url)

const SEED = 12345
const TOTAL_STEPS = 36_000 // 1 час игрового времени шагами по 100 мс
const SNAPSHOT_AT = [3_000, 12_000, 36_000]

// Все Decimal — строками, чтобы эталон читался глазами и диффался в PR.
function fingerprint(s: GameState) {
  return {
    gold: s.gold.toString(),
    level: s.level.toString(),
    currentXp: s.currentXp.toString(),
    damagePerSwing: s.damagePerSwing.toString(),
    totalTicks: s.totalTicks.toString(),
    inventoryCount: s.inventory.length,
    inventorySellTotal: s.inventory
      .reduce((sum, item) => sum.plus(sellPrice(item)), s.gold.minus(s.gold))
      .toString(),
  }
}

describe('golden: час симуляции с сидом 12345', () => {
  it('снимки на шагах 3000/12000/36000 совпадают с эталоном', () => {
    const rng = createRng(SEED)
    let state = createInitialState(SEED)
    const snapshots: Record<string, ReturnType<typeof fingerprint>> = {}
    for (let step = 1; step <= TOTAL_STEPS; step++) {
      state = tick(state, STEP_MS, rng)
      if (SNAPSHOT_AT.includes(step)) snapshots[`step-${step}`] = fingerprint(state)
    }

    if (!existsSync(SNAP_FILE)) {
      mkdirSync(SNAP_DIR, { recursive: true })
      writeFileSync(SNAP_FILE, JSON.stringify(snapshots, null, 2) + '\n')
      throw new Error(
        'Эталон создан: src/lib/game/__tests__/__snapshots__/golden.json — перезапусти тест.',
      )
    }

    const golden = JSON.parse(readFileSync(SNAP_FILE, 'utf8'))
    expect(snapshots).toEqual(golden)
  })
})
