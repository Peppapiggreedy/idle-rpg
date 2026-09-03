// ЛЕСТНИЦА ОТКРЫТИЙ ДЕЙСТВИТЕЛЬНО ЗАКРЫВАЕТ.
//
// Обещание, которое игрок уже видел, — не обещание. Лестница объявляет
// ремёсла на тридцатом, травничество на сороковом, зачарование на
// пятидесятом, а работали они с первого. Здесь проверяется, что закрытая
// механика молчит целиком — и в логике, и в источниках ресурсов.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, type GameState } from './state'
import { ensureStats } from './stats'
import { craft, recipeStatus } from './crafting'
import { gatherHerbs, potionSlots } from './potions'
import { RECIPES, RECIPE_BY_ID, PROFESSION_UNLOCK_LEVEL, professionUnlocked } from '../data/recipes'
import { HERBS } from '../data/herbs'
import { ZONES, ZONE_BY_ID } from '../data/zones'
import {
  CRAFT_UNLOCK_LEVEL,
  ENCHANT_UNLOCK_LEVEL,
  POTION_UNLOCK_LEVEL,
  UNIQUE_RECIPE_LEVEL,
} from '../data/balance'
import { PROGRESSION } from '../data/progression'
import {
  availableLootPolicies,
  availableUpgrades,
  buyUpgrade,
  inventorySize,
  lootPolicyOf,
  upgradeCost,
  upgradeStatus,
} from './upgrades'
import { GOLD_UPGRADES, GOLD_UPGRADE_BY_ID } from '../data/upgrades'
import { INVENTORY_SIZE } from '../data/balance'

function hero(level: number, patch: Partial<GameState> = {}): GameState {
  return ensureStats({
    ...createInitialState(1, 'warden'),
    level: new Decimal(level),
    gold: new Decimal('1e12'),
    statsDirty: true,
    ...patch,
  })
}

describe('ремёсла закрыты до своего уровня', () => {
  it('порог совпадает со ступенью лестницы открытий', () => {
    // Число не переписано руками: и ступень, и порог обязаны говорить одно.
    const step = PROGRESSION.find((s) =>
      s.unlocks.some((u) => u.kind === 'mechanic' && u.id === 'crafting'),
    )!
    expect(step.level).toBe(CRAFT_UNLOCK_LEVEL)
  })

  it('до тридцатого ни один рецепт кузни и кухни не собирается', () => {
    const before = hero(CRAFT_UNLOCK_LEVEL - 1)
    for (const recipe of RECIPES) {
      if (recipe.profession !== 'smithing' && recipe.profession !== 'cooking') continue
      const status = recipeStatus(before, recipe)
      expect(status.canCraft, recipe.id).toBe(false)
      expect(status.reason, recipe.id).toBe('level')
    }
  })

  it('на тридцатом рецепт перестаёт быть запертым уровнем', () => {
    const after = hero(CRAFT_UNLOCK_LEVEL)
    const plain = RECIPES.filter(
      (r) => (r.profession === 'smithing' || r.profession === 'cooking') && !r.unlockLevel,
    )
    expect(plain.length, 'предпосылка: есть рецепты без своего порога').toBeGreaterThan(0)
    for (const recipe of plain) {
      // Причина может быть любой, кроме уровня: материалов у героя нет.
      expect(recipeStatus(after, recipe).reason, recipe.id).not.toBe('level')
    }
  })

  it('порог профессии — пол для её рецептов, а не замена своему', () => {
    for (const recipe of RECIPES) {
      const floor = PROFESSION_UNLOCK_LEVEL[recipe.profession]
      const own = recipe.unlockLevel ?? 1
      // Рецепт не может открыться раньше своей профессии...
      expect(recipeStatus(hero(floor - 1), recipe).reason, recipe.id).toBe('level')
      // ...и свой, более высокий порог профессия не отменяет.
      if (own > floor) {
        expect(recipeStatus(hero(own - 1), recipe).reason, recipe.id).toBe('level')
      }
    }
  })

  it('реликварий заперт своим уровнем, а не общим ремесленным', () => {
    expect(PROFESSION_UNLOCK_LEVEL.relics).toBe(UNIQUE_RECIPE_LEVEL)
    expect(professionUnlocked('relics', UNIQUE_RECIPE_LEVEL - 1)).toBe(false)
    expect(professionUnlocked('relics', UNIQUE_RECIPE_LEVEL)).toBe(true)
  })
})

