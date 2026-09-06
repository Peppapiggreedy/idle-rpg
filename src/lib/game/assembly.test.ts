// ЛЕГЕНДАРНАЯ СБОРКА: вещь правит УМЕНИЕ и платит за это своими статами.
//
// Проверяется здесь именно ОБМЕН, а не «работает ли свойство». Работающее
// свойство без платы — это прибавка к бюджету силы мимо всех его коридоров,
// то есть ровно то, ради чего бюджет и заведён.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, type GameState } from './tick'
import { ensureStats } from './stats'
import { craftedItem } from './crafting'
import { heroAbilities } from './abilities'
import { abilitiesByPriority } from './rotation'
import { equippedBoons, rotationOf } from './state'
import { payloadFromState, readSave, stateFromPayload } from './save'
import { RECIPES, type RecipeDef } from '../data/recipes'
import { BOONS, BOON_BY_ID } from '../data/boons'
import { REAGENTS } from '../data/reagents'
import { ABILITY_BY_ID } from '../data/abilities'
import { DUNGEONS } from '../data/dungeons'

type ItemOut = Extract<RecipeDef['output'], { kind: 'item' }>

const ASSEMBLY = RECIPES.find(
  (r): r is RecipeDef & { output: ItemOut } => r.output.kind === 'item' && !!r.output.boonId,
)!

/** Сумма плоских прибавок вещи. База (kind 'base') в неё не входит: она
 *  заменяет умолчание, а не прибавляет силу. */
function statSum(mods: ReadonlyArray<{ kind: string; value: Decimal }>): number {
  return mods.filter((m) => m.kind !== 'base').reduce((sum, m) => sum + m.value.toNumber(), 0)
}

describe('сборка требует всю лестницу, а не любимую пару данжей', () => {
  it('в игре есть ровно одна сборка со свойством', () => {
    const withBoon = RECIPES.filter((r) => r.output.kind === 'item' && r.output.boonId)
    expect(withBoon).toHaveLength(1)
  })

  it('просит ИМЕННОЙ реагент каждой из восьми героик', () => {
    const heroic = REAGENTS.filter(
      (r) => r.source?.kind === 'dungeon' && r.source.difficulty === 'heroic',
    )
    expect(heroic.length, 'героических реагентов не восемь').toBe(DUNGEONS.length)
    const inputs = new Set(ASSEMBLY.inputs.map((i) => i.materialId))
    for (const reagent of heroic) {
      expect(inputs.has(reagent.id), `${reagent.id} не входит в сборку`).toBe(true)
    }
  })

  it('и верхний передел кузнечного — сборка это конец обеих лестниц', () => {
    const crafted = REAGENTS.filter((r) => r.role === 'crafted').map((r) => r.id)
    expect(ASSEMBLY.inputs.some((i) => crafted.includes(i.materialId))).toBe(true)
  })
})

describe('свойство оплачено статами ЭТОЙ ЖЕ вещи', () => {
  const boon = BOON_BY_ID[ASSEMBLY.output.boonId!]

  it('статы урезаны ровно на долю платы', () => {
    const made = craftedItem(ASSEMBLY.output, 1)!
    const plain = craftedItem({ ...ASSEMBLY.output, boonId: undefined }, 2)!
    expect(made.boonId).toBe(boon.id)
    expect(plain.boonId).toBeUndefined()
    // Не «меньше», а РОВНО на долю: допуск — цена округления к целому, а не
    // право генератора срезать сколько угодно.
    const expected = statSum(plain.mods) * (1 - boon.statShare)
    expect(statSum(made.mods)).toBeGreaterThan(0)
    expect(Math.abs(statSum(made.mods) - expected)).toBeLessThanOrEqual(made.mods.length / 2)
  })

  it('числа остаются целыми там, где они считаются штуками', () => {
    // Скидка идёт через то же зерно, что и генерация: дробная броня на
    // карточке означала бы, что бой считает не то, что показано.
    const made = craftedItem(ASSEMBLY.output, 3)!
    for (const mod of made.mods) {
      if (mod.stat !== 'armor' && mod.stat !== 'vitality') continue
      expect(Number.isInteger(mod.value.toNumber()), `${mod.stat} дробный`).toBe(true)
    }
  })

  it('БАЗУ боя скидка не трогает', () => {
    // kind 'base' ЗАМЕНЯЕТ умолчание, а не прибавляет: срезать долю со
    // скорости оружия значило бы сделать его быстрее, то есть заплатить
    // прибавкой. Проверяется на оружейной сборке, собранной здесь же.
    const weapon: ItemOut = {
      kind: 'item',
      slot: 'mainHand',
      rarity: 'legendary',
      level: 100,
      templateId: 'fang',
      name: 'проба',
      boonId: boon.id,
    }
    const made = craftedItem(weapon, 4)!
    const plain = craftedItem({ ...weapon, boonId: undefined }, 5)!
    const base = (item: typeof made, stat: string) =>
      item.mods.find((m) => m.kind === 'base' && m.stat === stat)?.value.toString()
    for (const stat of ['weaponSpeed', 'weaponDamageMin', 'weaponDamageMax']) {
      expect(base(made, stat), stat).toBe(base(plain, stat))
    }
    expect(statSum(made.mods)).toBeLessThan(statSum(plain.mods))
  })

  it('свойство даром не бывает: плата больше нуля у каждого', () => {
    for (const b of BOONS) expect(b.statShare, b.id).toBeGreaterThan(0)
  })
})

