import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import {
  autoEquipIfBetter,
  compareItem,
  equipItem,
  isEquipped,
  isUpgrade,
  unequipItem,
} from './equipment'
import { estimateCombatRate } from './combat'
import { createInitialState, type GameState } from './state'
import { ensureStats } from './stats'
import { UNARMED } from '../data/balance'
import { WEAPONS, type WeaponTemplate } from '../data/items'
import { SLOT_IDS } from '../data/slots'
import type { Item, Rarity } from '../types'

// Оружие «как из лута», но без побочных статов: для инварианта важна только
// база боя (скорость и диапазон урона).
function bareWeapon(t: WeaponTemplate): Item {
  const source = 'equipment:weapon'
  return {
    id: `w-${t.id}`,
    name: t.noun,
    rarity: 'common' as Rarity,
    slot: 'weapon',
    mods: [
      { stat: 'weaponSpeed', kind: 'base', value: t.weaponSpeed, source },
      { stat: 'weaponDamageMin', kind: 'base', value: t.damageMin, source },
      { stat: 'weaponDamageMax', kind: 'base', value: t.damageMax, source },
    ],
  }
}

function armor(id: string, slot: 'head' | 'chest', attackPower: number): Item {
  return {
    id,
    name: id,
    rarity: 'common',
    slot,
    mods: [
      {
        stat: 'attackPower',
        kind: 'flat',
        value: new Decimal(attackPower),
        source: `equipment:${slot}`,
      },
    ],
  }
}

function withItems(items: Item[], patch: Partial<GameState> = {}): GameState {
  return ensureStats({ ...createInitialState(1), inventory: items, statsDirty: true, ...patch })
}

describe('оружие задаёт базу боя', () => {
  it('надетое оружие заменяет безоружные значения, снятое — возвращает', () => {
    const weapon = bareWeapon(WEAPONS[2]) // Крушитель: 3.4 c, 17-34
    const s = withItems([weapon])
    expect(s.stats.weaponSpeed).toBe(UNARMED.weaponSpeed.toNumber())

    const equipped = equipItem(s, weapon.id)
    expect(equipped.stats.weaponSpeed).toBeCloseTo(3.4, 9)
    expect(equipped.stats.weaponDamageMin.toNumber()).toBe(17)
    expect(equipped.stats.weaponDamageMax.toNumber()).toBe(34)
    expect(equipped.inventory).toEqual([]) // предмет ушёл из сумки на героя
    expect(isEquipped(equipped, weapon.id)).toBe(true)

    const bare = unequipItem(equipped, 'weapon')
    expect(bare.stats.weaponSpeed).toBe(UNARMED.weaponSpeed.toNumber())
    expect(bare.stats.weaponDamageMin.eq(UNARMED.weaponDamageMin)).toBe(true)
    expect(bare.stats.weaponDamageMax.eq(UNARMED.weaponDamageMax)).toBe(true)
    expect(bare.inventory.map((i) => i.id)).toEqual([weapon.id])
  })

  it('смена оружия не копит базы: активна только последняя', () => {
    const first = bareWeapon(WEAPONS[0])
    const second = bareWeapon(WEAPONS[1])
    let s = withItems([first, second])
    s = equipItem(s, first.id)
    s = equipItem(s, second.id)
    expect(s.stats.weaponSpeed).toBeCloseTo(WEAPONS[1].weaponSpeed.toNumber(), 9)
    // Снятое оружие вернулось в инвентарь, а не пропало.
    expect(s.inventory.map((i) => i.id)).toEqual([first.id])
  })

  it('смена оружия сохраняет долю замаха: ни сброса, ни мгновенного удара', () => {
    const weapon = bareWeapon(WEAPONS[2])
    const s = { ...withItems([weapon]), swingProgress: 0.6 }
    const equipped = equipItem(s, weapon.id)
    expect(equipped.swingProgress).toBe(0.6)
  })
})

describe('инвариант: равное (средний урон / weaponSpeed) — равный урон в секунду', () => {
  // Все три оружия из data/items.ts построены с отношением 7.5.
  it.each([
    [0, 0],
    [500, 0],
    [0, 0.5],
    [1234, 1.75],
  ])('сила атаки %s, ускорение %s', (attackPower, haste) => {
    const source = 'test:harness'
    const dps = WEAPONS.map((template) => {
      const weapon = bareWeapon(template)
      // Дополнительные статы вешаем на второй слот, чтобы оружие осталось голым.
      const buff: Item = {
        id: 'buff',
        name: 'buff',
        rarity: 'common',
        slot: 'trinket',
        mods: [
          { stat: 'attackPower', kind: 'flat', value: new Decimal(attackPower), source },
          { stat: 'haste', kind: 'flat', value: new Decimal(haste), source },
        ],
      }
      let s = withItems([weapon, buff])
      s = equipItem(s, weapon.id)
      s = equipItem(s, buff.id)
      return estimateCombatRate(s).damagePerSecond.toNumber()
    })
    // Три разные скорости (1.4 / 2.2 / 3.4 c) — один и тот же урон в секунду.
    expect(dps[1]).toBeCloseTo(dps[0], 9)
    expect(dps[2]).toBeCloseTo(dps[0], 9)
  })
})

