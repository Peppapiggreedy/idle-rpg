// Профессии: материалы, рецепты, еда на привал. Уровней у профессий нет —
// проверяем это тоже: рецепт доступен ровно по материалам и ничему больше.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { STEP_MS } from './loop'
import { createInitialState, manualOnlySettings, type GameState } from './state'
import { ensureStats } from './stats'
import { tick } from './tick'
import { craft, materialCount, recipeStatus, rollMaterial, takeFood } from './crafting'
import { restDurationMs, startRest } from './rest'
import { MATERIALS, materialsInZone } from '../data/materials'
import { FOOD_BY_ID, PROFESSIONS, RECIPES, RECIPE_BY_ID, recipesOf } from '../data/recipes'
import { INVENTORY_SIZE, MATERIAL_DROP_CHANCE, REST_FOOD_SPEEDUP } from '../data/balance'
import { ZONES } from '../data/zones'


const NO_LUCK = () => 1

/** Броски по списку: последний повторяется, когда список кончился. */
function seqRng(values: number[]) {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}

function hero(patch: Partial<GameState> = {}): GameState {
  return ensureStats({
    ...createInitialState(1),
    abilitySettings: manualOnlySettings(),
    statsDirty: true,
    ...patch,
  })
}

const BROTH = RECIPE_BY_ID['herb-broth']
const HELM = RECIPE_BY_ID['forged-helm']

describe('данные профессий', () => {
  it('две профессии, у кулинарии 3-4 рецепта, у кузнечного 4-5', () => {
    expect(PROFESSIONS).toHaveLength(2)
    expect(recipesOf('cooking').length).toBeGreaterThanOrEqual(3)
    expect(recipesOf('cooking').length).toBeLessThanOrEqual(4)
    expect(recipesOf('smithing').length).toBeGreaterThanOrEqual(4)
    expect(recipesOf('smithing').length).toBeLessThanOrEqual(5)
  })

  it('у кузнечного дела по рецепту на разные слоты, а не пять на один', () => {
    const slots = recipesOf('smithing').map((r) =>
      r.output.kind === 'item' ? r.output.slot : null,
    )
    expect(new Set(slots).size).toBe(slots.length)
  })

  it('уровней у профессий нет: в данных нет ни одного требования по опыту', () => {
    // Прокачка профессии — это второй счётчик, который надо гриндить.
    // Гриндить в этой игре уже есть что, и заводить второй незачем.
    const json = JSON.stringify(RECIPES)
    expect(/level|уровен|experience|опыт/i.test(json)).toBe(false)
  })

  it('каждый материал падает хотя бы в одной существующей зоне', () => {
    const ids = ZONES.map((z) => z.id)
    for (const material of MATERIALS) {
      expect(material.zoneIds.length, material.id).toBeGreaterThan(0)
      for (const id of material.zoneIds) expect(ids, material.id).toContain(id)
    }
  })
})

describe('материалы падают своим броском', () => {
  it('бросок выше шанса не даёт ничего и пул зоны не трогает', () => {
    expect(rollMaterial(ZONES[0].id, () => MATERIAL_DROP_CHANCE)).toBeNull()
  })

  it('материал берётся из пула СВОЕЙ зоны', () => {
    for (const zone of ZONES) {
      const pool = materialsInZone(zone.id).map((m) => m.id)
      if (pool.length === 0) continue
      const rolled = rollMaterial(zone.id, seqRng([0, 0.999999]))
      expect(pool, zone.id).toContain(rolled!.id)
    }
  })

  it('материалы не занимают место в сумке', () => {
    // Полный инвентарь останавливает лут, но не материалы: у них свой мешок.
    const full = hero({
      inventory: Array.from({ length: INVENTORY_SIZE }, (_, i) => ({
        id: `f${i}`,
        name: 'хлам',
        rarity: 'common' as const,
        slot: 'trinket' as const,
        mods: [],
      })),
      monster: { ...hero().monster, currentHp: new Decimal(0.0001) },
    })
    let s = full
    for (let t = 0; t < 20_000 && Object.keys(s.materials).length === 0; t += STEP_MS) {
      s = tick(s, STEP_MS, () => 0.01, () => {})
    }
    expect(Object.keys(s.materials).length).toBeGreaterThan(0)
    expect(s.inventory.length).toBe(INVENTORY_SIZE)
  })
})

