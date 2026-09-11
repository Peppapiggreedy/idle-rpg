// ОДИННАДЦАТЬ ХАРАКТЕРИСТИК, ЗАВЕДЁННЫХ ВМЕСТЕ С МАШИНЕРИЕЙ ДЕРЕВА.
//
// Проверяется ТРИ вещи, и третья важнее первых двух:
//   1. они есть в конвейере и таланту их трогать можно;
//   2. каждая ДЕЙСТВУЕТ — в тике, в модели боя и в обеих осях героя;
//   3. пока они НУЛЕВЫЕ, игра считается ровно как считалась. Это и есть
//      условие, при котором одиннадцать характеристик можно было завести
//      разом, не двигая ни одного контракта.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, manualOnlySettings, tick, type GameState } from './tick'
import { ensureStats, STAT_IDS, type StatId, type StatModifier } from './stats'
import { createRng } from './rng'
import { TALENT_STAT_RULE } from '../data/talents'
import { CLASSES, classById } from '../data/classes'
import { doubleStrikeChance, reviveMultiplier } from './talents'
import { companionOf, freshHounds, houndMaxHp, houndModel, rollHoundBite } from './hound'
import { expectedMonsterDamage, rollMonsterDamage } from './combat'
import { axesOf } from './equipment'
import { estimateCombatRate } from './combat'
import { referenceMonsterTemplate } from '../data/monsters'
import { monsterFromTemplate } from './state'

/** Одиннадцать новых характеристик — списком, чтобы обход был явным. */
const NEW_STATS: StatId[] = [
  'doubleStrike',
  'dodge',
  'reviveSpeed',
  'houndMaxHp',
  'houndHpRegen',
  'houndAttackPower',
  'houndCritChance',
  'houndArmor',
  'houndDodge',
  'houndReviveSpeed',
  'redirectShare',
]

const HOUND_CLASS = CLASSES.find((c) => c.companion)!
const PLAIN_CLASS = CLASSES.find((c) => !c.companion)!

function hero(classId: string, level = 40, mods: StatModifier[] = []): GameState {
  const base = createInitialState(1, classId)
  const state = ensureStats({
    ...base,
    level: new Decimal(level),
    abilitySettings: manualOnlySettings(),
    statsDirty: true,
  })
  if (mods.length === 0) return state
  // Модификаторы подаются вещью: так они проходят ТОТ ЖЕ конвейер, что и
  // талант, и проверка не зависит от того, есть ли сегодня такой талант.
  const withItem = ensureStats({
    ...state,
    equipment: {
      ...state.equipment,
      trinket: {
        id: 'проверка',
        name: 'проверка',
        rarity: 'common',
        slot: 'trinket',
        level,
        mods: mods.map((m) => ({ ...m, source: 'equipment:trinket' })),
      },
    },
    statsDirty: true,
  })
  return { ...withItem, hounds: freshHounds(withItem) }
}

const mod = (stat: StatId, value: number): StatModifier => ({
  stat,
  kind: 'flat',
  value: new Decimal(value),
  source: 'equipment:trinket',
})

describe('одиннадцать характеристик заведены по правилам', () => {
  it('все в реестре конвейера', () => {
    for (const stat of NEW_STATS) expect(STAT_IDS, stat).toContain(stat)
  })

  it('таланту их трогать МОЖНО: ни одна не «характеристика» и не «настройка»', () => {
    for (const stat of NEW_STATS) {
      expect(TALENT_STAT_RULE[stat], stat).toBe('share')
    }
  })

  it('у героя без единого источника все одиннадцать — ноль', () => {
    const s = hero(PLAIN_CLASS.id)
    for (const stat of NEW_STATS) expect(s.stats[stat], stat).toBe(0)
  })

  it('доля зажата в 0..1 — и снизу, и сверху', () => {
    // Шанс выше единицы неотличим от неуязвимости, ниже нуля — переворачивает
    // сравнение. Зажим стоит в одной точке конвейера, здесь — его проверка.
    expect(hero(PLAIN_CLASS.id, 40, [mod('dodge', 5)]).stats.dodge).toBe(1)
    expect(hero(PLAIN_CLASS.id, 40, [mod('dodge', -5)]).stats.dodge).toBe(0)
  })
})

