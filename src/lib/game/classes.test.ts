// Два класса, два ресурса. Проверяем не «поля появились», а РАЗНИЦУ в игре:
// мана начинается полной и копится временем, ярость — пустой и копится боем.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { STEP_MS } from './loop'
import {
  createInitialState,
  emptyEquipment,
  manualOnlySettings,
  abilitiesOf,
  type GameState,
} from './state'
import { ensureStats } from './stats'
import { tick } from './tick'
import { estimateCombatRate, resourceIncome } from './combat'
import { CLASSES, CLASS_BY_ID, DEFAULT_CLASS, classById } from '../data/classes'
import { ABILITY_BY_ID } from '../data/abilities'
import { BRANCHES } from '../data/talents'
import { RESPAWN_DELAY_MS } from '../data/balance'

const NO_LUCK = () => 1
const WARDEN = CLASS_BY_ID.warden
const REAVER = CLASS_BY_ID.reaver
const HOUND = CLASS_BY_ID.houndmaster

function hero(classId: string, patch: Partial<GameState> = {}): GameState {
  return ensureStats({
    ...createInitialState(1, classId),
    abilitySettings: manualOnlySettings(classId),
    statsDirty: true,
    ...patch,
  })
}

function run(state: GameState, ms: number): GameState {
  for (let t = 0; t < ms; t += STEP_MS) state = tick(state, STEP_MS, NO_LUCK, () => {})
  return state
}

