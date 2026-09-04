// ОПИСАНИЕ УМЕНИЯ СОБИРАЕТСЯ ИЗ ПОЛЕЙ, А НЕ ПИШЕТСЯ РУКАМИ.
//
// Сборок было ТРИ — книга умений, ряд действий, настройки автокаста, — и все
// три знали ровно четыре поля из шестнадцати: цену, откат, урон и лечение.
// Семи флагов (weaken, detonate, absorb, execute, brand, freeCasts, stance)
// в интерфейсе не было ВООБЩЕ. Отсюда обе находки сразу: в книге нет точных
// значений, и Милость не показывает порог добивания — печатать его было
// некому, хотя в данных он лежал с первого дня.
//
// Главная проверка здесь — НЕ «текст такой-то», а «текст ЗАВИСИТ ОТ ПОЛЯ».
// Утверждение про конкретную формулировку сторожит опечатку; утверждение про
// зависимость сторожит возврат ручного текста.
import { describe, expect, it } from 'vitest'
import { Decimal } from '../game/numbers'
import { createInitialState } from '../game/tick'
import { DEFAULT_CLASS } from '../data/classes'
import { ABILITIES, ABILITY_BY_ID, type AbilityDef } from '../data/abilities'
import { abilityLines, type AbilityTextContext } from './abilityText'
import { resourceWords } from './resource'

const state = createInitialState(1, DEFAULT_CLASS.id, 1)
const ctx: AbilityTextContext = {
  resource: resourceWords(DEFAULT_CLASS.id),
  stats: state.stats,
}

const guardian = ABILITIES.filter((a) => DEFAULT_CLASS.abilityIds.includes(a.id))
const text = (a: AbilityDef, extra: Partial<AbilityTextContext> = {}) =>
  abilityLines(a, { ...ctx, ...extra }).join(' | ')

/** Умение-образец: все поля разом, чтобы проверять их по одному. */
function sample(over: Partial<AbilityDef> = {}): AbilityDef {
  return {
    id: 'sample',
    name: 'Образец',
    icon: 'ability-quick-strike',
    type: 'instant',
    unlockLevel: 1,
    manaCost: new Decimal(10),
    cooldownSec: 5,
    weaponDamagePercent: new Decimal(1.5),
    triggersGcd: true,
    ...over,
  }
}

describe('описание умения собирается из данных', () => {
  it('у каждого умения класса в описании есть числа', () => {
    for (const ability of guardian) {
      const line = text(ability)
      expect(line, `${ability.id}: описание пустое`).not.toBe('')
      expect(/\d/.test(line), `${ability.id}: в описании нет ни одного числа`).toBe(true)
      // Цена и откат — всегда, это первая строка.
      expect(line, `${ability.id}: нет отката`).toContain(`откат ${ability.cooldownSec}с`)
    }
  })

  it('ПОРОГ МИЛОСТИ ВИДЕН, и он 20 %', () => {
    // Ровно та находка: порог лежал в данных и не показывался нигде.
    const mercy = ABILITY_BY_ID['mercy']
    expect(mercy.execute?.belowHpShare).toBe(0.2)
    expect(text(mercy)).toContain('ниже 20% здоровья')
  })

  it('связка названа прямо, а не оставлена на догадку', () => {
    const rupture = ABILITY_BY_ID['rupture']
    expect(rupture.combo?.needsAbilityId).toBe('rending-wound')
    const line = text(rupture, { comboName: 'Рваная рана' })
    expect(line).toContain('Без «Рваная рана» в ряду не работает')
    // Без имени строки нет: имя знает вызывающий, а не сборка.
    expect(text(rupture)).not.toContain('не работает')
  })

  // ГЛАВНОЕ: текст обязан МЕНЯТЬСЯ от поля. Если удаление поля ничего не
  // меняет — значит строка написана руками, и находка вернулась.
  const FIELDS: Array<{ field: keyof AbilityDef; over: Partial<AbilityDef>; must: string }> = [
    { field: 'weaken', over: { weaken: { damageShare: 0.4, hits: 1 } }, must: 'слабее на 40%' },
    { field: 'detonate', over: { detonate: { multiplier: 1.5 } }, must: '×1.5' },
    {
      field: 'absorb',
      over: { absorb: { armorShare: 0.5, blockShare: 4, durationSec: 8 } },
      must: 'Щит на 8с',
    },
    { field: 'execute', over: { execute: { belowHpShare: 0.2 } }, must: 'ниже 20% здоровья' },
    {
      field: 'brand',
      over: { brand: { damageShare: 0.55, durationSec: 20, autocastAboveHpShare: 0.5 } },
      must: 'на 55% больше урона',
    },
    { field: 'freeCasts', over: { freeCasts: { casts: 3 } }, must: 'Следующие 3 умения' },
    {
      field: 'stance',
      over: { stance: { damageShare: 0.3, mitigationShare: 0.15, durationSec: 30 } },
      must: 'ниже на 30%',
    },
    {
      field: 'heal',
      over: {
        weaponDamagePercent: new Decimal(0),
        heal: { maxHpShare: new Decimal(0.25), autocastBelowHpShare: 0.55 },
      },
      must: 'Лечит 25% запаса',
    },
    {
      field: 'effect',
      over: {
        effect: {
          kind: 'damageOverTime',
          weaponDamagePercent: new Decimal(0.5),
          ticks: 3,
          tickIntervalSec: 1.5,
        },
      },
      must: 'Затем 3 раза по 50%',
    },
  ]

  it.each(FIELDS)('поле $field описывает себя само', ({ over, must }) => {
    const withField = text(sample(over))
    const without = text(sample())
    expect(withField, 'поле не описано в тексте').toContain(must)
    expect(withField, 'удаление поля ничего не изменило — строка написана руками').not.toBe(without)
  })

  it('ВСЕ необязательные поля AbilityDef покрыты — проверка по самим данным', () => {
    // Список покрытия сверяется не с типом (его в рантайме нет), а с ПОЛЯМИ,
    // которые реально встречаются в данных игры. Новое поле у нового умения
    // уронит этот тест, а не пройдёт молча.
    const known = new Set([
      'id', 'name', 'icon', 'type', 'unlockLevel', 'manaCost', 'cooldownSec',
      'weaponDamagePercent', 'triggersGcd', 'combo',
      ...FIELDS.map((f) => f.field as string),
    ])
    const seen = new Set<string>()
    for (const ability of ABILITIES) for (const key of Object.keys(ability)) seen.add(key)
    const uncovered = [...seen].filter((k) => !known.has(k))
    expect(uncovered, 'поле умения не описано в abilityLines').toEqual([])
  })

  it('цена ноль пишется словами, а не «0 маны»', () => {
    // «Сосредоточение» стоит ноль, и «0 маны» читалось бы как опечатка.
    const free = text(sample({ manaCost: new Decimal(0) }))
    expect(free).toContain('Ничего не стоит')
    expect(free).not.toContain('0 маны')
  })

  it('лечащее умение не пишет про урон, боевое не пишет про лечение', () => {
    const healer = text(
      sample({
        weaponDamagePercent: new Decimal(0),
        heal: { maxHpShare: new Decimal(0.25), autocastBelowHpShare: 0.55 },
      }),
    )
    expect(healer).not.toContain('Урон')
    expect(text(sample())).not.toContain('Лечит')
  })
})