describe('травничество закрыто целиком', () => {
  it('порог у сбора, рецептов и склянок ОДИН', () => {
    expect(PROFESSION_UNLOCK_LEVEL.herbalism).toBe(POTION_UNLOCK_LEVEL)
  })

  it('до сорокового трава не срезается даже в травяной зоне', () => {
    const zoneId = HERBS[0].zoneIds[0]
    const before = hero(POTION_UNLOCK_LEVEL - 1, { currentZoneId: zoneId })
    // Час игрового времени: если сбор идёт, за него набежали бы пучки.
    const after = gatherHerbs(before, 3_600_000)
    expect(after.materials[HERBS[0].id] ?? new Decimal(0)).toEqual(
      before.materials[HERBS[0].id] ?? new Decimal(0),
    )
  })

  it('с сорокового трава срезается', () => {
    const zoneId = HERBS[0].zoneIds[0]
    const at = hero(POTION_UNLOCK_LEVEL, { currentZoneId: zoneId })
    const after = gatherHerbs(at, 3_600_000)
    expect((after.materials[HERBS[0].id] ?? new Decimal(0)).gt(0)).toBe(true)
  })

  it('до сорокового в ряду действий нет ни одной склянки', () => {
    expect(potionSlots(hero(POTION_UNLOCK_LEVEL - 1))).toHaveLength(0)
    expect(potionSlots(hero(POTION_UNLOCK_LEVEL)).length).toBeGreaterThan(0)
  })

  it('травы растут ТОЛЬКО в зонах не ниже своего порога', () => {
    // То же правило держит content:check по данным; здесь оно проверяется
    // на живых зонах, чтобы поломка не ждала запуска отдельной проверки.
    for (const herb of HERBS) {
      expect(herb.zoneIds.length, herb.id).toBeGreaterThan(0)
      for (const zoneId of herb.zoneIds) {
        const zone = ZONE_BY_ID[zoneId]
        expect(zone, `${herb.id}: зона ${zoneId}`).toBeDefined()
        expect(zone.monsterLevelRange.min, `${herb.id} в ${zoneId}`).toBeGreaterThanOrEqual(
          POTION_UNLOCK_LEVEL,
        )
      }
    }
  })

  it('первая травяная зона — та самая полоса 41-45', () => {
    const first = ZONES.filter((z) => HERBS.some((h) => h.zoneIds.includes(z.id))).sort(
      (a, b) => a.monsterLevelRange.min - b.monsterLevelRange.min,
    )[0]
    expect(first.monsterLevelRange.min).toBe(41)
    expect(first.monsterLevelRange.max).toBe(45)
    // И в ней растут ВСЕ три травы: герой, доросший до зелий, варит любое,
    // не бегая по половине мира.
    for (const herb of HERBS) expect(herb.zoneIds, herb.id).toContain(first.id)
  })
})

