import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import {
  INVENTORY_SIZE,
  armorMods,
  averageArmorMods,
  rollLoot,
  rollRarity,
  rollSlot,
  sellItem,
  sellPrice,
  shieldMods,
  weaponMods,
  stashLoot,
} from './loot'
import { equipItem } from './equipment'
import { SLOT_IDS } from '../data/slots'
import { createInitialState, emptyEquipment, tick, type GameState } from './tick'
import { createRng } from './rng'
import { ensureStats } from './stats'
import { STEP_MS } from './loop'
import { DROP_CHANCE, averageItemSellPrice, itemSellPrice } from '../data/loot'
import { RARITIES, RARITY_BY_ID } from '../data/rarity'
import { GOLD_SOURCE_SHARE, LEVEL_CAP } from '../data/balance'
import { ZONES, representativeMonster, zoneForMonsterLevel } from '../data/zones'
import { DUST_BY_RARITY, ENCHANTS } from '../data/enchants'
import { CRAFT_TOLL_HOURS, goldPerHourAt } from '../data/recipes'
import {
  ARMOR_ATTRIBUTES,
  ARMOR_BASE_PRIMARY,
  ARMOR_BASE_VITALITY,
  ARMOR_BONUS_STAT,
  ITEM_STAT_GRAIN,
  SHIELDS,
  WEAPONS,
  type AttributeId,
} from '../data/items'
import { itemLevelScale } from '../data/balance'
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
    // конкретное значение множителя. Урон — величина «штуками» по
    // ITEM_STAT_GRAIN, поэтому формула включает округление к ближайшему:
    // в данных вещи лежит целое, и подсказка показывает то же самое.
    const mult = RARITY_BY_ID.legendary.bonusMult.toNumber()
    expect(by('weaponDamageMin')).toBe(Math.round(7 * mult))
    expect(by('weaponDamageMax')).toBe(Math.round(14 * mult))
    // А скорость округление не трогает: секунды дробные по природе.
    expect(by('weaponSpeed')).toBeCloseTo(1.4, 9)
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
    // Броня в счёт не идёт: она есть у КАЖДОЙ части брони и не разыгрывается
    // вовсе — вопрос везения тут только атрибут. Поэтому смотрим на атрибуты,
    // а не на позицию в массиве: строка брони стоит первой как главная.
    const attrs = (roll: number) => helm(roll).mods.filter((m) => m.stat !== 'armor')
    expect(attrs(0.1)[0].stat).toBe('strength')
    expect(attrs(0.3)[0].stat).toBe('agility')
    expect(attrs(0.6)[0].stat).toBe('intellect')
    // Выпавшая живучесть сливается с общим довеском в одну строку.
    const vit = attrs(0.9)
    expect(vit).toHaveLength(1)
    expect(vit[0]).toMatchObject({ stat: 'vitality', kind: 'flat' })
    expect(vit[0].value.toNumber()).toBe(6) // 4 главных + 2 довеска
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
    // Щит падает ТОЛЬКО щитом: хват приходит из шаблона, а не броском.
    expect(item!.grip).toBe('shield')
    const base = item!.mods.filter((m) => m.kind === 'base')
    expect(base.map((m) => m.stat).sort()).toEqual(['blockChance', 'blockValue'])
    expect(base.every((m) => m.source === 'equipment:offHand')).toBe(true)
    // Урона щит не даёт ни в каком виде.
    expect(item!.mods.some((m) => String(m.stat).startsWith('offhandDamage'))).toBe(false)
  })

  it('бросок выше доли щитов даёт ОДНОРУЧНОЕ оружие со своей базой', () => {
    const item = rollLoot(seqRng([0, 0, 0.2, 0, 0.9, 0]), 4)
    expect(item!.slot).toBe('offHand')
    expect(item!.grip).toBe('one')
    const base = item!.mods.filter((m) => m.kind === 'base')
    // База у левой руки СВОЯ: иначе второе оружие подменяло бы базу первого.
    expect(base.map((m) => m.stat).sort()).toEqual([
      'offhandDamageMax',
      'offhandDamageMin',
      'offhandSpeed',
    ])
    expect(base.every((m) => m.source === 'equipment:offHand')).toBe(true)
  })

  it('у каждой находки в руку есть хват, и он из шаблона', () => {
    // Требование к генерации: хват не выдумывается на месте и не бросается
    // отдельным броском — он приходит из шаблона. Проверяем всю рулетку:
    // предмет в руку без хвата правил рук не знает вовсе.
    const gripsInHands = new Set<string>()
    const rng = createRng(2026)
    for (let i = 0; i < 4000; i += 1) {
      const item = rollLoot(rng, i)
      if (!item) continue
      if (item.slot !== 'mainHand' && item.slot !== 'offHand') {
        // Броня в руки не идёт — хвата у неё нет и быть не должно.
        expect(item.grip, item.name).toBeUndefined()
        continue
      }
      expect(item.grip, item.name).toBeDefined()
      gripsInHands.add(`${item.slot}:${item.grip}`)
      // Щит — только во вторую руку: в главную он не падает никогда.
      if (item.grip === 'shield') expect(item.slot).toBe('offHand')
      // Двуручное — только в главную.
      if (item.grip === 'two') expect(item.slot).toBe('mainHand')
    }
    // Рулетка и правда выдала все три хвата, а не один и тот же.
    expect([...gripsInHands].sort()).toEqual([
      'mainHand:one',
      'mainHand:two',
      'offHand:one',
      'offHand:shield',
    ])
  })

  it('двуручное в левую руку не падает никогда', () => {
    // Прогоняем всю рулетку образцов: двуручное туда попасть не должно.
    for (let i = 0; i < 20; i += 1) {
      const item = rollLoot(seqRng([0, 0, 0.2, 0, 0.9, i / 20]), i)
      expect(item!.slot).toBe('offHand')
      expect(item!.grip).toBe('one')
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

    it('крит-находка при полной сумке НЕ продаётся', () => {
      // Худший путь из аудита: сумка полна, падает вещь только с критом.
      // Оценка не видела крита, находка читалась как «не апгрейд» и уходила
      // за медяки — тот самый предмет, что давал +19 % убийств в час.
      const worn = junk(1, 1)[0]
      let s: GameState = ensureStats({
        ...createInitialState(1),
        equipment: { ...createInitialState(1).equipment, hands: worn },
        inventory: junk(INVENTORY_SIZE, 1),
        itemSeq: INVENTORY_SIZE,
        statsDirty: true,
      })
      const talisman: Item = {
        id: `item-${INVENTORY_SIZE}`,
        name: 'Талисман Остроты',
        rarity: 'rare',
        slot: 'hands',
        level: 1,
        mods: [
          { stat: 'critChance', kind: 'flat', value: new Decimal(0.25), source: 'equipment:hands' },
        ],
      }
      s = stashLoot(s, talisman)
      // Находка в сумке, вытеснен и продан мусор — а не наоборот.
      expect(s.inventory.some((i) => i.id === talisman.id)).toBe(true)
      expect(s.inventory.length).toBe(INVENTORY_SIZE)
      const swap = s.combatLog.find((e) => e.type === 'loot-swap')
      expect(swap).toBeDefined()
      if (swap?.type === 'loot-swap') expect(swap.item.id).toBe(talisman.id)
      expect(s.combatLog.some((e) => e.type === 'autosell')).toBe(false)
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

  it('превращает предмет в золото по цене уровня и тира', () => {
    const s: GameState = { ...createInitialState(1), inventory: [item] }
    const after = sellItem(s, 'item-1')
    expect(after.inventory.length).toBe(0)
    // Число не выписано руками: цена — формула из данных, и продажа обязана
    // отдать ровно её, а не «примерно столько же».
    const expected = itemSellPrice(item.level, item.rarity)
    expect(after.gold.minus(s.gold).eq(expected)).toBe(true)
    expect(sellPrice(item).eq(expected)).toBe(true)
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

// ДОВЕСОК БРОНИ — ДАННЫЕ, А НЕ ИМЯ В КОДЕ (находка 1.4 в AUDIT.md).
//
// Логика знала, что живучесть особая: `if (primary === 'vitality')` сливал
// главный атрибут с общим довеском. Появись пятый атрибут или переедь
// довесок на другой стат — броня начала бы выдавать ДВЕ записи об одном
// стате, и в карточке предмета игрок читал бы «+12 живучести, +4 живучести»
// двумя строками.
describe('цена находки растёт от уровня и тира', () => {
  it('на одном тире цена строго растёт с уровнем вещи', () => {
    for (const rarity of RARITIES) {
      let prev = new Decimal(0)
      for (let l = 1; l <= LEVEL_CAP; l += 1) {
        const price = itemSellPrice(l, rarity.id)
        expect(price.gt(prev), `${rarity.id}, ур. ${l}`).toBe(true)
        prev = price
      }
    }
  })

  it('на одном уровне цена строго растёт с тиром', () => {
    for (const l of [1, 25, 55, 85, LEVEL_CAP]) {
      let prev = new Decimal(0)
      for (const rarity of RARITIES) {
        const price = itemSellPrice(l, rarity.id)
        expect(price.gt(prev), `ур. ${l}, ${rarity.id}`).toBe(true)
        prev = price
      }
    }
  })

  // ЧИСЛО, РАДИ КОТОРОГО ВСЁ И ДЕЛАЛОСЬ. Раньше цена не зависела от уровня
  // ВООБЩЕ: сотый уровень продавался по цене первого, и находки давали 0-1 %
  // золота. Разрыв «сотый против первого» и есть та самая починка.
  it('сотый уровень продаётся много дороже первого', () => {
    const first = itemSellPrice(1, 'common')
    const last = itemSellPrice(LEVEL_CAP, 'common')
    expect(last.div(first).toNumber()).toBeGreaterThan(20)
  })

  it('кран золота делится в заданной пропорции на каждом уровне', () => {
    // ДОЛИ СЧИТАЮТСЯ ПО ТИПИЧНОМУ УБИЙСТВУ, а не по одной находке: моб платит
    // всегда, находка — с вероятностью DROP_CHANCE и со случайным тиром.
    for (const zone of ZONES) {
      const typical = representativeMonster(zone)
      const fromMonster = typical.goldReward
      const fromLoot = averageItemSellPrice(typical.level).times(DROP_CHANCE)
      const share = fromLoot.div(fromMonster.plus(fromLoot)).toNumber()
      expect(share, zone.name).toBeCloseTo(GOLD_SOURCE_SHARE.loot, 6)
    }
  })

  it('цена вещи вне лестницы уровней не ломается', () => {
    // Уровень за потолком лестницы зон не должен ронять формулу: зоны для
    // него нет, и множитель зоны берётся единицей.
    expect(itemSellPrice(LEVEL_CAP + 50, 'common').gt(0)).toBe(true)
  })
})

// ВТОРАЯ ЖИЗНЬ НАХОДКИ: ПРОДАТЬ ИЛИ РАСПЫЛИТЬ. Это настоящий выбор игрока
// (лестница покупок даёт «продавать лишнее» и «распылять лишнее» отдельными
// покупками), и он обязан оставаться выбором. Мера — сколько находок нужно
// на ОДНО улучшение снаряжения по каждому пути: кованая вещь стоит час
// дохода золотом, зачарование — свою цену пылью.
//
// ДО ПЕРЕНОСА ДОХОДА НА НАХОДКИ ВЫБОРА НЕ БЫЛО ВОВСЕ. Цена продажи не знала
// об уровне, поэтому разрыв рос вместе с ним: ×60 на десятом уровне и ×1597
// на сотом — распылять было выгоднее в полторы тысячи раз. Теперь цена растёт
// по той же кривой, что и доход, и разрыв не зависит от уровня СТРУКТУРНО:
// в числителе и знаменателе стоит одна и та же кривая.
describe('продать или распылить — выбор, а не формальность', () => {
  const totalWeight = RARITIES.reduce((s, r) => s + r.weight, 0)
  const avgDust = RARITIES.reduce((s, r) => s + r.weight * DUST_BY_RARITY[r.id], 0) / totalWeight
  const dearestEnchant = Math.max(...ENCHANTS.map((e) => e.dustCost))

  /** Сколько находок нужно на одно улучшение каждым путём. */
  const paths = (level: number) => {
    const typical = representativeMonster(zoneForMonsterLevel(level) ?? ZONES[0])
    return {
      sell: goldPerHourAt(level).times(CRAFT_TOLL_HOURS.item)
        .div(averageItemSellPrice(typical.level)).toNumber(),
      dust: dearestEnchant / avgDust,
    }
  }

  it('разрыв между путями меньше трёх раз на всей лестнице', () => {
    for (let level = 1; level <= LEVEL_CAP; level += 1) {
      const { sell, dust } = paths(level)
      const gap = Math.max(sell, dust) / Math.min(sell, dust)
      expect(gap, `ур. ${level}`).toBeLessThan(3)
    }
  })

  it('разрыв не растёт с уровнем', () => {
    // Односторонней проверки мало: разрыв, ползущий вверх, до сотого уровня
    // в потолок не упрётся, а к рейду упрётся — и заметить это будет негде.
    const first = paths(1)
    const last = paths(LEVEL_CAP)
    expect(last.sell / last.dust).toBeCloseTo(first.sell / first.dust, 6)
  })
})

describe('модификаторы брони', () => {
  const rarity = RARITY_BY_ID.common

  it('в модификаторах брони НЕТ двух записей об одном стате', () => {
    for (const slot of ['head', 'chest', 'hands', 'legs', 'trinket'] as const) {
      for (const primary of ARMOR_ATTRIBUTES) {
        const mods = armorMods(slot, rarity, 7, primary)
        const seen = mods.map((m) => `${m.stat}:${m.kind}`)
        expect(new Set(seen).size, `${slot}/${primary}`).toBe(seen.length)
      }
    }
  })

  it('довесок идёт тому стату, который назван довеском В ДАННЫХ', () => {
    // Строка брони к этому правилу не относится: она не атрибут и слиться ни
    // с чем не может. Считаем атрибуты.
    const attrs = (primary: AttributeId) =>
      armorMods('head', rarity, 1, primary).filter((m) => m.stat !== 'armor')
    // Главный атрибут совпал с довеском — одна строка на удвоенный бюджет.
    const merged = attrs(ARMOR_BONUS_STAT)
    expect(merged).toHaveLength(1)
    expect(merged[0].stat).toBe(ARMOR_BONUS_STAT)
    expect(merged[0].value.eq(ARMOR_BASE_PRIMARY.plus(ARMOR_BASE_VITALITY))).toBe(true)

    // Не совпал — две строки, и вторая именно у довеска.
    const other = ARMOR_ATTRIBUTES.find((a) => a !== ARMOR_BONUS_STAT)!
    const split = attrs(other)
    expect(split).toHaveLength(2)
    expect(split.map((m) => m.stat)).toEqual([other, ARMOR_BONUS_STAT])
  })

  it('броня есть у каждой части брони и не зависит от главного атрибута', () => {
    for (const slot of ['head', 'chest', 'hands', 'legs', 'trinket'] as const) {
      for (const primary of ARMOR_ATTRIBUTES) {
        const armor = armorMods(slot, rarity, 7, primary).filter((m) => m.stat === 'armor')
        expect(armor, `${slot}/${primary}`).toHaveLength(1)
        expect(armor[0].kind, `${slot}/${primary}`).toBe('flat')
        expect(armor[0].value.gt(0), `${slot}/${primary}`).toBe(true)
        // Целое: броня считается штуками (ITEM_STAT_GRAIN в data/items.ts).
        expect(armor[0].value.eq(armor[0].value.round()), `${slot}/${primary}`).toBe(true)
      }
    }
  })

  it('средняя броня прогона слита по тому же признаку', () => {
    const avg = averageArmorMods('head', rarity, 1)
    const seen = avg.map((m) => m.stat)
    expect(new Set(seen).size).toBe(seen.length)
    const bonus = avg.find((m) => m.stat === ARMOR_BONUS_STAT)!
    // Броня не атрибут: она у всех одинакова и с довеском не сравнивается.
    const plain = avg.find((m) => m.stat !== ARMOR_BONUS_STAT && m.stat !== 'armor')!
    // Довесок делает свой стат тяжелее ровно на ARMOR_BASE_VITALITY.
    expect(bonus.value.minus(plain.value).eq(ARMOR_BASE_VITALITY)).toBe(true)
  })
})

describe('на выпадающих вещах только флэт', () => {
  // ПОЧЕМУ ПРАВИЛО ВООБЩЕ ЕСТЬ. Процент считается от СУММЫ конвейера, то есть
  // от остальной экипировки: такой предмет нельзя оценить сам по себе, а
  // сравнение находок в игре именно поштучное. И он не растёт ни от уровня
  // вещи, ни от тира — множитель силы умножает плоские прибавки, а проценту
  // умножать нечего. Крушитель с «+10% силы» это показывал в упор: на первом
  // уровне, когда силы нет вовсе, прибавка была РОВНО НУЛЁМ.
  //
  // Данные держит проверка контента; здесь проверяется ГЕНЕРАЦИЯ — что ни
  // один путь появления предмета не заводит процент сам.
  const allowed = new Set(['flat', 'base'])

  it('тысяча бросков дропа не даёт ни одного не-плоского модификатора', () => {
    const rng = createRng(31337)
    for (let i = 0; i < 1000; i += 1) {
      const item = rollLoot(rng, i, 1 + (i % 100))
      if (!item) continue
      for (const mod of item.mods) {
        expect(allowed.has(mod.kind), `${item.name}: ${mod.stat} ${mod.kind}`).toBe(true)
      }
    }
  })

  it('ни один шаблон оружия и щита не заводит процент', () => {
    for (const template of WEAPONS) {
      for (const mod of weaponMods(template, RARITY_BY_ID.legendary, 'mainHand', 80)) {
        expect(allowed.has(mod.kind), `${template.id}: ${mod.stat} ${mod.kind}`).toBe(true)
      }
    }
    for (const template of SHIELDS) {
      for (const mod of shieldMods(template, RARITY_BY_ID.legendary, 80)) {
        expect(allowed.has(mod.kind), `${template.id}: ${mod.stat} ${mod.kind}`).toBe(true)
      }
    }
  })

  it('побочный стат растёт от уровня вещи и от тира — процент не рос бы', () => {
    // Та самая причина, по которой процент на вещи бессмыслен: плоская
    // прибавка множится на силу предмета, а процент остался бы прежним.
    const template = WEAPONS.find((w) => w.extra.length > 0)!
    const stat = template.extra[0].stat
    const low = weaponMods(template, RARITY_BY_ID.common, 'mainHand', 1)
    const high = weaponMods(template, RARITY_BY_ID.legendary, 'mainHand', 80)
    const value = (mods: ReturnType<typeof weaponMods>) =>
      mods.find((m) => m.stat === stat)!.value.toNumber()
    expect(value(high)).toBeGreaterThan(value(low) * 5)
  })
})


// ЦЕЛЫЕ БОНУСЫ НА ПРЕДМЕТАХ (`ITEM_STAT_GRAIN` в data/items.ts).
//
// Бросок множит числа шаблона на уровень вещи и на тир, и до этой правки в
// карточке стояло «+12.4 силы» и «Урон оружия (мин): 25.5». Вещи считаются
// штуками — округление идёт НА ГЕНЕРАЦИИ, поэтому проверять его надо здесь,
// в данных предмета, а не в форматировании.
describe('целые бонусы на предметах', () => {
  const ARMOR_SLOTS = SLOT_IDS.filter((s) => s !== 'mainHand' && s !== 'offHand') as Array<
    'head' | 'chest' | 'hands' | 'legs' | 'trinket'
  >
  const LEVELS = [1, 2, 7, 13, 20, 37, 50, 64, 80, 93, 100]

  /** Каждый модификатор всякой вещи в сетке «шаблон × тир × уровень». */
  function* everyMod(): Generator<{ mod: { stat: string; value: Decimal }; where: string }> {
    for (const rarity of RARITIES) {
      for (const level of LEVELS) {
        for (const template of WEAPONS) {
          for (const slot of ['mainHand', 'offHand'] as const) {
            if (slot === 'offHand' && template.grip === 'two') continue
            for (const mod of weaponMods(template, rarity, slot, level))
              yield { mod, where: `${template.id}/${slot}/${rarity.id}/${level}` }
          }
        }
        for (const template of SHIELDS) {
          for (const mod of shieldMods(template, rarity, level))
            yield { mod, where: `${template.id}/${rarity.id}/${level}` }
        }
        for (const slot of ARMOR_SLOTS) {
          for (const primary of ARMOR_ATTRIBUTES) {
            for (const mod of armorMods(slot, rarity, level, primary))
              yield { mod, where: `${slot}/${primary}/${rarity.id}/${level}` }
          }
        }
      }
    }
  }

  it('всё, что считается штуками, лежит в предмете целым числом', () => {
    let checked = 0
    for (const { mod, where } of everyMod()) {
      if (ITEM_STAT_GRAIN[mod.stat as keyof typeof ITEM_STAT_GRAIN] !== 'whole') continue
      checked += 1
      const value = mod.value.toNumber()
      expect(Number.isInteger(value), `${where}: ${mod.stat} = ${value}`).toBe(true)
    }
    // Пустая сетка прошла бы этот тест молча — считаем, что проверять было что.
    expect(checked).toBeGreaterThan(1000)
  })

  it('тысяча бросков дропа не даёт ни одной дробной штуки', () => {
    const rng = createRng(20260903)
    let checked = 0
    for (let i = 0; i < 1000; i += 1) {
      const item = rollLoot(rng, i, 1 + (i % 100))
      if (!item) continue
      for (const mod of item.mods) {
        if (ITEM_STAT_GRAIN[mod.stat] !== 'whole') continue
        checked += 1
        expect(Number.isInteger(mod.value.toNumber()), `${item.name}: ${mod.stat}`).toBe(true)
      }
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('дробные по природе величины округление НЕ трогает', () => {
    // Скорость оружия — секунды: 1.4с это 1.4с, а не «полторы».
    for (const template of WEAPONS) {
      const speed = weaponMods(template, RARITY_BY_ID.legendary, 'mainHand', 80).find(
        (m) => m.stat === 'weaponSpeed',
      )!
      expect(speed.value.eq(template.weaponSpeed), template.id).toBe(true)
    }
    // Шанс блока — доля: округлённая до целого, она стала бы нулём.
    for (const template of SHIELDS) {
      const chance = shieldMods(template, RARITY_BY_ID.legendary, 80).find(
        (m) => m.stat === 'blockChance',
      )!
      expect(chance.value.eq(template.blockChance), template.id).toBe(true)
      expect(chance.value.gt(0)).toBe(true)
    }
  })

  it('ни одна прибавка не округляется В НОЛЬ', () => {
    // Ноль означал бы строку, которой в карточке нет вовсе (её прячет
    // `changesAnything`), и молча пропавший стат вещи. Сейчас самая мелкая
    // прибавка в данных — 2 (общий довесок брони), но правило важнее числа:
    // мельче единицы в данных заводить нельзя, и тест это скажет вслух.
    for (const { mod, where } of everyMod()) {
      if (ITEM_STAT_GRAIN[mod.stat as keyof typeof ITEM_STAT_GRAIN] !== 'whole') continue
      expect(mod.value.gt(0), `${where}: ${mod.stat} округлился в ноль`).toBe(true)
    }
  })

  // ГЛАВНАЯ ПРОВЕРКА СТАДИИ: округление не должно систематически съедать силу.
  // Вниз оно забирало бы в среднем полединицы с каждой строки — на семи слотах
  // это несколько единиц из воздуха. К ближайшему смещение нулевое, и здесь
  // оно меряется: сумма всех прибавок сетки до и после.
  it('средняя сила предмета от округления меняется меньше чем на процент', () => {
    let before = 0
    let after = 0
    const worst: Array<{ where: string; drift: number }> = []
    for (const rarity of RARITIES) {
      for (const level of LEVELS) {
        const power = itemLevelScale(level).times(rarity.bonusMult)
        // «До» пересчитывается теми же константами данных, что и «после»:
        // это ровно та формула, что стояла в loot.ts до округления.
        const raws: Array<{ stat: string; raw: Decimal; where: string }> = []
        for (const template of WEAPONS) {
          raws.push(
            { stat: 'weaponDamageMin', raw: template.damageMin.times(power), where: template.id },
            { stat: 'weaponDamageMax', raw: template.damageMax.times(power), where: template.id },
            ...template.extra.map((m) => ({
              stat: m.stat as string,
              raw: m.value.times(power),
              where: template.id,
            })),
          )
        }
        for (const template of SHIELDS) {
          raws.push(
            { stat: 'blockValue', raw: template.blockValue.times(power), where: template.id },
            ...template.extra.map((m) => ({
              stat: m.stat as string,
              raw: m.value.times(power),
              where: template.id,
            })),
          )
        }
        for (const primary of ARMOR_ATTRIBUTES) {
          const merged = primary === ARMOR_BONUS_STAT
          raws.push({
            stat: primary,
            raw: (merged ? ARMOR_BASE_PRIMARY.plus(ARMOR_BASE_VITALITY) : ARMOR_BASE_PRIMARY).times(
              power,
            ),
            where: `armor/${primary}`,
          })
          if (!merged)
            raws.push({
              stat: ARMOR_BONUS_STAT,
              raw: ARMOR_BASE_VITALITY.times(power),
              where: `armor/${primary}`,
            })
        }
        for (const { stat, raw, where } of raws) {
          const rounded = raw.round().toNumber()
          before += raw.toNumber()
          after += rounded
          worst.push({
            where: `${where}/${stat}/${rarity.id}/${level}`,
            drift: (rounded - raw.toNumber()) / raw.toNumber(),
          })
        }
      }
    }
    const drift = (after - before) / before
    worst.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
    console.log(
      `Округление к ближайшему: сумма прибавок ${before.toFixed(1)} → ${after.toFixed(1)}, ` +
        `сдвиг ${(drift * 100).toFixed(3)}%. Худшая отдельная строка: ` +
        `${worst[0].where} ${(worst[0].drift * 100).toFixed(1)}%.`,
    )
    expect(Math.abs(drift)).toBeLessThan(0.01)
  })
})

describe('сколько падает щитов', () => {
  // ЗАМЕР ПЕРВЫМ, РЕШЕНИЕ ВТОРЫМ. Щит после появления брони стал нести
  // заметную долю смягчения, и вопрос «а не слишком ли он редкий» законен.
  // Ответ считается, а не назначается: доля щитов лежит в данных
  // (SHIELD_SHARE в data/loot.ts), и тест фиксирует, ЧТО ИЗ НЕЁ ВЫХОДИТ.
  const KILLS = 60_000
  const per1000 = (n: number) => (n / KILLS) * 1000

  function drops(level: number) {
    const rng = createRng(4242 + level)
    const bySlot = new Map<string, number>()
    let shields = 0
    let total = 0
    for (let i = 0; i < KILLS; i += 1) {
      const item = rollLoot(rng, i, level)
      if (!item) continue
      total += 1
      bySlot.set(item.slot, (bySlot.get(item.slot) ?? 0) + 1)
      if (item.grip === 'shield') shields += 1
    }
    return { total, shields, bySlot }
  }

  it('щит — самая редкая находка, но не дефицит', () => {
    for (const level of [25, 55, 85]) {
      const { total, shields, bySlot } = drops(level)
      const shieldsPer1000 = per1000(shields)
      const chestPer1000 = per1000(bySlot.get('chest') ?? 0)
      // ОДИН ЩИТ НА ВОСЕМЬ ДЕСЯТКОВ УБИЙСТВ. Полный путь стоит около пяти
      // тысяч убийств, то есть щитов за игру выпадает шесть десятков — по
      // одному на полтора уровня героя. Редкость есть, дефицита нет.
      expect(shieldsPer1000, `ур.${level}: щитов на 1000 убийств`).toBeGreaterThan(10)
      expect(shieldsPer1000, `ур.${level}: щитов на 1000 убийств`).toBeLessThan(16)
      // И он ВСЕГДА реже любой части брони: слот левой руки делится с
      // одноручным оружием, а армора там нет вовсе.
      expect(shieldsPer1000, `ур.${level}: щит реже нагрудника`).toBeLessThan(chestPer1000)
      // Доля щитов среди всех находок — около пяти процентов.
      expect((shields / total) * 100, `ур.${level}: доля щитов`).toBeGreaterThan(3)
      expect((shields / total) * 100, `ур.${level}: доля щитов`).toBeLessThan(8)
    }
  })

  it('выпадение щитов не зависит от уровня', () => {
    // Уровень меняет СИЛУ находки, а не её вид: рулетка слотов и доля щитов
    // от него не зависят вовсе, и разъехаться они могли бы только правкой.
    const rates = [25, 55, 85].map((level) => per1000(drops(level).shields))
    expect(Math.max(...rates) / Math.min(...rates)).toBeLessThan(1.15)
  })
})
