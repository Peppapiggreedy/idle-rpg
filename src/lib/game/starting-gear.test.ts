// СТАРТОВОЕ СНАРЯЖЕНИЕ: одно белое оружие и шесть пустых слотов.
//
// Правило, ради которого этот файл существует: пустые слоты — это МЕСТО ПОД
// НАХОДКИ, а не недосмотр. Прежний комплект закрывал все семь слотов вещами
// РЕДКОГО тира, то есть выше среднего по рулетке дропа, и первые часы игры
// уходили на то, чтобы догнать подарок: почти любая находка была хуже
// надетого, значок «Апгрейд» не загорался, и главная петля игры — «убил,
// нашёл, надел» — не запускалась вовсе.
//
// Здесь проверяется и то, что комплект такой, и то, что игра с пустыми
// слотами работает: герой бьёт, побеждает, а находка в пустой слот
// сравнивается с НУЛЁМ, а не с чем-то невидимым.
import { describe, expect, it } from 'vitest'
import { CLASSES, classById } from '../data/classes'
import { SLOT_IDS } from '../data/slots'
import { RARITY_BY_ID } from '../data/rarity'
import { ONE_HANDED, WEAPONS } from '../data/items'
import { INVENTORY_SIZE, UNARMED } from '../data/balance'
import { createInitialState, startingEquipment } from './state'
import { equipUpgrades, pacingTable } from './simulate'
import { ZONES } from '../data/zones'
import { ensureStats } from './stats'
import { compareItem, equipStatus, upgradeShare } from './equipment'
import { armorMods, weaponMods } from './loot'
import { tick } from './tick'
import { STEP_MS } from './loop'
import { createRng } from './rng'
import { Decimal } from './numbers'
import type { Item } from '../types'

describe('стартовое снаряжение', () => {
  it.each(CLASSES.map((c) => [c.name, c.id] as const))(
    '%s начинает с ОДНОГО белого оружия в правой руке',
    (_name, classId) => {
      const equipment = startingEquipment(classById(classId))
      const filled = SLOT_IDS.filter((slot) => equipment[slot] !== null)
      expect(filled).toEqual(['mainHand'])
      const weapon = equipment.mainHand!
      expect(weapon.rarity).toBe('common')
      expect(weapon.level).toBe(1)
      // Оружие, а не щит: щит герой найдёт сам, и «щит или второй клинок»
      // становится решением игрока.
      expect(weapon.grip === 'one' || weapon.grip === 'two').toBe(true)
    },
  )

  it('тир комплекта берётся ИЗ ДАННЫХ класса, а не из кода', () => {
    // Мутация: подменяем тир в данных класса и ждём, что предмет изменится.
    // Без этой проверки редкость можно было бы снова зашить в state.ts, и
    // поле `rarity` в данных осталось бы украшением.
    const hero = classById('warden')
    const gold = startingEquipment({
      ...hero,
      startingEquipment: hero.startingEquipment.map((i) => ({ ...i, rarity: 'legendary' as const })),
    })
    expect(gold.mainHand!.rarity).toBe('legendary')
    const white = startingEquipment(hero)
    expect(white.mainHand!.rarity).toBe('common')
    // И числа тоже другие: тир множит прибавку оружия (bonusMult).
    const damageOf = (item: Item) =>
      item.mods.find((m) => m.stat === 'weaponDamageMax')!.value.toNumber()
    expect(damageOf(gold.mainHand!)).toBeGreaterThan(damageOf(white.mainHand!))
  })

  it('пустая вторая рука означает ОДИН замах, а не второй нулевой', () => {
    const state = createInitialState(1)
    expect(state.equipment.offHand).toBeNull()
    expect(state.stats.offhandDamageMax.toNumber()).toBe(0)
  })

  it('пустые слоты брони не ломают конвейер: статы считаются, бой идёт', () => {
    const rng = createRng(7)
    let state = createInitialState(7)
    // Полчаса игрового времени: за это время герой обязан кого-то убить
    // и не сломаться ни на одном пустом слоте.
    for (let i = 0; i < (30 * 60 * 1000) / STEP_MS; i++) state = tick(state, STEP_MS, rng, () => {})
    expect(state.stats.maxHp.gt(0)).toBe(true)
    expect(state.gold.gt(0)).toBe(true)
    expect(state.currentXp.gt(0) || state.level.gt(1)).toBe(true)
  })

  it('без оружия герой бьёт кулаками — база UNARMED из данных', () => {
    const state = createInitialState(1)
    const bare = { ...state, equipment: { ...state.equipment, mainHand: null } }
    // Пересчёт статов идёт через конвейер, поэтому сравниваем через него же.
    const stats = ensureStats({ ...bare, statsDirty: true }).stats
    expect(stats.weaponDamageMax.toNumber()).toBe(UNARMED.weaponDamageMax.toNumber())
    expect(stats.weaponSpeed).toBe(UNARMED.weaponSpeed.toNumber())
  })
})