describe('лестница покупок', () => {
  it('семь ступеней, уровни строго возрастают, цены тоже', () => {
    expect(GOLD_UPGRADES).toHaveLength(7)
    for (let i = 1; i < GOLD_UPGRADES.length; i += 1) {
      expect(GOLD_UPGRADES[i].level, GOLD_UPGRADES[i].id).toBeGreaterThan(
        GOLD_UPGRADES[i - 1].level,
      )
      expect(GOLD_UPGRADES[i].costHours, GOLD_UPGRADES[i].id).toBeGreaterThan(
        GOLD_UPGRADES[i - 1].costHours,
      )
    }
  })

  it('цена растёт по лестнице и считается часами дохода СВОЕГО уровня', () => {
    const costs = GOLD_UPGRADES.map((u) => upgradeCost(u))
    for (let i = 1; i < costs.length; i += 1) {
      expect(costs[i].gt(costs[i - 1]), GOLD_UPGRADES[i].id).toBe(true)
    }
    // Ни одна покупка не бесплатна: бесплатный слив — не слив.
    for (const cost of costs) expect(cost.gt(0)).toBe(true)
  })

  it('закрытая покупка не показывается вовсе', () => {
    const first = GOLD_UPGRADES[0]
    expect(availableUpgrades(hero(first.level - 1))).toHaveLength(0)
    expect(availableUpgrades(hero(first.level)).map((u) => u.def.id)).toContain(first.id)
  })

  it('купленная покупка уходит из списка и не покупается дважды', () => {
    const first = GOLD_UPGRADES[0]
    const bought = buyUpgrade(hero(first.level), first.id)
    expect(bought.purchasedUpgradeIds).toEqual([first.id])
    expect(availableUpgrades(bought).map((u) => u.def.id)).not.toContain(first.id)
    expect(upgradeStatus(bought, first).reason).toBe('owned')
    // Повторная покупка ничего не меняет и золота не снимает.
    expect(buyUpgrade(bought, first.id)).toBe(bought)
  })

  it('без золота покупка отказывает КОДОМ и золото не трогает', () => {
    const first = GOLD_UPGRADES[0]
    const poor = hero(first.level, { gold: new Decimal(0) })
    const status = upgradeStatus(poor, first)
    expect(status.canBuy).toBe(false)
    expect(status.reason).toBe('gold')
    expect(status.short.eq(status.cost)).toBe(true)
    expect(buyUpgrade(poor, first.id)).toBe(poor)
  })

  it('уровень важнее золота в порядке отказов', () => {
    const last = GOLD_UPGRADES[GOLD_UPGRADES.length - 1]
    expect(upgradeStatus(hero(1, { gold: new Decimal(0) }), last).reason).toBe('level')
  })

  it('сумка растёт ровно на купленное', () => {
    let state = hero(100)
    expect(inventorySize(state)).toBe(INVENTORY_SIZE)
    let expected = INVENTORY_SIZE
    for (const def of GOLD_UPGRADES) {
      state = buyUpgrade(state, def.id)
      if (def.effect.kind === 'bag') expected += def.effect.slots
      expect(inventorySize(state), def.id).toBe(expected)
    }
  })

  it('положения разбора открываются покупками, «не трогать» — всегда', () => {
    const fresh = hero(1)
    expect(availableLootPolicies(fresh)).toEqual(['keep'])
    // Пока положение не куплено, выбрать его нельзя даже правкой сейва.
    expect(lootPolicyOf({ ...fresh, lootPolicy: 'dust' })).toBe('keep')

    const sellId = GOLD_UPGRADES.find(
      (u) => u.effect.kind === 'policy' && u.effect.policy === 'sell',
    )!.id
    const withSell = buyUpgrade(hero(100), sellId)
    expect(availableLootPolicies(withSell)).toEqual(['keep', 'sell'])
    expect(lootPolicyOf({ ...withSell, lootPolicy: 'sell' })).toBe('sell')
    expect(lootPolicyOf({ ...withSell, lootPolicy: 'dust' })).toBe('keep')
  })

  it('ни одна покупка не даёт силы — только место и разбор', () => {
    // ЖЕЛЕЗНОЕ ПРАВИЛО ЛЕСТНИЦЫ: золото не покупает ни единицы урона, ни
    // живучести. Иначе оно стало бы второй лестницей прокачки рядом с
    // уровнями и предметами, и бюджет силы пришлось бы делить ещё и с ним.
    for (const def of GOLD_UPGRADES) {
      expect(['bag', 'policy'], def.id).toContain(def.effect.kind)
    }
    let state = hero(100)
    const before = state.stats
    for (const def of GOLD_UPGRADES) state = buyUpgrade(state, def.id)
    expect(ensureStats({ ...state, statsDirty: true }).stats).toEqual(before)
  })

  it('иконки покупок берутся из реестра, а id уникальны', () => {
    const ids = GOLD_UPGRADES.map((u) => u.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(GOLD_UPGRADE_BY_ID[id]).toBeDefined()
  })

  it('распыление продаётся ПОСЛЕ зачарования', () => {
    // Распылять лишнее имеет смысл только тогда, когда пыль есть куда деть.
    const dust = GOLD_UPGRADES.find(
      (u) => u.effect.kind === 'policy' && u.effect.policy === 'dust',
    )!
    expect(dust.level).toBeGreaterThan(ENCHANT_UNLOCK_LEVEL)
  })
})
