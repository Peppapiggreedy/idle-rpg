import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import {
  upgradeShare,
  equipmentWith,
  compareItem,
  equipItem,
  equipStatus,
  isEquipped,
  isUpgrade,
  unequipItem,
} from './equipment'
import { estimateCombatRate } from './combat'
import {
  createInitialState,
  emptyEquipment,
  manualOnlySettings,
  monsterFromTemplate,
  type GameState,
} from './state'
import { ensureStats } from './stats'
import { INVENTORY_SIZE, UNARMED } from '../data/balance'
import { OFFHAND_PENALTY } from '../data/balance'
import { ONE_HANDED, SHIELDS, WEAPONS, type ShieldTemplate, type WeaponTemplate } from '../data/items'
import { SLOT_IDS } from '../data/slots'
import { ZONE_BY_ID, zoneMonsterVariants } from '../data/zones'
import type { Item, Rarity } from '../types'

// Голый герой: стартовый комплект снят. Эти тесты про КОНВЕЙЕР и формулы,
// а не про то, во что игра одевает новобранца, — база должна быть чистой,
// иначе они мерили бы ещё и стартовые вещи.
function bareHero(seed = 1): GameState {
  return ensureStats({
    ...createInitialState(seed),
    equipment: emptyEquipment(),
    statsDirty: true,
  })
}


// Оружие «как из лута», но без побочных статов: для инварианта важна только
// база боя (скорость и диапазон урона).
function bareWeapon(t: WeaponTemplate, slot: 'mainHand' | 'offHand' = 'mainHand'): Item {
  const source = `equipment:${slot}`
  const off = slot === 'offHand'
  return {
    id: `w-${slot}-${t.id}`,
    name: t.noun,
    rarity: 'common' as Rarity,
    slot,
    level: 1,
    grip: t.grip,
    mods: [
      { stat: off ? 'offhandSpeed' : 'weaponSpeed', kind: 'base', value: t.weaponSpeed, source },
      { stat: off ? 'offhandDamageMin' : 'weaponDamageMin', kind: 'base', value: t.damageMin, source },
      { stat: off ? 'offhandDamageMax' : 'weaponDamageMax', kind: 'base', value: t.damageMax, source },
    ],
  }
}

// Щит «как из лута», но без побочных статов: важен только блок.
function bareShield(t: ShieldTemplate): Item {
  const source = 'equipment:offHand'
  return {
    id: `sh-${t.id}`,
    name: t.noun,
    rarity: 'common' as Rarity,
    slot: 'offHand',
    level: 1,
    grip: t.grip,
    mods: [
      { stat: 'blockChance', kind: 'base', value: t.blockChance, source },
      { stat: 'blockValue', kind: 'base', value: t.blockValue, source },
    ],
  }
}

