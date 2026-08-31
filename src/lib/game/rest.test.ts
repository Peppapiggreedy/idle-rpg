// Привал: управляемая пауза вместо смерти как единственной остановки.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { STEP_MS } from './loop'
import {
  createInitialState,
  emptyEquipment,
  manualOnlySettings,
  tick,
  type GameState,
} from './tick'
import { ensureStats } from './stats'
import { averageGear } from './simulate'
import { finishRest, maxMonsterHit, needsRest, restDurationMs, restProgress, startRest, zoneSafety } from './rest'
import { applyOfflineProgress } from './save'
import { zoneRate } from './zones'
import { REST_DURATION_S, REST_FOOD_SPEEDUP } from '../data/balance'
import { ZONES } from '../data/zones'

const NO_LUCK = () => 1

function hero(patch: Partial<GameState> = {}): GameState {
  return ensureStats({
    ...createInitialState(1),
    abilitySettings: manualOnlySettings(),
    statsDirty: true,
    ...patch,
  })
}

/**
 * Герой СЕРЕДИНЫ ЛЕСТНИЦЫ, слегка недоодетый: сороковой уровень в вещах
 * тридцатого. Нужен там, где меряется ОФФЛАЙН и цена привала.
 *
 * Почему не новобранец. Во-первых, в одном белом клинке при шести пустых
 * слотах он за стартовую зону не выходит вовсе. Во-вторых, за подъём в зону
 * выше своей теперь платят входящим уроном (LEVEL_GAP_DAMAGE_PER_LEVEL), и
 * герой первого уровня в любой зоне, кроме стартовой, просто ложится —
 * сравнение «с привалом против без привала» выродилось бы в «ноль против
 * нуля». Недоодетый герой своей полосы теряет HP, но не гибнет: ровно то,
 * на чём и меряется цена привала.
 */
function dressedHero(patch: Partial<GameState> = {}): GameState {
  return ensureStats({
    ...hero(),
    level: new Decimal(40),
    equipment: averageGear(30),
    statsDirty: true,
    ...patch,
  })
}

/** Первая зона, где аптайм попадает в окно: зоны выбираются ПОИСКОМ, а не
 *  номером — номер разъезжается с каждой правкой сил. */
function zoneWithUptime(from: number, to: number): (typeof ZONES)[number] {
  const found = ZONES.find((z) => {
    const share = zoneRate(dressedHero({ currentZoneId: z.id }), z).uptime
    return share > from && share <= to
  })
  if (!found) throw new Error(`нет зоны с аптаймом в (${from}, ${to}]`)
  return found
}

function run(state: GameState, ms: number): GameState {
  for (let t = 0; t < ms; t += STEP_MS) state = tick(state, STEP_MS, NO_LUCK, () => {})
  return state
}

