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
import {
  CRAFT_TOLL_HOURS,
  FOOD_BY_ID,
  PROFESSIONS,
  RECIPES,
  RECIPE_BY_ID,
  craftToll,
  goldPerHourAt,
  recipeLevel,
  recipeUnlockLevel,
  recipesOf,
} from '../data/recipes'
import { LEVEL_CAP } from '../data/balance'
import { TEMPLE } from '../data/temple'
import {
  CRAFT_UNLOCK_LEVEL,
  INVENTORY_SIZE,
  MATERIAL_DROP_CHANCE,
  REST_FOOD_SPEEDUP,
} from '../data/balance'
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
    // УРОВЕНЬ ПРОФЕССИИ ПО УМОЛЧАНИЮ. Ремёсла открываются на тридцатом
    // (CRAFT_UNLOCK_LEVEL), и герой первого уровня упирался бы в отказ
    // `level` в каждом тесте про материалы — то есть мерил бы не то, что
    // написано в его названии. Про сам порог есть свои тесты ниже.
    level: new Decimal(CRAFT_UNLOCK_LEVEL),
    abilitySettings: manualOnlySettings(),
    // ЗОЛОТА С ЗАПАСОМ ПО УМОЛЧАНИЮ. У крафта теперь есть пошлина, и без неё
    // каждый тест про материалы упирался бы в отказ по золоту — то есть мерил
    // бы не то, что написано в его названии. Про саму пошлину есть свои тесты
    // ниже, и там золото задаётся явно.
    gold: new Decimal(1e9),
    statsDirty: true,
    ...patch,
  })
}

const BROTH = RECIPE_BY_ID['herb-broth']
const HELM = RECIPE_BY_ID['forged-helm']

/**
 * Рядовые рецепты кузнеца: те, что не заперты НИЧЕМ, кроме материалов.
 * Кузнечное дело — подстраховка от невезения, и мерить его надо без наград:
 * реликты стоят реагентов героики, а храмовые открываются рубежом волн.
 */
// Награды храма — и рубежи волн, и рецепт за полную зачистку: и то, и другое
// открывается достижением, а не материалами, и в «рядовые» не годится.
const rewardIds = new Set([
  ...TEMPLE.milestones.map((m) => m.recipeId),
  TEMPLE.clearReward.recipeId,
])
const everydaySmithing = () =>
  recipesOf('smithing').filter((r) => recipeUnlockLevel(r) < LEVEL_CAP && !rewardIds.has(r.id))
/** Легендарные реликты: открываются на потолке и стоят реагентов героики. */
const legendarySmithing = () =>
  recipesOf('smithing').filter((r) => recipeUnlockLevel(r) >= LEVEL_CAP)

