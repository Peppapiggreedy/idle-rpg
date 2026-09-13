// УМЕНИЕ, ИГРАЮЩЕЕ САМО, И СЛОТ, КОТОРЫЙ ОТ ЭТОГО ОСВОБОЖДАЕТСЯ.
//
// Это ЕДИНСТВЕННОЕ расширение закрытых списков за ночь восьми веток, и на нём
// стоят восемь талантов — по одному в каждой ветке. Проверяется поэтому не
// «работает», а три отдельных свойства, каждое из которых ломается порознь:
//
//   1. слот РЕАЛЬНО освобождается — иначе талант не делает того, что обещает;
//   2. умение остаётся в игре — иначе он его просто отбирает;
//   3. МОДЕЛЬ его видит — иначе правило «оффлайн <= автокаст» ломается молча,
//      потому что тик-то его видит.
//
// И обратная сторона: пока ни один талант флага не поднял, ряд обязан быть
// РОВНО ТЕМ ЖЕ ОБЪЕКТОМ. Механизм, который «почти ничего не меняет», меняет
// golden.
import { describe, expect, it } from 'vitest'
import { TALENTS, TALENT_BY_ID, autoAbilityIds, type TalentDef } from '../data/talents'
import { DEFAULT_CLASS } from '../data/classes'
import { activeAbilityIds, createInitialState, effectiveSlots, rotationOf } from './state'
import { abilitiesByPriority } from './rotation'

const hero = () => createInitialState(1, DEFAULT_CLASS.id, 1)

/** Талант-образец: делает первое умение ряда автоматическим. */
function autoTalentFor(abilityId: string): TalentDef {
  return {
    ...TALENTS.find((t) => t.branch.startsWith(DEFAULT_CLASS.id))!,
    id: 'проба-авто-умения',
    maxRank: 1,
    effect: { kind: 'flag', flag: 'auto-ability', abilityId },
  }
}

describe('умение, играющее само', () => {
  it('пока таланта нет — ряд тот же самый объект, ни одного лишнего имени', () => {
    const s = hero()
    // ИМЕННО ТОТ ЖЕ ОБЪЕКТ: копия ряда на каждый вызов сама по себе безобидна,
    // но её достаточно, чтобы промахнуться мимо мемо модели боя.
    expect(effectiveSlots(s)).toBe(s.abilitySlots)
    expect(autoAbilityIds(s.talents)).toEqual([])
    expect(activeAbilityIds(s)).toEqual(s.abilitySlots.filter((id) => id !== null))
  })

  describe('когда талант взят', () => {
    const s = hero()
    const target = s.abilitySlots.find((id): id is string => id !== null)!
    const talent = autoTalentFor(target)
    // И в СПРАВОЧНИК тоже: `rankOf` берёт потолок ранга оттуда, и без записи
    // в нём подставной талант считался бы невзятым. Ловушка известная —
    // `abilityTune.test.ts` наступил на неё первым.
    TALENTS.push(talent)
    TALENT_BY_ID[talent.id] = talent
    const withTalent = { ...s, talents: { [talent.id]: 1 } }

    it('СЛОТ ОСВОБОЖДАЕТСЯ: на месте умения в ряду пусто', () => {
      const before = s.abilitySlots.filter((id) => id !== null).length
      const after = effectiveSlots(withTalent).filter((id) => id !== null).length
      expect(after, 'слот не освободился — талант не сделал обещанного').toBe(before - 1)
      expect(effectiveSlots(withTalent)).not.toContain(target)
    })

    it('УМЕНИЕ ОСТАЁТСЯ В ИГРЕ: оно в списке активных, просто без места', () => {
      expect(activeAbilityIds(withTalent)).toContain(target)
    })

    it('МОДЕЛЬ ЕГО ВИДИТ: ротация отдаёт его наравне с рядом', () => {
      const played = abilitiesByPriority(rotationOf(withTalent as never), false).map((a) => a.id)
      expect(played, 'модель не видит автоматическое умение').toContain(target)
    })

    it('в ряду и в автоматических одновременно оно не задваивается', () => {
      const ids = activeAbilityIds(withTalent)
      expect(ids.filter((id) => id === target).length).toBe(1)
    })

    it('снятие очка возвращает умение в ряд — без миграции сейва', () => {
      expect(effectiveSlots({ ...withTalent, talents: {} })).toBe(s.abilitySlots)
    })
  })
})