describe('уход на привал', () => {
  it('просадка НИЖЕ ПОРОГА В СЕРЕДИНЕ БОЯ схватку не прерывает', () => {
    // Главное правило шага: герой доводит бой до конца. Раньше он выходил
    // из схватки, едва просев, и умереть при аккуратном пороге было нельзя
    // вовсе — порог был не решением, а страховкой.
    const s = hero({ restHpThreshold: 0.4 })
    const low = { ...s, currentHp: s.stats.maxHp.times(0.3) }
    expect(needsRest(low)).toBe(true) // порог пройден…
    const after = tick(low, STEP_MS, NO_LUCK, () => {})
    expect(after.heroState).toBe('alive') // …но моб ещё жив, и бой идёт
  })

  it('после убийства с HP ниже порога герой уходит на привал', () => {
    const s = hero({ restHpThreshold: 0.4 })
    // Моб добит: currentHp моба на нуле — ровно то состояние, в котором
    // решение об отдыхе и принимается.
    const afterKill = {
      ...s,
      currentHp: s.stats.maxHp.times(0.3),
      monster: { ...s.monster, currentHp: new Decimal(0) },
    }
    const after = tick(afterKill, STEP_MS, NO_LUCK, () => {})
    expect(after.heroState).toBe('resting')
    expect(after.restMsLeft).toBeGreaterThan(0)
    // Таймер респауна снят: возвращаться будет не к кому.
    expect(after.respawnMsLeft).toBe(0)
  })

  it('после привала ждёт НОВЫЙ моб с полным здоровьем', () => {
    // Возврат — это новая схватка, а не продолжение старой. Иначе привал
    // был бы способом долечиться посреди боя, только оформленным иначе.
    const s = hero({ restHpThreshold: 0.4 })
    const started = startRest({
      ...s,
      currentHp: new Decimal(1),
      monster: { ...s.monster, currentHp: new Decimal(0) },
    })
    const after = run(started, REST_DURATION_S * 1000 + STEP_MS)
    expect(after.heroState).toBe('alive')
    expect(after.monster.currentHp.eq(after.monster.maxHp)).toBe(true)
    // И это именно появление нового противника, а не долеченный старый.
    expect(after.combatLog.some((e) => e.type === 'spawn')).toBe(true)
  })

  it('войти в бой на низком запасе — значит, возможно, не выйти', () => {
    // Оборотная сторона правила: смерть перестала быть невозможной, и это
    // ожидаемо. Герой с третью запаса против моба, снимающего больше, гибнет.
    let s = hero({ restHpThreshold: 0.3 })
    s = ensureStats({ ...s, equipment: emptyEquipment(), statsDirty: true })
    s = { ...s, currentHp: s.stats.maxHp.times(0.3), currentZoneId: ZONES[3].id }
    s = { ...s, monster: { ...s.monster, currentHp: s.monster.maxHp } }
    let died = false
    for (let t = 0; t < 300_000; t += STEP_MS) {
      s = tick(s, STEP_MS, NO_LUCK, () => {})
      if (s.heroState === 'dead') {
        died = true
        break
      }
    }
    expect(died).toBe(true)
  })

  it('с нулевым порогом привала нет вовсе — остаётся только смерть', () => {
    const s = hero({ restHpThreshold: 0, restResourceThreshold: 0 })
    const low = { ...s, currentHp: s.stats.maxHp.times(0.05) }
    expect(needsRest(low)).toBe(false)
    expect(tick(low, STEP_MS, NO_LUCK, () => {}).heroState).toBe('alive')
  })

  it('порог по ресурсу работает так же, как по HP', () => {
    const s = hero({ restHpThreshold: 0, restResourceThreshold: 0.4 })
    const dry = { ...s, currentMana: s.stats.maxMana.times(0.1) }
    expect(needsRest(dry)).toBe(true)
  })

  it('на привале герой не бьёт и по нему не бьют', () => {
    const s = startRest(hero({ restHpThreshold: 0.4, currentHp: new Decimal(10) }))
    const hpBefore = s.currentHp
    const monsterHpBefore = s.monster.currentHp
    const after = run(s, REST_DURATION_S * 1000 - STEP_MS * 2)
    expect(after.heroState).toBe('resting')
    expect(after.monster.currentHp.eq(monsterHpBefore)).toBe(true)
    // HP не растёт по ходу привала: восстановление происходит в его конце.
    expect(after.currentHp.eq(hpBefore)).toBe(true)
  })
})

describe('длительность и восстановление', () => {
  it('привал длится ровно REST_DURATION_S и восстанавливает полностью', () => {
    const s = startRest(
      hero({ restHpThreshold: 0.4, currentHp: new Decimal(5), currentMana: new Decimal(1) }),
    )
    expect(s.restMsLeft).toBe(REST_DURATION_S * 1000)
    const during = run(s, REST_DURATION_S * 1000 - STEP_MS)
    expect(during.heroState).toBe('resting')
    const after = run(s, REST_DURATION_S * 1000)
    expect(after.heroState).toBe('alive')
    expect(after.currentHp.eq(after.stats.maxHp)).toBe(true)
    expect(after.currentMana.eq(after.stats.maxMana)).toBe(true)
  })

  it('прерывание даёт восстановление пропорционально отсиженному', () => {
    // Бесплатное прерывание превратило бы привал в кнопку «полный запас»,
    // и порог перестал бы что-либо значить.
    const start = startRest(hero({ currentHp: new Decimal(0), currentMana: new Decimal(0) }))
    const half = run(start, REST_DURATION_S * 500)
    const progress = restProgress(half)
    // Отсидели примерно половину — точное число тиков здесь не важно, важно,
    // что вернётся ровно эта доля, а не всё и не ничего.
    expect(progress).toBeGreaterThan(0.4)
    expect(progress).toBeLessThan(0.6)
    const stopped = finishRest(half, progress)
    expect(stopped.heroState).toBe('alive')
    expect(stopped.currentHp.div(stopped.stats.maxHp).toNumber()).toBeCloseTo(progress, 6)
    expect(stopped.currentMana.div(stopped.stats.maxMana).toNumber()).toBeCloseTo(progress, 6)
  })

  it('источник ускорения сокращает привал вдвое и расходуется', () => {
    // Само поле пока заполняет только кулинария из следующего шага; здесь
    // проверено, что место его учёта живое, а не декоративное.
    const plain = hero()
    const fed = { ...plain, restSpeedupSource: 'food:test' }
    expect(restDurationMs(fed)).toBe(restDurationMs(plain) / REST_FOOD_SPEEDUP)
    expect(finishRest(startRest(fed)).restSpeedupSource).toBeNull()
  })
})