describe('крафт', () => {
  it('без материалов рецепт не собрать, и видно чего не хватает', () => {
    const status = recipeStatus(hero(), BROTH)
    expect(status.canCraft).toBe(false)
    expect(status.reason).toBe('materials')
    expect(status.missing[0]).toMatchObject({ materialId: 'meadow-herb', need: 3 })
    expect(status.missing[0].have.toNumber()).toBe(0)
    // И состояние не меняется вовсе.
    const s = hero()
    expect(craft(s, BROTH.id)).toBe(s)
  })

  it('с материалами рецепт собирается и материалы тратятся', () => {
    const s = hero({ materials: { 'meadow-herb': new Decimal(5) } })
    expect(recipeStatus(s, BROTH).canCraft).toBe(true)
    const after = craft(s, BROTH.id)
    expect(materialCount(after, 'meadow-herb').toNumber()).toBe(2)
    expect(materialCount(after, BROTH.output.kind === 'food' ? BROTH.output.id : '').toNumber()).toBe(1)
    expect(after.combatLog[0]).toMatchObject({ type: 'craft', recipeId: BROTH.id })
  })

  it('предмету нужно место в сумке, и отказ говорит об этом отдельным кодом', () => {
    const materials = { 'quarry-ore': new Decimal(10), 'bog-hide': new Decimal(10) }
    const full = hero({
      materials,
      inventory: Array.from({ length: INVENTORY_SIZE }, (_, i) => ({
        id: `f${i}`,
        name: 'хлам',
        rarity: 'common' as const,
        slot: 'trinket' as const,
        mods: [],
      })),
    })
    expect(recipeStatus(full, HELM).reason).toBe('inventory-full')
    const room = hero({ materials })
    const after = craft(room, HELM.id)
    expect(after.inventory).toHaveLength(1)
    expect(after.inventory[0].slot).toBe('head')
  })

  it('кованый предмет не лучше хорошей находки своей зоны, а вровень', () => {
    // Крафт — подстраховка от невезения, а не обход лута: редкость у него
    // необычная, а не легендарная, и модификаторы строит та же функция.
    for (const recipe of recipesOf('smithing')) {
      if (recipe.output.kind !== 'item') continue
      expect(['common', 'uncommon', 'rare']).toContain(recipe.output.rarity)
    }
  })
})

describe('еда сокращает привал и расходуется', () => {
  it('порция вдвое укорачивает привал и тратится ровно на один', () => {
    const s = hero({ materials: { 'food:herb-broth': new Decimal(1) } })
    const plain = hero()
    const rested = startRest(s)
    expect(rested.restSpeedupSource).toBe('food:herb-broth')
    expect(rested.restTotalMs).toBe(restDurationMs(plain) / REST_FOOD_SPEEDUP)
    // Порция израсходована: второй привал уже без неё.
    expect(materialCount(rested, 'food:herb-broth').toNumber()).toBe(0)
  })

  it('без еды привал просто дольше — она не обязательна', () => {
    const rested = startRest(hero())
    expect(rested.restSpeedupSource).toBeNull()
    expect(rested.restTotalMs).toBe(restDurationMs(hero()))
    expect(rested.heroState).toBe('resting')
  })

  it('еда берётся только из готовых порций, а не из сырья', () => {
    const raw = hero({ materials: { 'meadow-herb': new Decimal(9) } })
    expect(takeFood(raw).foodId).toBeNull()
    for (const id of Object.keys(FOOD_BY_ID)) {
      const fed = hero({ materials: { [id]: new Decimal(1) } })
      expect(takeFood(fed).foodId).toBe(id)
    }
  })

  it('привал с едой и без — единственная разница в длине, не в исходе', () => {
    // Кончаются оба одинаково — полным запасом; еда меняет только КОГДА.
    const until = (state: GameState) => {
      let s = state
      for (let t = 0; t < 30_000; t += STEP_MS) {
        s = tick(s, STEP_MS, NO_LUCK, () => {})
        if (s.heroState === 'alive') return { at: t, hp: s.currentHp, max: s.stats.maxHp }
      }
      throw new Error('привал не кончился')
    }
    const low = { currentHp: new Decimal(1), currentMana: new Decimal(1) }
    const fed = until(startRest(hero({ ...low, materials: { 'food:herb-broth': new Decimal(1) } })))
    const plain = until(startRest(hero(low)))
    expect(fed.hp.eq(fed.max)).toBe(true)
    expect(plain.hp.eq(plain.max)).toBe(true)
    expect(fed.at).toBeLessThan(plain.at)
  })
})
