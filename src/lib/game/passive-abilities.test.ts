// ПАССИВНОЕ УМЕНИЕ — ТРЕТИЙ ТИП, И ПРОВЕРЯЕТСЯ ОН В ОБЕ СТОРОНЫ.
//
// Мало потребовать, чтобы пассивное не нажималось: надо ещё убедиться, что
// АКТИВНОЕ по-прежнему нажимается и по-прежнему видно автокасту — иначе
// правило выполнялось бы само собой у любого умения, и сторож ничего не
// стерёг бы.
//
// Числа спутника здесь не проверяются: они в `hound-abilities.test.ts`.
// Здесь — только сам тип: четыре нуля, отказ кодом, невидимость автокасту,
// участие в модели с нулевым темпом.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, tick } from './tick'
import { ensureStats } from './stats'
import { STEP_MS } from './loop'
import { abilityStatus, autocastCandidates, useAbility } from './abilities'
import { rotationRate } from './rotation'
import { ABILITIES, ABILITY_BY_ID } from '../data/abilities'
import { CLASS_BY_ID } from '../data/classes'
import { averageGear } from './simulate'
import { rotationOf, type GameState } from './state'

const HOUND = CLASS_BY_ID.houndmaster
const NO_LUCK = () => 1
const PASSIVE = ABILITIES.filter((a) => a.type === 'passive')

function hero(slots: (string | null)[]): GameState {
  const base = ensureStats({
    ...createInitialState(1, HOUND.id, 1),
    level: new Decimal(20),
    equipment: averageGear(20),
    statsDirty: true,
    abilitySlots: [...slots, null, null, null, null].slice(0, 4),
  })
  return { ...base, currentHp: base.stats.maxHp, currentMana: base.stats.maxMana }
}

describe('пассивное умение', () => {
  it('в игре оно есть — иначе весь этот файл ничего не стережёт', () => {
    expect(PASSIVE.map((a) => a.id)).toContain('pack')
  })

  it('четыре нуля: ни цены, ни отката, ни урона, ни общей задержки', () => {
    for (const a of PASSIVE) {
      expect(a.manaCost.toNumber(), a.id).toBe(0)
      expect(a.cooldownSec, a.id).toBe(0)
      expect(a.weaponDamagePercent.toNumber(), a.id).toBe(0)
      expect(a.triggersGcd, a.id).toBe(false)
    }
  })

  it('не нажимается: отказ отдельным кодом, а нажатие не меняет состояние', () => {
    for (const a of PASSIVE) {
      const s = hero([a.id])
      const status = abilityStatus(s, a)
      expect(status.usable, a.id).toBe(false)
      expect(status.reason, a.id).toBe('passive')
      // Ровно тот же объект: ни ресурса, ни отката, ни счётчика кастов.
      expect(useAbility(s, a.id, NO_LUCK, () => {}), a.id).toBe(s)
    }
  })

  it('отказ «пассивное» сильнее смерти и отката: ждать игроку нечего', () => {
    const a = PASSIVE[0]
    const dead: GameState = { ...hero([a.id]), heroState: 'dead' }
    expect(abilityStatus(dead, a).reason).toBe('passive')
  })

  it('автокаст его не видит, а соседнее активное — видит', () => {
    const s = hero(['undercut', PASSIVE[0].id])
    const ids = autocastCandidates(s).map((x) => x.id)
    expect(ids).toContain('undercut')
    expect(ids).not.toContain(PASSIVE[0].id)
  })

  it('в модели боя стоит кастом с НУЛЕВЫМ темпом, а активное — с положительным', () => {
    const s = hero(['undercut', PASSIVE[0].id])
    const rate = rotationRate(s.stats, rotationOf(s), { onlyAutocast: true, delayed: true, potions: false })
    const byId = new Map(rate.casts.map((c) => [c.ability.id, c.castsPerSecond]))
    expect(byId.get(PASSIVE[0].id), 'пассивное обязано быть в ротации').toBe(0)
    expect(byId.get('undercut') ?? 0).toBeGreaterThan(0)
  })

  it('в ротацию попадает и БЕЗ галки автокаста: галка про нажатия, а его не нажимают', () => {
    const s = hero(['undercut', PASSIVE[0].id])
    const settings = Object.fromEntries(
      Object.entries(s.abilitySettings).map(([id, v]) => [id, { ...v, autocast: false }]),
    )
    const off: GameState = { ...s, abilitySettings: settings }
    const rate = rotationRate(off.stats, rotationOf(off), { onlyAutocast: true, delayed: true, potions: false })
    expect(rate.casts.map((c) => c.ability.id)).toContain(PASSIVE[0].id)
  })

  it('не тратит ресурс тиком: полоска на месте через пять секунд', () => {
    let s = hero([PASSIVE[0].id])
    const before = s.currentMana
    for (let t = 0; t < 5000; t += STEP_MS) s = tick(s, STEP_MS, NO_LUCK, () => {})
    expect(s.currentMana.gte(before)).toBe(true)
    expect(s.abilityCooldownsMs[PASSIVE[0].id] ?? 0).toBe(0)
  })

  it('активное по-прежнему нажимается — обратная сторона правила', () => {
    const s = hero(['undercut'])
    expect(abilityStatus(s, ABILITY_BY_ID.undercut).usable).toBe(true)
    expect(useAbility(s, 'undercut', NO_LUCK, () => {})).not.toBe(s)
  })
})