describe('данные профессий', () => {
  it('четыре профессии, у кулинарии 3-4 рецепта, у кузнечного 4-5 рядовых', () => {
    // Кулинария, кузнечное дело, травничество и реликварий: каждая отвечает
    // на свой вопрос, и ни одна не дублирует другую.
    expect(PROFESSIONS).toHaveLength(4)
    expect(recipesOf('cooking').length).toBeGreaterThanOrEqual(3)
    expect(recipesOf('cooking').length).toBeLessThanOrEqual(4)
    // Рядовые рецепты кузнеца — подстраховка от невезения; легендарные
    // реликты на реагентах героики считаются отдельно: это конец лестницы,
    // а не запасной вариант.
    expect(everydaySmithing().length).toBeGreaterThanOrEqual(4)
    expect(everydaySmithing().length).toBeLessThanOrEqual(5)
    expect(legendarySmithing().length).toBeGreaterThan(0)
  })

  it('у кузнечного дела по рецепту на разные слоты, а не пять на один', () => {
    const slots = everydaySmithing().map((r) =>
      r.output.kind === 'item' ? r.output.slot : null,
    )
    expect(new Set(slots).size).toBe(slots.length)
  })

  it('уровней у профессий нет: в данных нет ни одного требования по опыту', () => {
    // Прокачка профессии — это второй счётчик, который надо гриндить.
    // Гриндить в этой игре уже есть что, и заводить второй незачем.
    // Поле level у ВЫХОДНОГО ПРЕДМЕТА — не в счёт: это уровень вещи (как у
    // дропа), а не требование к кузнецу; требований и опыта быть не должно.
    const json = JSON.stringify(
      RECIPES.map((r) => (r.output.kind === 'item' ? { ...r, output: { ...r.output, level: 0 } } : r)),
    )
    expect(/требует|requirement|experience|опыт/i.test(json)).toBe(false)
  })

  it('каждый материал падает хотя бы в одной существующей зоне', () => {
    const ids = ZONES.map((z) => z.id)
    for (const material of MATERIALS) {
      // Исключение ровно одно и названо в самих данных: материал-НАГРАДА
      // не падает нигде и падать не должен — его выдают за достижение.
      if (material.award !== undefined) {
        expect(material.zoneIds, material.id).toEqual([])
        continue
      }
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
        level: 1,
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
        level: 1,
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
    // Легендарные реликты сюда не входят: они стоят реагентов ГЕРОИКИ,
    // то есть второго прохода по всей лестнице, и обходом лута не являются.
    for (const recipe of everydaySmithing()) {
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


// ---------------------------------------------------------------------------
// ПОШЛИНА КРАФТА
// ---------------------------------------------------------------------------
//
// До неё крафт не стоил золота вовсе, и золото тратилось ровно на одно —
// сброс талантов. Кран льёт, слива нет; к пятидесятому уровню счётчик
// становится украшением, а «накопить» перестаёт быть решением.
describe('пошлина крафта', () => {
  it('считается ДОЛЕЙ часового дохода, а не числом', () => {
    // Числом её пришлось бы держать в двух местах — в цене и в кривой
    // золота, — и они разъехались бы на первой правке баланса.
    for (const recipe of RECIPES) {
      const hours = CRAFT_TOLL_HOURS[
        recipe.output.kind === 'item'
          ? recipe.output.procId
            ? 'unique'
            : 'item'
          : recipe.output.kind
      ]
      const expected = goldPerHourAt(recipeLevel(recipe)).times(hours).ceil()
      expect(craftToll(recipe).toNumber(), recipe.id).toBe(expected.toNumber())
    }
  })

  it('еда втрое дешевле склянки, уникум дороже кованого', () => {
    // Порядок цен — часть замысла: еду жгут пачками, склянку берут в данж,
    // кованую вещь делают на невезение, уникум планируют заранее.
    expect(CRAFT_TOLL_HOURS.potion / CRAFT_TOLL_HOURS.food).toBeCloseTo(3, 1)
    expect(CRAFT_TOLL_HOURS.item).toBeGreaterThan(CRAFT_TOLL_HOURS.potion)
    expect(CRAFT_TOLL_HOURS.unique).toBeGreaterThan(CRAFT_TOLL_HOURS.item)
    // И расходники укладываются в обещанные 35-40% часа.
    expect(CRAFT_TOLL_HOURS.potion).toBeGreaterThanOrEqual(0.35)
    expect(CRAFT_TOLL_HOURS.potion).toBeLessThanOrEqual(0.4)
  })

  it('РАСТЁТ ПО ТИРУ: глубокий рецепт дороже мелкого', () => {
    // Пошлина обязана расти вместе с доходом — иначе к концу игры она
    // превращается в округление, и слив снова пропадает.
    const byLevel = [...RECIPES].sort((a, b) => recipeLevel(a) - recipeLevel(b))
    const cheapest = byLevel[0]
    const deepest = byLevel[byLevel.length - 1]
    expect(recipeLevel(deepest)).toBeGreaterThan(recipeLevel(cheapest))
    expect(craftToll(deepest).gt(craftToll(cheapest))).toBe(true)
  })

  it('не хватило золота — отказ КОДОМ, и видно, сколько не хватает', () => {
    const toll = craftToll(BROTH)
    const poor = hero({
      materials: { 'meadow-herb': new Decimal(5) },
      gold: toll.minus(1),
    })
    const status = recipeStatus(poor, BROTH)
    expect(status.canCraft).toBe(false)
    expect(status.reason).toBe('gold')
    expect(status.tollShort.toNumber()).toBe(1)
    // И состояние не меняется: отказ — это ничего не делать.
    expect(craft(poor, BROTH.id)).toBe(poor)
  })

  it('золото списывается ровно на пошлину', () => {
    const toll = craftToll(BROTH)
    const rich = hero({ materials: { 'meadow-herb': new Decimal(5) }, gold: toll.times(3) })
    const after = craft(rich, BROTH.id)
    expect(after.gold.toNumber()).toBe(toll.times(2).toNumber())
  })

  it('материалы важнее золота в порядке отказов', () => {
    // Материалы копятся сами, пока герой в зоне, а золото игрок тратит и на
    // другое. «Не хватает золота» — это решение, и показывать его надо
    // тогда, когда всё остальное уже есть.
    const broke = hero({ materials: {}, gold: new Decimal(0) })
    expect(recipeStatus(broke, BROTH).reason).toBe('materials')
  })
})
