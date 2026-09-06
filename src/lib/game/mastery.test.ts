// МАСТЕРСТВО РАСТЁТ ДЕЛОМ, А НЕ УРОВНЕМ.
//
// До этой стадии профессия открывалась уровнем героя и больше ничем: дорос —
// знаешь всё, не дорос — не знаешь ничего. Промежуточного состояния не было,
// а именно в нём ремесло и живёт.
//
// Проверяется здесь ровно то, что делает мастерство мастерством: единственный
// вход (крафт), потолок у каждого рецепта, ступени на своих границах и то,
// что ветеран не начинает с нуля.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, tick, type GameState } from './tick'
import { createRng } from './rng'
import { craft, masteryGain, masteryOf } from './crafting'
import { RECIPES, RECIPE_BY_ID, masteryToKnow, recipeLevel, type RecipeDef } from '../data/recipes'
import {
  MASTERY_MAX,
  MASTERY_PER_CRAFT,
  MASTERY_PROFESSIONS,
  MASTERY_RANKS,
  MASTERY_RANK_STEP,
  hasMastery,
  masteryCeilingForLevel,
  masteryFromLevel,
  masteryRank,
  pointsToNextRank,
} from '../data/mastery'
import { readSave } from './save'

/** Герой, которому хватает всего: уровень, золото и полный мешок. */
function ready(patch: Partial<GameState> = {}): GameState {
  const base = createInitialState(1)
  const materials: Record<string, Decimal> = {}
  for (const recipe of RECIPES) {
    for (const input of recipe.inputs) materials[input.materialId] = new Decimal(999)
  }
  return {
    ...base,
    level: new Decimal(100),
    gold: new Decimal('1e18'),
    materials,
    ...patch,
  }
}

/** Первый рецепт профессии, который герой сотого уровня может собрать. */
function recipeFor(profession: string): RecipeDef {
  const found = RECIPES.find((r) => r.profession === profession && r.output.kind !== 'item')
  return found ?? RECIPES.filter((r) => r.profession === profession)[0]
}

describe('мастерство растёт крафтом и только им', () => {
  it('крафт в свою силу даёт прибавку', () => {
    const before = ready()
    const recipe = RECIPES.find((r) => r.profession === 'smithing')!
    const after = craft(before, recipe.id)
    expect(masteryOf(before, 'smithing')).toBe(0)
    expect(masteryOf(after, 'smithing')).toBe(MASTERY_PER_CRAFT)
  })

  it('сто тиков боя мастерства не двигают', () => {
    // Единственный вход — крафт. Убийства, время и уровни на шкалу не влияют:
    // число, которое растёт само, ничего не измеряет.
    let s = ready()
    const rng = createRng(7)
    for (let i = 0; i < 100; i += 1) s = tick(s, 100, rng)
    for (const profession of MASTERY_PROFESSIONS) expect(masteryOf(s, profession)).toBe(0)
  })

  it('рост уровня героя мастерства не даёт', () => {
    const low = ready({ level: new Decimal(1) })
    const high = ready({ level: new Decimal(100) })
    expect(masteryOf(low, 'smithing')).toBe(masteryOf(high, 'smithing'))
  })
})

describe('потолок рецепта: дешёвый рецепт перестаёт учить', () => {
  it('рецепт ниже потолка мастерства не даёт ничего', () => {
    // Без потолка выгоднее всего было бы молотить САМЫЙ ДЕШЁВЫЙ рецепт:
    // пошлина меньше, прибавка та же. Потолок заставляет идти дальше.
    const shallow = RECIPES.filter((r) => r.profession === 'smithing').sort(
      (a, b) => recipeLevel(a) - recipeLevel(b),
    )[0]
    const ceiling = masteryCeilingForLevel(recipeLevel(shallow))
    const skilled = ready({ mastery: { smithing: ceiling } })
    expect(masteryGain(skilled, shallow)).toBe(0)
    expect(masteryOf(craft(skilled, shallow.id), 'smithing')).toBe(ceiling)
  })

  it('РОВНО на потолке прибавки уже нет, на очко ниже — есть', () => {
    // Граница проверяется с обеих сторон: «ниже потолка» и «не выше» — это
    // разные правила, и перепутать их легко.
    const recipe = RECIPES.filter((r) => r.profession === 'smithing').sort(
      (a, b) => recipeLevel(a) - recipeLevel(b),
    )[0]
    const ceiling = masteryCeilingForLevel(recipeLevel(recipe))
    expect(masteryGain(ready({ mastery: { smithing: ceiling } }), recipe)).toBe(0)
    expect(masteryGain(ready({ mastery: { smithing: ceiling - 1 } }), recipe)).toBeGreaterThan(0)
  })

  it('глубокий рецепт учит там, где мелкий уже нет', () => {
    const byLevel = RECIPES.filter((r) => r.profession === 'smithing').sort(
      (a, b) => recipeLevel(a) - recipeLevel(b),
    )
    const shallow = byLevel[0]
    const deep = byLevel[byLevel.length - 1]
    const at = masteryCeilingForLevel(recipeLevel(shallow))
    const hero = ready({ mastery: { smithing: at } })
    expect(masteryGain(hero, shallow)).toBe(0)
    expect(masteryGain(hero, deep)).toBeGreaterThan(0)
  })

  it('выше сотни мастерство не уходит', () => {
    const capped = ready({ mastery: { smithing: MASTERY_MAX - 1 } })
    const deep = RECIPES.filter((r) => r.profession === 'smithing').sort(
      (a, b) => recipeLevel(b) - recipeLevel(a),
    )[0]
    expect(masteryOf(craft(capped, deep.id), 'smithing')).toBeLessThanOrEqual(MASTERY_MAX)
  })
})