describe('индикатор безопасности зоны', () => {
  it('метка считает БОЙ ЦЕЛИКОМ, а не один удар', () => {
    const s = hero({ restHpThreshold: 0.6 })
    for (const zone of ZONES) {
      const safety = zoneSafety(s, zone)
      expect(safety.worstHit.eq(maxMonsterHit(zone, s.stats, s.level.toNumber()))).toBe(true)
      // Метка — это ровно сравнение порога с потерей за неудачный бой, без
      // запаса и без округлений: обещание «умереть нельзя» обязано быть точным.
      expect(safety.safe).toBe(safety.thresholdHp.gt(safety.worstFight))
      // И бой всегда тяжелее одного удара: за схватку прилетает не раз.
      expect(safety.worstFight.gte(0)).toBe(true)
    }
  })

  it('порога, которого хватало на удар, на бой уже не хватает', () => {
    // Именно эта разница и есть смысл шага: раньше «безопасно» значило
    // «переживу удар», теперь — «переживу схватку».
    const s = hero({ restHpThreshold: 0.6, currentZoneId: ZONES[2].id })
    const safety = zoneSafety(s, ZONES[2])
    expect(safety.worstFight.gt(safety.worstHit)).toBe(true)
  })

  it('безопасная по метке зона действительно не убивает', () => {
    // Проверяем не метку, а игру. Метка теперь считает БОЙ ЦЕЛИКОМ (см.
    // zoneSafety): порога должно хватать не на один удар, а на всё, что
    // моб успеет снять за схватку. Иначе обещание «умереть нельзя»
    // держалось бы ровно до первого затяжного боя.
    const zone = ZONES[0]
    let s = hero({ restHpThreshold: 0.5, currentZoneId: zone.id })
    expect(zoneSafety(s, zone).safe).toBe(true)
    for (let t = 0; t < 600_000; t += STEP_MS) {
      s = tick(s, STEP_MS, () => 0.999, () => {})
      if (s.heroState === 'dead') break
    }
    expect(s.heroState).not.toBe('dead')
  })
})

describe('оффлайн знает про привалы', () => {
  it('высокий порог стоит времени: привалов больше — золота меньше', () => {
    const HOURS8 = 8 * 3_600_000
    // Зона, где герой ещё не умирает, но уже теряет здоровье: разница
    // в золоте — это ровно время, проведённое на привалах, и ничего больше.
    // В смертельной зоне сравнение мерило бы смерть против привала, а не
    // цену самого привала: смерть стоит дороже, и привал на её фоне выгоден.
    //
    // Сравниваем два ненулевых порога, а не порог с его отсутствием: привал
    // теперь квантуется БОЯМИ, и «отдыхать после каждого убийства» — это
    // тоже привал, просто самый частый.
    // Зона, где герой ещё не гибнет, но уже теряет здоровье: разница в золоте
    // это ровно время на привалах, и ничего больше.
    const zone = zoneWithUptime(0.9, 0.999)
    const idle = dressedHero({ currentZoneId: zone.id, restHpThreshold: 0.9 })
    const greedy = ensureStats({
      ...idle,
      restHpThreshold: 0.2,
      restResourceThreshold: 0,
      statsDirty: true,
    })
    const resting = applyOfflineProgress(idle, HOURS8).report
    const nonstop = applyOfflineProgress(greedy, HOURS8).report
    expect(resting).not.toBeNull()
    expect(nonstop).not.toBeNull()
    expect(resting!.gold.lt(nonstop!.gold)).toBe(true)
  })

  it('в опасной зоне привал ВЫГОДНЕЕ смерти — и модель это видит', () => {
    // Оборотная сторона того же: тридцать секунд воскрешения дороже десяти
    // секунд привала, поэтому порог окупается там, где без него умирают.
    const HOURS8 = 8 * 3_600_000
    // Зона выбирается ПОИСКОМ: нужна та, где безрассудный уже заметно
    // умирает, а осторожный ещё держится. Номер в лестнице для этого не
    // годится — он разъезжается с каждой правкой сил.
    const zone =
      ZONES.find((z) => {
        const reckless = ensureStats({
          ...dressedHero({ currentZoneId: z.id }),
          restHpThreshold: 0,
          restResourceThreshold: 0,
          statsDirty: true,
        })
        const share = zoneRate(reckless, z).uptime
        return share > 0.2 && share < 0.8
      }) ?? ZONES[2]
    const careful = dressedHero({ currentZoneId: zone.id, restHpThreshold: 0.6 })
    const reckless = ensureStats({
      ...careful,
      restHpThreshold: 0,
      restResourceThreshold: 0,
      statsDirty: true,
    })
    const withRest = applyOfflineProgress(careful, HOURS8).report
    const withoutRest = applyOfflineProgress(reckless, HOURS8).report
    expect(withRest!.gold.gt(withoutRest!.gold)).toBe(true)
  })
})
