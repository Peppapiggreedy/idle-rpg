// ПЁС — ВТОРОЕ ТЕЛО. Не эффект и не бафф: свой таймер замаха, своё здоровье,
// перенаправление входящего, падение и возврат. Проверяется на настоящем
// тике и на модели боя — обе обязаны видеть пса одинаково.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { STEP_MS } from './loop'
import { createInitialState, manualOnlySettings, type GameState } from './state'
import { ensureStats } from './stats'
import { tick } from './tick'
import { axesOf } from './equipment'
import { estimateCombatRate } from './combat'
import { HOUND_ID, freshHounds, houndMaxHp, isHoundUp, upHounds } from './hound'
import { applyOfflineProgress, payloadFromState, stateFromPayload } from './save'
import { zoneRate } from './zones'
import { CLASS_BY_ID, CLASSES } from '../data/classes'
import { createRng } from './rng'
import { OFFLINE_EFFICIENCY } from '../data/balance'
import { ZONES } from '../data/zones'
import type { AttackEvent } from '../types'

const NO_LUCK = () => 1
const HOUND = CLASS_BY_ID.houndmaster
const WARDEN = CLASS_BY_ID.warden
const DEF = HOUND.companion!

function hero(classId: string, patch: Partial<GameState> = {}): GameState {
  return ensureStats({
    ...createInitialState(7, classId, 7),
    abilitySettings: manualOnlySettings(classId),
    statsDirty: true,
    ...patch,
  })
}

/** Моб, которого не убить за отведённое время: замер идёт В БОЮ. */
function tough(state: GameState, damage = 0): GameState {
  return {
    ...state,
    monster: {
      ...state.monster,
      maxHp: new Decimal('1e9'),
      currentHp: new Decimal('1e9'),
      damageMin: new Decimal(damage),
      damageMax: new Decimal(damage),
    },
  }
}

function run(
  state: GameState,
  ms: number,
  onAttack: (e: AttackEvent) => void = () => {},
  rng: () => number = NO_LUCK,
): GameState {
  for (let t = 0; t < ms; t += STEP_MS) state = tick(state, STEP_MS, rng, onAttack)
  return state
}

describe('пёс — данные класса, а не механизм', () => {
  it('у Псаря спутник есть, у двух прежних классов — нет, и список псов это отражает', () => {
    expect(hero(HOUND.id).hounds).toHaveLength(DEF.count)
    for (const cls of CLASSES.filter((c) => !c.companion)) {
      expect(hero(cls.id).hounds, cls.id).toEqual([])
    }
  })

  it('запас пса — доля запаса героя, и он полон на старте', () => {
    const h = hero(HOUND.id)
    expect(houndMaxHp(h).eq(h.stats.maxHp.times(DEF.maxHpShare))).toBe(true)
    expect(h.hounds[0].hp.eq(houndMaxHp(h))).toBe(true)
    expect(isHoundUp(h.hounds[0])).toBe(true)
  })
})

describe('пёс бьёт по своему таймеру', () => {
  it('укусы идут в шину с пометкой спутника и по своему замаху', () => {
    const bites: AttackEvent[] = []
    const heroHits: AttackEvent[] = []
    run(tough(hero(HOUND.id)), 10_000, (e) => {
      if (e.companion) bites.push(e)
      else if (e.sourceId === 'hero') heroHits.push(e)
    })
    const expected = Math.floor(10 / DEF.swingTime)
    expect(bites.length).toBeGreaterThanOrEqual(expected - 1)
    expect(bites.length).toBeLessThanOrEqual(expected + 1)
    // Оба тела бьют, и разными таймерами: число ударов разное.
    expect(heroHits.length).toBeGreaterThan(0)
    expect(bites.length).not.toBe(heroHits.length)
    for (const b of bites) expect(b.sourceId).toBe(HOUND_ID)
  })

  it('укус виден в журнале своей строкой', () => {
    const s = run(tough(hero(HOUND.id)), 2_000)
    expect(s.combatLog.some((e) => e.type === 'hound-hit')).toBe(true)
  })

  it('без пса на поле укусов нет: у Стража шина чистая от спутника', () => {
    const bites: AttackEvent[] = []
    run(tough(hero(WARDEN.id)), 5_000, (e) => {
      if (e.companion || e.targetId === HOUND_ID) bites.push(e)
    })
    expect(bites).toEqual([])
  })

  it('лежащий пёс не кусает', () => {
    const base = hero(HOUND.id)
    const down = tough({
      ...base,
      hounds: [{ hp: new Decimal(0), swing: 0, downMsLeft: 60_000 }],
    })
    const bites: AttackEvent[] = []
    run(down, 5_000, (e) => {
      if (e.companion) bites.push(e)
    })
    expect(bites).toEqual([])
  })
})

