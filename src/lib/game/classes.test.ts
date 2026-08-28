// Два класса, два ресурса. Проверяем не «поля появились», а РАЗНИЦУ в игре:
// мана начинается полной и копится временем, ярость — пустой и копится боем.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { STEP_MS } from './loop'
import { createInitialState, manualOnlySettings, abilitiesOf, type GameState } from './state'
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