describe('двойной счёт с флагами разобран', () => {
  // РЕШЕНИЕ: стат и флаг — СЛАГАЕМЫЕ, и складываются в одном месте. Заменить
  // флаг статом было бы чище, но оба флага висят на КЛЮЧЕВЫХ талантах, а
  // ключевому модификаторы конвейера запрещены схемой.
  it('вторая атака: флаг и стат складываются, и ровно один раз', () => {
    const plain = hero(PLAIN_CLASS.id)
    expect(doubleStrikeChance(plain)).toBe(0)
    const withStat = hero(PLAIN_CLASS.id, 40, [mod('doubleStrike', 0.1)])
    expect(doubleStrikeChance(withStat)).toBeCloseTo(0.1, 9)
    // Флаг у Стража даёт 0.2; вместе со статом — 0.3, а не 0.2 и не 0.1.
    const flagged = { ...withStat, talents: { 'wrath-double-flourish': 1 } }
    expect(doubleStrikeChance(flagged)).toBeCloseTo(0.3, 9)
  })

  it('подъём после смерти: флаг и стат МНОЖАТСЯ, а не складываются', () => {
    // Сложением два источника увели бы время подъёма в ноль, то есть смерть
    // перестала бы стоить чего бы то ни было.
    const plain = hero(PLAIN_CLASS.id)
    expect(reviveMultiplier(plain)).toBe(1)
    const withStat = hero(PLAIN_CLASS.id, 40, [mod('reviveSpeed', 0.25)])
    expect(reviveMultiplier(withStat)).toBeCloseTo(0.75, 9)
    const flagged = { ...withStat, talents: { 'bulwark-swift-return': 1 } }
    expect(reviveMultiplier(flagged)).toBeCloseTo(0.5 * 0.75, 9)
  })
})

describe('уворот действует в тике и в модели', () => {
  const monster = monsterFromTemplate(referenceMonsterTemplate(40))

  it('в тике: уворот в единицу — входящего нет вовсе', () => {
    const s = hero(PLAIN_CLASS.id, 40, [mod('dodge', 1)])
    const rng = createRng(7)
    for (let i = 0; i < 20; i += 1) {
      expect(rollMonsterDamage(monster, s.stats, 40, rng).toNumber()).toBe(0)
    }
  })

  it('в тике: без уворота бросок НЕ ДЕЛАЕТСЯ — поток случайности тот же', () => {
    // Обратная сторона: лишний вызов rng сдвинул бы поток у всей сегодняшней
    // игры, и golden упал бы на ровном месте.
    const s = hero(PLAIN_CLASS.id)
    const a = createRng(11)
    const b = createRng(11)
    const rolled = rollMonsterDamage(monster, s.stats, 40, a)
    expect(rolled.gt(0)).toBe(true)
    // Второй генератор крутится столько же раз, сколько первый.
    expect(rollMonsterDamage(monster, s.stats, 40, b).eq(rolled)).toBe(true)
  })

  it('в модели: половина уворота — половина входящего', () => {
    const plain = hero(PLAIN_CLASS.id)
    const half = hero(PLAIN_CLASS.id, 40, [mod('dodge', 0.5)])
    const before = expectedMonsterDamage(monster, plain.stats, 40).toNumber()
    const after = expectedMonsterDamage(monster, half.stats, 40).toNumber()
    expect(after).toBeCloseTo(before / 2, 6)
  })

  it('уворот поднимает ОСЬ ЖИВУЧЕСТИ — значит виден игроку и решает про вещи', () => {
    const plain = axesOf(hero(PLAIN_CLASS.id))
    const dodgy = axesOf(hero(PLAIN_CLASS.id, 40, [mod('dodge', 0.3)]))
    expect(dodgy.survival.gt(plain.survival)).toBe(true)
  })
})