describe('перенаправление: урон меняет адресата, а не исчезает', () => {
  it('сумма по герою и псу равна удару, доля — из данных', () => {
    const base = tough(hero(HOUND.id), 50)
    // Моб замахивается сразу: ждём его первый удар и читаем шину.
    const s = { ...base, monster: { ...base.monster, swingProgress: 0.99 } }
    const toHero: Decimal[] = []
    const toHound: Decimal[] = []
    run(s, STEP_MS * 3, (e) => {
      if (e.targetId === 'hero') toHero.push(e.amount)
      if (e.targetId === HOUND_ID) toHound.push(e.amount)
    })
    expect(toHero).toHaveLength(1)
    expect(toHound).toHaveLength(1)
    const total = toHero[0].plus(toHound[0])
    expect(toHound[0].div(total).toNumber()).toBeCloseTo(DEF.redirectShare, 6)
    // Здоровье пса просело ровно на его часть.
    const after = run(s, STEP_MS * 3)
    expect(houndMaxHp(after).minus(after.hounds[0].hp).toNumber()).toBeCloseTo(
      toHound[0].toNumber(),
      6,
    )
  })

  it('у Стража удар доходит целиком: перенаправлять некому', () => {
    const base = tough(hero(WARDEN.id), 50)
    const s = { ...base, monster: { ...base.monster, swingProgress: 0.99 } }
    const toHound: Decimal[] = []
    let toHero = 0
    run(s, STEP_MS * 3, (e) => {
      if (e.targetId === HOUND_ID) toHound.push(e.amount)
      if (e.targetId === 'hero') toHero += 1
    })
    expect(toHound).toEqual([])
    expect(toHero).toBe(1)
  })
})

describe('падение и возврат', () => {
  it('пёс с пустым запасом ложится на свой таймер и встаёт полным', () => {
    const base = hero(HOUND.id)
    const weak = tough(
      {
        ...base,
        hounds: [{ hp: new Decimal(1), swing: 0, downMsLeft: 0 }],
        monster: { ...base.monster, swingProgress: 0.99 },
      },
      500,
    )
    const down = run(weak, STEP_MS * 3)
    expect(isHoundUp(down.hounds[0])).toBe(false)
    expect(down.hounds[0].downMsLeft).toBeGreaterThan(0)
    expect(down.hounds[0].downMsLeft).toBeLessThanOrEqual(DEF.returnSec * 1000)
    expect(down.combatLog.some((e) => e.type === 'hound-down')).toBe(true)
    // Пока лежит — не кусает и не принимает урон; моба для чистоты уберём.
    const quiet = { ...down, monster: { ...down.monster, damageMin: new Decimal(0), damageMax: new Decimal(0) } }
    const back = run(quiet, DEF.returnSec * 1000 + STEP_MS * 2)
    expect(isHoundUp(back.hounds[0])).toBe(true)
    expect(back.hounds[0].hp.eq(houndMaxHp(back))).toBe(true)
    expect(back.combatLog.some((e) => e.type === 'hound-return')).toBe(true)
  })

  it('вне боя пёс восстанавливается по ставке из данных', () => {
    const base = hero(HOUND.id)
    const half = houndMaxHp(base).div(2)
    const idle = {
      ...base,
      respawnMsLeft: 1_000_000,
      hounds: [{ hp: half, swing: 0, downMsLeft: 0 }],
    }
    const after = run(idle, 5_000)
    const expected = half.plus(houndMaxHp(base).times(DEF.regenShare.outOfCombat * 5))
    expect(after.hounds[0].hp.toNumber()).toBeCloseTo(expected.toNumber(), 3)
  })
})

