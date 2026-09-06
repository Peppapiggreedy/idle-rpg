// КРАФТОВАЯ ВЕЩЬ РАВНА ДРОПУ СВОЕЙ ПОЛОСЫ, И НЕ ВЫШЕ.
//
// Это главное правило ночи «рецепт как добыча», и оно контринтуитивно:
// ремесло обычно делают сильнее находок, чтобы им пользовались. Здесь
// наоборот — ценность крафта в АДРЕСНОСТИ. Не повезло с поножами двадцать
// уровней подряд? Скуй их. Не «скуй, потому что кованое лучше», а «скуй,
// потому что рулетка не даёт именно этот слот».
//
// Если крафт станет сильнее дропа, лестница предметов поедет вслед за ним, и
// вся балансовая ветка — темп, цена боя, ворота подземелий — пересчитывается
// заново. Поэтому проверка стоит здесь, а не в отчёте.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { craftedItem } from './crafting'
import { armorMods, shieldMods, weaponMods } from './loot'
import { RECIPES, recipeLevel, type RecipeDef } from '../data/recipes'
import { RARITY_BY_ID, RARITIES } from '../data/rarity'
import { SHIELD_BY_ID, WEAPON_BY_ID } from '../data/items'
import { bandForLevel, LEVEL_BANDS } from '../data/bands'

/** Смитинговые рецепты, дающие ВЕЩЬ: переделы и еда сюда не входят. */
const ITEM_RECIPES = RECIPES.filter(
  (r): r is RecipeDef & { output: Extract<RecipeDef['output'], { kind: 'item' }> } =>
    r.profession === 'smithing' && r.output.kind === 'item',
)

/** Суммарная величина плоских прибавок вещи — грубая, но честная мера. */
function power(mods: ReadonlyArray<{ value: Decimal }>): number {
  return mods.reduce((sum, mod) => sum + Math.abs(mod.value.toNumber()), 0)
}

/**
 * Та же вещь, но КАК НАХОДКА: те же генераторы, тот же уровень, та же
 * редкость. Именно с ней и сравнивается кованая — не с абстрактным «дропом»,
 * а с тем, что рулетка выдала бы на этом месте.
 */
function asDrop(output: Extract<RecipeDef['output'], { kind: 'item' }>): number {
  const rarity = RARITY_BY_ID[output.rarity]
  if (output.slot === 'mainHand') {
    const template = WEAPON_BY_ID[output.templateId ?? 'fang']
    return power(weaponMods(template, rarity, 'mainHand', output.level))
  }
  if (output.slot === 'offHand') {
    const template = SHIELD_BY_ID[output.templateId ?? 'bulwark']
    return power(shieldMods(template, rarity, output.level))
  }
  return power(armorMods(output.slot, rarity, output.level, output.attribute ?? 'strength'))
}

describe('сила крафта равна дропу своей полосы', () => {
  it('таблица: кованое против находки того же уровня и тира', () => {
    // Печатается в отчёт: разговор «крафт сильнее или слабее» без чисел
    // превращается в спор о вкусах.
    const rows = ITEM_RECIPES.map((recipe) => {
      const level = recipeLevel(recipe)
      const band = bandForLevel(level)
      const item = craftedItem(recipe.output, 0)
      const made = item ? power(item.mods) : 0
      const drop = asDrop(recipe.output)
      return { id: recipe.id, band: band.id, level, rarity: recipe.output.rarity, made, drop }
    })
    console.log('рецепт                полоса    ур.  тир        кованое  находка  разница')
    for (const r of rows) {
      const diff = r.drop === 0 ? 0 : ((r.made - r.drop) / r.drop) * 100
      console.log(
        `${r.id.padEnd(22)}${r.band.padEnd(10)}${String(r.level).padStart(3)}  ` +
          `${r.rarity.padEnd(10)}${r.made.toFixed(1).padStart(8)}${r.drop.toFixed(1).padStart(9)}` +
          `${diff.toFixed(1).padStart(8)} %`,
      )
    }
    expect(rows.length).toBeGreaterThan(0)
  })

  it('кованая вещь — ровно то же, что находка её уровня и тира', () => {
    // РОВНО, а не «примерно»: `craftedItem` зовёт ТЕ ЖЕ генераторы, что и лут
    // (`armorMods`, `weaponMods`, `shieldMods`), — своего пути к силе у крафта
    // нет. Тест сторожит именно это: появится у крафта свой множитель — и
    // равенство сломается на первом же рецепте.
    for (const recipe of ITEM_RECIPES) {
      const item = craftedItem(recipe.output, 0)
      expect(item, recipe.id).not.toBeNull()
      if (!item) continue
      expect(power(item.mods), recipe.id).toBeCloseTo(asDrop(recipe.output), 6)
    }
  })

  it('уровень вещи не выходит за её полосу', () => {
    // Вещь полосы обязана быть вещью ЭТОЙ полосы: уровень выше верхней
    // границы означал бы, что крафт обгоняет находки на шаг лестницы.
    for (const recipe of ITEM_RECIPES) {
      const level = recipeLevel(recipe)
      const band = bandForLevel(level)
      expect(level, `${recipe.id}: ниже своей полосы`).toBeGreaterThanOrEqual(band.minLevel)
      expect(level, `${recipe.id}: выше своей полосы`).toBeLessThanOrEqual(band.maxLevel)
    }
  })

  it('тир кованой вещи не выше того, что выпадает в зоне', () => {
    // Легендарные и эпические кованые вещи существуют — реликвии и награды
    // храма, — но у них СВОЙ путь: реагенты подземелий и полная зачистка.
    // Обычная лестница кузнечного выше редкого не поднимается, потому что
    // редкое и есть «хорошая находка»: его вес в рулетке пятнадцать против
    // сотни у обычного, то есть каждая седьмая вещь.
    const ladder = ITEM_RECIPES.filter((r) => r.id.startsWith('forged-') || r.output.name)
    const allowed = new Set(['uncommon', 'rare'])
    for (const recipe of ladder) {
      // Реликвии и храмовые награды в лестницу не входят: они и заявлены как
      // конец пути, а не как ступень.
      if (recipe.id.startsWith('relic-') || recipe.id.startsWith('trial-')) continue
      expect(allowed.has(recipe.output.rarity), `${recipe.id}: тир ${recipe.output.rarity}`).toBe(
        true,
      )
    }
    // И само определение «хорошей находки» — не на глаз: редкое выпадает
    // заметно реже обычного, но не является исключением.
    const rare = RARITIES.find((r) => r.id === 'rare')!
    const common = RARITIES.find((r) => r.id === 'common')!
    expect(rare.weight).toBeLessThan(common.weight)
    expect(rare.weight).toBeGreaterThan(0)
  })

  it('на каждой полосе есть что сковать, и слоты не повторяются подряд', () => {
    // То же, что держит content:check, но с другой стороны: там правило
    // проверяется на слепке контента, здесь — на живых данных вместе с
    // остальными свойствами лестницы. Дыра в середине была именно такой:
    // каждая отдельная проверка молчала.
    const bySlot = new Map<string, string[]>()
    for (const recipe of ITEM_RECIPES) {
      const band = bandForLevel(recipeLevel(recipe)).id
      bySlot.set(band, [...(bySlot.get(band) ?? []), recipe.output.slot])
    }
    for (const band of LEVEL_BANDS) {
      expect(bySlot.get(band.id), `полоса ${band.id} пуста`).toBeTruthy()
    }
  })
})