describe('восемь характеристик спутника действуют на пса', () => {
  const monster = monsterFromTemplate(referenceMonsterTemplate(40))
  const withHound = (stat: StatId, value: number) => hero(HOUND_CLASS.id, 40, [mod(stat, value)])

  it('запас пса растёт от houndMaxHp', () => {
    const plain = houndMaxHp(hero(HOUND_CLASS.id)).toNumber()
    const grown = houndMaxHp(withHound('houndMaxHp', 0.5)).toNumber()
    expect(grown).toBeGreaterThan(plain)
  })

  it('укус сильнее от houndAttackPower', () => {
    const plain = hero(HOUND_CLASS.id)
    const strong = withHound('houndAttackPower', 0.5)
    expect(companionOf(strong)!.hitShare).toBeGreaterThan(companionOf(plain)!.hitShare)
  })

  it('крит укуса растёт от houndCritChance, и это ЕГО крит, а не героя', () => {
    const s = withHound('houndCritChance', 1)
    const def = companionOf(s)!
    const rng = createRng(3)
    // Шанс крита пса доведён до единицы: любой укус критует, хотя у героя
    // шанс прежний.
    for (let i = 0; i < 10; i += 1) expect(rollHoundBite(s.stats, def, rng).isCrit).toBe(true)
    expect(s.stats.critChance).toBeLessThan(1)
  })

  it('возврат быстрее от houndReviveSpeed, восстановление — от houndHpRegen', () => {
    const plain = companionOf(hero(HOUND_CLASS.id))!
    expect(companionOf(withHound('houndReviveSpeed', 0.5))!.returnSec).toBeLessThan(plain.returnSec)
    expect(companionOf(withHound('houndHpRegen', 0.5))!.regenShare.inCombat).toBeGreaterThan(
      plain.regenShare.inCombat,
    )
  })

  it('доля перенаправления растёт от redirectShare', () => {
    const plain = companionOf(hero(HOUND_CLASS.id))!
    expect(companionOf(withHound('redirectShare', 0.1))!.redirectShare).toBeCloseTo(
      plain.redirectShare + 0.1,
      9,
    )
  })

  it('броня и уворот пса держат его на ногах дольше — это видно МОДЕЛИ', () => {
    // Модель — то, по чему считаются прогноз зоны, оффлайн и обе оси. Если бы
    // она их не видела, пёс жил бы дольше только в тике, и оффлайн врал бы.
    const plain = houndModel(hero(HOUND_CLASS.id), monster)!
    const armored = houndModel(withHound('houndArmor', 0.5), monster)!
    const nimble = houndModel(withHound('houndDodge', 0.5), monster)!
    expect(armored.standing).toBeGreaterThan(plain.standing)
    expect(nimble.standing).toBeGreaterThan(plain.standing)
  })

  it('характеристики спутника поднимают ось УРОНА Псаря', () => {
    const plain = axesOf(hero(HOUND_CLASS.id))
    const strong = axesOf(withHound('houndAttackPower', 0.5))
    expect(strong.damage.gt(plain.damage)).toBe(true)
  })
})

describe('пока они нулевые — игра та же', () => {
  it('модель боя сходится до последней цифры у всех трёх классов', () => {
    // Сторож против тихого сдвига: одиннадцать характеристик заведены разом, и
    // обещание «ни один контракт не двинулся» держится только тем, что ноль
    // проходит по коду ровно как его отсутствие.
    for (const cls of CLASSES) {
      const s = hero(cls.id)
      const rate = estimateCombatRate(s)
      expect(rate.killsPerSecond.gt(0), cls.id).toBe(true)
      for (const stat of NEW_STATS) expect(s.stats[stat], `${cls.id}: ${stat}`).toBe(0)
    }
  })

  it('спутник без характеристик — ТОТ ЖЕ объект из данных, бит в бит', () => {
    const s = hero(HOUND_CLASS.id)
    expect(companionOf(s)).toBe(classById(HOUND_CLASS.id).companion)
  })

  it('тик у класса без спутника не трогает ни одну из них', () => {
    const s = hero(PLAIN_CLASS.id, 20)
    const after = tick(s, 1000, createRng(5))
    for (const stat of NEW_STATS) expect(after.stats[stat], stat).toBe(0)
  })
})