describe('автонадевание', () => {
  it('сравнивает по урону в секунду, а не по сумме силы атаки', () => {
    // Медленное оружие (3.4 c) против быстрого (1.4 c) при равном отношении
    // урона к скорости: сумма «сырых» статов у медленного больше, но урон
    // в секунду одинаков — значит апгрейдом оно не считается.
    const fast = bareWeapon(WEAPONS[0])
    const slow = bareWeapon(WEAPONS[2])
    let s = withItems([fast, slow])
    s = equipItem(s, fast.id)
    expect(slow.mods[2].value.gt(fast.mods[2].value)).toBe(true) // урон выше
    expect(isUpgrade(s, slow)).toBe(false) // а урон в секунду — нет
  })

  it('надевает предмет, только когда он лучше; выключенный флаг не трогает ничего', () => {
    const weapon = bareWeapon(WEAPONS[1])
    const s = withItems([weapon])
    expect(isUpgrade(s, weapon)).toBe(true) // против голых рук — лучше
    expect(autoEquipIfBetter(s, weapon).equipment.weapon?.id).toBe(weapon.id)
    const off = { ...s, autoEquip: false }
    expect(autoEquipIfBetter(off, weapon).equipment.weapon).toBeNull()
  })

  it('броня без прироста урона в секунду апгрейдом не считается', () => {
    const zero = armor('пустышка', 'head', 0)
    const s = withItems([zero])
    expect(isUpgrade(s, zero)).toBe(false)
  })
})

describe('сравнение для UI', () => {
  it('отдаёт производные числа и разницу по урону в секунду', () => {
    const weapon = bareWeapon(WEAPONS[1]) // Полуторник 2.2 c, 11-22
    const s = withItems([weapon])
    const c = compareItem(s, weapon)
    expect(c.slot).toBe('weapon')
    expect(c.currentItem).toBeNull() // слот пуст — сравниваем с голыми руками
    expect(c.withItem.swingTime).toBeCloseTo(2.2, 9)
    // Урон удара = урон оружия + сила атаки * weaponSpeed / 14.
    expect(c.withItem.damageMin.toNumber()).toBeCloseTo(11 + (70 * 2.2) / 14, 9)
    expect(c.withItem.damageMax.toNumber()).toBeCloseTo(22 + (70 * 2.2) / 14, 9)
    expect(c.damagePerSecondDelta.toNumber()).toBeCloseTo(
      c.withItem.damagePerSecond.minus(c.current.damagePerSecond).toNumber(),
      9,
    )
    expect(c.isUpgrade).toBe(true)
  })

  it('после надевания сравнение идёт уже с надетым предметом', () => {
    const first = bareWeapon(WEAPONS[0])
    const second = bareWeapon(WEAPONS[1])
    let s = withItems([first, second])
    s = equipItem(s, first.id)
    expect(compareItem(s, second).currentItem?.id).toBe(first.id)
  })
})

describe('слоты', () => {
  it('у свежего героя все слоты пусты', () => {
    const s = createInitialState(1)
    expect(SLOT_IDS.every((slot) => s.equipment[slot] === null)).toBe(true)
  })

  it('предметы разных слотов не вытесняют друг друга', () => {
    const head = armor('шлем', 'head', 10)
    const chest = armor('панцирь', 'chest', 20)
    let s = withItems([head, chest])
    s = equipItem(s, head.id)
    s = equipItem(s, chest.id)
    expect(s.equipment.head?.id).toBe(head.id)
    expect(s.equipment.chest?.id).toBe(chest.id)
    expect(s.stats.attackPower.toNumber()).toBe(70 + 30)
  })

  it('снять при полном инвентаре нельзя — предмету некуда лечь', () => {
    const weapon = bareWeapon(WEAPONS[0])
    const filler = Array.from({ length: 12 }, (_, i) => armor(`м-${i}`, 'head', 1))
    let s = withItems([weapon])
    s = equipItem(s, weapon.id)
    s = { ...s, inventory: filler }
    expect(unequipItem(s, 'weapon')).toBe(s)
  })
})
