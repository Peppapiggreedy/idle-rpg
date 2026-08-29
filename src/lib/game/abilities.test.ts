import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { STEP_MS, createGameLoop } from './loop'
import {
  createInitialState,
  manualOnlySettings,
  monsterFromTemplate,
  tick,
  type GameState,
} from './tick'
import { applyModifiers, ensureStats } from './stats'
import {
  abilityStatus,
  advanceCooldowns,
  useAbility,
  ABILITY_BY_ID,
  ABILITIES,
} from './abilities'
import { expectedAbilityDamage, expectedSwingDamage } from './combat'
import { GCD_MS } from '../data/balance'
import { WEAPONS } from '../data/items'
import { COMMON, buildMonster } from '../data/monsters'
import { CLASSES } from '../data/classes'
import { abilitiesOf } from './state'
import type { AttackEvent, Item, MonsterTemplate } from '../types'

const NO_LUCK = () => 1 // без критов и без дропа
const QUICK = ABILITY_BY_ID['quick-strike'] // instant
const WOUND = ABILITY_BY_ID['rending-wound'] // onNextSwing + эффект
const BLOW = ABILITY_BY_ID['shattering-blow'] // onNextSwing, дорогое

// Толстый мирный моб: не бьёт в ответ, не умирает от пары ударов.
const DUMMY: MonsterTemplate = {
  ...buildMonster({ id: 'dummy', name: 'Чучело', role: COMMON }, 1, new Decimal(1)),
  maxHp: new Decimal(100_000),
  damageMin: new Decimal(0),
  damageMax: new Decimal(0),
}

// Запас маны поднимаем ЧЕСТНО, предметом через конвейер статов: иначе реген
// упрётся в базовый кап и «срежет» ману на первом же тике.
const MANA_TRINKET: Item = {
  id: 'test-trinket',
  name: 'Тестовый оберег',
  rarity: 'common',
  slot: 'trinket',
  level: 1,
  mods: [
    { stat: 'maxMana', kind: 'flat', value: new Decimal(500), source: 'equipment:trinket' },
  ],
}

// Автокаст выключен: эти тесты про РУЧНОЕ применение умений. Автокасту
// посвящён отдельный блок в autocast.test.ts.
// Уровень 10: все три умения открыты. Замкам уровней — свой блок ниже.
function hero(patch: Partial<GameState> = {}): GameState {
  const base = { ...createInitialState(1), abilitySettings: manualOnlySettings() }
  const withMana = ensureStats({
    ...base,
    level: new Decimal(10),
    equipment: { ...base.equipment, trinket: MANA_TRINKET },
    monster: monsterFromTemplate(DUMMY),
    combatLog: [],
    statsDirty: true,
  })
  return ensureStats({
    ...withMana,
    currentMana: withMana.stats.maxMana,
    statsDirty: true,
    ...patch,
  })
}

function collect(): { events: AttackEvent[]; emit: (e: AttackEvent) => void } {
  const events: AttackEvent[] = []
  return { events, emit: (e) => void events.push(e) }
}

function run(state: GameState, ms: number, rng = NO_LUCK): GameState {
  for (let t = 0; t < ms; t += STEP_MS) state = tick(state, STEP_MS, rng, () => {})
  return state
}

describe('данные умений', () => {
  it('у каждого класса свои три умения, у каждого цена, кулдаун и доля удара', () => {
    for (const hero of CLASSES) {
      expect(abilitiesOf(hero.id), hero.id).toHaveLength(3)
    }
    // Наборы классов не пересекаются: иначе «своё умение» было бы формальностью.
    const ids = CLASSES.flatMap((c) => c.abilityIds)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of ABILITIES) {
      expect(a.manaCost.gt(0)).toBe(true)
      expect(a.cooldownSec).toBeGreaterThan(0)
      expect(a.weaponDamagePercent.gt(0)).toBe(true)
    }
  })

  it('GCD тратят только мгновенные умения', () => {
    for (const a of ABILITIES) {
      expect(a.triggersGcd).toBe(a.type === 'instant')
    }
  })
})