describe('класс — это данные', () => {
  it('у каждого класса полный набор: ресурс, статы, умения, ветки, иконка', () => {
    for (const hero of CLASSES) {
      expect(hero.id, 'пустой id').toBeTruthy()
      expect(hero.name.trim().length, hero.id).toBeGreaterThan(0)
      expect(hero.icon, hero.id).toBeTruthy()
      expect(hero.tagline.trim().length, hero.id).toBeGreaterThan(0)
      expect(hero.abilityIds.length, hero.id).toBeGreaterThan(0)
      expect(hero.branchIds.length, hero.id).toBeGreaterThan(0)
      for (const id of hero.abilityIds) expect(ABILITY_BY_ID[id], `${hero.id}: ${id}`).toBeDefined()
      for (const b of hero.branchIds) {
        expect(BRANCHES.some((x) => x.id === b), `${hero.id}: ${b}`).toBe(true)
      }
    }
  })

  it('наборы умений классов не пересекаются', () => {
    const ids = CLASSES.flatMap((c) => c.abilityIds)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('неизвестный класс деградирует до дефолтного, а не роняет игру', () => {
    expect(classById('нет-такого').id).toBe(DEFAULT_CLASS.id)
    expect(classById(null).id).toBe(DEFAULT_CLASS.id)
  })
})

describe('мана и ярость ведут себя противоположно', () => {
  it('страж начинает с полным запасом, изувер — с пустым', () => {
    expect(hero(WARDEN.id).currentMana.gt(0)).toBe(true)
    expect(hero(REAVER.id).currentMana.toNumber()).toBe(0)
  })

  it('мана копится сама, ярость — нет', () => {
    const warden = run(hero(WARDEN.id, { currentMana: new Decimal(0) }), 10_000)
    expect(warden.currentMana.gt(0)).toBe(true)
    // У изувера реген обнулён МНОЖИТЕЛЕМ: прибавка за уровень его не оживит.
    expect(hero(REAVER.id).stats.manaRegen.toNumber()).toBe(0)
  })

  it('ярость копится от собственных ударов', () => {
    // Ставим моба, которого не убить за отведённое время: иначе замер попадёт
    // на паузу респауна, где ярость, наоборот, тает.
    const base = hero(REAVER.id)
    const s = {
      ...base,
      monster: { ...base.monster, maxHp: new Decimal('1e9'), currentHp: new Decimal('1e9') },
    }
    const after = run(s, 10_000)
    expect(after.currentMana.gt(0)).toBe(true)
  })

  it('ярость копится и от чужих ударов — за то, что стоишь под ними', () => {
    const base = hero(REAVER.id)
    const quiet = {
      ...base,
      monster: {
        ...base.monster,
        maxHp: new Decimal('1e9'),
        currentHp: new Decimal('1e9'),
        damageMin: new Decimal(0),
        damageMax: new Decimal(0),
      },
    }
    const beaten = {
      ...quiet,
      monster: { ...quiet.monster, damageMin: new Decimal(5), damageMax: new Decimal(5) },
    }
    // Окно короткое НАМЕРЕННО: за десять секунд оба варианта упираются в
    // потолок запаса, и сравнивать было бы нечего.
    expect(run(beaten, 2_000).currentMana.gt(run(quiet, 2_000).currentMana)).toBe(true)
  })

  it('ярость тает вне боя, мана — нет', () => {
    const rage = hero(REAVER.id, { currentMana: new Decimal(80), respawnMsLeft: RESPAWN_DELAY_MS })
    expect(run(rage, 200).currentMana.lt(80)).toBe(true)
    const mana = hero(WARDEN.id, { currentMana: new Decimal(10), respawnMsLeft: RESPAWN_DELAY_MS })
    expect(run(mana, 200).currentMana.gte(10)).toBe(true)
  })
})

describe('энергия — третий ресурс, и он не сводится к двум другим', () => {
  /** Моб, которого не убить за отведённое время: замер идёт В БОЮ. */
  function inFight(state: GameState): GameState {
    return {
      ...state,
      monster: { ...state.monster, maxHp: new Decimal('1e9'), currentHp: new Decimal('1e9') },
    }
  }

  it('запас ровно сто, начинается полным', () => {
    const h = hero(HOUND.id)
    expect(h.stats.maxMana.toNumber()).toBe(100)
    expect(h.currentMana.eq(h.stats.maxMana)).toBe(true)
  })

  it('восстанавливается САМА, В БОЮ и быстро: с нуля до полной за десять секунд', () => {
    const empty = inFight(hero(HOUND.id, { currentMana: new Decimal(0) }))
    // Мана в бою тоже капает, но у неё пауза и медленная ставка; здесь
    // первая порция приходит через REGEN_TICK_S, а полная полоска — за
    // считанные секунды.
    expect(run(empty, 4_000).currentMana.gt(0)).toBe(true)
    expect(run(empty, 10_000).currentMana.eq(empty.stats.maxMana)).toBe(true)
  })

  it('не зависит ни от одной характеристики: интеллект и уровень её не двигают', () => {
    const base = hero(HOUND.id)
    // Герой с завышенным интеллектом: шапка на +500 к интеллекту.
    const equipment = emptyEquipment()
    equipment.head = {
      id: 'test-hat',
      name: 'hat',
      rarity: 'common',
      slot: 'head',
      level: 1,
      mods: [{ stat: 'intellect', kind: 'flat', value: new Decimal(500), source: 'equipment:head' }],
    }
    const smart = hero(HOUND.id, { equipment: { ...base.equipment, ...equipment, mainHand: base.equipment.mainHand } })
    expect(smart.stats.maxMana.toNumber()).toBe(100)
    expect(smart.stats.manaRegen.eq(base.stats.manaRegen)).toBe(true)
    // Та же шапка на Страже двигает и запас, и восстановление: значит тест
    // различает классы, а не проверяет пустоту.
    const wardenBase = hero(WARDEN.id)
    const wardenSmart = hero(WARDEN.id, {
      equipment: { ...wardenBase.equipment, head: equipment.head },
    })
    expect(wardenSmart.stats.maxMana.gt(wardenBase.stats.maxMana)).toBe(true)
    expect(wardenSmart.stats.manaRegen.gt(wardenBase.stats.manaRegen)).toBe(true)
    // И герой с заниженным: уровень 60 даёт интеллект за уровни — энергии всё равно.
    const veteran = hero(HOUND.id, { level: new Decimal(60), statsDirty: true })
    expect(veteran.stats.maxMana.toNumber()).toBe(100)
    expect(veteran.stats.manaRegen.eq(base.stats.manaRegen)).toBe(true)
  })

  it('ни свой удар, ни чужой её не дают, и вне боя она не тает', () => {
    expect(HOUND.resource.perSwingDealt.eq(0)).toBe(true)
    expect(HOUND.resource.perHitTaken.eq(0)).toBe(true)
    expect(HOUND.resource.decayShare.eq(0)).toBe(true)
    // Пауза респауна: ярость здесь тает, энергия — нет.
    const idle = hero(HOUND.id, { currentMana: new Decimal(50), respawnMsLeft: RESPAWN_DELAY_MS })
    expect(run(idle, 200).currentMana.gte(50)).toBe(true)
  })

  it('регенерация идёт из статов, а не из привала: модель читает тот же реген', () => {
    const h = hero(HOUND.id)
    expect(h.stats.manaRegen.gt(0)).toBe(true)
    expect(h.stats.regenDelay).toBe(0)
    expect(resourceIncome(h).eq(h.stats.manaRegen)).toBe(true)
  })
})

describe('модель боя знает про оба ресурса', () => {
  it('доход ярости считается из боя, а не из регена', () => {
    const rage = hero(REAVER.id)
    expect(rage.stats.manaRegen.toNumber()).toBe(0)
    // Реген нулевой, а доход — нет: иначе модель считала бы, что изувер не
    // применяет умений вовсе.
    expect(resourceIncome(rage).gt(0)).toBe(true)
  })

  it('изувер применяет умения, и оценка это видит', () => {
    const settings = Object.fromEntries(
      abilitiesOf(REAVER.id).map((a, i) => [a.id, { autocast: true, priority: i, reserve: 0 }]),
    )
    const auto = hero(REAVER.id, { abilitySettings: settings })
    const rate = estimateCombatRate(auto)
    expect(rate.abilityDamagePerSecond.gt(0)).toBe(true)
    expect(rate.damagePerSecond.gt(rate.autoDamagePerSecond)).toBe(true)
  })
})
