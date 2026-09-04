// ОДНА ФУНКЦИЯ «МОЖНО ЛИ СЮДА» НА ВСЕ ПУТИ ПЕРЕНОСА.
//
// Путей четыре: перетаскивание мышью, «нажал умение → нажал слот», возврат из
// слота в книгу и перестановка слот↔слот. Своей проверки у пути быть не
// должно — иначе они разъедутся на первой правке правил. Ровно это и
// произошло раньше: книга носила умение в своей локальной переменной, ряд
// действий в своей, и на тач-экране порядок слотов не менялся никак.
import { describe, expect, it } from 'vitest'
import { Decimal } from '../game/numbers'
import { ABILITY_BY_ID } from '../data/abilities'
import { abilityDropStatus, type AbilityDropContext } from './abilityDrop'
import { abilityDropRefusalText } from './abilityText'
import { sameAbilityCarry } from '../stores/ui'

const ctx = (heroLevel: number): AbilityDropContext => ({ heroLevel, byId: ABILITY_BY_ID })

/** Раннее умение и позднее — чтобы проверять запертость по-настоящему. */
const EARLY = 'quick-strike'
const LATE = 'stance' // открывается на двадцатом

describe('куда можно положить умение', () => {
  it('образцы взяты настоящие: одно раннее, одно позднее', () => {
    expect(ABILITY_BY_ID[EARLY].unlockLevel).toBe(1)
    expect(ABILITY_BY_ID[LATE].unlockLevel).toBeGreaterThan(10)
  })

  it('пустая рука — не отказ, а отсутствие вопроса', () => {
    const out = abilityDropStatus(null, { kind: 'slot', index: 0 }, ctx(50))
    expect(out.fits).toBe(false)
    expect(out.allowed).toBe(false)
    expect(out.reason).toBeNull()
  })

  it('из книги в слот: можно, если умение открыто', () => {
    const out = abilityDropStatus(
      { from: 'book', abilityId: EARLY },
      { kind: 'slot', index: 2 },
      ctx(1),
    )
    expect(out).toEqual({ fits: true, allowed: true, reason: null })
  })

  it('запертое уровнем подсвечивается, но не кладётся — и называет причину', () => {
    // «Подходит» и «можно прямо сейчас» — разные вещи: цель остаётся
    // подсвеченной, а игрок получает СТРОКУ, а не молча потухшую ячейку.
    const out = abilityDropStatus(
      { from: 'book', abilityId: LATE },
      { kind: 'slot', index: 0 },
      ctx(5),
    )
    expect(out.fits).toBe(true)
    expect(out.allowed).toBe(false)
    expect(out.reason).toBe('locked')
    expect(abilityDropRefusalText('locked', ABILITY_BY_ID[LATE].unlockLevel)).toContain('20')
  })

  it('слот в слот: перестановка разрешена', () => {
    const out = abilityDropStatus(
      { from: 'slot', index: 0, abilityId: EARLY },
      { kind: 'slot', index: 3 },
      ctx(1),
    )
    expect(out).toEqual({ fits: true, allowed: true, reason: null })
  })

  it('слот сам в себя — не отказ, но и не действие', () => {
    const out = abilityDropStatus(
      { from: 'slot', index: 1, abilityId: EARLY },
      { kind: 'slot', index: 1 },
      ctx(1),
    )
    expect(out.fits).toBe(true)
    expect(out.allowed).toBe(false)
    expect(out.reason).toBe('same-spot')
  })

  it('перестановка внутри ряда разрешена даже запертому: доступность от неё не меняется', () => {
    const out = abilityDropStatus(
      { from: 'slot', index: 0, abilityId: LATE },
      { kind: 'slot', index: 2 },
      ctx(5),
    )
    expect(out.allowed).toBe(true)
  })

  it('из слота в книгу — освобождение; из книги в книгу — ничего', () => {
    const back = abilityDropStatus(
      { from: 'slot', index: 0, abilityId: EARLY },
      { kind: 'book' },
      ctx(1),
    )
    expect(back).toEqual({ fits: true, allowed: true, reason: null })

    const nowhere = abilityDropStatus({ from: 'book', abilityId: EARLY }, { kind: 'book' }, ctx(1))
    expect(nowhere.fits).toBe(false)
    expect(nowhere.allowed).toBe(false)
  })

  it('несуществующее умение не подсвечивает ничего', () => {
    const out = abilityDropStatus(
      { from: 'book', abilityId: 'нет-такого' },
      { kind: 'slot', index: 0 },
      ctx(99),
    )
    expect(out.fits).toBe(false)
  })

  it('сравнение несомого различает источник, а не только имя умения', () => {
    // Одно и то же умение, взятое из книги и из слота, — разные переносы:
    // первый кладёт, второй меняет местами.
    const fromBook = { from: 'book' as const, abilityId: EARLY }
    const fromSlot = { from: 'slot' as const, index: 0, abilityId: EARLY }
    expect(sameAbilityCarry(fromBook, fromSlot)).toBe(false)
    expect(sameAbilityCarry(fromSlot, { ...fromSlot })).toBe(true)
    expect(sameAbilityCarry(fromSlot, { ...fromSlot, index: 1 })).toBe(false)
    expect(sameAbilityCarry(null, null)).toBe(true)
  })
})

describe('порядок слотов и есть приоритет автокаста', () => {
  it('перестановка меняет ИМЕНА, а не откаты', async () => {
    // Откаты живут на умении. Если бы перестановка их трогала, смена
    // четвёрки стала бы бесплатным сбросом — автокаст нашёл бы это за час.
    const { createInitialState } = await import('../game/tick')
    const { DEFAULT_CLASS } = await import('../data/classes')
    const base = createInitialState(1, DEFAULT_CLASS.id, 1)
    const state = {
      ...base,
      level: new Decimal(30),
      abilityCooldownsMs: { ...base.abilityCooldownsMs, [EARLY]: 4000 },
    }
    const slots = [...state.abilitySlots]
    const swapped = [...slots]
    ;[swapped[0], swapped[2]] = [swapped[2], swapped[0]]
    // Откаты — отдельная карта по id умения, и перестановка ряда её не
    // касается вовсе: это разные структуры состояния.
    expect(state.abilityCooldownsMs[EARLY]).toBe(4000)
    expect(swapped).not.toEqual(slots)
    expect([...swapped].sort()).toEqual([...slots].sort())
  })
})
