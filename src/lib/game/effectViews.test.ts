// РЯД ЗНАЧКОВ ПРОВЕРЯЕТСЯ В ОБЕ СТОРОНЫ: мало показать метку — надо ещё
// убедиться, что её НЕ показывают, когда её нет, и что сторона берётся из
// поля состояния, а не угадывается.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, tick } from './tick'
import { ensureStats } from './stats'
import { STEP_MS } from './loop'
import { effectViews, type EffectKind } from './effectViews'
import { useAbility } from './abilities'
import { averageGear } from './simulate'
import { ABILITIES } from '../data/abilities'
import { CLASS_BY_ID } from '../data/classes'
import type { GameState } from './state'

const NO_LUCK = () => 1
const SRC = { kind: 'ability', id: 'quick-strike' } as const

function hero(classId = 'warden', slots: (string | null)[] = []): GameState {
  const base = ensureStats({
    ...createInitialState(1, classId, 1),
    level: new Decimal(30),
    equipment: averageGear(30),
    statsDirty: true,
    abilitySlots: [...slots, null, null, null, null].slice(0, 4),
  })
  return { ...base, currentHp: base.stats.maxHp, currentMana: base.stats.maxMana }
}

describe('метки для ряда значков', () => {
  it('пусто, пока ничего не висит', () => {
    expect(effectViews(hero())).toEqual([])
  })

  it('сторона берётся из ПОЛЯ состояния, а не из записи метки', () => {
    const s: GameState = {
      ...hero(),
      stance: { source: SRC, damageShare: 0.2, mitigationShare: 0.3, msLeft: 5000 },
      monsterBrand: { source: SRC, damageShare: 0.15, msLeft: 7000 },
    }
    const views = effectViews(s)
    expect(views.find((v) => v.kind === 'stance')?.target).toBe('hero')
    expect(views.find((v) => v.kind === 'brand')?.target).toBe('monster')
  })

  it('метка называет свой источник — по нему берутся значок и имя', () => {
    const s: GameState = {
      ...hero(),
      stance: { source: { kind: 'ability', id: 'stance' }, damageShare: 0.2, mitigationShare: 0.3, msLeft: 5000 },
    }
    expect(effectViews(s)[0].source).toEqual({ kind: 'ability', id: 'stance' })
  })

  it('источником бывает ТАЛАНТ: у окна мстителя своего умения нет', () => {
    const s: GameState = {
      ...hero('houndmaster'),
      houndMarks: {
        haste: null,
        recall: null,
        grip: null,
        skulk: null,
        avenge: { source: { kind: 'talent', id: 'hound-avenge' }, share: 0.2, msLeft: 4000 },
      },
    }
    const view = effectViews(s).find((v) => v.kind === 'hound-avenge')
    expect(view?.source.kind).toBe('talent')
    expect(view?.target).toBe('hero')
  })

  it('метка по ВРЕМЕНИ читается секундами, метка по ШТУКАМ — счётчиком', () => {
    const s: GameState = {
      ...hero(),
      monsterBrand: { source: SRC, damageShare: 0.15, msLeft: 7000 },
      monsterWeaken: { source: SRC, damageShare: 0.5, hitsLeft: 2 },
    }
    const brand = effectViews(s).find((v) => v.kind === 'brand')!
    const weaken = effectViews(s).find((v) => v.kind === 'weaken')!
    expect(brand.msLeft).toBe(7000)
    expect(brand.charges).toBeUndefined()
    expect(weaken.charges).toBe(2)
    expect(weaken.msLeft).toBeUndefined()
  })

  it('величина ДЕЙСТВУЮЩАЯ, а не номинал: «Упор» на старте смягчает ноль', () => {
    const s: GameState = {
      ...hero(),
      resolve: { source: SRC, share: 0, perHitTaken: 0.04, maxShare: 0.24, msLeft: 9000 },
    }
    expect(effectViews(s)[0].share).toBe(0)
    const grown: GameState = { ...s, resolve: { ...s.resolve!, share: 0.12 } }
    expect(effectViews(grown)[0].share).toBe(0.12)
  })

  it('щит с нулём в запасе не метка: он уже съеден', () => {
    const s: GameState = { ...hero(), absorb: { source: SRC, left: new Decimal(0), msLeft: 5000 } }
    expect(effectViews(s)).toEqual([])
  })

  it('порядок стабилен: две подряд сборки одного состояния дают один список', () => {
    const s: GameState = {
      ...hero(),
      stance: { source: SRC, damageShare: 0.2, mitigationShare: 0.3, msLeft: 5000 },
      absorb: { source: SRC, left: new Decimal(50), msLeft: 4000 },
      monsterBrand: { source: SRC, damageShare: 0.15, msLeft: 7000 },
    }
    expect(effectViews(s).map((v) => v.kind)).toEqual(effectViews(s).map((v) => v.kind))
    expect(effectViews(s).map((v) => v.kind)).toEqual(['absorb', 'stance', 'brand'])
  })

  it('метка появляется от настоящего каста и уходит сама', () => {
    // НАСТОЯЩИЙ путь, а не собранное руками состояние: между умением и рядом
    // значков стоит тик, и проверять надо его.
    const brand = ABILITIES.find((a) => a.brand && CLASS_BY_ID.warden.abilityIds.includes(a.id))!
    let s = hero('warden', [brand.id])
    expect(effectViews(s).some((v) => v.kind === 'brand')).toBe(false)
    s = useAbility(s, brand.id, NO_LUCK, () => {})
    const view = effectViews(s).find((v) => v.kind === 'brand')
    expect(view, 'клеймо не попало в ряд значков').toBeDefined()
    expect(view!.source).toEqual({ kind: 'ability', id: brand.id })
    // Тик списывает время метки: через её длительность её уже нет.
    for (let t = 0; t < brand.brand!.durationSec * 1000 + STEP_MS; t += STEP_MS) {
      s = tick(s, STEP_MS, NO_LUCK, () => {})
    }
    expect(effectViews(s).some((v) => v.kind === 'brand')).toBe(false)
  })

  it('каждый род метки достижим: список кодов не мёртвый', () => {
    // Сторож против кода, который завели и забыли подключить: любой род из
    // записи обязан собираться хотя бы одним состоянием.
    const all: EffectKind[] = [
      'dot', 'weaken', 'brand', 'stance', 'absorb', 'resolve', 'ramp', 'edge',
      'free-casts', 'hound-haste', 'hound-recall', 'hound-grip', 'hound-skulk', 'hound-avenge',
    ]
    const s: GameState = {
      ...hero('houndmaster'),
      activeEffects: [{ abilityId: 'quick-strike', damagePerTick: new Decimal(5), ticksLeft: 3, msToNextTick: 500 }],
      monsterWeaken: { source: SRC, damageShare: 0.5, hitsLeft: 2 },
      monsterBrand: { source: SRC, damageShare: 0.15, msLeft: 7000 },
      stance: { source: SRC, damageShare: 0.2, mitigationShare: 0.3, msLeft: 5000 },
      absorb: { source: SRC, left: new Decimal(50), msLeft: 4000 },
      resolve: { source: SRC, share: 0.1, perHitTaken: 0.04, maxShare: 0.24, msLeft: 9000 },
      ramp: { source: SRC, share: 0.1, perSwing: 0.03, maxShare: 0.2, msLeft: 8000 },
      edge: { source: SRC, resourceAbove: 0.35, damagePerShare: 0.45, msLeft: 6000 },
      freeCastsLeft: 3,
      houndMarks: {
        haste: { source: SRC, share: 0.3, msLeft: 3000 },
        recall: { source: SRC, share: 0.1, msLeft: 2000 },
        grip: { source: SRC, share: 0.25, msLeft: 5000 },
        skulk: { source: SRC, share: 0.3, msLeft: 4000 },
        avenge: { source: { kind: 'talent', id: 'hound-avenge' }, share: 0.2, msLeft: 4000 },
      },
    }
    const kinds = new Set(effectViews(s).map((v) => v.kind))
    for (const kind of all) expect(kinds.has(kind), `род «${kind}» не собирается ничем`).toBe(true)
  })
})