describe('пустой слот в сравнении', () => {
  // Находка в пустой слот. Атрибут СИЛА, а не живучесть, и это важно:
  // «лучше» меряется убийствами в секунду, а живучесть входит в них только
  // через аптайм — в стартовой зоне он и так единица, и панцирь на живучесть
  // оценку не двигает вовсе. Это свойство самой оценки, и проверять на нём
  // правило пустого слота значило бы проверять не то.
  function armor(level: number): Item {
    const rarity = RARITY_BY_ID.common
    return {
      id: 'find-chest',
      name: 'Панцирь',
      rarity: rarity.id,
      slot: 'chest',
      level,
      mods: armorMods('chest', rarity, level, 'strength'),
    }
  }

  it('находка в пустой слот сравнивается с НУЛЁМ, а не с пустотой', () => {
    const state = createInitialState(1)
    const cmp = compareItem(state, armor(30))
    // Слот пуст — сравнивать не с чем, и это ЗАКОННОЕ состояние, а не сбой.
    expect(cmp.currentItem).toBeNull()
    // «До» — это герой как есть, без вклада пустого слота, а «после» — он же
    // плюс вещь. Вещь взята заведомо сильная: оценка квантует бой замахами,
    // и мелкая прибавка может не сдвинуть их число вовсе — проверять правило
    // пустого слота на такой значило бы проверять квантование.
    expect(cmp.before).toEqual(state.stats)
    expect(cmp.isUpgrade).toBe(true)
    expect(upgradeShare(state, armor(30))!).toBeGreaterThan(0)
  })

  it('первый панцирь — апгрейд, даже когда оценка не двигается', () => {
    // РЕГРЕССИЯ, которую нашёл прогон полного пути. Мера «лучше» одна —
    // убийств в секунду, — и живучесть входит в неё только через аптайм.
    // В стартовой зоне аптайм равен единице, поэтому панцирь на ЖИВУЧЕСТЬ
    // оценку не двигает вовсе, и по строгому «больше» игра говорила бы
    // «не апгрейд» о первой в жизни находке на голое место. Герой прогона
    // так и доходил до 82 уровня из ста в одном белом клинке.
    const state = createInitialState(1)
    const rarity = RARITY_BY_ID.common
    const vitality: Item = {
      id: 'find-chest-vit',
      name: 'Панцирь',
      rarity: rarity.id,
      slot: 'chest',
      level: 1,
      mods: armorMods('chest', rarity, 1, 'vitality'),
    }
    expect(state.equipment.chest).toBeNull()
    // Оценка и правда не выросла — и это НЕ повод оставить слот пустым.
    const cmp = compareItem(state, vitality)
    expect(cmp.withItem.killsPerSecond.gte(cmp.current.killsPerSecond)).toBe(true)
    expect(cmp.isUpgrade).toBe(true)
    // А поверх уже надетого то же самое правило не действует: там сравнивать
    // есть с чем, и порог остаётся строгим.
    const dressed = ensureStats({
      ...state,
      equipment: { ...state.equipment, chest: vitality },
      statsDirty: true,
    })
    const same: Item = { ...vitality, id: 'find-chest-vit-2' }
    expect(compareItem(dressed, same).isUpgrade).toBe(false)
  })

  it('ПУСТОЙ СЛОТ — ЭТО НОЛЬ: вещь без статов не меняет ничего', () => {
    // Главная проверка правила. Если бы пустой слот значил «неизвестно», а
    // не «ноль», надевание вещи-пустышки двигало бы оценку — и сравнение
    // находок с пустыми слотами врало бы ровно на этот сдвиг.
    const state = createInitialState(1)
    const nothing: Item = {
      id: 'empty-chest',
      name: 'Ветошь',
      rarity: 'common',
      slot: 'chest',
      level: 1,
      mods: [],
    }
    const cmp = compareItem(state, nothing)
    expect(cmp.currentItem).toBeNull()
    expect(cmp.combatDelta).toBe(0)
    expect(cmp.isUpgrade).toBe(false)
    expect(upgradeShare(state, nothing)).toBeNull()
  })

  it('второй такой же предмет уже сравнивается с надетым, а не с нулём', () => {
    const state = createInitialState(1)
    const worn = armor(1)
    const dressed = {
      ...state,
      equipment: { ...state.equipment, chest: worn },
      statsDirty: true,
    }
    const ready = ensureStats(dressed)
    const better = { ...armor(5), id: 'find-chest-2' }
    const cmp = compareItem(ready, better)
    expect(cmp.currentItem?.id).toBe(worn.id)
    // Прирост считается ДОЛЕЙ: сравнивать теперь есть с чем.
    const share = upgradeShare(ready, better)
    expect(share).not.toBe(Number.POSITIVE_INFINITY)
    expect(share === null || share > 0).toBe(true)
  })
})