describe('мгновенное умение', () => {
  it('бьёт сразу, списывает ману, ставит кулдаун и GCD', () => {
    const before = hero()
    const { events, emit } = collect()
    const after = useAbility(before, QUICK.id, NO_LUCK, emit)

    expect(before.monster.currentHp.minus(after.monster.currentHp).gt(0)).toBe(true)
    expect(before.currentMana.minus(after.currentMana).eq(QUICK.manaCost)).toBe(true)
    expect(after.abilityCooldownsMs[QUICK.id]).toBe(QUICK.cooldownSec * 1000)
    expect(after.gcdMsLeft).toBe(GCD_MS)
    expect(events).toHaveLength(1)
    expect(events[0].abilityId).toBe(QUICK.id) // AttackEvent помечен умением
    expect(after.combatLog[0]).toMatchObject({ type: 'ability', abilityId: QUICK.id })
  })

  it('НЕ трогает прогресс замаха автоатаки', () => {
    const before = hero({ swingProgress: 0.42 })
    const after = useAbility(before, QUICK.id, NO_LUCK, () => {})
    expect(after.swingProgress).toBe(0.42)
    // И следующая автоатака приходит в свой срок, а не раньше и не позже.
    const swingMs = before.stats.swingTime * 1000
    const withAbility = run(after, swingMs * 0.5)
    const without = run(before, swingMs * 0.5)
    expect(withAbility.swingProgress).toBeCloseTo(without.swingProgress, 9)
  })

  it('урон считается той же формулой, что и автоатака, с долей умения', () => {
    const s = hero()
    const expected = expectedSwingDamage(s.stats).times(QUICK.weaponDamagePercent)
    expect(expectedAbilityDamage(s.stats, QUICK.weaponDamagePercent).eq(expected)).toBe(true)
    // Бросок без крита (rng = 1) даёт ровно долю от удара при вырожденном диапазоне.
    const flat = ensureStats({
      ...s,
      stats: applyModifiers([
        { stat: 'attackPower', kind: 'base', value: new Decimal(0), source: 'test' },
        { stat: 'weaponDamageMin', kind: 'base', value: new Decimal(100), source: 'test' },
        { stat: 'weaponDamageMax', kind: 'base', value: new Decimal(100), source: 'test' },
      ]),
      statsDirty: false,
    })
    const after = useAbility(flat, QUICK.id, NO_LUCK, () => {})
    const dealt = flat.monster.currentHp.minus(after.monster.currentHp)
    expect(dealt.toNumber()).toBeCloseTo(100 * QUICK.weaponDamagePercent.toNumber(), 9)
  })
})

