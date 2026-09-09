// КОМАНДЫ ПСУ — ОДИННАДЦАТЬ УМЕНИЙ ПСАРЯ.
//
// Все команды — ФЛАГИ С PAYLOAD'ом в данных, а не ветки по id в логике, и
// проверяются они по одному правилу: команда делает ровно то, что обещает её
// строка в книге, и ничего сверх. Вторая половина проверок — про автокаст:
// команда, которую он не умеет применять разумно, — плохая команда в
// idle-игре, поэтому каждый порог из задания проверен тиком.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, tick } from './tick'
import { ensureStats } from './stats'
import { STEP_MS } from './loop'
import {
  abilityStatus,
  autocastAllows,
  autocastCandidates,
  houndCapacity,
  useAbility,
} from './abilities'
import { estimateCombatRate } from './combat'
import { activeCompanion, companionOf, houndMaxHp, isHoundUp, upHounds } from './hound'
import { averageGear } from './simulate'
import { payloadFromState, stateFromPayload } from './save'
import { ABILITY_BY_ID } from '../data/abilities'
import { CLASSES, CLASS_BY_ID } from '../data/classes'
import { NO_HOUND_MARKS, type GameState } from './state'
import type { AttackEvent } from '../types'

const HOUND = CLASS_BY_ID.houndmaster
const NO_LUCK = () => 1
const step = (s: GameState, ms: number, rng = NO_LUCK) => {
  for (let t = 0; t < ms; t += STEP_MS) s = tick(s, STEP_MS, rng, () => {})
  return s
}

/** Псарь двадцатого уровня, полный, с ПОЛНЫМ рядом команд под рукой. */
function hero(slots: (string | null)[], patch: Partial<GameState> = {}): GameState {
  const base = ensureStats({
    ...createInitialState(1, HOUND.id, 1),
    level: new Decimal(20),
    equipment: averageGear(20),
    statsDirty: true,
    abilitySlots: [...slots, null, null, null, null].slice(0, 4),
    ...patch,
  })
  const ready = { ...base, currentHp: base.stats.maxHp, currentMana: base.stats.maxMana }
  // Свежие псы под пересчитанные статы; лишние правки — сверху.
  const max = houndMaxHp(ready)
  return { ...ready, hounds: ready.hounds.map((h) => ({ ...h, hp: max })), ...patch }
}

/** Моб-манекен: живучий и бьющий слабо, чтобы бой длился и никто не умирал. */
function withDummy(state: GameState, damage = 5): GameState {
  const hp = new Decimal(1e9)
  return {
    ...state,
    monster: {
      ...state.monster,
      currentHp: hp,
      maxHp: hp,
      damageMin: new Decimal(damage),
      damageMax: new Decimal(damage),
      swingTime: 1,
      swingProgress: 0.9,
    },
  }
}

const downed = (s: GameState): GameState => ({
  ...s,
  hounds: s.hounds.map((h) => ({ hp: new Decimal(0), swing: 0, downMsLeft: 9000 })),
})

const collect = () => {
  const events: AttackEvent[] = []
  return { events, emit: (e: AttackEvent) => void events.push(e) }
}

describe('данные класса', () => {
  it('одиннадцать умений, у каждого класса свои, сетка открытий как у готового', () => {
    expect(HOUND.abilityIds).toHaveLength(11)
    const levels = HOUND.abilityIds.map((id) => ABILITY_BY_ID[id].unlockLevel).sort((a, b) => a - b)
    expect(levels).toEqual([1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20])
    for (const other of CLASSES.filter((c) => c.id !== HOUND.id)) {
      for (const id of other.abilityIds) expect(HOUND.abilityIds, id).not.toContain(id)
    }
  })
})

describe('травля', () => {
  it('ставит метку своры и укорачивает замах пса', () => {
    const s = hero(['sic'])
    const after = useAbility(s, 'sic', NO_LUCK, () => {})
    expect(after.houndMarks.haste?.share).toBe(0.5)
    const def = companionOf(after)!
    expect(activeCompanion(def, after.houndMarks).swingTime).toBeCloseTo(def.swingTime / 1.5, 9)
    // Метка тает игровым временем и уходит вместе с длительностью.
    expect(step(after, 8100).houndMarks.haste).toBeNull()
  })

  it('без стоящего пса отказывает кодом', () => {
    expect(abilityStatus(downed(hero(['sic'])), ABILITY_BY_ID.sic).reason).toBe('no-hound')
  })
})

