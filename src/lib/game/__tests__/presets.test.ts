// Пресеты для съёмки скриншотов: json в __fixtures__/presets — то, что грузит
// игра по ?state=. Тест их перегенерирует (UPDATE_PRESETS=1) и держит контракт:
// каждый пресет обязан читаться ТЕМ ЖЕ путём загрузки сейва, что и живой сейв.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { migrateSave, stateFromPayload } from '../save'
import { PRESET_NAMES, presetPayload, type PresetName } from '../__fixtures__/presets/build'

const DIR = new URL('../__fixtures__/presets/', import.meta.url)
const fileFor = (name: PresetName) => new URL(`${name}.json`, DIR)

// Перегенерация по требованию: числа пресетов детерминированы, поэтому
// повторный запуск без изменений в коде даёт байт-в-байт тот же json.
const shouldUpdate = process.env.UPDATE_PRESETS === '1'

describe('пресеты для скриншотов', () => {
  it.each(PRESET_NAMES)('%s: json на месте и совпадает с генератором', (name) => {
    const expected = JSON.stringify(presetPayload(name), null, 2) + '\n'
    const file = fileFor(name)
    if (shouldUpdate || !existsSync(file)) {
      writeFileSync(file, expected)
      if (!shouldUpdate) {
        throw new Error(`Пресет ${name}.json создан — перезапусти тест.`)
      }
    }
    expect(readFileSync(file, 'utf8')).toBe(expected)
  })

  it.each(PRESET_NAMES)('%s: читается обычным путём загрузки сейва', (name) => {
    const raw = JSON.parse(readFileSync(fileFor(name), 'utf8'))
    // migrateSave — та же цепочка миграций, что и у живого сейва: когда
    // версия сейва поднимется, пресеты обязаны доехать по ней, а не сломаться.
    const migrated = migrateSave(raw)
    expect(migrated).not.toBeNull()
    const state = stateFromPayload(migrated!)
    expect(state.level.gt(0)).toBe(true)
    expect(state.stats.maxHp.gt(0)).toBe(true)
    expect(state.currentHp.lte(state.stats.maxHp)).toBe(true)
    expect(state.currentMana.lte(state.stats.maxMana)).toBe(true)
    expect(state.monster.maxHp.gt(0)).toBe(true)
  })

  it('пресеты отличаются друг от друга — иначе снимки меряют одно и то же', () => {
    const states = PRESET_NAMES.map((name) => stateFromPayload(migrateSave(
      JSON.parse(readFileSync(fileFor(name), 'utf8')),
    )!))
    const [fresh, mid, rich] = states
    expect(fresh.level.lt(mid.level)).toBe(true)
    expect(mid.level.lt(rich.level)).toBe(true)
    expect(fresh.inventory.length).toBe(0)
    expect(rich.inventory.length).toBeGreaterThan(mid.inventory.length)
    // Богатый герой обязан показывать то, чего нет у остальных.
    expect(Object.keys(rich.dungeonsCleared).length).toBeGreaterThan(0)
    expect(Object.keys(rich.talents).length).toBeGreaterThan(Object.keys(mid.talents).length)
  })
})