describe('умение на следующий замах', () => {
  it('постановка в очередь не списывает ману и не бьёт', () => {
    const before = hero()
    const after = useAbility(before, BLOW.id, NO_LUCK, () => {})
    expect(after.queuedAbilityId).toBe(BLOW.id)
    expect(after.currentMana.eq(before.currentMana)).toBe(true)
    expect(after.monster.currentHp.eq(before.monster.currentHp)).toBe(true)
    expect(after.gcdMsLeft).toBe(0) // GCD не тратит
    expect(after.abilityCooldownsMs[BLOW.id]).toBeUndefined()
  })

  it('повторное нажатие снимает очередь и ману не списывает', () => {
    const before = hero()
    const queued = useAbility(before, BLOW.id, NO_LUCK, () => {})
    const cancelled = useAbility(queued, BLOW.id, NO_LUCK, () => {})
    expect(cancelled.queuedAbilityId).toBeNull()
    expect(cancelled.currentMana.eq(before.currentMana)).toBe(true)
    expect(cancelled.abilityCooldownsMs[BLOW.id]).toBeUndefined()
    expect(cancelled.monster.currentHp.eq(before.monster.currentHp)).toBe(true)
  })

  it('в очереди одновременно только одно умение', () => {
    let s = hero()
    s = useAbility(s, WOUND.id, NO_LUCK, () => {})
    s = useAbility(s, BLOW.id, NO_LUCK, () => {})
    expect(s.queuedAbilityId).toBe(BLOW.id)
    expect(s.currentMana.eq(hero().currentMana)).toBe(true) // ничего не списано
  })

  it('замах заменяется умением: мана списывается в момент удара', () => {
    const start = hero()
    const queued = useAbility(start, BLOW.id, NO_LUCK, () => {})
    const swingMs = start.stats.swingTime * 1000
    // До замаха мана на месте.
    const midway = run(queued, swingMs * 0.5)
    expect(midway.currentMana.eq(start.currentMana)).toBe(true)
    expect(midway.queuedAbilityId).toBe(BLOW.id)
    // Замах пришёл — умение сработало вместо автоатаки.
    const after = run(queued, swingMs + STEP_MS)
    expect(after.queuedAbilityId).toBeNull()
    // Мана ушла именно на умение. Точного равенства нет: за те же тики капнул
    // реген маны, поэтому проверяем, что списано почти ровно manaCost.
    // Реген за прошедшее время часть маны вернул, поэтому сравниваем с ним.
    const elapsedSec = (start.stats.swingTime * 1000 + STEP_MS) / 1000
    const regened = start.stats.manaRegen.times(elapsedSec)
    const spent = start.currentMana.minus(after.currentMana)
    expect(spent.gt(0)).toBe(true)
    expect(spent.lte(BLOW.manaCost)).toBe(true)
    expect(spent.gte(BLOW.manaCost.minus(regened))).toBe(true)
    expect(after.abilityCooldownsMs[BLOW.id]).toBeGreaterThan(0)
    expect(after.combatLog.some((e) => e.type === 'ability')).toBe(true)
    // Автоатаки в этот замах не было — умение её ЗАМЕНИЛО.
    const hits = after.combatLog.filter((e) => e.type === 'hit').length
    expect(hits).toBe(0)
  })

  it('не хватило маны к моменту удара — очередь снимается, бьёт автоатака', () => {
    // Пауза восстановления взведена надолго: иначе за время замаха ресурс
    // накапает, умение сработает, и проверять будет нечего.
    const poor = hero({ currentMana: new Decimal(1), regenDelayMsLeft: 999_999 })
    const queued = useAbility(poor, BLOW.id, NO_LUCK, () => {})
    expect(queued.queuedAbilityId).toBe(BLOW.id) // поставить можно: мана ещё капает
    const after = run(queued, poor.stats.swingTime * 1000 + STEP_MS)
    expect(after.queuedAbilityId).toBeNull()
    expect(after.abilityCooldownsMs[BLOW.id]).toBeUndefined() // кулдаун не потрачен
    expect(after.combatLog.some((e) => e.type === 'hit')).toBe(true)
  })

  it('умение с эффектом накладывает урон по времени', () => {
    const start = hero()
    const queued = useAbility(start, WOUND.id, NO_LUCK, () => {})
    const hit = run(queued, start.stats.swingTime * 1000 + STEP_MS)
    expect(hit.activeEffects).toHaveLength(1)
    expect(hit.activeEffects[0].abilityId).toBe(WOUND.id)
    expect(hit.activeEffects[0].ticksLeft).toBe(WOUND.effect!.ticks)

    const hpAfterHit = hit.monster.currentHp
    const ticked = run(hit, WOUND.effect!.tickIntervalSec * 1000 + STEP_MS)
    expect(ticked.monster.currentHp.lt(hpAfterHit)).toBe(true)
    expect(ticked.combatLog.some((e) => e.type === 'effect')).toBe(true)
    expect(ticked.activeEffects[0].ticksLeft).toBe(WOUND.effect!.ticks - 1)
  })

  it('эффект отваливается вместе с мобом, на котором висел', () => {
    const start = hero({ monster: monsterFromTemplate({ ...DUMMY, maxHp: new Decimal(1e9) }) })
    const queued = useAbility(start, WOUND.id, NO_LUCK, () => {})
    let s = run(queued, start.stats.swingTime * 1000 + STEP_MS)
    expect(s.activeEffects).toHaveLength(1)
    // Добиваем моба — эффект должен сняться, а не перейти на следующего.
    s = { ...s, monster: { ...s.monster, currentHp: new Decimal(0) } }
    s = tick(s, STEP_MS, NO_LUCK, () => {})
    expect(s.activeEffects).toEqual([])
  })
})