describe('подрез', () => {
  it('сильнее ровно на долю, пока пёс на ногах, и обычный, когда пёс лежит', () => {
    const up = withDummy(hero(['hamstring']))
    const down = withDummy(downed(hero(['hamstring'])))
    const dealtUp = up.monster.currentHp.minus(useAbility(up, 'hamstring', NO_LUCK, () => {}).monster.currentHp)
    const dealtDown = down.monster.currentHp.minus(
      useAbility(down, 'hamstring', NO_LUCK, () => {}).monster.currentHp,
    )
    expect(dealtUp.div(dealtDown).toNumber()).toBeCloseTo(1.6, 6)
    // На цели ничего не остаётся: это чтение пса, а не метка.
    const after = useAbility(up, 'hamstring', NO_LUCK, () => {})
    expect(after.activeEffects).toHaveLength(0)
    expect(after.monsterBrand).toBeNull()
  })
})

describe('отзыв', () => {
  it('пёс не кусает, не принимает урона и лечится, пока отозван', () => {
    const wounded = withDummy(hero(['recall']), 40)
    const max = houndMaxHp(wounded)
    const s = { ...wounded, hounds: wounded.hounds.map((h) => ({ ...h, hp: max.times(0.3) })) }
    const after = useAbility(s, 'recall', NO_LUCK, () => {})
    expect(after.houndMarks.recall).not.toBeNull()
    const { events, emit } = collect()
    let run = after
    for (let t = 0; t < 3000; t += STEP_MS) run = tick(run, STEP_MS, NO_LUCK, emit)
    expect(events.filter((e) => e.companion).length, 'отозванный пёс кусал').toBe(0)
    expect(events.filter((e) => e.targetId === 'hound').length, 'отозванный пёс получал удары').toBe(0)
    expect(run.hounds[0].hp.gt(s.hounds[0].hp), 'отозванный пёс не лечился').toBe(true)
    // Герой при этом получает удары ЦЕЛИКОМ: перенаправлять некому.
    expect(run.currentHp.lt(after.currentHp)).toBe(true)
  })

  it('автокаст не отзывает целого пса и отзывает раненого', () => {
    const full = hero(['recall'])
    expect(autocastAllows(full, ABILITY_BY_ID.recall)).toBe(false)
    expect(autocastCandidates(full).map((a) => a.id)).not.toContain('recall')
    const max = houndMaxHp(full)
    const hurt = { ...full, hounds: full.hounds.map((h) => ({ ...h, hp: max.times(0.3) })) }
    expect(autocastAllows(hurt, ABILITY_BY_ID.recall)).toBe(true)
    expect(autocastCandidates(hurt).map((a) => a.id)).toContain('recall')
    // Лежачий пёс — не раненый: отзывать некого.
    expect(autocastCandidates(downed(hurt)).map((a) => a.id)).not.toContain('recall')
  })
})

describe('хватка', () => {
  it('моб замахивается медленнее на долю, пока пёс держит', () => {
    const s = withDummy(hero(['grip']))
    const held = useAbility(s, 'grip', NO_LUCK, () => {})
    expect(held.houndMarks.grip?.share).toBe(0.35)
    const free = { ...held, houndMarks: { ...held.houndMarks, grip: null } }
    const a = tick({ ...held, monster: { ...held.monster, swingProgress: 0 } }, 500, NO_LUCK, () => {})
    const b = tick({ ...free, monster: { ...free.monster, swingProgress: 0 } }, 500, NO_LUCK, () => {})
    expect(a.monster.swingProgress).toBeCloseTo(b.monster.swingProgress / 1.35, 9)
  })

  it('автокаст не держит умирающего: порог по цели из данных', () => {
    const s = hero(['grip'])
    const dying = { ...s, monster: { ...s.monster, currentHp: s.monster.maxHp.times(0.2) } }
    expect(autocastAllows(dying, ABILITY_BY_ID.grip)).toBe(false)
    expect(autocastAllows(s, ABILITY_BY_ID.grip)).toBe(true)
  })

  it('хватка кончается вместе с мобом', () => {
    const s = withDummy(hero(['grip']))
    const held = useAbility(s, 'grip', NO_LUCK, () => {})
    const dead = { ...held, monster: { ...held.monster, currentHp: new Decimal(0) } }
    expect(tick(dead, STEP_MS, NO_LUCK, () => {}).houndMarks.grip).toBeNull()
  })
})

