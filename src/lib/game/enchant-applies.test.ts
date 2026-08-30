// ДИАГНОСТИКА: доезжает ли зачарование надетого предмета до статов и до боя.
//
// Тест написан ПЕРВЫМ, до любых правок интерфейса, и остаётся в репозитории
// навсегда. Причина: «зачарований не видно на надетых вещах» — это симптом,
// у которого два совершенно разных диагноза. Либо модификатор не собирается
// вовсе (тогда чинить надо конвейер, и все числа игры сдвинутся), либо он
// собирается, а не показан (тогда чинить надо вёрстку и ни одно число не
// поменяется). Отличить их на глаз нельзя, поэтому здесь замер, а не догадка.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, type GameState } from './state'
import { collectModifiers, ensureStats } from './stats'
import { estimateCombatRate, expectedSwingDamage } from './combat'
import { enchantItem } from './enchanting'
import { ENCHANTS, ENCHANT_BY_ID, enchantModifiers } from '../data/enchants'
import { WEAPONS } from '../data/items'
import { representativeMonster, zoneForMonsterLevel } from '../data/zones'
import { monsterFromTemplate } from './state'
import { ENCHANT_UNLOCK_LEVEL } from '../data/balance'
import type { Item } from '../types'

// Оружие из шаблона: зачарования рук вешаются на mainHand, и именно оно
// задаёт базу боя, поэтому эффект виден и в статах, и в уроне.
function weapon(): Item {
  const template = WEAPONS.find((w) => w.grip === 'one') ?? WEAPONS[0]
  return {
    id: 'test-weapon',
    name: template.noun,
    rarity: 'common',
    slot: 'mainHand',
    level: 10,
    grip: template.grip,
    mods: [
      { stat: 'weaponSpeed', kind: 'base', value: new Decimal(2), source: 'equipment:weapon' },
      { stat: 'weaponDamageMin', kind: 'base', value: new Decimal(8), source: 'equipment:weapon' },
      { stat: 'weaponDamageMax', kind: 'base', value: new Decimal(12), source: 'equipment:weapon' },
    ],
  }
}

// Уровень берётся ИЗ КОНСТАНТЫ открытия системы, а не числом: на герое ниже
// неё enchantStatus отказывает кодом 'locked', и тест мерил бы запертую
// механику, а не работу зачарования.
function heroWearing(item: Item): GameState {
  const base = createInitialState(1)
  return ensureStats({
    ...base,
    level: new Decimal(ENCHANT_UNLOCK_LEVEL),
    equipment: { ...base.equipment, mainHand: item },
    // Перед героем моб ЕГО полосы, а не стартовый. Против моба первого уровня
    // герой пятидесятого бьёт с одного удара, и урон в секунду упирается в
    // паузу респауна: усиление оружия в такое число просто не попадает, и
    // тест показал бы «зачарование не работает» там, где не работает замер.
    monster: monsterFromTemplate(
      representativeMonster(zoneForMonsterLevel(ENCHANT_UNLOCK_LEVEL)),
    ),
    statsDirty: true,
  })
}

const RUNE_EDGE = ENCHANT_BY_ID['rune-edge']

describe('зачарование надетого предмета доезжает до статов', () => {
  it('модификатор зачарования есть в собранном блоке', () => {
    const plain = heroWearing(weapon())
    const enchanted = heroWearing({ ...weapon(), enchantId: RUNE_EDGE.id })

    const sources = collectModifiers(enchanted).map((m) => m.source)
    expect(sources).toContain('enchant:mainHand')
    // И его там НЕ БЫЛО без зачарования — иначе тест зеленел бы на чём угодно.
    expect(collectModifiers(plain).map((m) => m.source)).not.toContain('enchant:mainHand')
  })

  it('стат, на который оно смотрит, действительно вырос', () => {
    const plain = heroWearing(weapon())
    const enchanted = heroWearing({ ...weapon(), enchantId: RUNE_EDGE.id })
    // Руна кромки — +8% силы атаки процентом.
    expect(enchanted.stats.attackPower.gt(plain.stats.attackPower)).toBe(true)
  })

  it('до боя тоже доезжает: и удар, и урон в секунду', () => {
    const plain = heroWearing(weapon())
    const enchanted = heroWearing({ ...weapon(), enchantId: RUNE_EDGE.id })
    expect(expectedSwingDamage(enchanted.stats).gt(expectedSwingDamage(plain.stats))).toBe(true)
    const before = estimateCombatRate(plain).damagePerSecond
    const after = estimateCombatRate(enchanted).damagePerSecond
    expect(after.gt(before)).toBe(true)
  })

  it('каждое зачарование игры что-то меняет в статах своего слота', () => {
    // Не только «руна кромки». Зачарование, которое ничего не двигает, —
    // мёртвый контент, и таким его в игру пускать нельзя.
    for (const enchant of ENCHANTS) {
      for (const slot of enchant.slots) {
        const mods = enchantModifiers({ slot, enchantId: enchant.id })
        expect(mods.length, `${enchant.id} в слоте ${slot}`).toBeGreaterThan(0)
        for (const mod of mods) {
          expect(mod.source, `${enchant.id}`).toBe(`enchant:${slot}`)
          expect(mod.value.eq(0), `${enchant.id}: нулевой модификатор`).toBe(false)
        }
      }
    }
  })
})

describe('зачарование живёт на предмете, а не на слоте', () => {
  it('переживает снятие и повторное надевание', () => {
    const item: Item = { ...weapon(), enchantId: RUNE_EDGE.id }
    const worn = heroWearing(item)
    const ap = worn.stats.attackPower

    // Снять: предмет уходит в сумку вместе со своим зачарованием.
    const base = createInitialState(1)
    const off = ensureStats({
      ...worn,
      equipment: { ...base.equipment, mainHand: null },
      inventory: [item],
      statsDirty: true,
    })
    expect(off.stats.attackPower.lt(ap)).toBe(true)
    expect(off.inventory[0].enchantId).toBe(RUNE_EDGE.id)

    // Надеть обратно: тот же предмет, тот же результат.
    const again = ensureStats({
      ...off,
      equipment: { ...off.equipment, mainHand: off.inventory[0] },
      inventory: [],
      statsDirty: true,
    })
    expect(again.stats.attackPower.eq(ap)).toBe(true)
  })

  it('наложение на НАДЕТУЮ вещь пересчитывает статы сразу', () => {
    // Отдельный путь: enchantItem обязан положить зачарованную вещь и в
    // сумку, и в слот, иначе герой носил бы старую копию без зачарования.
    const item = weapon()
    const hero = { ...heroWearing(item), enchantDust: new Decimal(10_000) }
    const before = hero.stats.attackPower
    const after = enchantItem(hero, item.id, RUNE_EDGE.id)
    expect(after.equipment.mainHand?.enchantId).toBe(RUNE_EDGE.id)
    expect(after.stats.attackPower.gt(before)).toBe(true)
  })
})
