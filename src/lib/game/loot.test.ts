import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { INVENTORY_SIZE, rollLoot, rollRarity, rollSlot, sellItem, sellPrice } from './loot'
import { equipItem } from './equipment'
import { SLOT_IDS } from '../data/slots'
import { createInitialState, emptyEquipment, tick, type GameState } from './tick'
import { ensureStats } from './stats'
import { STEP_MS } from './loop'
import { DROP_CHANCE } from '../data/loot'
import { RARITIES, RARITY_BY_ID } from '../data/rarity'
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
    // Числа берутся ИЗ ДАННЫХ редкости, а не переписываются руками: лестница
    // редкостей — предмет баланса, и тест обязан проверять формулу, а не
    // конкретное значение множителя.
    const mult = RARITY_BY_ID.legendary.bonusMult.toNumber()
    expect(by('weaponDamageMin')).toBeCloseTo(7 * mult, 9)
    expect(by('weaponDamageMax')).toBeCloseTo(14 * mult, 9)
  })

  it('броня даёт атрибуты обычными модификаторами, без base', () => {
    // Слот 0.35 попадает в отрезок головы (за двумя руками, 34 из 114).
    // Последний бросок — главный атрибут: 0.6 из четырёх даёт интеллект.
    const item = rollLoot(seqRng([0, 0, 0.35, 0, 0, 0.6]), 1)
    expect(item!.slot).toBe('head')
    expect(item!.name).toBe('Щербатый Шлем')
    expect(item!.mods.some((m) => m.kind === 'base')).toBe(false)
    expect(item!.mods.every((m) => m.source === 'equipment:head')).toBe(true)
    const primary = item!.mods.find((m) => m.stat === 'intellect')!
    expect(primary.value.toNumber()).toBe(4) // база 4 * bonusMult 1 * уровень 1
    const vit = item!.mods.find((m) => m.stat === 'vitality')!
    expect(vit.value.toNumber()).toBe(2)
  })

  it('главный атрибут брони не привязан к слоту — его решает бросок', () => {
    const helm = (roll: number) => rollLoot(seqRng([0, 0, 0.35, 0, 0, roll]), 1)!
    expect(helm(0.1).mods[0].stat).toBe('strength')
    expect(helm(0.3).mods[0].stat).toBe('agility')
    expect(helm(0.6).mods[0].stat).toBe('intellect')
    // Выпавшая живучесть сливается с общим довеском в одну строку.
    const vit = helm(0.9)
    expect(vit.mods).toHaveLength(1)
    expect(vit.mods[0]).toMatchObject({ stat: 'vitality', kind: 'flat' })
    expect(vit.mods[0].value.toNumber()).toBe(6) // 4 главных + 2 довеска
  })

  it('предмет наследует уровень моба, и сила растёт от него линейно', () => {
    const at = (level: number) => rollLoot(seqRng([0, 0, 0.35, 0, 0, 0.6]), 1, level)!
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
    const s = untilLoot(createInitialState(1), () => 0)
    expect(s.inventory.length).toBe(1)
    expect(s.combatLog.some((e) => e.type === 'loot')).toBe(true)
  })

  it('надетым предмет сам не становится: автонадевания больше нет', () => {
    // rng 0 -> слот оружия. Раньше герой надел бы находку сам, и апгрейд
    // проходил незамеченным. Теперь она ждёт в сумке, а в руке остаётся
    // стартовое оружие, пока игрок не решит иначе.
    const before = createInitialState(1)
    const s = untilLoot(before, () => 0)
    expect(s.equipment.mainHand?.id).toBe(before.equipment.mainHand?.id)
    expect(s.inventory.length).toBe(1)
  })

  // Полная сумка раньше глушила дроп ЦЕЛИКОМ: герой переставал находить
  // вещи, пока игрок не продаст. Это был техдолг №4, и вот его проверки.
  describe('полная сумка', () => {
    function junk(count: number, value = 1): Item[] {
      return Array.from({ length: count }, (_, i) => ({
        id: `item-${i}`,
        name: 'Ржавый Хват',
        rarity: 'common' as const,
        slot: 'hands' as const,
        level: 1,
        mods: [
          {
            stat: 'attackPower' as const,
            kind: 'flat' as const,
            value: new Decimal(value),
            source: 'equipment:hands',
          },
        ],
      }))
    }

    it('дроп всё равно бросается, а находка уходит в золото', () => {
      // Мусор в сумке лучше находки не бывает, но и находка не апгрейд:
      // слот кистей уже занят таким же. Значит — автопродажа.
      const full = junk(INVENTORY_SIZE, 999)
      let s: GameState = {
        ...createInitialState(1),
        inventory: full,
        equipment: { ...createInitialState(1).equipment, hands: junk(1, 999)[0] },
        itemSeq: INVENTORY_SIZE,
      }
      s = ensureStats({ ...s, statsDirty: true })
      const before = s.gold
      for (let i = 0; i < 1200; i++) {
        s = tick(s, STEP_MS, () => 0)
        if (s.combatLog.some((e) => e.type === 'autosell')) break
      }
      expect(s.combatLog.some((e) => e.type === 'autosell')).toBe(true)
      expect(s.gold.gt(before)).toBe(true)
      expect(s.inventory.length).toBe(INVENTORY_SIZE)
    })

    it('апгрейд при полной сумке не теряется: вытесняется худшее', () => {
      // Сумка забита слабым мусором, герой раздет — любая найденная вещь
      // апгрейд. Потерять её из-за полной сумки нельзя.
      let s: GameState = ensureStats({
        ...createInitialState(1),
        equipment: emptyEquipment(),
        inventory: junk(INVENTORY_SIZE),
        itemSeq: INVENTORY_SIZE,
        statsDirty: true,
      })
      for (let i = 0; i < 1200; i++) {
        s = tick(s, STEP_MS, () => 0)
        if (s.combatLog.some((e) => e.type === 'loot-swap')) break
      }
      const swap = s.combatLog.find((e) => e.type === 'loot-swap')
      expect(swap).toBeDefined()
      expect(s.inventory.length).toBe(INVENTORY_SIZE)
      // Находка в сумке, вытесненный мусор — нет.
      if (swap?.type === 'loot-swap') {
        expect(s.inventory.some((i) => i.id === swap.item.id)).toBe(true)
        expect(s.inventory.some((i) => i.id === swap.dropped.id)).toBe(false)
      }
    })
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