describe('старый сейв', () => {
  it('уже надетые вещи новый комплект не трогает', async () => {
    const { readFileSync } = await import('node:fs')
    const { loadGame, SAVE_KEY } = await import('./save')
    const raw = readFileSync(new URL('./__fixtures__/save-v20.json', import.meta.url), 'utf8')
    const data = new Map<string, string>([[SAVE_KEY, raw]])
    const result = loadGame({
      storage: {
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => void data.set(k, v),
        removeItem: (k) => void data.delete(k),
      },
      now: () => 0,
    })
    expect(result.kind).toBe('loaded')
    if (result.kind !== 'loaded') throw new Error('unreachable')
    // Полный комплект прежней версии остаётся на герое ЦЕЛИКОМ: правка
    // стартового набора относится к НОВОМУ герою, а не к чужому прогрессу.
    const filled = SLOT_IDS.filter((slot) => result.state.equipment[slot] !== null)
    expect(filled.length).toBe(SLOT_IDS.length)
    expect(result.state.equipment.mainHand!.level).toBeGreaterThan(1)
    expect(result.state.level.gt(new Decimal(1))).toBe(true)
  })
})


describe('эталонный герой прогона', () => {
  it('первую зону проходит в стартовом комплекте, а не в полном среднем', () => {
    // ПОЧЕМУ ЭТО ВАЖНО. Прогон одевал эталонного героя в полный средний
    // комплект с первой секунды — и это было почти правдой, пока игра сама
    // дарила полный комплект. Теперь она даёт одно белое оружие, и такой
    // эталон описывал бы героя, которого не существует: против мобов
    // стартовой зоны он быстрее настоящего почти вдвое, и контракт темпа
    // мерил бы не ту игру.
    //
    // hours: 0 — прогон не крутится вовсе, снимается только первая строка.
    const first = pacingTable({ hours: 0 })[0]
    expect(first.level).toBe(1)
    expect(first.gearLevel).toBe(1)
    expect(first.currentZoneId).toBe(ZONES[0].id)
  })
})


describe('разбор сумки моделью игрока', () => {
  it('отказ по одной вещи не останавливает разбор целиком', () => {
    // РЕГРЕССИЯ, которую нашёл прогон полного пути. С ПОЛНОЙ сумкой
    // двуручное надеть нельзя: снимаются две руки, а место освобождается
    // одно — отказ `two-handed-needs-both`. Прежний разбор брал ровно
    // лучшего кандидата и, получив отказ, возвращался ни с чем; на следующей
    // находке повторялось то же самое, и герой замирал в тех вещах, что были.
    // В прогоне он шёл с 30 по 80 уровень в вещах 24 уровня.
    const rarity = RARITY_BY_ID.legendary
    const twoHanded = WEAPONS.find((w) => w.grip === 'two')!
    const state = ensureStats({
      ...createInitialState(1),
      // Обе руки заняты: только тогда двуручное снимает ДВА предмета.
      equipment: {
        ...createInitialState(1).equipment,
        offHand: {
          id: 'worn-off',
          name: ONE_HANDED[0].noun,
          rarity: 'common' as const,
          slot: 'offHand' as const,
          level: 1,
          grip: ONE_HANDED[0].grip,
          mods: weaponMods(ONE_HANDED[0], RARITY_BY_ID.common, 'offHand', 1),
        },
      },
      // Сумка полна: лучший кандидат — двуручное, и он получит отказ.
      inventory: [
        {
          id: 'huge-two-hander',
          name: twoHanded.noun,
          rarity: rarity.id,
          slot: 'mainHand' as const,
          level: 60,
          grip: twoHanded.grip,
          mods: weaponMods(twoHanded, rarity, 'mainHand', 60),
        },
        {
          id: 'good-chest',
          name: 'Панцирь',
          rarity: rarity.id,
          slot: 'chest' as const,
          level: 60,
          mods: armorMods('chest', rarity, 60, 'strength'),
        },
        ...Array.from({ length: INVENTORY_SIZE - 2 }, (_, i) => ({
          id: `junk-${i}`,
          name: 'Хлам',
          rarity: 'common' as const,
          slot: 'trinket' as const,
          level: 1,
          mods: [],
        })),
      ],
      statsDirty: true,
    })
    // Условие теста: двуручное — апгрейд, но надеть его нельзя.
    expect(upgradeShare(state, state.inventory[0])).not.toBeNull()
    expect(equipStatus(state, state.inventory[0]).canEquip).toBe(false)
    // И разбор всё равно обязан дойти до второго кандидата.
    const after = equipUpgrades(state)
    expect(after.equipment.chest?.id).toBe('good-chest')
  })
})
