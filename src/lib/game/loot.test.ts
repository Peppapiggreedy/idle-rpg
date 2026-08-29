import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { INVENTORY_SIZE, rollLoot, rollRarity, rollSlot, sellItem, sellPrice } from './loot'
import { equipItem } from './equipment'
import { SLOT_IDS } from '../data/slots'
import { createInitialState, tick, type GameState } from './tick'
import { STEP_MS } from './loop'
import { DROP_CHANCE } from '../data/loot'
import { RARITIES } from '../data/rarity'
import type { Item } from '../types'

// rng из заготовленной последовательности значений.
function seqRng(values: number[]) {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}

describe('rollRarity', () => {
  it('края рулетки: 0 — common, почти 1 — legendary', () => {
    expect(rollRarity(() => 0).id).toBe('common')
    expect(rollRarity(() => 0.999999).id).toBe('legendary')
  })

  it('распределение уважает веса (сеточная проверка без случайности)', () => {
    const total = RARITIES.reduce((s, r) => s + r.weight, 0)
    const counts: Record<string, number> = {}
    for (let i = 0; i < total; i++) {
      const id = rollRarity(() => (i + 0.5) / total).id
      counts[id] = (counts[id] ?? 0) + 1
    }
    for (const r of RARITIES) expect(counts[r.id]).toBe(r.weight)
  })
})

describe('rollLoot', () => {
  it('дроп не выпадает, если бросок выше шанса', () => {
    expect(rollLoot(() => DROP_CHANCE, 0)).toBeNull()
  })

  it('оружие задаёт базу боя тремя модификаторами kind base', () => {
    // Броски: шанс, редкость (почти 1 = legendary), слот (0 = правая рука),
    // прилагательное, модель оружия.
    const item = rollLoot(seqRng([0, 0.999999, 0, 0, 0]), 7)
    expect(item).not.toBeNull()
    expect(item!.id).toBe('item-7')
    expect(item!.rarity).toBe('legendary')
    expect(item!.slot).toBe('mainHand')
    expect(item!.name).toBe('Щербатый Змеезуб')
    const base = item!.mods.filter((m) => m.kind === 'base')
    expect(base.map((m) => m.stat).sort()).toEqual([
      'weaponDamageMax',
      'weaponDamageMin',
      'weaponSpeed',
    ])
    expect(base.every((m) => m.source === 'equipment:mainHand')).toBe(true)
    const by = (stat: string) => base.find((m) => m.stat === stat)!.value.toNumber()
    expect(by('weaponSpeed')).toBeCloseTo(1.4, 9)
    expect(by('weaponDamageMin')).toBe(112) // 7 * bonusMult 16
    expect(by('weaponDamageMax')).toBe(224) // 14 * bonusMult 16
  })

  it('броня даёт атрибуты обычными модификаторами, без base', () => {
    // Слот 0.35 попадает в отрезок головы (за двумя руками, 34 из 114).
    const item = rollLoot(seqRng([0, 0, 0.35, 0, 0]), 1)
    expect(item!.slot).toBe('head')
    expect(item!.name).toBe('Щербатый Шлем')
    expect(item!.mods.some((m) => m.kind === 'base')).toBe(false)
    expect(item!.mods.every((m) => m.source === 'equipment:head')).toBe(true)
    // Главный атрибут слота головы — интеллект, довесок — живучесть.
    const primary = item!.mods.find((m) => m.stat === 'intellect')!
    expect(primary.value.toNumber()).toBe(4) // база 4 * bonusMult 1 * уровень 1
    const vit = item!.mods.find((m) => m.stat === 'vitality')!
    expect(vit.value.toNumber()).toBe(2)
  })

  it('предмет наследует уровень моба, и сила растёт от него линейно', () => {
    const at = (level: number) => rollLoot(seqRng([0, 0, 0.35, 0, 0]), 1, level)!
    expect(at(1).level).toBe(1)
    expect(at(26).level).toBe(26)
    const base = at(1).mods.find((m) => m.stat === 'intellect')!.value
    const deep = at(26).mods.find((m) => m.stat === 'intellect')!.value
    // itemLevelScale(26) = 1 + 0.16 * 25 = 5 — та же прямая, что у HP мобов.
    expect(deep.div(base).toNumber()).toBeCloseTo(5, 9)
  })
})

describe('левая рука: щит или второй клинок', () => {
  // Порядок бросков фиксирован: слот -> прилагательное -> «щит или оружие»
  // -> сам образец. Поменяется порядок — разъедутся все прогоны с сидом.
  it('бросок ниже доли щитов даёт щит с блоком через конвейер', () => {
    const item = rollLoot(seqRng([0, 0, 0.2, 0, 0.1, 0]), 3)
    expect(item!.slot).toBe('offHand')
    expect(item!.name).toBe('Щербатый Заслон')
    // Щит — не оружие: поля hands у него нет вовсе.
    expect(item!.hands).toBeUndefined()
    const base = item!.mods.filter((m) => m.kind === 'base')
    expect(base.map((m) => m.stat).sort()).toEqual(['blockChance', 'blockValue'])
    expect(base.every((m) => m.source === 'equipment:offHand')).toBe(true)
    // Урона щит не даёт ни в каком виде.
    expect(item!.mods.some((m) => String(m.stat).startsWith('offhandDamage'))).toBe(false)
  })

  it('бросок выше доли щитов даёт ОДНОРУЧНОЕ оружие со своей базой', () => {
    const item = rollLoot(seqRng([0, 0, 0.2, 0, 0.9, 0]), 4)
    expect(item!.slot).toBe('offHand')
    expect(item!.hands).toBe(1)
    const base = item!.mods.filter((m) => m.kind === 'base')
    // База у левой руки СВОЯ: иначе второе оружие подменяло бы базу первого.
    expect(base.map((m) => m.stat).sort()).toEqual([
      'offhandDamageMax',
      'offhandDamageMin',
      'offhandSpeed',
    ])
    expect(base.every((m) => m.source === 'equipment:offHand')).toBe(true)
  })

  it('двуручное в левую руку не падает никогда', () => {
    // Прогоняем всю рулетку образцов: двуручное туда попасть не должно.
    for (let i = 0; i < 20; i += 1) {
      const item = rollLoot(seqRng([0, 0, 0.2, 0, 0.9, i / 20]), i)
      expect(item!.slot).toBe('offHand')
      expect(item!.hands).toBe(1)
    }
  })
})