function armor(id: string, slot: 'head' | 'chest', attackPower: number): Item {
  return {
    id,
    name: id,
    rarity: 'common',
    slot,
    level: 1,
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
  return ensureStats({ ...bareHero(1), inventory: items, statsDirty: true, ...patch })
}

describe('оружие задаёт базу боя', () => {
  it('надетое оружие заменяет безоружные значения, снятое — возвращает', () => {
    const weapon = bareWeapon(WEAPONS[2]) // Крушитель: 3.4 c, 25.5-51
    const s = withItems([weapon])
    expect(s.stats.weaponSpeed).toBe(UNARMED.weaponSpeed.toNumber())

    const equipped = equipItem(s, weapon.id)
    expect(equipped.stats.weaponSpeed).toBeCloseTo(3.4, 9)
    expect(equipped.stats.weaponDamageMin.toNumber()).toBe(25.5)
    expect(equipped.stats.weaponDamageMax.toNumber()).toBe(51)
    expect(equipped.inventory).toEqual([]) // предмет ушёл из сумки на героя
    expect(isEquipped(equipped, weapon.id)).toBe(true)

    const bare = unequipItem(equipped, 'mainHand')
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

describe('инвариант: равный урон оружия в секунду — равный урон в секунду', () => {
  // Инвариант из итерации 2 пережил вторую руку, но мерить его теперь надо на
  // СВЯЗКАХ, а не на предметах: правая рука одноручного оружия честно даёт
  // половину связки, и сравнивать её с двуручным — сравнивать полруки с двумя.
  //
  //   два одноручных: 7.5 + 7.5 * OFFHAND_PENALTY = 11.25;
  //   двуручное:      11.25.
  //
  // Одноручное со щитом сюда не входит намеренно: у него 7.5, и это плата.
  const bundles = (): Array<{ name: string; items: Item[] }> => [
    ...ONE_HANDED.map((t) => ({
      name: `два ${t.noun}`,
      items: [bareWeapon(t, 'mainHand'), bareWeapon(t, 'offHand')],
    })),
    ...WEAPONS.filter((t) => t.grip === 'two').map((t) => ({
      name: t.noun,
      items: [bareWeapon(t, 'mainHand')],
    })),
  ]

  it.each([
    [0, 0],
    [500, 0],
    [0, 0.5],
    [1234, 1.75],
  ])('сила атаки %s, ускорение %s', (attackPower, haste) => {
    const source = 'test:harness'
    const dps = bundles().map((bundle) => {
      // Дополнительные статы вешаем на талисман, чтобы руки остались голыми.
      const buff: Item = {
        id: 'buff',
        name: 'buff',
        rarity: 'common',
        slot: 'trinket',
        level: 1,
        mods: [
          { stat: 'attackPower', kind: 'flat', value: new Decimal(attackPower), source },
          { stat: 'haste', kind: 'flat', value: new Decimal(haste), source },
        ],
      }
      let s = withItems([...bundle.items, buff])
      for (const item of [...bundle.items, buff]) s = equipItem(s, item.id)
      // Инвариант — про УДАР ОРУЖИЯ. Умения намеренно любят медленное оружие
      // (доля от крупного удара больше), поэтому берём автоатаку отдельно.
      return estimateCombatRate(s).autoDamagePerSecond.toNumber()
    })
    // Разные скорости и разные стили — один и тот же урон в секунду.
    for (let i = 1; i < dps.length; i += 1) expect(dps[i]).toBeCloseTo(dps[0], 6)
  })

  it('щит стоит урона ровно столько, сколько отдаёт вторая рука', () => {
    const one = ONE_HANDED[0]
    // Силу атаки обнуляем базовым модификатором: она делится между руками и
    // одинакова у обоих стилей, а мерить здесь надо вклад именно второй руки.
    const noAp: Item = {
      id: 'no-ap',
      name: 'no-ap',
      rarity: 'common',
      slot: 'trinket',
      level: 1,
      mods: [{ stat: 'attackPower', kind: 'base', value: new Decimal(0), source: 'test:harness' }],
    }
    const build = (items: Item[]): GameState => {
      let s = withItems(items)
      for (const item of items) s = equipItem(s, item.id)
      return s
    }
    const dual = build([bareWeapon(one, 'mainHand'), bareWeapon(one, 'offHand'), noAp])
    const shielded = build([bareWeapon(one, 'mainHand'), bareShield(SHIELDS[0]), noAp])
    const dualDps = estimateCombatRate(dual).autoDamagePerSecond
    const shieldDps = estimateCombatRate(shielded).autoDamagePerSecond
    expect(shieldDps.lt(dualDps)).toBe(true)
    // Ровно доля второй руки — не «примерно меньше», а именно она.
    expect(dualDps.div(shieldDps).toNumber()).toBeCloseTo(1 + OFFHAND_PENALTY, 6)
    // И плата возвращается живучестью: блок и запас HP.
    expect(shielded.stats.blockChance).toBeGreaterThan(0)
    expect(dual.stats.blockChance).toBe(0)
  })
})

describe('автонадевание', () => {
  it('сравнивает по урону в секунду, а не по сумме силы атаки', () => {
    // По автоатаке два оружия равны: отношение урона к скорости одинаково.
    const fast = bareWeapon(ONE_HANDED[0])
    const slow = bareWeapon(ONE_HANDED[1])
    let s = withItems([fast, slow])
    s = equipItem(s, fast.id)
    expect(slow.mods[2].value.gt(fast.mods[2].value)).toBe(true) // урон выше
    const withFast = estimateCombatRate(s).autoDamagePerSecond
    const withSlow = estimateCombatRate(equipItem(s, slow.id)).autoDamagePerSecond
    expect(withSlow.toNumber()).toBeCloseTo(withFast.toNumber(), 9)

    // Без умений медленное оружие апгрейдом не считается — урон в секунду тот же.
    const noAbilities = { ...s, abilitySettings: manualOnlySettings() }
    expect(isUpgrade(noAbilities, slow)).toBe(false)
    // А с включённым автокастом — считается, и это НЕ ошибка сравнения: удар
    // крупнее, значит и умения от него бьют сильнее при той же цене в мане.
    expect(isUpgrade(s, slow)).toBe(true)
  })

  it('надевает предмет, только когда он лучше; выключенный флаг не трогает ничего', () => {
    const weapon = bareWeapon(WEAPONS[1])
    const s = withItems([weapon])
    expect(isUpgrade(s, weapon)).toBe(true) // против голых рук — лучше
    // Сам он никуда не денется: надевает предметы только игрок.
    expect(s.equipment.mainHand).toBeNull()
  })

  it('доля прироста считается тем же estimateCombatRate, что и сравнение', () => {
    // Метка «+12%» и подсказка под курсором обязаны говорить одно и то же:
    // двух мер «хорошести» в игре нет.
    const better = armor('добротный шлем', 'head', 40)
    const s = withItems([better])
    const cmp = compareItem(s, better)
    const share = upgradeShare(s, better)!
    // Доля считается по ТЕМПУ УБИЙСТВ, а не по голому урону в секунду: в темп
    // входит ещё и аптайм, то есть живучесть, и без него броня никогда не
    // считалась бы апгрейдом (см. комментарий у farmRate в equipment.ts).
    expect(share).toBeCloseTo(
      cmp.withItem.killsPerSecond
        .minus(cmp.current.killsPerSecond)
        .div(cmp.current.killsPerSecond)
        .toNumber(),
      9,
    )
    // Не апгрейд — доли нет вовсе, а не «ноль процентов».
    const zero = armor('пустышка', 'head', 0)
    expect(upgradeShare(withItems([zero]), zero)).toBeNull()
  })

  it('броня без прироста урона в секунду апгрейдом не считается', () => {
    const zero = armor('пустышка', 'head', 0)
    const s = withItems([zero])
    expect(isUpgrade(s, zero)).toBe(false)
  })
})

describe('две руки: правила связки', () => {
  const equipAll = (items: Item[]): GameState => {
    let s = withItems(items)
    for (const item of items) s = equipItem(s, item.id)
    return s
  }

  it('двуручное занимает обе руки и освобождает левую', () => {
    const main = bareWeapon(ONE_HANDED[0], 'mainHand')
    const off = bareWeapon(ONE_HANDED[0], 'offHand')
    const two = bareWeapon(WEAPONS.find((w) => w.grip === 'two')!, 'mainHand')
    let s = equipAll([main, off])
    expect(s.equipment.offHand?.id).toBe(off.id)
    s = equipItem({ ...s, inventory: [two] }, two.id)
    expect(s.equipment.mainHand?.id).toBe(two.id)
    expect(s.equipment.offHand).toBeNull()
    // Освобождённая рука вернулась в сумку, а не растворилась.
    expect(s.inventory.map((i) => i.id).sort()).toEqual([main.id, off.id].sort())
  })

  // ПРАВИЛО ИЗМЕНИЛОСЬ ОСОЗНАННО. Раньше предмет в левую руку молча срывал
  // надетое двуручное — то есть одно нажатие меняло связку целиком, и игрок
  // узнавал об этом уже по упавшему урону. Теперь это ОТКАЗ с причиной:
  // двуручное снимают сами, и решение остаётся за игроком.
  it('во вторую руку при двуручном — отказ, а не молчаливый срыв связки', () => {
    const two = bareWeapon(WEAPONS.find((w) => w.grip === 'two')!, 'mainHand')
    const off = bareWeapon(ONE_HANDED[0], 'offHand')
    let s = equipAll([two])
    s = { ...s, inventory: [off] }
    expect(equipStatus(s, off).reason).toBe('occupied-by-two-handed')
    const after = equipItem(s, off.id)
    // Ничего не изменилось: ни руки, ни сумка.
    expect(after.equipment.mainHand?.id).toBe(two.id)
    expect(after.equipment.offHand).toBeNull()
    expect(after.inventory.map((i) => i.id)).toEqual([off.id])
  })

  it('щит в главную руку не надевается ни при каких условиях', () => {
    const shield = { ...bareShield(SHIELDS[0]), slot: 'mainHand' as const }
    const s = { ...equipAll([]), inventory: [shield] }
    expect(equipStatus(s, shield).reason).toBe('shield-offhand-only')
    expect(equipItem(s, shield.id).equipment.mainHand).toBeNull()
  })

  it('двуручное не надеть, когда снятому некуда лечь', () => {
    // Сумка полна, обе руки заняты: двуручное сняло бы ДВА предмета, а
    // освободило бы одно место. Отказ — и ни один предмет не потерян.
    const two = bareWeapon(WEAPONS.find((w) => w.grip === 'two')!, 'mainHand')
    const main = bareWeapon(ONE_HANDED[0], 'mainHand')
    const off = bareWeapon(ONE_HANDED[0], 'offHand')
    const filler = Array.from({ length: INVENTORY_SIZE - 1 }, (_, i) => ({
      ...bareWeapon(ONE_HANDED[0], 'mainHand'),
      id: `filler-${i}`,
    }))
    let s = equipAll([main, off])
    s = { ...s, inventory: [two, ...filler] }
    expect(s.inventory).toHaveLength(INVENTORY_SIZE)
    expect(equipStatus(s, two).reason).toBe('two-handed-needs-both')
    const after = equipItem(s, two.id)
    expect(after.equipment.mainHand?.id).toBe(main.id)
    expect(after.inventory).toHaveLength(INVENTORY_SIZE)
  })

  it('двуручное само снимает вторую руку в сумку, когда место есть', () => {
    const two = bareWeapon(WEAPONS.find((w) => w.grip === 'two')!, 'mainHand')
    const main = bareWeapon(ONE_HANDED[0], 'mainHand')
    const off = bareWeapon(ONE_HANDED[0], 'offHand')
    let s = equipAll([main, off])
    s = { ...s, inventory: [two] }
    expect(equipStatus(s, two).canEquip).toBe(true)
    const after = equipItem(s, two.id)
    expect(after.equipment.mainHand?.id).toBe(two.id)
    expect(after.equipment.offHand).toBeNull()
    // Обе снятые вещи в сумке, а не в небытии.
    expect(after.inventory.map((i) => i.id).sort()).toEqual([main.id, off.id].sort())
  })

  it('щит и оружие в левой руке одновременно невозможны', () => {
    const off = bareWeapon(ONE_HANDED[0], 'offHand')
    const shield = bareShield(SHIELDS[0])
    let s = equipAll([off])
    s = equipItem({ ...s, inventory: [shield] }, shield.id)
    expect(s.equipment.offHand?.id).toBe(shield.id)
    expect(s.inventory.map((i) => i.id)).toEqual([off.id])
    // И обратно: оружие вытесняет щит тем же правилом одного слота.
    s = equipItem({ ...s, inventory: [off] }, off.id)
    expect(s.equipment.offHand?.id).toBe(off.id)
  })

  it('правило связки — чистая функция, её же зовёт и оценка «а если надеть»', () => {
    const main = bareWeapon(ONE_HANDED[0], 'mainHand')
    const off = bareWeapon(ONE_HANDED[0], 'offHand')
    const two = bareWeapon(WEAPONS.find((w) => w.grip === 'two')!, 'mainHand')
    const worn = equipAll([main, off]).equipment
    const { equipment, removed } = equipmentWith(worn, two)
    expect(equipment.offHand).toBeNull()
    expect(removed.map((i) => i.id).sort()).toEqual([main.id, off.id].sort())
  })

  it('автоэкипировка сравнивает СВЯЗКУ, а не отдельный предмет', () => {
    // Двуручное сильнее ЛЮБОЙ одной руки, но ровно равно двум. Слепое
    // сравнение «предмет против предмета в том же слоте» показало бы
    // громадный апгрейд и молча отобрало бы вторую руку.
    const main = bareWeapon(ONE_HANDED[0], 'mainHand')
    const off = bareWeapon(ONE_HANDED[0], 'offHand')
    const two = bareWeapon(WEAPONS.find((w) => w.grip === 'two')!, 'mainHand')
    // МОБ — МЕШОК: много HP и ноль урона. Обе половины нужны.
    //
    // Много HP — потому что инвариант «равный урон оружия в секунду — равный
    // итог» держится там, где бой длится больше десятка замахов: на мобе,
    // который умирает с двух ударов, крупный замах бьёт мимо остатка HP, и
    // разница связок превращается в перебой. Мобы стартовой полосы теперь
    // как раз такие, тонкие, — поэтому моб задан явно.
    //
    // Ноль урона — потому что мера «лучше» это убийств в секунду С УЧЁТОМ
    // аптайма: на толстом и КУСАЧЕМ мобе голый герой первого уровня умирает,
    // аптайм падает в ноль у обеих связок, и сравнивать становится нечего.
    const target = monsterFromTemplate({
      id: 'test-sack',
      name: 'Мешок',
      level: 1,
      maxHp: new Decimal(5000),
      goldReward: new Decimal(1),
      xpReward: new Decimal(1),
      damageMin: new Decimal(0),
      damageMax: new Decimal(0),
      swingTime: 2,
    })
    const dual = {
      ...equipAll([main, off]),
      monster: target,
      abilitySettings: manualOnlySettings(),
    }
    const single = { ...equipAll([main]), monster: target, abilitySettings: manualOnlySettings() }
    const share = (state: GameState) =>
      compareItem(state, two)
        .damagePerSecondDelta.div(estimateCombatRate(state).damagePerSecond)
        .toNumber()
    // По урону оружия в секунду связки в точности равны.
    expect(estimateCombatRate(dual).autoDamagePerSecond.toNumber()).toBeCloseTo(
      estimateCombatRate(equipAll([two])).autoDamagePerSecond.toNumber(),
      6,
    )
    // Поэтому смена связки почти ничего не меняет: остаток — перебой
    // (крупный замах чаще бьёт мимо остатка HP), а не выигрыш стиля.
    expect(Math.abs(share(dual))).toBeLessThan(0.08)
    // А без второй руки то же двуручное — настоящий апгрейд, и разница
    // на порядок больше: именно её показало бы сравнение «предмет к предмету».
    expect(share(single)).toBeGreaterThan(0.2)
    expect(isUpgrade(single, two)).toBe(true)
  })
})

describe('сравнение для UI', () => {
  it('отдаёт производные числа и разницу по урону в секунду', () => {
    const weapon = bareWeapon(WEAPONS[1]) // Полуторник 2.2 c, 11-22
    const s = withItems([weapon])
    const c = compareItem(s, weapon)
    expect(c.slot).toBe('mainHand')
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

  it('оценка НЕ ЗАВИСИТ от того, кто стоит перед героем сейчас', () => {
    // Значок «Апгрейд» и процент в подсказке обязаны быть свойством ВЕЩИ,
    // а не мгновенного снимка боя. Пока оценка считалась против живого моба,
    // одна и та же вещь при неизменной экипировке читалась то как «+12,6 %»,
    // то как «не апгрейд» — просто потому, что заспавнился другой моб из
    // пула зоны. Три разных вердикта за полторы минуты стояния на месте.
    const weapon = bareWeapon(WEAPONS[1])
    const base = withItems([weapon])
    const zone = ZONE_BY_ID[base.currentZoneId]
    const shares = zoneMonsterVariants(zone).map((template) =>
      compareItem({ ...base, monster: monsterFromTemplate(template) }, weapon).combatDelta,
    )
    // Мобов в пуле зоны заведомо несколько, иначе проверка ничего не значит.
    expect(shares.length).toBeGreaterThan(1)
    for (const share of shares) expect(share).toBe(shares[0])
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
    const s = bareHero(1)
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
    const filler = Array.from({ length: INVENTORY_SIZE }, (_, i) => armor(`м-${i}`, 'head', 1))
    let s = withItems([weapon])
    s = equipItem(s, weapon.id)
    s = { ...s, inventory: filler }
    expect(unequipItem(s, 'mainHand')).toBe(s)
  })
})
