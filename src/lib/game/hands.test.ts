// Две руки: независимые таймеры, штраф левой и блок щитом.
//
// Проверяем не «поля появились», а наблюдаемое поведение: сколько ударов
// каждая рука делает за минуту, сколько урона несёт удар левой и что именно
// снимает щит. Числа берём из конвейера статов, а не из констант в тесте:
// иначе тест закрепил бы копию формулы, а не саму формулу.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { STEP_MS } from './loop'
import { createInitialState, emptyEquipment, manualOnlySettings, type GameState } from './state'
import { ensureStats } from './stats'
import { tick } from './tick'
import { expectedSwingDamage, hasOffhand, rollBlock } from './combat'
import { OFFHAND_PENALTY } from '../data/balance'
import { ONE_HANDED, SHIELDS, WEAPONS } from '../data/items'
import type { WeaponTemplate } from '../data/items'
import type { AttackEvent, Item } from '../types'

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


const HALF = () => 0.5

function weapon(t: WeaponTemplate, slot: 'mainHand' | 'offHand'): Item {
  const source = `equipment:${slot}`
  const off = slot === 'offHand'
  return {
    id: `w-${slot}-${t.id}`,
    name: t.noun,
    rarity: 'common',
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

function shield(): Item {
  const t = SHIELDS[0]
  return {
    id: 'shield',
    name: t.noun,
    rarity: 'common',
    slot: 'offHand',
    level: 1,
    mods: [
      { stat: 'blockChance', kind: 'base', value: t.blockChance, source: 'equipment:offHand' },
      { stat: 'blockValue', kind: 'base', value: t.blockValue, source: 'equipment:offHand' },
    ],
  }
}

// Герой на манекене: моб с огромным запасом HP и без урона. Бой не кончается,
// значит счёт ударов за минуту меряет ровно таймеры рук.
function dummy(patch: Partial<GameState> = {}): GameState {
  const base = bareHero(1)
  return ensureStats({
    ...base,
    abilitySettings: manualOnlySettings(),
    monster: {
      ...base.monster,
      maxHp: new Decimal('1e12'),
      currentHp: new Decimal('1e12'),
      damageMin: new Decimal(0),
      damageMax: new Decimal(0),
    },
    statsDirty: true,
    ...patch,
  })
}

function swingsOver(state: GameState, ms: number): AttackEvent[] {
  const seen: AttackEvent[] = []
  let s = state
  for (let t = 0; t < ms; t += STEP_MS) {
    s = tick(s, STEP_MS, HALF, (e) => seen.push(e))
  }
  return seen
}

describe('таймеры рук идут независимо', () => {
  const main = weapon(ONE_HANDED[0], 'mainHand') // 1.4 c
  const off = weapon(ONE_HANDED[1], 'offHand') // 2.2 c
  const dual = dummy({ equipment: { ...bareHero(1).equipment, mainHand: main, offHand: off } })

  it('за минуту каждая рука бьёт по своей скорости', () => {
    expect(hasOffhand(dual.stats)).toBe(true)
    const mainHit = expectedSwingDamage(dual.stats, 'main')
    const offHit = expectedSwingDamage(dual.stats, 'off')
    // Скорости разные, значит и урон удара разный — по нему и различаем руки.
    expect(mainHit.eq(offHit)).toBe(false)
    const events = swingsOver(dual, 60_000)
    const count = (amount: Decimal) =>
      events.filter((e) => Math.abs(e.amount.minus(amount).toNumber()) < 1e-6).length
    // Целая часть: последний замах минуты может не успеть завершиться.
    expect(count(mainHit)).toBeGreaterThanOrEqual(Math.floor(60 / dual.stats.swingTime) - 1)
    expect(count(mainHit)).toBeLessThanOrEqual(Math.ceil(60 / dual.stats.swingTime))
    expect(count(offHit)).toBeGreaterThanOrEqual(Math.floor(60 / dual.stats.offhandSwingTime) - 1)
    expect(count(offHit)).toBeLessThanOrEqual(Math.ceil(60 / dual.stats.offhandSwingTime))
    // И вместе — ровно сумма, ни одного лишнего или потерянного удара.
    expect(count(mainHit) + count(offHit)).toBe(events.length)
  })

  it('доли замаха расходятся: это два таймера, а не один на двоих', () => {
    let s = dual
    for (let t = 0; t < 1000; t += STEP_MS) s = tick(s, STEP_MS, HALF, () => {})
    expect(s.swingProgress).not.toBeCloseTo(s.offhandSwingProgress, 3)
  })

  it('пустая левая рука не бьёт вовсе', () => {
    const single = dummy({
      equipment: { ...bareHero(1).equipment, mainHand: main },
    })
    expect(hasOffhand(single.stats)).toBe(false)
    const events = swingsOver(single, 30_000)
    const mainHit = expectedSwingDamage(single.stats, 'main')
    expect(events.every((e) => e.amount.eq(mainHit))).toBe(true)
  })
})

describe('штраф левой руки', () => {
  it('удар левой равен OFFHAND_PENALTY от того же оружия в правой', () => {
    const t = ONE_HANDED[0]
    const equipment = bareHero(1).equipment
    const dual = dummy({
      equipment: { ...equipment, mainHand: weapon(t, 'mainHand'), offHand: weapon(t, 'offHand') },
    })
    // Одно и то же оружие в обеих руках: разница между ударами — ровно штраф.
    const mainHit = expectedSwingDamage(dual.stats, 'main')
    const offHit = expectedSwingDamage(dual.stats, 'off')
    expect(offHit.div(mainHit).toNumber()).toBeCloseTo(OFFHAND_PENALTY, 9)
  })

  it('штраф виден и в реальных ударах, а не только в оценке', () => {
    const t = ONE_HANDED[0]
    const equipment = bareHero(1).equipment
    const dual = dummy({
      equipment: { ...equipment, mainHand: weapon(t, 'mainHand'), offHand: weapon(t, 'offHand') },
    })
    const events = swingsOver(dual, 20_000)
    const amounts = [...new Set(events.map((e) => e.amount.toNumber()))].sort((a, b) => a - b)
    // Ровно два разных числа: удар правой и удар левой.
    expect(amounts.length).toBe(2)
    expect(amounts[0] / amounts[1]).toBeCloseTo(OFFHAND_PENALTY, 9)
  })
})

describe('щит блокирует', () => {
  const ALWAYS = () => 0
  const equipment = bareHero(1).equipment

  it('блок снимает ровно blockValue, а не долю', () => {
    const s = ensureStats({
      ...bareHero(1),
      equipment: { ...equipment, offHand: shield() },
      statsDirty: true,
    })
    const incoming = new Decimal(40)
    const { amount, blocked } = rollBlock(s.stats, incoming, ALWAYS)
    expect(blocked).toBe(true)
    expect(amount.eq(incoming.minus(s.stats.blockValue))).toBe(true)
    // Слабый удар блок съедает целиком, но в минус не уводит.
    expect(rollBlock(s.stats, new Decimal(1), ALWAYS).amount.toNumber()).toBe(0)
  })

  it('без щита блока нет ни при каком броске', () => {
    const bare = ensureStats({ ...bareHero(1), statsDirty: true })
    expect(rollBlock(bare.stats, new Decimal(40), ALWAYS).blocked).toBe(false)
  })

  it('в бою блок эмитится отдельным событием и уменьшает вход', () => {
    const base = bareHero(1)
    // Моб с фиксированным ударом: разброс здесь только мешал бы.
    const hit = new Decimal(30)
    let s = ensureStats({
      ...base,
      abilitySettings: manualOnlySettings(),
      equipment: { ...equipment, offHand: shield() },
      restHpThreshold: 0,
      restResourceThreshold: 0,
      monster: {
        ...base.monster,
        maxHp: new Decimal('1e12'),
        currentHp: new Decimal('1e12'),
        damageMin: hit,
        damageMax: hit,
        swingProgress: 0.999,
      },
      statsDirty: true,
    })
    // Контроль: тот же герой без щита. Разница в потере HP и есть блок —
    // так реген обеих сторон сокращается сам и мерить приходится именно щит.
    const bare = ensureStats({ ...s, equipment: { ...s.equipment, offHand: null }, statsDirty: true })
    const shieldedAfter = tick(s, STEP_MS, ALWAYS, () => {})
    const bareAfter = tick(bare, STEP_MS, ALWAYS, () => {})
    const event = shieldedAfter.combatLog.find((e) => e.type === 'block')
    expect(event).toBeDefined()
    if (event?.type !== 'block') throw new Error('unreachable')
    expect(event.blocked.eq(s.stats.blockValue)).toBe(true)
    const expected = hit.times(1 - s.stats.damageReduction).minus(s.stats.blockValue)
    expect(event.damage.eq(expected)).toBe(true)
    // Без щита событие обычное, и урона прошло ровно на blockValue больше.
    // Сравниваем СОБЫТИЯ, а не остаток HP: щит даёт ещё и живучесть, то есть
    // меняет и запас, и потолок регена, — разница в HP мерила бы не блок.
    const plain = bareAfter.combatLog.find((e) => e.type === 'hurt')
    expect(plain).toBeDefined()
    if (plain?.type !== 'hurt') throw new Error('unreachable')
    expect(plain.damage.minus(event.damage).eq(s.stats.blockValue)).toBe(true)
  })

  it('щит и второй клинок исключают друг друга по стилю', () => {
    // Со щитом левая рука не бьёт вовсе — плата за блок.
    const shielded = dummy({ equipment: { ...equipment, mainHand: weapon(ONE_HANDED[0], 'mainHand'), offHand: shield() } })
    expect(hasOffhand(shielded.stats)).toBe(false)
    expect(shielded.stats.blockChance).toBeGreaterThan(0)
    const dual = dummy({
      equipment: {
        ...equipment,
        mainHand: weapon(ONE_HANDED[0], 'mainHand'),
        offHand: weapon(ONE_HANDED[0], 'offHand'),
      },
    })
    expect(hasOffhand(dual.stats)).toBe(true)
    expect(dual.stats.blockChance).toBe(0)
  })
})

describe('двуручное', () => {
  it('в данных есть представитель каждого стиля', () => {
    expect(WEAPONS.some((w) => w.grip === 'two')).toBe(true)
    expect(ONE_HANDED.length).toBeGreaterThanOrEqual(2)
    expect(SHIELDS.length).toBeGreaterThanOrEqual(1)
  })
})
