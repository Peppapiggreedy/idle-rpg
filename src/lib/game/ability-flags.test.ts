// ТРИ НОВЫХ МЕХАНИКИ: ослабление, детонатор и поглощение.
//
// Все три — ФЛАГИ С PAYLOAD'ом в данных, а не ветки по id в логике, и
// проверяются они по одному правилу: механика делает ровно то, что обещает
// её строка в книге, и ничего сверх.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, tick } from './tick'
import { ensureStats } from './stats'
import {
  abilityStatus,
  absorbPool,
  autocastCandidates,
  outgoingMultiplier,
  pendingEffectDamage,
  useAbility,
} from './abilities'
import { createRng } from './rng'
import { ABILITY_BY_ID } from '../data/abilities'
import { DEFAULT_CLASS } from '../data/classes'
import type { GameState } from './state'

const BLEED = 'rending-wound'
const RUPTURE = 'rupture'
const SHOVE = 'shield-shove'
const WALL = 'bulwark'

function hero(level = 20, patch: Partial<GameState> = {}): GameState {
  const ready = ensureStats({
    ...createInitialState(1, DEFAULT_CLASS.id, 1),
    level: new Decimal(level),
    statsDirty: true,
    ...patch,
  })
  // Запас налит доверху: тесты здесь про механику умений, а не про экономику
  // ресурса. Пустая мана роняла бы умение из очереди по совсем другой причине.
  return { ...ready, currentHp: ready.stats.maxHp, currentMana: ready.stats.maxMana }
}

/**
 * Моб-МАНЕКЕН: живучий и бьющий. Обычный моб стартовой зоны умирает с одного
 * удара героя двадцатого уровня и не успевает ударить в ответ — а здесь
 * проверяется именно ответный удар.
 */
function withDummy(state: GameState): GameState {
  const hp = new Decimal(1e9)
  return {
    ...state,
    monster: {
      ...state.monster,
      currentHp: hp,
      maxHp: hp,
      // Бьёт слабо и предсказуемо: герой обязан ПЕРЕЖИТЬ замер, иначе обе
      // ветки сравнения упрутся в ноль здоровья и сравнивать станет нечего.
      damageMin: new Decimal(5),
      damageMax: new Decimal(5),
      swingTime: 1,
      swingProgress: 0.9,
    },
  }
}

/** Кровотечение на мобе: ставим его настоящим ударом умения. */
function withBleed(state: GameState): GameState {
  const queued = useAbility(state, BLEED, createRng(7), () => {})
  // onNextSwing бьёт на замахе — крутим тик, пока эффект не появится.
  let s = queued
  for (let i = 0; i < 200 && s.activeEffects.length === 0; i += 1) {
    s = tick(s, 100, createRng(9), () => {})
  }
  return s
}

describe('кровотечение как сущность на цели', () => {
  it('читается снаружи: остаток эффекта — число, а не догадка', () => {
    const s = withBleed(hero())
    expect(s.activeEffects.length).toBeGreaterThan(0)
    expect(pendingEffectDamage(s).gt(0)).toBe(true)
  })

  it('РАЗРЫВ съедает его целиком и бьёт остатком', () => {
    const bleeding = withBleed(hero())
    const pending = pendingEffectDamage(bleeding)
    const hpBefore = bleeding.monster.currentHp
    // Ставим «Разрыв» в очередь и доводим до удара.
    let s = useAbility(bleeding, RUPTURE, createRng(3), () => {})
    expect(s.queuedAbilityId).toBe(RUPTURE)
    for (let i = 0; i < 200 && s.queuedAbilityId !== null; i += 1) {
      s = tick(s, 100, createRng(11), () => {})
    }
    // Эффект СЪЕДЕН: тикать больше нечему.
    expect(pendingEffectDamage(s).eq(0)).toBe(true)
    // И остаток ушёл в урон: моб потерял больше, чем сам удар умения.
    const lost = hpBefore.minus(s.monster.currentHp)
    expect(lost.gt(pending)).toBe(true)
  })

  it('без кровотечения РАЗРЫВ не встаёт в очередь и не тратит ресурс', () => {
    const clean = hero()
    expect(clean.activeEffects).toHaveLength(0)
    const status = abilityStatus(clean, ABILITY_BY_ID[RUPTURE])
    expect(status.usable).toBe(false)
    expect(status.reason).toBe('no-combo')
    const after = useAbility(clean, RUPTURE, createRng(5), () => {})
    // Ни очереди, ни списанного ресурса: отказ, а не «нажмётся и пропадёт».
    expect(after.queuedAbilityId).toBeNull()
    expect(after.currentMana.eq(clean.currentMana)).toBe(true)
  })
})

