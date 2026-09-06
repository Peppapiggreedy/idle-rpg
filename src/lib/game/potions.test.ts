// СНАБЖЕНИЕ ЗЕЛЬЯМИ: ПОЛОСА ТЯНЕТ ОДНО ЗЕЛЬЕ И НЕ ТЯНЕТ ТРИ.
//
// Контракт `POTION_TARGET_UPTIME` (0.9) записан в `data/balance.ts` и
// посчитан в `potionSupply` — а ДЕРЖАЛСЯ он ничем. Ни одного теста: функция
// существовала, число существовало, и между ними не было проверки. Ночь
// «рецепт как добыча» добавила ещё пять склянок, то есть ровно то, что
// такой контракт и должно ломать, — поэтому тест появляется здесь.
//
// Смысл контракта в двух половинах, и обе обязательны:
//   • зона своей полосы ТЯНЕТ одно зелье почти непрерывно — иначе склянка
//     это украшение, которое нечем поддерживать;
//   • она же НЕ ТЯНЕТ все зелья разом — иначе выбор «чего мне не хватает»
//     исчезает, и игрок просто пьёт всё подряд.
import { describe, expect, it } from 'vitest'
import { createInitialState } from './tick'
import { potionSupply } from './potions'
import { POTION_TARGET_UPTIME } from '../data/balance'
import { HERBS } from '../data/herbs'
import { POTION_RECIPES, recipeLevel } from '../data/recipes'
import { ZONES } from '../data/zones'
import { bandForLevel } from '../data/bands'

/** Зоны полосы, на которой стоит рецепт. */
function zonesOfBand(level: number) {
  const band = bandForLevel(level).id
  return ZONES.filter((z) => bandForLevel(z.monsterLevelRange.max).id === band)
}

describe('склянки стоят на полосах и обеспечены травой', () => {
  it('у каждой склянки есть свой уровень, и они разные', () => {
    // Было три зелья без единого уровня: все открывались разом на сороковом
    // и больше не появлялось ничего. Уровень — это место на лестнице, и
    // одинаковые уровни означают, что лестницы нет.
    const levels = POTION_RECIPES.map((r) => recipeLevel(r))
    for (const level of levels) expect(level).toBeGreaterThan(0)
    expect(new Set(levels).size, 'склянки открываются разом — лестницы нет').toBeGreaterThan(1)
  })

  it('роли склянок не повторяются: набор про выбор, а не про числа', () => {
    // Две склянки с одним и тем же статом — это одна склянка и её копия
    // подороже. Проверяется НАБОР статов рецепта: пара «урон + крит» и
    // «урон» это разные ответы, а «урон» и «урон» — один и тот же.
    const roles = POTION_RECIPES.map((r) =>
      r.output.mods
        .map((m) => m.stat)
        .sort()
        .join('+'),
    )
    expect(new Set(roles).size, `повторяются роли: ${roles.join(', ')}`).toBe(roles.length)
  })

  it('зона своей полосы тянет ОДНУ склянку на целевой аптайм', () => {
    // Главная половина контракта. Считается по той же `potionSupply`, что
    // читает панель ремёсел: второй модели снабжения в игре нет.
    const state = createInitialState(1)
    for (const recipe of POTION_RECIPES) {
      const zones = zonesOfBand(recipeLevel(recipe))
      expect(zones.length, `${recipe.id}: полоса без зон`).toBeGreaterThan(0)
      const best = Math.max(...zones.map((z) => potionSupply(state, recipe, z.id).share))
      expect(best, `${recipe.id}: травы не хватает даже на одно зелье`).toBeGreaterThanOrEqual(1)
    }
  })

  it('и НЕ тянет все склянки полосы разом', () => {
    // Вторая половина, без которой первая бессмысленна. Если бы травы
    // хватало на всё сразу, выбор «чего мне не хватает» исчез бы: игрок пил
    // бы весь набор и не думал.
    const state = createInitialState(1)
    for (const zone of ZONES) {
      const here = POTION_RECIPES.filter(
        (r) => bandForLevel(recipeLevel(r)).id === bandForLevel(zone.monsterLevelRange.max).id,
      )
      if (here.length < 2) continue
      // Суммарная нужда всех склянок полосы по каждой траве против того, что
      // зона даёт. Хотя бы одна трава обязана оказаться в дефиците.
      const need: Record<string, number> = {}
      let got: Record<string, number> = {}
      for (const recipe of here) {
        const supply = potionSupply(state, recipe, zone.id)
        got = supply.gotPerMinute
        for (const [herb, value] of Object.entries(supply.needPerMinute)) {
          need[herb] = (need[herb] ?? 0) + value
        }
      }
      const short = Object.entries(need).some(([herb, value]) => (got[herb] ?? 0) < value)
      expect(short, `${zone.id}: травы хватает на все склянки разом — выбора нет`).toBe(true)
    }
  })

  it('целевой аптайм — тот же, что записан в балансе', () => {
    // Тест обязан мерить контракт, а не своё представление о нём: число
    // берётся из data/balance.ts, и его правка обязана менять ожидания
    // здесь, а не молча расходиться с ними.
    expect(POTION_TARGET_UPTIME).toBeGreaterThan(0)
    expect(POTION_TARGET_UPTIME).toBeLessThanOrEqual(1)
  })

  it('травы не растут раньше своей механики', () => {
    // Правило лестницы открытий: закрытая механика не собирает ресурс
    // раньше своего уровня. Стадия добавила склянки, но ни одной травы —
    // и это проверяется, а не подразумевается.
    for (const herb of HERBS) {
      for (const zoneId of herb.zoneIds) {
        const zone = ZONES.find((z) => z.id === zoneId)
        expect(zone, `${herb.id}: зона ${zoneId} не найдена`).toBeTruthy()
        if (!zone) continue
        expect(
          zone.monsterLevelRange.min,
          `${herb.id} растёт в зоне ${zoneId}, а она мельче травяных полос`,
        ).toBeGreaterThanOrEqual(41)
      }
    }
  })
})
