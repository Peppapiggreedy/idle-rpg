// «ЗА РАНГ» — ТОЛЬКО ТАМ, ГДЕ РАНГ БОЛЬШЕ ОДНОГО.
//
// Проверяется В ОБЕ СТОРОНЫ: мало убрать приписку у одноранговых — надо ещё
// убедиться, что у многоранговых она ОСТАЛАСЬ. Односторонняя проверка прошла
// бы и на строке, из которой «за ранг» выкинули совсем.
import { describe, expect, it } from 'vitest'
import { BRANCH_BY_ID, TALENTS, type TalentDef } from '../data/talents'
import { effectText } from './talentText'
import { resourceWords } from './resource'

const WORDS = resourceWords('warden')

const classOf = (talent: TalentDef): string => BRANCH_BY_ID[talent.branch]?.classId ?? 'warden'
const words = (talent: TalentDef) => resourceWords(classOf(talent))

describe('«за ранг» у талантов', () => {
  it('у одноранговых приписки нет ни у одного', () => {
    const singles = TALENTS.filter((t) => t.maxRank === 1)
    expect(singles.length, 'одноранговых талантов в дереве нет — сторожить нечего').toBeGreaterThan(0)
    for (const talent of singles) {
      expect(effectText(talent, words(talent)), talent.id).not.toContain('за ранг')
    }
  })

  it('у многоранговых приписка ОСТАЛАСЬ — иначе правило выполнялось бы пустотой', () => {
    const many = TALENTS.filter((t) => t.maxRank > 1)
    const withPhrase = many.filter((t) => effectText(t, words(t)).includes('за ранг'))
    expect(many.length).toBeGreaterThan(0)
    // Не у всех: правка одним `set` ранга не копит, и у неё приписки не было
    // и раньше. Но у подавляющего большинства она обязана быть.
    expect(withPhrase.length / many.length, 'приписка пропала почти везде').toBeGreaterThan(0.8)
  })

  it('ключевые этажи и венцы — одноранговые, и на них это видно', () => {
    const key = TALENTS.filter((t) => t.exclusiveGroup !== undefined)
    expect(key.length).toBeGreaterThan(0)
    for (const talent of key) {
      expect(talent.maxRank, `${talent.id}: ключевой талант обязан быть одноранговым`).toBe(1)
      expect(effectText(talent, words(talent)), talent.id).not.toContain('за ранг')
    }
  })

  it('слово не потеряно вовсе: хотя бы у одного таланта оно есть', () => {
    expect(TALENTS.some((t) => effectText(t, WORDS).includes('за ранг'))).toBe(true)
  })
})