describe('кулдауны и глобальная задержка', () => {
  it('GCD ровно 1.5 игровой секунды', () => {
    const after = useAbility(hero(), QUICK.id, NO_LUCK, () => {})
    expect(after.gcdMsLeft).toBe(1500)
    expect(advanceCooldowns(after, 1400).gcdMsLeft).toBe(100)
    expect(advanceCooldowns(after, 1500).gcdMsLeft).toBe(0)
    expect(advanceCooldowns(after, 9999).gcdMsLeft).toBe(0) // в минус не уходит
  })

  it('у каждого умения свой кулдаун, они не мешают друг другу', () => {
    // Ждём столько, чтобы GCD уже отпустил, а кулдаун выпада ещё шёл.
    const wait = (GCD_MS + QUICK.cooldownSec * 1000) / 2
    let s = useAbility(hero(), QUICK.id, NO_LUCK, () => {})
    s = advanceCooldowns(s, wait)
    expect(s.gcdMsLeft).toBe(0)
    expect(s.abilityCooldownsMs[QUICK.id]).toBe(QUICK.cooldownSec * 1000 - wait)
    // Другое умение при этом свободно.
    expect(abilityStatus(s, BLOW).usable).toBe(true)
  })

  it('кулдауны идут игровым временем и истекают в тике', () => {
    let s = useAbility(hero(), QUICK.id, NO_LUCK, () => {})
    s = run(s, QUICK.cooldownSec * 1000 - STEP_MS)
    expect(abilityStatus(s, QUICK).reason).toBe('cooldown')
    s = run(s, 2 * STEP_MS)
    expect(abilityStatus(s, QUICK).usable).toBe(true)
    expect(s.abilityCooldownsMs[QUICK.id]).toBeUndefined()
  })

  it('множитель скорости ×100 ускоряет кулдауны ровно так же, как бой', () => {
    // Ручной планировщик кадров вместо rAF и настоящих часов.
    let time = 0
    let pending: Array<(t: number) => void> = []
    let s = useAbility(hero(), QUICK.id, NO_LUCK, () => {})
    const loop = createGameLoop({
      step: (dt) => {
        s = tick(s, dt, NO_LUCK, () => {})
      },
      now: () => time,
      raf: (cb) => {
        pending.push(cb)
        return pending.length
      },
      caf: () => {},
    })
    loop.setSpeed(100)
    loop.start()
    // 100 кадров по 16 мс реального времени = 1.6 c; на ×100 это 160 игровых
    // секунд, чего с запасом хватает трёхсекундному кулдауну.
    for (let i = 0; i < 100; i++) {
      time += 16
      const cbs = pending
      pending = []
      for (const cb of cbs) cb(time)
    }
    loop.stop()
    expect(s.abilityCooldownsMs[QUICK.id]).toBeUndefined()
    expect(s.gcdMsLeft).toBe(0)
    // Игрового времени прошло куда больше реального — множитель работает.
    expect(s.playtimeMs.toNumber()).toBeGreaterThan(3000)
  })
})

describe('почему кнопка не нажимается', () => {
  it('мёртвый герой', () => {
    const dead = hero({ heroState: 'dead', reviveMsLeft: 5000 })
    expect(abilityStatus(dead, QUICK)).toMatchObject({ usable: false, reason: 'dead' })
    expect(useAbility(dead, QUICK.id, NO_LUCK, () => {})).toBe(dead)
  })

  it('кулдаун', () => {
    const s = useAbility(hero(), QUICK.id, NO_LUCK, () => {})
    expect(abilityStatus(s, QUICK)).toMatchObject({ usable: false, reason: 'cooldown' })
    expect(useAbility(s, QUICK.id, NO_LUCK, () => {})).toBe(s)
  })

  it('глобальная задержка — но только для умений, которые её тратят', () => {
    const s = { ...hero(), gcdMsLeft: 900 }
    expect(abilityStatus(s, QUICK)).toMatchObject({ usable: false, reason: 'gcd' })
    // onNextSwing GCD не тратит, значит и не ждёт его.
    expect(abilityStatus(s, BLOW).usable).toBe(true)
  })

  it('не хватает маны — у мгновенного сразу, у onNextSwing только в момент удара', () => {
    const poor = hero({ currentMana: new Decimal(0) })
    expect(abilityStatus(poor, QUICK)).toMatchObject({ usable: false, reason: 'no-mana' })
    expect(useAbility(poor, QUICK.id, NO_LUCK, () => {})).toBe(poor)
    // Поставить в очередь можно: мана капает, к замаху может и хватить.
    expect(abilityStatus(poor, BLOW).usable).toBe(true)
  })

  it('снять своё умение с очереди можно даже в GCD и без маны', () => {
    const s = { ...hero({ currentMana: new Decimal(0) }), gcdMsLeft: 1200 }
    const queued = useAbility(s, BLOW.id, NO_LUCK, () => {})
    expect(abilityStatus(queued, BLOW)).toMatchObject({ usable: true, queued: true })
    expect(useAbility(queued, BLOW.id, NO_LUCK, () => {}).queuedAbilityId).toBeNull()
  })
})

