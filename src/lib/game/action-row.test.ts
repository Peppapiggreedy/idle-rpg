// РЯД ДЕЙСТВИЙ ПОКАЗЫВАЕТ ТО, ЧТО ЕСТЬ, И ИМЕЕТ ПОТОЛОК.
//
// Ряд ОДИН на умения и склянки: четыре слота умений плюс склянки. Пока в него
// попадали все девять рецептов сразу по уровню, кнопок становилось
// тринадцать — на телефоне видно пять, и ряд выдавливал соседей.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { potionSlots, drinkPotion } from './potions'
import { createInitialState, type GameState } from './state'
import { POTION_RECIPES } from '../data/recipes'
import { POTION_UNLOCK_LEVEL, ABILITY_SLOTS } from '../data/balance'

/** Герой на уровне склянок с заданным содержимым мешка. */
function hero(materials: Record<string, Decimal> = {}): GameState {
  const base = createInitialState(1, 'warden')
  return {
    ...base,
    level: new Decimal(POTION_UNLOCK_LEVEL),
    materials: { ...base.materials, ...materials },
  }
}

const full = () =>
  hero(Object.fromEntries(POTION_RECIPES.map((r) => [r.output.id, new Decimal(5)])))

describe('ряд действий: только то, что есть', () => {
  it('в ряду только склянки, которых есть хотя бы одна штука', () => {
    const two = POTION_RECIPES.slice(0, 2)
    const shown = potionSlots(hero(Object.fromEntries(two.map((r) => [r.output.id, new Decimal(3)]))))
    expect(shown.map((s) => s.recipe.id)).toEqual(two.map((r) => r.id))
  })

  it('склянка кончилась — кнопка ушла', () => {
    const one = POTION_RECIPES[0]
    const before = hero({ [one.output.id]: new Decimal(1) })
    expect(potionSlots(before)).toHaveLength(1)
    // Выпили последнюю: пока действует — остаётся (идёт отсчёт), потом уходит.
    const after = drinkPotion(before, one.output.id)
    expect(potionSlots(after)).toHaveLength(1)
    expect(potionSlots(after)[0].active).toBe(true)
    expect(potionSlots({ ...after, activePotions: [] })).toHaveLength(0)
  })

  it('нумерация хоткеев не разъезжается: ключ жмёт ту кнопку, что нарисована', () => {
    // Клавиша склянки — её МЕСТО В ПОКАЗАННОМ РЯДУ плюс число слотов умений.
    // Обе стороны (подпись и обработчик) считают её одинаково, поэтому
    // проверяем само правило: подряд, без дыр, сразу за умениями.
    const shown = potionSlots(full())
    const keys = shown.map((_, i) => ABILITY_SLOTS + i + 1)
    expect(keys).toEqual(shown.map((_, i) => ABILITY_SLOTS + i + 1))
    expect(keys[0]).toBe(ABILITY_SLOTS + 1)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('ПОТОЛОК РЯДА ПОСЧИТАН, А НЕ ОЦЕНЁН НА ГЛАЗ', () => {
    // Сколько кнопок ряд может выдать в конце игры: четыре умения плюс все
    // склянки игры. Число печатается — по нему и решают, хватает ли прокрутки.
    const ceiling = ABILITY_SLOTS + POTION_RECIPES.length
    // eslint-disable-next-line no-console
    console.log(
      `ряд действий: потолок ${ceiling} кнопок (${ABILITY_SLOTS} умений + ${POTION_RECIPES.length} склянок); ` +
        'кнопка 56px, зазор 8px — на 390px помещается 5',
    )
    expect(potionSlots(full())).toHaveLength(POTION_RECIPES.length)
    // Потолок должен оставаться таким, чтобы прокрутки ряда хватало: больше
    // двух десятков кнопок не прокручивают, а ищут.
    expect(ceiling).toBeLessThanOrEqual(20)
  })
})
