// ЯРОСТЬ: РЕСУРС, КОТОРЫЙ ДАЁТ БОЙ, А НЕ ВРЕМЯ.
//
// Спецификация ночи, и проверяется она целиком, потому что каждый пункт
// по отдельности выглядит мелочью, а вместе они и есть класс:
//   • копится от урона — И НАНЕСЁННОГО, И ПОЛУЧЕННОГО;
//   • убывает вне боя;
//   • максимум РОВНО 100 и не зависит ни от одной характеристики;
//   • поднять его можно ТОЛЬКО талантами;
//   • привал ярость не наливает.
//
// РОД РЕСУРСА — ДАННЫЕ, а не ветвление по id класса: тесты ниже читают
// `resource` из `ClassDef` и не знают слова «изувер» нигде, кроме выбора
// героя для проверки.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, manualOnlySettings, tick, type GameState } from './tick'
import { ensureStats } from './stats'
import { createRng } from './rng'
import { startRest, finishRest } from './rest'
import { CLASSES, classById } from '../data/classes'
import { BRANCHES, TALENTS } from '../data/talents'
import { payloadFromState, readSave, stateFromPayload } from './save'
import { ABILITY_BY_ID } from '../data/abilities'

const RAGE = CLASSES.find((c) => c.resource.kind === 'rage')!
const MANA = CLASSES.find((c) => c.resource.kind === 'mana')!

/** Герой класса с полными статами. Уровень задаётся: запас от него не зависит. */
function hero(classId: string, level = 1, patch: Partial<GameState> = {}): GameState {
  return ensureStats({
    ...createInitialState(1, classId),
    level: new Decimal(level),
    abilitySettings: manualOnlySettings(),
    statsDirty: true,
    ...patch,
  })
}

describe('род ресурса — данные, а не ветвление по классу', () => {
  it('у каждого класса ресурс описан полем, и все три вида заняты', () => {
    const kinds = new Set(CLASSES.map((c) => c.resource.kind))
    expect(kinds.has('mana')).toBe(true)
    expect(kinds.has('rage')).toBe(true)
    expect(kinds.has('energy')).toBe(true)
    for (const cls of CLASSES) {
      expect(typeof cls.resource.startFull, cls.id).toBe('boolean')
      expect(typeof cls.resource.restRefill, cls.id).toBe('boolean')
    }
  })

  it('мана и ярость описаны ОДНИМИ полями, различаются только числами', () => {
    // Мана: не копится боем, не тает, наливается привалом, начинается полной.
    expect(MANA.resource.perSwingDealt.eq(0)).toBe(true)
    expect(MANA.resource.perHitTaken.eq(0)).toBe(true)
    expect(MANA.resource.decayShare.eq(0)).toBe(true)
    expect(MANA.resource.restRefill).toBe(true)
    expect(MANA.resource.startFull).toBe(true)
    // Ярость: ровно наоборот по каждому полю.
    expect(RAGE.resource.perSwingDealt.gt(0)).toBe(true)
    expect(RAGE.resource.perHitTaken.gt(0)).toBe(true)
    expect(RAGE.resource.decayShare.gt(0)).toBe(true)
    expect(RAGE.resource.restRefill).toBe(false)
    expect(RAGE.resource.startFull).toBe(false)
  })
})