describe('надетая сборка правит умение — и его читают ВСЕ', () => {
  const boon = BOONS[0]
  const worn = (): GameState => {
    const item = craftedItem(ASSEMBLY.output, 6)!
    const base = ensureStats(createInitialState(1))
    return ensureStats({
      ...base,
      level: new Decimal(100),
      equipment: { ...base.equipment, [item.slot]: item },
      statsDirty: true,
    })
  }

  it('без вещи умение БАЗОВОЕ бит в бит', () => {
    const bare = ensureStats(createInitialState(1))
    expect(equippedBoons(bare.equipment)).toEqual([])
    const book = heroAbilities(bare)
    const found = book.find((a) => a.id === boon.abilityId)
    expect(found, 'умения свойства нет у класса').toBeTruthy()
    expect(found).toBe(ABILITY_BY_ID[boon.abilityId])
  })

  it('с вещью — правленое, и правка ровно та, что в данных', () => {
    const hero = worn()
    expect(equippedBoons(hero.equipment)).toEqual([boon.id])
    const base = ABILITY_BY_ID[boon.abilityId]
    const tuned = heroAbilities(hero).find((a) => a.id === boon.abilityId)!
    expect(tuned).not.toBe(base)
    // Правка сверяется С ДАННЫМИ, а не с числом, выписанным в тесте: правка
    // силы свойства обязана менять и ожидание здесь, а не расходиться с ним.
    const tune = boon.tune.find((t) => t.field === 'cooldownSec')
    expect(tune, 'свойство перестало править откат — поправь тест вместе с данными').toBeTruthy()
    if (!tune || tune.kind !== 'multiplier') return
    expect(tuned.cooldownSec).toBeCloseTo(base.cooldownSec * tune.value, 6)
    expect(tuned.cooldownSec).toBeLessThan(base.cooldownSec)
  })

  it('ротация везёт свойство с собой — модель и автокаст читают то же умение', () => {
    // Ротацию читают модель боя, автокаст, оффлайн и контракты. Пронеси
    // свойство мимо — и каждый из них считал бы по умению, которого у героя
    // в руках нет.
    const hero = worn()
    const rotation = rotationOf(hero)
    expect(rotation.boons).toEqual([boon.id])
    const listed = abilitiesByPriority(rotation, false).find((a) => a.id === boon.abilityId)
    if (!listed) return
    expect(listed.cooldownSec).toBeLessThan(ABILITY_BY_ID[boon.abilityId].cooldownSec)
  })
})

describe('сборка переживает перезагрузку', () => {
  it('свойство лежит в сейве и возвращается с вещью', () => {
    const item = craftedItem(ASSEMBLY.output, 7)!
    const hero = ensureStats({
      ...createInitialState(1),
      inventory: [item],
      statsDirty: true,
    })
    const result = readSave(payloadFromState(hero, 0) as unknown as Record<string, unknown>)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(stateFromPayload(result.payload).inventory[0].boonId).toBe(item.boonId)
  })

  it('чужое свойство из сейва отбрасывается, а вещь остаётся носимой', () => {
    const item = craftedItem(ASSEMBLY.output, 8)!
    const hero = ensureStats({
      ...createInitialState(1),
      inventory: [{ ...item, boonId: 'нет-такого-свойства' }],
      statsDirty: true,
    })
    const result = readSave(payloadFromState(hero, 0) as unknown as Record<string, unknown>)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    const restored = stateFromPayload(result.payload).inventory[0]
    expect(restored.boonId).toBeUndefined()
    expect(restored.mods.length).toBeGreaterThan(0)
  })
})
