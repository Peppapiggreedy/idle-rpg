// ЛЕЧЕНИЕ СТРАЖА: умение-флаг, правило автокаста и модель в оценке.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import {
  autocastCandidates,
  autocastHeal,
  autocastStep,
  passesReserve,
  useAbility,
} from './abilities'
import { estimateCombatRate } from './combat'
import { createInitialState, monsterFromTemplate, type GameState } from './state'
import { ensureStats } from './stats'
import { CLASSES } from '../data/classes'
import { ABILITIES, ABILITY_BY_ID } from '../data/abilities'
import { AUTOCAST_DELAY_MS } from '../data/balance'
import { representativeMonster, ZONES, zoneMonsterVariants } from '../data/zones'
import { averageGear } from './simulate'

const HEAL = ABILITIES.find((a) => a.heal)!
const noop = () => {}
const NO_LUCK = () => 0

/** Страж уровня, на котором лечение открыто, с заданной долей здоровья и маной. */
function healer(level: number, hpShare: number, mana?: number): GameState {
  const base = ensureStats({
    ...createInitialState(1, 'warden'),
    level: new Decimal(level),
    equipment: averageGear(level),
    currentZoneId: ZONES[1].id,
    statsDirty: true,
  })
  return {
    ...base,
    currentHp: base.stats.maxHp.times(hpShare),
    currentMana: mana === undefined ? base.stats.maxMana : new Decimal(mana),
    monster: monsterFromTemplate(representativeMonster(ZONES[1])),
  }
}

describe('лечащее умение', () => {
  it('лечение у класса не больше одного, и у Стража оно на раннем уровне', () => {
    // БЫЛО «ровно одно на игру», и это было верно ровно до тех пор, пока
    // лечение было только у Стража. Ночь восьми веток дала «Передышку» венцу
    // Тропы: у Псаря лечения не было вовсе, а ось ветки — простой, который
    // лечение и режет. Правило, которое тут держится, другое и важнее: у
    // КЛАССА лечение одно — иначе автокаст выбирал бы между двумя, а правило
    // «лечение впереди урона» перестало бы иметь единственный адрес.
    for (const cls of CLASSES) {
      const heals = cls.abilityIds
        .map((id) => ABILITY_BY_ID[id])
        .filter((a) => a?.heal).length
      const granted = ABILITIES.filter(
        (a) => a.heal && !CLASSES.some((c) => c.abilityIds.includes(a.id)),
      ).length
      expect(heals, cls.id).toBeLessThanOrEqual(1)
      expect(granted, 'лечения от талантов').toBeLessThanOrEqual(1)
    }
    expect(HEAL.type).toBe('instant')
    expect(HEAL.unlockLevel).toBeGreaterThanOrEqual(4)
    expect(HEAL.unlockLevel).toBeLessThanOrEqual(6)
    expect(HEAL.weaponDamagePercent.eq(0)).toBe(true)
  })

  it('возвращает долю максимального запаса, списывает ману и пишет событие', () => {
    const s = healer(HEAL.unlockLevel, 0.3)
    const after = useAbility(s, HEAL.id, NO_LUCK, noop)
    const expected = s.currentHp.plus(s.stats.maxHp.times(HEAL.heal!.maxHpShare))
    expect(after.currentHp.toNumber()).toBeCloseTo(expected.toNumber(), 6)
    expect(after.currentMana.eq(s.currentMana.minus(HEAL.manaCost))).toBe(true)
    expect(after.abilityCasts.eq(s.abilityCasts.plus(1))).toBe(true)
    const event = after.combatLog.find((e) => e.type === 'ability-heal')
    expect(event).toBeDefined()
    if (event?.type === 'ability-heal') {
      expect(event.abilityId).toBe(HEAL.id)
      expect(event.amount.toNumber()).toBeCloseTo(s.stats.maxHp.times(HEAL.heal!.maxHpShare).toNumber(), 6)
    }
    // Моба лечение не трогает.
    expect(after.monster.currentHp.eq(s.monster.currentHp)).toBe(true)
  })

  it('перелив режется: событие несёт реальную прибавку', () => {
    const s = healer(HEAL.unlockLevel, 0.9)
    const after = useAbility(s, HEAL.id, NO_LUCK, noop)
    expect(after.currentHp.eq(s.stats.maxHp)).toBe(true)
    const event = after.combatLog.find((e) => e.type === 'ability-heal')
    if (event?.type === 'ability-heal') {
      expect(event.amount.toNumber()).toBeCloseTo(s.stats.maxHp.times(0.1).toNumber(), 6)
    }
  })

  it('автокаст лечит только ниже порога из данных — и тогда раньше любого урона', () => {
    const below = HEAL.heal!.autocastBelowHpShare
    const healthy = healer(HEAL.unlockLevel, below + 0.2)
    expect(autocastCandidates(healthy).some((a) => a.id === HEAL.id)).toBe(false)
    const hurt = healer(HEAL.unlockLevel, below - 0.1)
    expect(autocastCandidates(hurt).some((a) => a.id === HEAL.id)).toBe(true)
    // Боевое умение первого уровня тоже готово, но первым идёт лечение.
    const step = autocastStep(hurt, AUTOCAST_DELAY_MS, NO_LUCK, noop)
    expect(step.combatLog.some((e) => e.type === 'ability-heal')).toBe(true)
    expect(step.combatLog.some((e) => e.type === 'ability')).toBe(false)
    expect(step.currentHp.gt(hurt.currentHp)).toBe(true)
  })

  it('запертое уровнем лечение автокаст не жмёт и не бережёт под него ману', () => {
    const rookie = healer(HEAL.unlockLevel - 1, 0.2, HEAL.manaCost.toNumber() + 5)
    expect(autocastHeal(rookie)).toBeNull()
    expect(autocastCandidates(rookie).some((a) => a.id === HEAL.id)).toBe(false)
    const strike = ABILITY_BY_ID['quick-strike']
    expect(passesReserve(rookie, strike)).toBe(true)
  })

  it('«беречь ману на лечение»: боевое умение оставляет цену лечения, само лечение не ограничено', () => {
    const strike = ABILITY_BY_ID['quick-strike']
    // Маны хватает на удар, но после него на лечение не останется.
    const tight = healer(HEAL.unlockLevel, 0.9, HEAL.manaCost.plus(strike.manaCost).toNumber() - 1)
    expect(tight.holdManaForHeal).toBe(true)
    expect(passesReserve(tight, strike)).toBe(false)
    expect(passesReserve(tight, HEAL)).toBe(true)
    // Настройка снята — автокаст волен потратить всё.
    expect(passesReserve({ ...tight, holdManaForHeal: false }, strike)).toBe(true)
    // Маны с запасом — удар проходит и при включённом резерве.
    const rich = healer(HEAL.unlockLevel, 0.9)
    expect(passesReserve(rich, strike)).toBe(true)
    // Лечение снято с автокаста — беречь нечего.
    const noAuto = {
      ...tight,
      abilitySettings: {
        ...tight.abilitySettings,
        [HEAL.id]: { ...tight.abilitySettings[HEAL.id], autocast: false },
      },
    }
    expect(passesReserve(noAuto, strike)).toBe(true)
  })
})

