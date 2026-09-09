// ПОЛ РЕСУРСА: «не тратить ниже N %» — один ползунок на класс.
//
// Резерв у каждого умения был и остался; пол отвечает на другой вопрос —
// «ниже чего автокаст не тратит ВООБЩЕ». Правило одно и живёт в двух местах,
// которые обязаны совпадать: `passesReserve` у тика и `dutyCycle` у модели.
// Ручная игра пола не знает: это порог автокаста, а не запрет игры.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, type GameState } from './tick'
import { ensureStats } from './stats'
import { abilityStatus, autocastCandidates, passesReserve } from './abilities'
import { estimateCombatRate } from './combat'
import { abilitiesOf, rotationOf } from './state'
import { SAVE_VERSION, payloadFromState, readSave, stateFromPayload } from './save'
import { averageGear, buildSimState } from './simulate'
import {
  MAX_RESOURCE_FLOOR,
  REST_THRESHOLD_STEP,
  RESOURCE_FLOOR_DEFAULT,
  snapResourceFloor,
} from '../data/balance'
import { CLASSES, DEFAULT_CLASS } from '../data/classes'

function hero(classId: string, level: number, floor: number, manaShare = 1): GameState {
  const base = ensureStats({
    ...createInitialState(1, classId, 1),
    level: new Decimal(level),
    equipment: averageGear(level),
    statsDirty: true,
    resourceFloor: floor,
  })
  return {
    ...base,
    currentHp: base.stats.maxHp,
    currentMana: base.stats.maxMana.times(manaShare),
  }
}

describe('ползунок пола ресурса', () => {
  it('прижимается к шагу порога привала и к потолку в единицу', () => {
    expect(snapResourceFloor(0.27)).toBe(0.3)
    expect(snapResourceFloor(0.31)).toBe(0.3)
    expect(snapResourceFloor(1.4)).toBe(MAX_RESOURCE_FLOOR)
    expect(snapResourceFloor(-0.2)).toBe(0)
    expect(snapResourceFloor(Number.NaN)).toBe(RESOURCE_FLOOR_DEFAULT)
    // Шаг общий с привалом: два соседних ползунка с разными шагами — ошибка.
    expect(snapResourceFloor(REST_THRESHOLD_STEP * 3)).toBeCloseTo(REST_THRESHOLD_STEP * 3, 9)
  })

  it('по умолчанию ноль у каждого класса — автокаст жмёт до дна, как и прежде', () => {
    for (const cls of CLASSES) {
      expect(createInitialState(1, cls.id, 1).resourceFloor, cls.id).toBe(0)
    }
  })
})

describe('автокаст читает пол, рука — нет', () => {
  const costly = (s: GameState) =>
    abilitiesOf(s.classId).filter((a) => a.manaCost.gt(0) && s.level.gte(a.unlockLevel))

  it('под полом платное умение не кандидат автокаста, но руками жмётся', () => {
    // Полоска РОВНО на полу (60 % и 60 %): любая трата увела бы её под пол,
    // и автокаст обязан молчать, сколько бы умение ни стоило.
    const s = hero(DEFAULT_CLASS.id, 20, 0.6, 0.6)
    const blocked = costly(s)
    expect(blocked.length).toBeGreaterThan(0)
    for (const a of blocked) {
      expect(passesReserve(s, a), a.id).toBe(false)
      // Рука пола не знает: статус умения с полом и без — один и тот же
      // (связка без опоры отказывает своим кодом в обоих случаях).
      expect(abilityStatus(s, a).usable, `${a.id}: рука ограничена полом`).toBe(
        abilityStatus({ ...s, resourceFloor: 0 }, a).usable,
      )
    }
    expect(blocked.some((a) => abilityStatus(s, a).usable)).toBe(true)
    const names = autocastCandidates(s).map((a) => a.id)
    for (const a of blocked) expect(names, a.id).not.toContain(a.id)
    // Тот же герой без пола — те же умения в кандидатах.
    const free = { ...s, resourceFloor: 0 }
    const open = autocastCandidates(free).map((a) => a.id)
    expect(open.some((id) => blocked.some((a) => a.id === id))).toBe(true)
  })

  it('пол и резерв умения складываются по максимуму — в обе стороны', () => {
    const s = hero(DEFAULT_CLASS.id, 20, 0.3, 0.6)
    const [a] = costly(s)
    const withReserve = (reserve: number, floor: number): GameState => ({
      ...s,
      resourceFloor: floor,
      abilitySettings: { ...s.abilitySettings, [a.id]: { autocast: true, reserve } },
    })
    // Резерв выше пола — решает резерв.
    expect(passesReserve(withReserve(0.7, 0.3), a)).toBe(false)
    // Пол выше резерва — решает пол.
    expect(passesReserve(withReserve(0.3, 0.7), a)).toBe(false)
    // Оба низкие — умение проходит.
    expect(passesReserve(withReserve(0.1, 0.1), a)).toBe(true)
  })

  it('пол едет с ротацией: модель читает то же поле, что и тик', () => {
    const s = hero(DEFAULT_CLASS.id, 20, 0.4)
    expect(rotationOf(s).resourceFloor).toBe(0.4)
    // Билд прогона задаёт пол так же, как порог привала: полем SimBuild.
    const built = buildSimState(
      { classId: DEFAULT_CLASS.id, level: 20, gearLevel: 20, gear: 'average', resourceFloor: 0.5 },
      s.currentZoneId,
      7,
    )
    expect(built.resourceFloor).toBe(0.5)
    expect(rotationOf(built).resourceFloor).toBe(0.5)
  })
})