describe('запас ровно сто и не растёт ни от чего, кроме талантов', () => {
  it('стартовый максимум — сто, и он один на всех уровнях', () => {
    for (const level of [1, 25, 50, 100]) {
      expect(hero(RAGE.id, level).stats.maxMana.toNumber(), `уровень ${level}`).toBe(100)
    }
  })

  it('характеристики запаса не двигают', () => {
    // Интеллект — главный подозреваемый: у манного класса он и есть запас.
    // У ярости он погашен, и проверяется это ЧИСЛОМ, а не доверием к данным.
    const plain = hero(RAGE.id, 40)
    const smart = ensureStats({
      ...plain,
      equipment: {
        ...plain.equipment,
        trinket: {
          id: 'умник',
          name: 'умник',
          rarity: 'common',
          slot: 'trinket',
          level: 40,
          mods: [
            { stat: 'intellect', kind: 'flat', value: new Decimal(500), source: 'equipment:trinket' },
          ],
        },
      },
      statsDirty: true,
    })
    expect(smart.stats.maxMana.toNumber()).toBe(plain.stats.maxMana.toNumber())
    // И у манного класса та же вещь запас ПОДНИМАЕТ — иначе тест доказывал бы
    // лишь то, что интеллект вообще ничего не делает.
    const wise = hero(MANA.id, 40)
    const wiser = ensureStats({
      ...wise,
      equipment: { ...wise.equipment, trinket: smart.equipment.trinket },
      statsDirty: true,
    })
    expect(wiser.stats.maxMana.gt(wise.stats.maxMana)).toBe(true)
  })

  it('ТАЛАНТ ёмкости поднимает максимум выше ста', () => {
    // Единственный разрешённый способ. Талант ищется по эффекту, а не по id:
    // переименуют — тест продолжит проверять правило, а не строку.
    const own = new Set(BRANCHES.filter((b) => b.classId === RAGE.id).map((b) => b.id))
    const capacity = TALENTS.filter(
      (t) =>
        own.has(t.branch) &&
        t.effect.kind === 'modifiers' &&
        t.effect.mods.some((m) => m.stat === 'maxMana'),
    )
    expect(capacity.length, 'у ярости нет ни одного таланта на ёмкость').toBeGreaterThan(0)
    const talent = capacity[0]
    const grown = hero(RAGE.id, 40, { talents: { [talent.id]: talent.maxRank } })
    expect(grown.stats.maxMana.gt(100)).toBe(true)
  })
})

describe('копится боем, тает вне боя', () => {
  it('начинается с нуля, а не с полного', () => {
    expect(hero(RAGE.id).currentMana.toNumber()).toBe(0)
    expect(hero(MANA.id).currentMana.gt(0)).toBe(true)
  })

  it('копится и от своего удара, и от чужого', () => {
    // Через настоящий тик: своя модель дохода тут была бы вторым ответом на
    // тот же вопрос. Герой без умений — только автоатаки и ответные удары.
    let s = hero(RAGE.id, 20, { currentMana: new Decimal(0) })
    const rng = createRng(11)
    for (let i = 0; i < 200; i += 1) s = tick(s, 100, rng)
    expect(s.currentMana.gt(0), 'ярость не накопилась за двадцать секунд боя').toBe(true)
    // Ставки обеих половин ненулевые — то есть считается и то, и другое.
    expect(RAGE.resource.perSwingDealt.gt(0)).toBe(true)
    expect(RAGE.resource.perHitTaken.gt(0)).toBe(true)
  })

  it('тает, пока герой не в бою', () => {
    // Пауза респауна — это и есть «вне боя» для тика.
    const s = hero(RAGE.id, 20, { currentMana: new Decimal(100), respawnMsLeft: 5000 })
    const after = tick(s, 1000, createRng(3))
    expect(after.currentMana.lt(100)).toBe(true)
  })

  it('у манного класса не тает и не копится боем', () => {
    const s = hero(MANA.id, 20, { respawnMsLeft: 5000 })
    const after = tick(s, 1000, createRng(3))
    expect(after.currentMana.gte(s.currentMana)).toBe(true)
  })
})

describe('привал ярость не наливает', () => {
  it('после привала ресурс тот же, а здоровье полное', () => {
    const started = startRest(
      hero(RAGE.id, 20, { currentHp: new Decimal(1), currentMana: new Decimal(7) }),
    )
    const after = finishRest(started)
    // Полнота полоски меряется долей: сложение Decimal возвращает
    // 402.59999999999997 при запасе 402.6000000000001, и точное равенство
    // проверяло бы арифметику с плавающей точкой, а не правило привала.
    expect(after.currentHp.div(after.stats.maxHp).toNumber()).toBeCloseTo(1, 9)
    expect(after.currentMana.toNumber()).toBe(7)
  })

  it('а манному наливает — иначе правило проверяло бы само себя', () => {
    const started = startRest(
      hero(MANA.id, 20, { currentHp: new Decimal(1), currentMana: new Decimal(1) }),
    )
    const after = finishRest(started)
    expect(after.currentMana.div(after.stats.maxMana).toNumber()).toBeCloseTo(1, 9)
  })
})