describe('серия', () => {
  it('три удара героя за одну цену и укус пса на каждый', () => {
    const s = withDummy(hero(['flurry']))
    const { events, emit } = collect()
    const after = useAbility(s, 'flurry', NO_LUCK, emit)
    const heroHits = events.filter((e) => e.sourceId === 'hero')
    const bites = events.filter((e) => e.companion)
    expect(heroHits).toHaveLength(1)
    expect(bites).toHaveLength(3)
    expect(s.currentMana.minus(after.currentMana).eq(ABILITY_BY_ID.flurry.manaCost)).toBe(true)
    // Урон героя — три удара по 0.7: сравниваем с одним ударом Подсечки (1.5).
    const single = withDummy(hero(['undercut']))
    const dealtSingle = single.monster.currentHp.minus(
      useAbility(single, 'undercut', NO_LUCK, () => {}).monster.currentHp,
    )
    expect(heroHits[0].amount.div(dealtSingle).toNumber()).toBeCloseTo((3 * 0.7) / 1.5, 6)
  })
})

describe('перевязка', () => {
  it('лечит стоящего пса долей его запаса и отказывает, когда пёс лежит', () => {
    const s = hero(['bandage'])
    const max = houndMaxHp(s)
    const hurt = { ...s, hounds: s.hounds.map((h) => ({ ...h, hp: max.times(0.2) })) }
    const after = useAbility(hurt, 'bandage', NO_LUCK, () => {})
    expect(after.hounds[0].hp.div(max).toNumber()).toBeCloseTo(0.6, 9)
    expect(abilityStatus(downed(s), ABILITY_BY_ID.bandage).reason).toBe('no-hound')
    // Автокаст: целого пса не перевязывает, раненого — да.
    expect(autocastCandidates(s).map((a) => a.id)).not.toContain('bandage')
    expect(autocastCandidates(hurt).map((a) => a.id)).toContain('bandage')
  })
})

describe('спуск', () => {
  it('герой не бьёт, пёс кусает сразу и сильнее; без пса — отказ', () => {
    const s = withDummy(hero(['unleash']))
    const { events, emit } = collect()
    useAbility(s, 'unleash', NO_LUCK, emit)
    expect(events.filter((e) => e.sourceId === 'hero')).toHaveLength(0)
    const bites = events.filter((e) => e.companion)
    expect(bites).toHaveLength(1)
    // Обычный укус — из тика того же пса на том же манекене.
    const plain = collect()
    let run: GameState = { ...s, abilitySlots: [null, null, null, null] }
    for (let t = 0; t < 2000 && plain.events.filter((e) => e.companion).length === 0; t += STEP_MS) {
      run = tick(run, STEP_MS, NO_LUCK, plain.emit)
    }
    const ordinary = plain.events.find((e) => e.companion)!
    expect(bites[0].amount.div(ordinary.amount).toNumber()).toBeCloseTo(ABILITY_BY_ID.unleash.unleash!.biteMult, 6)
    expect(abilityStatus(downed(s), ABILITY_BY_ID.unleash).reason).toBe('no-hound')
    // Автокаст ждёт семи десятых полоски.
    expect(autocastAllows({ ...s, currentMana: s.stats.maxMana.times(0.6) }, ABILITY_BY_ID.unleash)).toBe(false)
  })
})

describe('скрадывание', () => {
  it('пёс принимает больше входящего вместо героя', () => {
    const s = withDummy(hero(['skulk']), 50)
    const after = useAbility(s, 'skulk', NO_LUCK, () => {})
    expect(after.houndMarks.skulk?.share).toBe(0.3)
    const def = companionOf(after)!
    expect(activeCompanion(def, after.houndMarks).redirectShare).toBeCloseTo(def.redirectShare + 0.3, 9)
    const { events, emit } = collect()
    let run = after
    for (let t = 0; t < 1200; t += STEP_MS) run = tick(run, STEP_MS, NO_LUCK, emit)
    const toHound = events.filter((e) => e.targetId === 'hound').reduce((a, e) => a.plus(e.amount), new Decimal(0))
    const toHero = events.filter((e) => e.targetId === 'hero').reduce((a, e) => a.plus(e.amount), new Decimal(0))
    expect(toHound.gt(0)).toBe(true)
    expect(toHound.div(toHound.plus(toHero)).toNumber()).toBeCloseTo(def.redirectShare + 0.3, 6)
  })
})

describe('оклик', () => {
  it('поднимает павшего с долей запаса, при стоящих псах — отказ', () => {
    const s = hero(['rally'])
    expect(abilityStatus(s, ABILITY_BY_ID.rally).reason).toBe('no-fallen-hound')
    const fallen = downed(s)
    const after = useAbility(fallen, 'rally', NO_LUCK, () => {})
    expect(isHoundUp(after.hounds[0])).toBe(true)
    expect(after.hounds[0].hp.div(houndMaxHp(after)).toNumber()).toBeCloseTo(0.5, 9)
    // Автокаст зовёт только павшего — на стоящем кандидатом не становится.
    expect(autocastCandidates(s).map((a) => a.id)).not.toContain('rally')
    expect(autocastCandidates(fallen).map((a) => a.id)).toContain('rally')
  })
})

