// ВМЕСТИМОСТЬ СУМКИ — ОДНО ЧИСЛО, И СПРАШИВАТЬ ЕГО МОЖНО ОДНИМ СПОСОБОМ.
//
// Находка: после покупки расширения счётчик показывал «28/24». Вещи лежали
// СВЕРХ знаменателя — то есть логика уже знала про расширения, а подпись всё
// ещё читала `INVENTORY_SIZE`, которую CLAUDE.md прямо называет БАЗОЙ, а не
// итогом. Чинить подпись было бы починкой симптома: второй способ узнать
// вместимость остался бы на месте и разъехался бы снова.
//
// Здесь проверяется ровно то, что этого второго способа больше нет:
// производная сходится с логикой на каждой ступени лестницы, «сумка полна»
// наступает на том же числе, что в счётчике, купленное переживает сейв,
// и НИ ОДИН боевой исходник не читает базу напрямую.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState } from './tick'
import { DEFAULT_CLASS } from '../data/classes'
import { INVENTORY_SIZE } from '../data/balance'
import { GOLD_UPGRADES } from '../data/upgrades'
import { inventorySize, buyUpgrade } from './upgrades'
import { stashLoot } from './loot'
import { saveGame, loadGame, type SaveStorage } from './save'
import type { GameState } from './state'
import type { Item } from '../types'

const GAME_DIR = new URL('./', import.meta.url)
const UI_DIR = new URL('../ui/', import.meta.url)

/** Ступени лестницы, которые расширяют сумку, в порядке покупки. */
const BAG_STEPS = GOLD_UPGRADES.filter((u) => u.effect.kind === 'bag')

/**
 * Комментарии — не потребители. Объяснение «почему здесь НЕ база» само
 * содержит её имя, и сканер по сырому тексту ловил бы собственную сноску.
 */
function code(source: string): string {
  const keep = (block: string) => '\n'.repeat((block.match(/\n/g) ?? []).length)
  return source
    .replace(/<!--[\s\S]*?-->/g, keep)
    .replace(/\/\*[\s\S]*?\*\//g, keep)
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

/** Герой, которому лестница покупок доступна целиком: сотый уровень и золото. */
function hero(): GameState {
  const state = createInitialState(1, DEFAULT_CLASS.id, 1)
  return { ...state, level: new Decimal(100), gold: new Decimal('1e30') }
}

function makeStorage(): SaveStorage {
  const data = new Map<string, string>()
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

function junk(i: number): Item {
  return {
    id: `junk-${i}`,
    name: `Хлам ${i}`,
    slot: 'head',
    rarity: 'common',
    level: 1,
    mods: [],
  }
}

describe('вместимость сумки — одно число на всех', () => {
  it('лестница расширений вообще есть, иначе тесту нечего проверять', () => {
    expect(BAG_STEPS.length).toBeGreaterThanOrEqual(4)
  })

  it('на каждой ступени производная равна базе плюс всё купленное', () => {
    let state = hero()
    let expected = INVENTORY_SIZE
    expect(inventorySize(state)).toBe(expected)
    for (const step of BAG_STEPS) {
      state = buyUpgrade(state, step.id)
      expect(state.purchasedUpgradeIds, `ступень ${step.id} не куплена`).toContain(step.id)
      expected += step.effect.kind === 'bag' ? step.effect.slots : 0
      expect(inventorySize(state), `после ${step.id}`).toBe(expected)
    }
    // Ради этого всё и затевалось: после покупок число ОТЛИЧАЕТСЯ от базы.
    expect(expected).toBeGreaterThan(INVENTORY_SIZE)
  })

  it('«сумка полна» наступает ровно на том числе, что в счётчике', () => {
    // Именно это расходилось на экране: вещей 28, знаменатель 24.
    let state = hero()
    for (const step of BAG_STEPS) state = buyUpgrade(state, step.id)
    const size = inventorySize(state)

    state = { ...state, inventory: Array.from({ length: size - 1 }, (_, i) => junk(i)) }
    const almost = stashLoot(state, junk(999))
    expect(almost.inventory).toHaveLength(size)

    // Ещё одна находка в полную сумку места уже не находит.
    const full = stashLoot(almost, junk(1000))
    expect(full.inventory).toHaveLength(size)
  })

  it('купленное расширение переживает сохранение и загрузку', () => {
    // Расширение куплено ЗА ЗОЛОТО. Потерять его при загрузке — потерять
    // прогресс игрока, и это недопустимо ни при какой правке лестницы.
    let state = hero()
    for (const step of BAG_STEPS) state = buyUpgrade(state, step.id)
    const size = inventorySize(state)
    expect(size).toBeGreaterThan(INVENTORY_SIZE)

    const storage = makeStorage()
    saveGame(state, { storage, now: () => 0 })
    const back = loadGame({ storage, now: () => 0 })
    expect(back.kind, 'сейв не прочитался').toBe('loaded')
    if (back.kind !== 'loaded') return
    expect(inventorySize(back.state), 'расширения потерялись при загрузке').toBe(size)
  })

  it('базу INVENTORY_SIZE не читает ни один боевой исходник, кроме названных', () => {
    // Список поимённый и с причиной — он же документация о том, где базе
    // ЗАКОННО быть. Всё остальное обязано спрашивать `inventorySize(state)`.
    const allowed: Record<string, string> = {
      'upgrades.ts': 'сам селектор: база плюс купленное',
      'save.ts': 'миграция 19→20 работает с СЫРЫМ сейвом, покупок в нём быть не может',
    }
    const strays: string[] = []
    const scan = (dir: URL, prefix: string) => {
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.ts') && !name.endsWith('.svelte')) continue
        if (name.endsWith('.test.ts') || name.endsWith('.d.ts')) continue
        if (allowed[name]) continue
        if (code(readFileSync(new URL(name, dir), 'utf8')).includes('INVENTORY_SIZE')) {
          strays.push(prefix + name)
        }
      }
    }
    scan(GAME_DIR, 'game/')
    scan(UI_DIR, 'ui/')
    const app = code(readFileSync(new URL('../../App.svelte', import.meta.url), 'utf8'))
    if (app.includes('INVENTORY_SIZE')) strays.push('App.svelte')
    expect(strays, 'кто-то снова считает вместимость по базе').toEqual([])
  })

  // ЗАВЕДОМО БИТЫЕ ОБРАЗЦЫ. Сканер, которому нечего сказать, зелёный ровно
  // так же, как сканер, который перестал работать.
  it('сканер видит базу в коде и не видит её в объяснении', () => {
    expect(code("const n = INVENTORY_SIZE\n")).toContain('INVENTORY_SIZE')
    expect(code("// здесь НЕ INVENTORY_SIZE, а производная\n")).not.toContain('INVENTORY_SIZE')
    expect(code("/* про INVENTORY_SIZE */\nconst n = 1\n")).not.toContain('INVENTORY_SIZE')
    expect(code("<!-- INVENTORY_SIZE -->\n<b/>\n")).not.toContain('INVENTORY_SIZE')
  })

  it('база наружу из game/index.ts не отдаётся вовсе', () => {
    // Пока её можно было импортировать из публичного индекса, счётчик на
    // кнопке её и импортировал. Сторож на строку, а не на намерение.
    const index = code(readFileSync(new URL('index.ts', GAME_DIR), 'utf8'))
    expect(index).not.toMatch(/\bINVENTORY_SIZE\b/)
    expect(index).toMatch(/\binventorySize\b/)
  })
})