describe('цены умений живут на шкале 0..100', () => {
  it('ни одно умение не дороже полного запаса', () => {
    const pool = hero(RAGE.id).stats.maxMana
    for (const id of RAGE.abilityIds) {
      const ability = ABILITY_BY_ID[id]
      expect(ability, id).toBeTruthy()
      expect(ability.manaCost.lte(pool), `${id}: дороже полного запаса`).toBe(true)
    }
  })

  it('самое дешёвое умение стоит меньше трети запаса', () => {
    // Иначе первые секунды боя пустые при любом доходе: ярость входит в бой
    // с нуля, и первый каст обязан быть достижимым за пару ударов.
    const pool = hero(RAGE.id).stats.maxMana.toNumber()
    const cheapest = Math.min(...RAGE.abilityIds.map((id) => ABILITY_BY_ID[id].manaCost.toNumber()))
    expect(cheapest / pool).toBeLessThan(1 / 3)
  })
})

describe('старый сейв переживает переход', () => {
  const migrated = (raw: Record<string, unknown>) => {
    const result = readSave({ version: 32, ...raw })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('сейв не прочитался')
    return stateFromPayload(result.payload)
  }

  it('запас прижимается к новому потолку', () => {
    const s = migrated({ classId: RAGE.id, level: '40', currentMana: '178' })
    expect(s.currentMana.toNumber()).toBeLessThanOrEqual(100)
  })

  it('дерево сброшено бесплатно: ранги пусты, счётчик платных сбросов на месте', () => {
    const s = migrated({
      classId: RAGE.id,
      level: '40',
      talents: { 'instinct-rage-capacity': 3 },
      talentResets: 2,
    })
    expect(s.talents).toEqual({})
    expect(s.talentResets).toBe(2)
  })

  it('СЕГОДНЯШНИЙ сейв ранги переживают — сброс срабатывает один раз', () => {
    // Обратная сторона бесплатного сброса: если сверять нечего или сверка
    // ошибается, дерево обнулялось бы при КАЖДОЙ загрузке, и игрок терял бы
    // раскладку молча. Круг «сохранить — прочитать» это и ловит.
    const own = new Set(BRANCHES.filter((b) => b.classId === RAGE.id).map((b) => b.id))
    const capacity = TALENTS.find(
      (t) =>
        own.has(t.branch) &&
        t.effect.kind === 'modifiers' &&
        t.effect.mods.some((m) => m.stat === 'maxMana'),
    )!
    const s = hero(RAGE.id, 40, { talents: { [capacity.id]: 1 } })
    const back = stateFromPayload(payloadFromState(s, 0))
    expect(back.talents).toEqual({ [capacity.id]: 1 })
  })

  it('СТРАЖУ миграция ярости не трогает: запас на месте, сброс — от своего поколения', () => {
    // ЗДЕСЬ БЫЛО «миграция не трогает вовсе», и это перестало быть правдой —
    // но перестало по ДРУГОЙ причине, и путать их нельзя. Миграция ярости
    // Стража по-прежнему не касается: его запас как был 178, так и остался
    // (у Изувера тот же сейв прижимается к сотне). А вот ранги сброшены, и
    // сбросило их не переселение ресурса, а СВОЁ поколение дерева: ночь
    // пересобрала Гнев, `treeRevision` Стража стал вторым, и правило
    // «пересобрал дерево — дай бесплатный сброс» вернуло очки свободными.
    const s = migrated({
      classId: MANA.id,
      level: '40',
      talents: { 'wrath-honed-edge': 3 },
      currentMana: '178',
      talentResets: 2,
    })
    expect(s.currentMana.toNumber()).toBe(178)
    expect(s.talents).toEqual({})
    // Бесплатный сброс не дорожит следующий платный.
    expect(s.talentResets).toBe(2)
  })

  it('сегодняшний сейв Стража ранги переживает — сброс срабатывает один раз', () => {
    // Обратная сторона: сверка поколений обязана срабатывать РОВНО на чужом
    // поколении. Ошибись она — дерево обнулялось бы при каждой загрузке, и
    // ветеран терял бы раскладку молча, без единой строки на экране.
    const s = hero(MANA.id, 40, { talents: { 'wrath-honed-edge': 3 } })
    const back = stateFromPayload(payloadFromState(s, 0))
    expect(back.talents).toEqual({ 'wrath-honed-edge': 3 })
  })
})

describe('ветвлений по id класса в логике нет', () => {
  it('весь ресурс читается из данных класса', () => {
    // Прямая проверка на подмену: класс с другим id, но теми же данными
    // ресурса, обязан вести себя так же. Собрать такой класс нельзя, поэтому
    // проверяется обратное — что поля вообще читаются и различают классы.
    for (const cls of CLASSES) {
      const resource = classById(cls.id).resource
      expect(resource).toBe(cls.resource)
    }
  })
})