describe('rollSlot', () => {
  it('края рулетки: 0 — оружие, почти 1 — последний слот', () => {
    expect(rollSlot(() => 0)).toBe('mainHand')
    expect(rollSlot(() => 0.999999)).toBe(SLOT_IDS[SLOT_IDS.length - 1])
  })
})

// Сид фиксирован: без него spawnMonster выдаёт случайного моба зоны, и тест
// становится плавающим — длина боя зависит от того, кто попался.
describe('дроп в бою', () => {
  function untilLoot(state: GameState, rng: () => number): GameState {
    // Бой обычного моба стартовой зоны идёт около десяти секунд (контракт
    // темпа), поэтому крутим щедрый запас тиков и выходим по первому же луту.
    for (let i = 0; i < 1200; i++) {
      state = tick(state, STEP_MS, rng)
      if (state.combatLog.some((e) => e.type === 'loot')) break
    }
    return state
  }

  it('с моба падает предмет и попадает в инвентарь с записью в лог', () => {
    // Автонадевание выключено: проверяем путь «дроп -> инвентарь».
    const s = untilLoot({ ...createInitialState(1), autoEquip: false }, () => 0)
    expect(s.inventory.length).toBe(1)
    expect(s.combatLog.some((e) => e.type === 'loot')).toBe(true)
  })

  it('с включённым автонадеванием предмет сразу уходит в слот', () => {
    // rng 0 -> слот оружия: безоружный герой обязан счесть его апгрейдом.
    const s = untilLoot(createInitialState(1), () => 0)
    expect(s.equipment.mainHand).not.toBeNull()
    expect(s.inventory).toEqual([]) // из инвентаря предмет ушёл на героя
    expect(s.stats.weaponSpeed).toBeCloseTo(1.4, 9) // база боя от оружия
  })

  it('автонадевание не трогает предмет, который хуже надетого', () => {
    const s = untilLoot(createInitialState(1), () => 0)
    const equipped = s.equipment.mainHand!
    // Второй такой же дроп не лучше первого — остаётся в инвентаре.
    const after = untilLoot({ ...s, combatLog: [] }, () => 0)
    expect(after.equipment.mainHand?.id).toBe(equipped.id)
    expect(after.inventory.length).toBe(1)
  })

  it('при полном инвентаре предмет не падает', () => {
    const full: Item[] = Array.from({ length: INVENTORY_SIZE }, (_, i) => ({
      id: `item-${i}`,
      name: 'Ржавый Хват',
      rarity: 'common',
      slot: 'hands',
      level: 1,
      mods: [
        { stat: 'attackPower', kind: 'flat', value: new Decimal(1), source: 'equipment:hands' },
      ],
    }))
    let s: GameState = { ...createInitialState(1), inventory: full, itemSeq: INVENTORY_SIZE }
    for (let i = 0; i < 40; i++) s = tick(s, STEP_MS, () => 0)
    expect(s.inventory.length).toBe(INVENTORY_SIZE)
  })
})

describe('продажа', () => {
  const item: Item = {
    id: 'item-1',
    name: 'Верный Оберег',
    rarity: 'rare',
    slot: 'trinket',
    level: 1,
    mods: [
      { stat: 'attackPower', kind: 'flat', value: new Decimal(4), source: 'equipment:trinket' },
    ],
  }

  it('превращает предмет в золото по цене тира', () => {
    const s: GameState = { ...createInitialState(1), inventory: [item] }
    const after = sellItem(s, 'item-1')
    expect(after.inventory.length).toBe(0)
    // база 5 * sellMult(rare) 5 = 25 золота
    expect(after.gold.minus(s.gold).toNumber()).toBe(25)
    expect(sellPrice(item).toNumber()).toBe(25)
  })

  it('надетый предмет продать нельзя — сперва снять', () => {
    const s: GameState = { ...createInitialState(1), inventory: [item] }
    const equipped = equipItem(s, 'item-1')
    expect(equipped.equipment.trinket?.id).toBe('item-1')
    const after = sellItem(equipped, 'item-1')
    expect(after).toBe(equipped) // золото не начислено, предмет на месте
    expect(after.equipment.trinket?.id).toBe('item-1')
  })

  it('несуществующий id — состояние не меняется', () => {
    const s: GameState = { ...createInitialState(1), inventory: [item] }
    expect(sellItem(s, 'нет-такого')).toBe(s)
  })
})