describe('умения открываются уровнями', () => {
  it('у каждого класса ровно одно умение с первого уровня, дальше по одному', () => {
    for (const cls of CLASSES) {
      const levels = abilitiesOf(cls.id)
        .map((a) => a.unlockLevel)
        .sort((a, b) => a - b)
      expect(levels[0], cls.id).toBe(1)
      expect(new Set(levels).size, cls.id).toBe(levels.length) // не пачкой
    }
  })

  it('запертое уровнем не жмётся и не встаёт в очередь', () => {
    const novice = hero({ level: new Decimal(1), statsDirty: true })
    expect(abilityStatus(novice, WOUND)).toMatchObject({ usable: false, reason: 'locked' })
    expect(abilityStatus(novice, BLOW)).toMatchObject({ usable: false, reason: 'locked' })
    expect(useAbility(novice, BLOW.id, NO_LUCK, () => {})).toBe(novice)
    // Первое умение класса открыто с самого начала.
    expect(abilityStatus(novice, QUICK).reason).not.toBe('locked')
  })

  it('замок важнее смерти: причина не меняется от состояния героя', () => {
    const dead = hero({ level: new Decimal(1), heroState: 'dead', statsDirty: true })
    expect(abilityStatus(dead, BLOW).reason).toBe('locked')
  })

  it('на уровне разблокировки умение открывается', () => {
    const grown = hero({ level: new Decimal(WOUND.unlockLevel), statsDirty: true })
    expect(abilityStatus(grown, WOUND).reason).not.toBe('locked')
  })
})

describe('умения масштабируются от оружия', () => {
  // Оружие в data/items.ts подобрано с равным отношением (средний урон /
  // weaponSpeed): по урону в секунду они равны. Значит вся разница между ними
  // для умений — размер ОДНОГО удара.
  function withWeapon(index: number): GameState {
    const w = WEAPONS[index]
    const source = 'equipment:mainHand'
    return ensureStats({
      ...hero(),
      equipment: {
        ...hero().equipment,
        mainHand: {
          id: `w${index}`,
          name: w.noun,
          rarity: 'common',
          slot: 'mainHand',
          level: 1,
          grip: w.grip,
          mods: [
            { stat: 'weaponSpeed', kind: 'base', value: w.weaponSpeed, source },
            { stat: 'weaponDamageMin', kind: 'base', value: w.damageMin, source },
            { stat: 'weaponDamageMax', kind: 'base', value: w.damageMax, source },
          ],
        },
      },
      statsDirty: true,
    })
  }

  it('медленное оружие даёт больше урона за ману, чем быстрое', () => {
    const fast = withWeapon(0) // Змеезуб 1.4 c
    const slow = withWeapon(2) // Крушитель 3.4 c
    expect(fast.stats.weaponSpeed).toBeLessThan(slow.stats.weaponSpeed)

    const perMana = (s: GameState) =>
      expectedAbilityDamage(s.stats, QUICK.weaponDamagePercent).div(QUICK.manaCost)
    expect(perMana(slow).gt(perMana(fast))).toBe(true)
    // Ровно во столько раз, во сколько медленнее оружие: доля-то одна.
    expect(perMana(slow).div(perMana(fast)).toNumber()).toBeCloseTo(
      expectedSwingDamage(slow.stats).div(expectedSwingDamage(fast.stats)).toNumber(),
      9,
    )
  })

  it('лучшее оружие усиливает умение вместе с автоатакой', () => {
    const bare = hero()
    const armed = withWeapon(2)
    const grow = (s: GameState) => expectedAbilityDamage(s.stats, BLOW.weaponDamagePercent)
    expect(grow(armed).gt(grow(bare))).toBe(true)
  })
})