describe('СТЕНА: поглощение растёт от брони и силы блока', () => {
  const wall = ABILITY_BY_ID[WALL]

  it('запас щита считается из брони и блока, а не из воздуха', () => {
    const s = hero()
    const expected = s.stats.armor
      .times(wall.absorb!.armorShare)
      .plus(s.stats.blockValue.times(wall.absorb!.blockShare))
    expect(absorbPool(s, wall).eq(expected)).toBe(true)
  })

  it('больше брони — больше щит', () => {
    const light = hero()
    // Статы подменяем НАПРЯМУЮ и намеренно: проверяется формула запаса щита,
    // а не конвейер статов — у него свои тесты. Через `ensureStats` подмена
    // не прошла бы: он пересчитывает статы из источников, как и должен.
    const heavy: GameState = {
      ...light,
      stats: { ...light.stats, armor: light.stats.armor.plus(1000) },
    }
    expect(absorbPool(heavy, wall).gt(absorbPool(light, wall))).toBe(true)
  })

  it('применение вешает щит на длительность из данных', () => {
    const s = useAbility(hero(), WALL, createRng(1), () => {})
    expect(s.absorb).not.toBeNull()
    expect(s.absorb!.msLeft).toBe(wall.absorb!.durationSec * 1000)
    expect(s.absorb!.left.eq(absorbPool(hero(), wall))).toBe(true)
  })

  it('щит съедает урон раньше полоски здоровья', () => {
    // Моб бьёт по герою со щитом и без; со щитом полоска обязана просесть
    // меньше. Бросок один и тот же — сид общий.
    //
    // Щит вешаем ЧИСЛОМ, а не применением умения: голый герой двадцатого
    // уровня носит одно белое оружие, брони и щита у него нет, и запас,
    // посчитанный от нулевой брони, был бы нулевым. Формулу запаса проверяет
    // соседний тест — здесь проверяется, что тик его тратит.
    const base = withDummy(hero())
    const armedStart: GameState = { ...base, absorb: { left: new Decimal(30), msLeft: 60_000 } }
    let bare = base
    let armed = armedStart
    for (let i = 0; i < 40; i += 1) {
      bare = tick(bare, 200, createRng(21), () => {})
      armed = tick(armed, 200, createRng(21), () => {})
    }
    expect(armed.currentHp.gt(bare.currentHp)).toBe(true)
    // И запас щита потрачен, а не висит нетронутым.
    expect(armed.absorb === null || armed.absorb.left.lt(30)).toBe(true)
  })
})

describe('ТОЛЧОК ЩИТОМ ослабляет следующий удар противника', () => {
  it('метка появляется и живёт ровно столько ударов, сколько в данных', () => {
    const s = useAbility(hero(), SHOVE, createRng(1), () => {})
    expect(s.monsterWeaken).toEqual({
      damageShare: ABILITY_BY_ID[SHOVE].weaken!.damageShare,
      hitsLeft: ABILITY_BY_ID[SHOVE].weaken!.hits,
    })
  })

  it('ослабленный удар снимает меньше здоровья', () => {
    const base = withDummy(hero())
    const shoved: GameState = { ...base, monsterWeaken: { damageShare: 0.5, hitsLeft: 1 } }
    let bare = base
    let soft = shoved
    // Одного удара моба достаточно: метка сходит после него.
    for (let i = 0; i < 40; i += 1) {
      bare = tick(bare, 200, createRng(33), () => {})
      soft = tick(soft, 200, createRng(33), () => {})
    }
    expect(soft.currentHp.gt(bare.currentHp)).toBe(true)
  })
})

// --- ПОЗДНИЕ ЧЕТЫРЕ: ситуации вместо прибавок --------------------------------

const MERCY = 'mercy'
const BRAND = 'brand'
const FOCUS = 'focus'
const STANCE = 'stance'

/** Здоровье моба долей запаса — без этого ни добивание, ни клеймо не проверить. */
function atHpShare(state: GameState, share: number): GameState {
  return { ...state, monster: { ...state.monster, currentHp: state.monster.maxHp.times(share) } }
}

describe('МИЛОСТЬ доступна только на добивании', () => {
  const mercy = ABILITY_BY_ID[MERCY]
  const threshold = mercy.execute!.belowHpShare

  it('выше порога — отказ с НАЗВАННОЙ причиной', () => {
    const s = atHpShare(withDummy(hero()), threshold + 0.2)
    const status = abilityStatus(s, mercy)
    expect(status.usable).toBe(false)
    expect(status.reason).toBe('target-healthy')
  })

  it('ниже порога — доступна', () => {
    const s = atHpShare(withDummy(hero()), threshold / 2)
    expect(abilityStatus(s, mercy).usable).toBe(true)
  })

  it('автокаст просто пропускает её, пока цель цела', () => {
    const healthy = atHpShare(withDummy(hero()), 0.9)
    expect(autocastCandidates(healthy).map((a) => a.id)).not.toContain(MERCY)
    const dying = atHpShare(withDummy(hero()), threshold / 2)
    // Умение должно стоять в ряду, иначе автокаст его не увидит по построению.
    const inBar: GameState = { ...dying, abilitySlots: [MERCY, null, null, null] }
    expect(autocastCandidates(inBar).map((a) => a.id)).toContain(MERCY)
  })
})