describe('ступени переключаются РОВНО на границах', () => {
  it('каждая ступень начинается со своего числа', () => {
    for (const rank of MASTERY_RANKS) {
      expect(masteryRank(rank.from).id, `${rank.id}: ровно на границе`).toBe(rank.id)
      if (rank.from > 0) {
        expect(masteryRank(rank.from - 1).id, `${rank.id}: на очко ниже`).not.toBe(rank.id)
      }
    }
  })

  it('ступеней пять, шаг ровный, первая с нуля', () => {
    expect(MASTERY_RANKS.length).toBe(MASTERY_MAX / MASTERY_RANK_STEP)
    expect(MASTERY_RANKS[0].from).toBe(0)
    for (let i = 1; i < MASTERY_RANKS.length; i += 1) {
      expect(MASTERY_RANKS[i].from - MASTERY_RANKS[i - 1].from).toBe(MASTERY_RANK_STEP)
    }
  })

  it('строка «до следующей ступени» верна, в том числе на последней', () => {
    expect(pointsToNextRank(0)).toBe(MASTERY_RANK_STEP)
    expect(pointsToNextRank(MASTERY_RANK_STEP - 1)).toBe(1)
    // На последней ступени следующей нет, и это null, а не ноль: ноль читался
    // бы как «вот-вот переключится».
    expect(pointsToNextRank(MASTERY_MAX)).toBeNull()
    expect(pointsToNextRank(MASTERY_RANKS[MASTERY_RANKS.length - 1].from)).toBeNull()
  })
})

describe('шкала есть ровно у двух профессий', () => {
  it('кулинария и реликварий шкалы не завели', () => {
    // Решение, а не недоделка: глубина ставится там, куда игрок возвращается.
    expect(hasMastery('cooking')).toBe(false)
    expect(hasMastery('relics')).toBe(false)
    expect(hasMastery('smithing')).toBe(true)
    expect(hasMastery('herbalism')).toBe(true)
  })

  it('крафт еды мастерства не даёт и мешок не портит', () => {
    const before = ready()
    const food = recipeFor('cooking')
    const after = craft(before, food.id)
    expect(after.mastery).toEqual({})
    expect(masteryGain(before, food)).toBe(0)
  })

  it('у профессии без шкалы её нет и после сотни крафтов', () => {
    let s = ready()
    const food = recipeFor('cooking')
    for (let i = 0; i < 100; i += 1) s = craft(s, food.id)
    expect(s.mastery.cooking).toBeUndefined()
  })
})

describe('старый сейв мигрирует в осмысленное мастерство', () => {
  const migrated = (level: string) => {
    const result = readSave({ version: 30, level, materials: {}, mastery: undefined })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('сейв не прочитался')
    return result.payload.mastery
  }

  it('ветеран сотого уровня не становится новиком', () => {
    const mastery = migrated('100')
    for (const profession of MASTERY_PROFESSIONS) {
      expect(mastery[profession], profession).toBe(MASTERY_MAX)
      expect(masteryRank(mastery[profession]).id).toBe(
        MASTERY_RANKS[MASTERY_RANKS.length - 1].id,
      )
    }
  })

  it('мастерство выведено из уровня по той же лестнице полос', () => {
    for (const level of [1, 15, 35, 60, 100]) {
      const mastery = migrated(String(level))
      expect(mastery.smithing, `уровень ${level}`).toBe(masteryFromLevel(level))
    }
  })

  it('новичок получает мастерство своей полосы, а не ноль и не сотню', () => {
    const mastery = migrated('5')
    expect(mastery.smithing).toBeGreaterThan(0)
    expect(mastery.smithing).toBeLessThan(MASTERY_MAX)
  })

  it('профессии без шкалы миграция мастерства не выдаёт', () => {
    const mastery = migrated('100')
    expect(mastery.cooking).toBeUndefined()
    expect(mastery.relics).toBeUndefined()
  })
})

describe('мастерство переживает круг сейв → загрузка', () => {
  it('крафт двигает ТОЛЬКО свою профессию, и ровно на прибавку', () => {
    // Рецепт берётся САМЫЙ ГЛУБОКИЙ ИЗ ИЗВЕСТНЫХ на этом мастерстве, и обе
    // половины важны. Мелкий на сорока двух очках уже не учит — тест мерил бы
    // потолок; тот, до которого герой не дорос ступенью, он попросту не знает
    // (рецепт стал добычей) — и крафт не состоялся бы вовсе.
    const deep = RECIPES.filter(
      (r) =>
        r.profession === 'smithing' &&
        r.source.kind === 'mastery' &&
        masteryToKnow(r) <= 42 &&
        masteryCeilingForLevel(recipeLevel(r)) > 42,
    ).sort((a, b) => recipeLevel(b) - recipeLevel(a))[0]
    const before = ready({ mastery: { smithing: 42, herbalism: 8 } })
    const after = craft(before, RECIPE_BY_ID[deep.id].id)
    expect(masteryOf(after, 'smithing')).toBe(42 + MASTERY_PER_CRAFT)
    expect(masteryOf(after, 'herbalism')).toBe(8)
  })
})