describe('модель боя знает о поле', () => {
  it('высокий пол режет урон умений и не поднимает темп убийств', () => {
    for (const cls of CLASSES) {
      const open = hero(cls.id, 20, 0)
      const tight = { ...open, resourceFloor: 0.9 }
      const a = estimateCombatRate(open, 'auto')
      const b = estimateCombatRate(tight, 'auto')
      expect(
        b.abilityDamagePerSecond.lte(a.abilityDamagePerSecond.times(1 + 1e-9)),
        `${cls.id}: пол поднял урон умений`,
      ).toBe(true)
      expect(b.killsPerSecond.lte(a.killsPerSecond.times(1 + 1e-9)), cls.id).toBe(true)
    }
    // Пол в девять десятых оставляет ротации десятую часть запаса, и у класса
    // на мане это обязано быть ВИДНО, а не теряться. У класса, чей доход от
    // боя покрывает ротацию целиком, модель первого порядка ресурсом не
    // ограничена ни с полом, ни без — там пол и в тике почти не срабатывает:
    // полоска и так стоит высоко.
    const open = hero(DEFAULT_CLASS.id, 20, 0)
    const tight = { ...open, resourceFloor: 0.9 }
    expect(
      estimateCombatRate(tight, 'auto').abilityDamagePerSecond.lt(
        estimateCombatRate(open, 'auto').abilityDamagePerSecond,
      ),
      'модель пола не видит',
    ).toBe(true)
  })
})

describe('пол в сейве', () => {
  it('пишется, читается и прижимается к шагу', () => {
    const s = hero(DEFAULT_CLASS.id, 12, 0.3)
    const payload = payloadFromState(s, 0)
    expect(payload.version).toBe(SAVE_VERSION)
    expect(payload.resourceFloor).toBe(0.3)
    expect(stateFromPayload(payload).resourceFloor).toBe(0.3)
    // Правленый руками сейв: значение не на шаге читается ближайшим шагом.
    expect(stateFromPayload({ ...payload, resourceFloor: 0.27 }).resourceFloor).toBe(0.3)
    // Мусор — умолчание, а не отказ загрузки: терять прогресс из-за ползунка не за что.
    expect(
      stateFromPayload({ ...payload, resourceFloor: 'abc' as unknown as number }).resourceFloor,
    ).toBe(0)
  })

  it('сейв прошлой версии получает ноль — поведение прежнее', () => {
    const s = hero(DEFAULT_CLASS.id, 12, 0)
    const { resourceFloor: _dropped, ...old } = payloadFromState(s, 0)
    void _dropped
    const result = readSave({ ...old, version: SAVE_VERSION - 1 })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.payload.version).toBe(SAVE_VERSION)
    expect(result.payload.resourceFloor).toBe(0)
    expect(stateFromPayload(result.payload).resourceFloor).toBe(0)
  })
})