describe('свора', () => {
  it('второй пёс, пока кнопка в ряду; зов при полной своре — отказ; снял кнопку — пёс ушёл', () => {
    const without = hero(['undercut'])
    expect(houndCapacity(without)).toBe(1)
    expect(abilityStatus({ ...without, abilitySlots: ['pack', null, null, null] }, ABILITY_BY_ID.pack).usable).toBe(true)
    const s = hero(['pack'])
    expect(houndCapacity(s)).toBe(2)
    const called = useAbility(s, 'pack', NO_LUCK, () => {})
    expect(called.hounds).toHaveLength(2)
    expect(upHounds(called)).toHaveLength(2)
    // Откат снят нарочно: проверяется отказ по своре, а не по откату.
    const ready = { ...called, abilityCooldownsMs: {}, abilityCharges: {}, gcdMsLeft: 0 }
    expect(abilityStatus(ready, ABILITY_BY_ID.pack).reason).toBe('pack-full')
    // Автокаст зовёт ОДИН раз: при полной своре умение не кандидат.
    expect(autocastCandidates(s).map((a) => a.id)).toContain('pack')
    expect(autocastCandidates(ready).map((a) => a.id)).not.toContain('pack')
    const unslotted = tick({ ...called, abilitySlots: [null, null, null, null] }, STEP_MS, NO_LUCK, () => {})
    expect(unslotted.hounds).toHaveLength(1)
  })

  it('свора переживает сейв', () => {
    const called = useAbility(hero(['pack']), 'pack', NO_LUCK, () => {})
    const loaded = stateFromPayload(payloadFromState(called, 0))
    expect(loaded.hounds).toHaveLength(2)
  })
})

describe('модель боя видит команды', () => {
  const rate = (ids: string[]) => estimateCombatRate(hero(ids), 'auto')
  it('травля, спуск, серия и свора поднимают урон в секунду против одной Подсечки', () => {
    const base = rate(['undercut']).damagePerSecond
    for (const id of ['sic', 'unleash', 'flurry', 'pack', 'hamstring']) {
      expect(rate(['undercut', id]).damagePerSecond.gt(base), `${id} не виден модели`).toBe(true)
    }
  })

  it('оффлайн не обещает больше автокаста ни с одной командой в ряду', () => {
    for (const id of HOUND.abilityIds) {
      const s = hero(['undercut', id])
      const auto = estimateCombatRate(s, 'auto')
      const manual = estimateCombatRate(s, 'manual')
      expect(auto.killsPerSecond.lte(manual.killsPerSecond.times(1 + 1e-9)), id).toBe(true)
    }
  })
})

describe('четвёрка по умолчанию — рабочая ротация', () => {
  it('полоска энергии ходит, а не стоит на месте', () => {
    // Псарь шестого уровня своими четырьмя кнопками: если полоска весь бой
    // стоит выше девяти десятых, главный вопрос класса не возникает вовсе.
    const base = ensureStats({ ...createInitialState(1, HOUND.id, 1), level: new Decimal(6), statsDirty: true })
    let s = withDummy({ ...base, currentHp: base.stats.maxHp, currentMana: base.stats.maxMana })
    let min = 1
    for (let t = 0; t < 60_000; t += STEP_MS) {
      s = tick(s, STEP_MS, NO_LUCK, () => {})
      min = Math.min(min, s.currentMana.div(s.stats.maxMana).toNumber())
    }
    expect(min).toBeLessThan(0.5)
  })
})

describe('Стража и Изувера это не касается', () => {
  it('ни одно их умение не командует псом, и метки своры у них не появляются', () => {
    for (const cls of CLASSES.filter((c) => c.id !== HOUND.id)) {
      for (const id of cls.abilityIds) {
        const a = ABILITY_BY_ID[id]
        for (const flag of ['houndHaste', 'packStrike', 'recall', 'grip', 'flurry', 'houndHeal', 'unleash', 'skulk', 'rally', 'pack'] as const) {
          expect(a[flag], `${id}.${flag}`).toBeUndefined()
        }
      }
      let s = ensureStats({ ...createInitialState(1, cls.id, 1), level: new Decimal(20), statsDirty: true })
      s = step(withDummy({ ...s, currentHp: s.stats.maxHp, currentMana: s.stats.maxMana }), 5000)
      expect(s.houndMarks).toEqual(NO_HOUND_MARKS)
      expect(s.hounds).toEqual([])
    }
  })
})