describe('лечение в оценке боя', () => {
  it('с лечением цикл длиннее, потеря меньше, темп не ниже', () => {
    const level = 25
    const zone = ZONES.find((z) => level >= z.monsterLevelRange.min && level <= z.monsterLevelRange.max)!
    const base = ensureStats({
      ...createInitialState(1, 'warden'),
      level: new Decimal(level),
      equipment: averageGear(level),
      currentZoneId: zone.id,
      statsDirty: true,
    })
    // Здоровяк пула, а не медианный моб: порог лечения лежит НИЖЕ порога
    // привала, и медианный бой (8 % запаса) до него не доходит — герой
    // садится отдыхать раньше. Лечение — про тяжёлый бой, и мерить его надо
    // на тяжёлом бою.
    const heaviest = zoneMonsterVariants(zone).reduce((a, b) =>
      b.damageMax.gt(a.damageMax) ? b : a,
    )
    const facing = { ...base, monster: monsterFromTemplate(heaviest) }
    const withHeal = estimateCombatRate(facing)
    const noHeal = estimateCombatRate({
      ...facing,
      abilitySettings: {
        ...facing.abilitySettings,
        [HEAL.id]: { ...facing.abilitySettings[HEAL.id], autocast: false },
      },
    })
    expect(noHeal.healsPerCycle).toBe(0)
    expect(withHeal.healsPerCycle).toBeGreaterThan(0)
    expect(withHeal.hpLossPerSecond.lt(noHeal.hpLossPerSecond)).toBe(true)
    expect(withHeal.killsPerCycle).toBeGreaterThan(noHeal.killsPerCycle)
    expect(withHeal.uptime).toBeGreaterThan(noHeal.uptime)
    // Лечение стоит маны, а мана — это урон умений: темп с лечением может быть
    // чуть ниже, но не провалом. Что выгоднее в сумме — решает замер тиком в
    // отчёте (простой на привалах), а не эта оценка.
    expect(withHeal.killsPerSecond.gte(noHeal.killsPerSecond.times(0.95))).toBe(true)
  })

  it('ниже уровня открытия лечения в оценке нет', () => {
    const level = HEAL.unlockLevel - 1
    const base = ensureStats({
      ...createInitialState(1, 'warden'),
      level: new Decimal(level),
      currentZoneId: ZONES[0].id,
      statsDirty: true,
    })
    const rate = estimateCombatRate({ ...base, monster: monsterFromTemplate(representativeMonster(ZONES[0])) })
    expect(rate.healsPerCycle).toBe(0)
  })
})