describe('пёс входит в обе оси и в модель боя', () => {
  it('пока пёс лежит, падают ОБЕ оси', () => {
    const up = hero(HOUND.id)
    const down = { ...up, hounds: [{ hp: new Decimal(0), swing: 0, downMsLeft: 5_000 }] }
    const a = axesOf(up)
    const b = axesOf(down)
    expect(b.damage.lt(a.damage)).toBe(true)
    expect(b.survival.lt(a.survival)).toBe(true)
  })

  it('оценка боя читает пса: с ним урон в секунду выше, потеря героя ниже', () => {
    const up = hero(HOUND.id)
    const gone = { ...up, hounds: [] }
    const withHound = estimateCombatRate(up)
    const without = estimateCombatRate(gone)
    expect(withHound.damagePerSecond.gt(without.damagePerSecond)).toBe(true)
    expect(withHound.grossHpLossPerSecond.lte(without.grossHpLossPerSecond)).toBe(true)
  })

  it('у класса без спутника модель не двигается ни на бит', () => {
    const w = hero(WARDEN.id)
    const a = estimateCombatRate(w)
    const b = estimateCombatRate({ ...w, hounds: freshHounds(w) })
    expect(b).toEqual(a)
  })
})

describe('оффлайн ≤ автокаст — и для класса с псом', () => {
  const HOUR_MS = 3_600_000

  it('час оффлайна равен OFFLINE_EFFICIENCY часа живой игры — модель видит пса, как тик', () => {
    // Тот же метод, что у Стража в combat-rate.test.ts: живая игра ровно на
    // ту долю часа, которую обещает оффлайн, сравнивается золотом.
    for (const seed of [777, 4242]) {
      const rng = createRng(seed)
      let sim = createInitialState(seed, HOUND.id, seed)
      for (let t = 0; t < HOUR_MS * OFFLINE_EFFICIENCY; t += STEP_MS) {
        sim = tick(sim, STEP_MS, rng, () => {})
      }
      const { report } = applyOfflineProgress(createInitialState(seed, HOUND.id, seed), HOUR_MS)
      expect(report, `сид ${seed}`).not.toBeNull()
      const relDiff = Math.abs(report!.gold.toNumber() - sim.gold.toNumber()) / sim.gold.toNumber()
      // Допуск тот же, что у готового класса: пёс в модели первого порядка,
      // и если он уводит оффлайн дальше 20 %, модель пса неверна.
      expect(relDiff, `сид ${seed}: оффлайн ${report!.gold}, тик ${sim.gold}`).toBeLessThanOrEqual(0.2)
    }
  })

  it('оффлайн НИКОГДА не выгоднее той же живой игры', () => {
    const rng = createRng(777)
    let sim = createInitialState(777, HOUND.id, 777)
    for (let t = 0; t < HOUR_MS; t += STEP_MS) sim = tick(sim, STEP_MS, rng, () => {})
    const { report } = applyOfflineProgress(createInitialState(777, HOUND.id, 777), HOUR_MS)
    expect(report!.gold.lt(sim.gold)).toBe(true)
    // Модель зоны — та же, что кормит оффлайн, и пса она видит.
    expect(zoneRate(createInitialState(777, HOUND.id, 777), ZONES[0], 'auto').killsPerSecond.gt(0)).toBe(true)
  }, 30_000)
})

describe('псы переживают сохранение и загрузку', () => {
  it('здоровье и таймер возврата читаются обратно; запас пересчитывается', () => {
    const base = hero(HOUND.id)
    const hurt = {
      ...base,
      hounds: [{ hp: houndMaxHp(base).div(3), swing: 0.5, downMsLeft: 0 }],
    }
    const back = stateFromPayload(payloadFromState(hurt, 0))
    expect(back.hounds).toHaveLength(1)
    expect(back.hounds[0].hp.toNumber()).toBeCloseTo(houndMaxHp(base).div(3).toNumber(), 6)
    expect(back.hounds[0].downMsLeft).toBe(0)
    const down = { ...base, hounds: [{ hp: new Decimal(0), swing: 0, downMsLeft: 4_321 }] }
    const downBack = stateFromPayload(payloadFromState(down, 0))
    expect(downBack.hounds[0].downMsLeft).toBe(4_321)
    expect(isHoundUp(downBack.hounds[0])).toBe(false)
  })

  it('сейв без поля псов даёт свежий комплект, а не пустоту', () => {
    const payload = payloadFromState(hero(HOUND.id), 0)
    const { hounds: _dropped, ...legacy } = payload
    const back = stateFromPayload(legacy as typeof payload)
    expect(back.hounds).toHaveLength(DEF.count)
    expect(upHounds(back)).toHaveLength(DEF.count)
  })

  it('у Стража поле пустое в обе стороны', () => {
    const payload = payloadFromState(hero(WARDEN.id), 0)
    expect(payload.hounds).toEqual([])
    expect(stateFromPayload(payload).hounds).toEqual([])
  })
})