describe('КЛЕЙМО поднимает получаемый урон и не вешается на умирающего', () => {
  const brand = ABILITY_BY_ID[BRAND]

  it('метка живёт заданное время и множит урон героя', () => {
    const plain = withDummy(hero())
    const marked: GameState = {
      ...plain,
      monsterBrand: { damageShare: brand.brand!.damageShare, msLeft: 20_000 },
    }
    expect(outgoingMultiplier(marked).gt(outgoingMultiplier(plain))).toBe(true)
    expect(outgoingMultiplier(marked).eq(1 + brand.brand!.damageShare)).toBe(true)
  })

  it('автокаст не клеймит цель ниже порога окупаемости', () => {
    const bar: (string | null)[] = [BRAND, null, null, null]
    const dying: GameState = {
      ...atHpShare(withDummy(hero()), brand.brand!.autocastAboveHpShare / 2),
      abilitySlots: bar,
    }
    expect(autocastCandidates(dying).map((a) => a.id)).not.toContain(BRAND)
    const fresh: GameState = { ...atHpShare(withDummy(hero()), 0.95), abilitySlots: bar }
    expect(autocastCandidates(fresh).map((a) => a.id)).toContain(BRAND)
  })

  it('РУКАМИ клеймо ставится когда угодно: правило только для автокаста', () => {
    const dying = atHpShare(withDummy(hero()), 0.05)
    expect(abilityStatus(dying, brand).usable).toBe(true)
  })
})

describe('СОСРЕДОТОЧЕНИЕ делает бесплатными ровно три применения', () => {
  const focus = ABILITY_BY_ID[FOCUS]

  it('после применения счётчик равен числу из данных', () => {
    const s = useAbility(withDummy(hero()), FOCUS, createRng(1), () => {})
    expect(s.freeCastsLeft).toBe(focus.freeCasts!.casts)
  })

  it('три следующих платных умения не стоят ресурса, четвёртое стоит', () => {
    let s = useAbility(withDummy(hero()), FOCUS, createRng(1), () => {})
    const mana = s.currentMana
    // Жмём одно и то же дешёвое умение, снимая откат руками: проверяется
    // счётчик применений, а не таймеры.
    for (let i = 0; i < 3; i += 1) {
      s = useAbility({ ...s, abilityCooldownsMs: {}, abilityCharges: {}, gcdMsLeft: 0 }, 'quick-strike', createRng(2), () => {})
    }
    expect(s.currentMana.eq(mana)).toBe(true)
    expect(s.freeCastsLeft).toBe(0)
    const after = useAbility(
      { ...s, abilityCooldownsMs: {}, abilityCharges: {}, gcdMsLeft: 0 },
      'quick-strike',
      createRng(2),
      () => {},
    )
    expect(after.currentMana.lt(mana)).toBe(true)
  })
})

describe('ГЛУХАЯ СТОЙКА меняет одну ось на другую', () => {
  const stance = ABILITY_BY_ID[STANCE]

  it('свой урон падает ровно на долю из данных', () => {
    const s = useAbility(withDummy(hero()), STANCE, createRng(1), () => {})
    expect(s.stance).not.toBeNull()
    expect(outgoingMultiplier(s).eq(1 - stance.stance!.damageShare)).toBe(true)
  })

  it('входящий урон смягчается: полоска проседает меньше', () => {
    const base = withDummy(hero())
    const guarded: GameState = {
      ...base,
      stance: { damageShare: 0.25, mitigationShare: 0.5, msLeft: 60_000 },
    }
    let bare = base
    let held = guarded
    for (let i = 0; i < 40; i += 1) {
      bare = tick(bare, 200, createRng(44), () => {})
      held = tick(held, 200, createRng(44), () => {})
    }
    expect(held.currentHp.gt(bare.currentHp)).toBe(true)
  })

  it('стойка сходит по истечении срока', () => {
    const s = useAbility(withDummy(hero()), STANCE, createRng(1), () => {})
    let later = s
    for (let i = 0; i < 200 && later.stance !== null; i += 1) {
      later = tick(later, 1000, createRng(5), () => {})
    }
    expect(later.stance).toBeNull()
  })
})
