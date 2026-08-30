// ПРЕРВАННЫЙ ЗАБЕГ. Общее правило для всего закрытого контента — данжа,
// храма и будущего рейда: закрытая вкладка расформировывает забег, герой
// выходит наружу в подходящую зону, и оффлайн начисляется ПО НЕЙ.
//
// Два свойства РАЗНЫЕ, и каждое проверяется отдельно: оффлайн начисляется,
// но сама попытка НЕ продолжается и НЕ засчитывается.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, type GameState } from './tick'
import { ensureStats } from './stats'
import { enterDungeon } from './dungeons'
import { enterTemple } from './temple'
import { forecastZone, offlineZone } from './zones'
import { loadGame, saveGame, type SaveStorage } from './save'
import { DUNGEONS } from '../data/dungeons'
import { TEMPLE } from '../data/temple'
import { SAFE_ZONE, ZONES, ZONE_BY_ID, zoneForMonsterLevel } from '../data/zones'
import { XP_GAP_PENALTY } from '../data/balance'
import { averageGear } from './simulate'

const DUNGEON = DUNGEONS[0]
const HOUR = 3_600_000
const FULL_GAP = XP_GAP_PENALTY[0].maxGap

function makeStorage(): SaveStorage {
  const data = new Map<string, string>()
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

function hero(patch: Partial<GameState> = {}): GameState {
  return ensureStats({
    ...createInitialState(1),
    level: new Decimal(DUNGEON.unlockRequirement),
    currentZoneId: DUNGEON.zoneId,
    lastSurvivedZoneId: DUNGEON.zoneId,
    equipment: averageGear(DUNGEON.unlockRequirement),
    statsDirty: true,
    ...patch,
  })
}

/** Сохранить состояние и загрузить его же спустя `awayMs`. */
function reloadAfter(state: GameState, awayMs: number) {
  const storage = makeStorage()
  saveGame(state, { storage, now: () => 0 })
  const result = loadGame({ storage, now: () => awayMs })
  expect(result.kind).toBe('loaded')
  if (result.kind !== 'loaded') throw new Error('unreachable')
  return result
}

describe('выбор зоны для выхода наружу', () => {
  it('последняя выжитая, если её мобы не отстали', () => {
    const zone = ZONE_BY_ID[DUNGEON.zoneId]
    const s = hero({ lastSurvivedZoneId: zone.id })
    expect(offlineZone(s).id).toBe(zone.id)
  })

  it('последняя выжитая отстала — берётся самая высокая подходящая', () => {
    // Герой давно вырос из стартового луга: возвращать его туда значит
    // отправить фармить зону, которая уже не платит опыта.
    const start = zoneForMonsterLevel(1)
    const level = 40
    const s = hero({
      level: new Decimal(level),
      equipment: averageGear(level),
      lastSurvivedZoneId: start.id,
    })
    const picked = offlineZone(s)
    expect(picked.id).not.toBe(start.id)
    // Выбранная зона открыта, не отстала и герой в ней не гибнет.
    expect(picked.unlockRequirement).toBeLessThanOrEqual(level)
    expect(level - picked.monsterLevelRange.min).toBeLessThanOrEqual(FULL_GAP)

    // И ЭТО САМАЯ ВЫСОКАЯ ИЗ ПОДХОДЯЩИХ — утверждением, а не условием.
    //
    // Здесь стоял цикл по зонам выше выбранной с проверкой внутри `if`.
    // Условие было истинно ровно для тех зон, которых по построению не
    // бывает: `picked` уже самая высокая подходящая, значит выше неё
    // подходящих нет, и тело `if` не выполнялось НИ РАЗУ. Ревизия доказала
    // это мутацией: перевёрнутый обход в offlineZone оставлял зелёными все
    // 825 тестов проекта, хотя цена такой ошибки для игрока — до минус 48 %
    // оффлайнового опыта за ночь.
    //
    // Список подходящих зон перечисляется ЗДЕСЬ и проверяется на непустоту:
    // иначе тест снова стал бы проверять пустое множество.
    const fits = ZONES.filter(
      (z) =>
        z.unlockRequirement <= level &&
        level - z.monsterLevelRange.min <= FULL_GAP &&
        ['safe', 'risky'].includes(forecastZone(s, z).verdict),
    )
    expect(fits.length).toBeGreaterThan(1)
    const deepest = Math.max(...fits.map((z) => z.monsterLevelRange.min))
    expect(picked.monsterLevelRange.min).toBe(deepest)
  })

  it('подходящей нет — безопасная', () => {
    // Первый уровень: всё, кроме стартовой полосы, закрыто, а истории
    // выживания ещё нет вовсе.
    const rookie = ensureStats({
      ...createInitialState(1),
      lastSurvivedZoneId: null,
      statsDirty: true,
    })
    // Ни одной открытой зоны выше стартовой быть не может, значит выбор
    // сводится к безопасной либо к самой стартовой — и обе законны.
    const picked = offlineZone(rookie)
    expect(picked.unlockRequirement).toBeLessThanOrEqual(1)
  })

  it('выбор детерминирован: одно и то же состояние — одна и та же зона', () => {
    const s = hero()
    const first = offlineZone(s).id
    for (let i = 0; i < 5; i += 1) expect(offlineZone(s).id).toBe(first)
  })
})

describe('данж: закрытая вкладка', () => {
  it('забег расформирован, герой снаружи, оффлайн начислен по зоне', () => {
    const inside = enterDungeon(hero(), DUNGEON.id)
    expect(inside.dungeonRun).not.toBeNull()

    const { state, offline } = reloadAfter(inside, 4 * HOUR)

    // Забег снят, а герой стоит в зоне, которую выбрало правило.
    expect(state.dungeonRun).toBeNull()
    expect(state.currentZoneId).toBe(offlineZone(inside).id)
    // Перед ним обычный моб зоны, а не босс цепочки.
    expect(DUNGEON.bosses.map((b) => b.id)).not.toContain(state.monster.id)

    // Оффлайн НАЧИСЛЕН — раньше он был ровно нулевым.
    expect(offline).not.toBeNull()
    expect(offline!.kills.gt(0)).toBe(true)
    expect(offline!.gold.gt(0)).toBe(true)
    // И отчёт честно говорит, откуда взялись числа и что забег оборвался.
    expect(offline!.interrupted).toBe('dungeon')
    expect(offline!.zoneId).toBe(state.currentZoneId)
  })

  it('попытка НЕ засчитана: цепочку придётся начинать заново', () => {
    // Второе свойство пары. Оффлайн начислен — но данж не пройден: флага
    // прохождения нет, и прогресс цепочки обнулён.
    const inside = enterDungeon(hero(), DUNGEON.id)
    const { state } = reloadAfter(inside, 8 * HOUR)
    expect(state.dungeonsCleared[DUNGEON.id]).toBeUndefined()
    expect(state.dungeonRun).toBeNull()
  })

  it('лут за уже убитых боссов остаётся', () => {
    const loot = {
      id: 'boss-drop',
      name: 'Трофей',
      rarity: 'epic' as const,
      slot: 'trinket' as const,
      level: DUNGEON.unlockRequirement,
      mods: [],
    }
    const inside = enterDungeon(hero({ inventory: [loot] }), DUNGEON.id)
    const { state } = reloadAfter(inside, HOUR)
    expect(state.inventory.map((i) => i.id)).toContain('boss-drop')
  })

  it('часы перевели назад — забег всё равно расформирован', () => {
    // Оффлайн при отрицательной разнице не начисляется, и расформирование
    // не должно ехать вместе с ним: иначе герой остался бы заперт внутри.
    const inside = enterDungeon(hero(), DUNGEON.id)
    const storage = makeStorage()
    saveGame(inside, { storage, now: () => 10 * HOUR })
    const result = loadGame({ storage, now: () => 0 })
    expect(result.kind).toBe('loaded')
    if (result.kind !== 'loaded') throw new Error('unreachable')
    expect(result.state.dungeonRun).toBeNull()
    expect(result.offline).toBeNull()
  })
})

describe('храм: закрытая вкладка', () => {
  function inTemple(): GameState {
    const at = ensureStats({
      ...hero({
        level: new Decimal(TEMPLE.unlockRequirement),
        equipment: averageGear(TEMPLE.unlockRequirement),
        currentZoneId: TEMPLE.zoneId,
        lastSurvivedZoneId: TEMPLE.zoneId,
      }),
      statsDirty: true,
    })
    return enterTemple(at, TEMPLE)
  }

  it('выход ведёт в полосу входа храма, а не в чужую', () => {
    // Инвариант входа: храм открывается с 70 уровня и стоит в полосе 71-75.
    // Возврат из прерванного забега обязан вести туда же — раньше вход стоял
    // в полосе 91-95, и герой семидесятого уровня выходил в зону, где не
    // выживает.
    const zone = ZONE_BY_ID[TEMPLE.zoneId]
    expect(zone.monsterLevelRange.min - 1).toBeLessThanOrEqual(TEMPLE.unlockRequirement)
    expect(TEMPLE.unlockRequirement).toBeLessThanOrEqual(zone.monsterLevelRange.max)
    const { state } = reloadAfter(inTemple(), HOUR)
    const out = ZONE_BY_ID[state.currentZoneId]
    expect(out.monsterLevelRange.min).toBeLessThanOrEqual(TEMPLE.unlockRequirement + 1)
  })

  it('забег расформирован, оффлайн начислен, рекорд не тронут', () => {
    const inside = inTemple()
    expect(inside.templeRun).not.toBeNull()

    const { state, offline } = reloadAfter(inside, 4 * HOUR)
    expect(state.templeRun).toBeNull()
    expect(state.currentZoneId).toBe(offlineZone(inside).id)
    expect(offline).not.toBeNull()
    expect(offline!.interrupted).toBe('temple')
    // Рекорд волн — заработанное, его закрытая вкладка не отнимает.
    expect(state.templeBestWave).toBe(inside.templeBestWave)
  })

  it('брошенный забег НЕ засчитывается: рекорд и награды не меняются', () => {
    // Это и есть вторая половина пары «смерть засчитывается, прерывание —
    // нет». Смерть проверяется в temple-record.test.ts.
    const inside = inTemple()
    const before = { record: inside.templeBestWave, dust: inside.enchantDust, gold: inside.gold }
    const { state } = reloadAfter(inside, HOUR)
    expect(state.templeBestWave).toBe(before.record)
    expect(state.enchantDust.eq(before.dust)).toBe(true)
    // Золото могло вырасти за оффлайн, но не за этажи: рекорд не сдвинулся.
    expect(state.templeCleared).toBe(false)
  })
})

describe('без забега загрузка не меняется', () => {
  it('герой снаружи остаётся в своей зоне', () => {
    const outside = hero()
    const { state, offline } = reloadAfter(outside, 2 * HOUR)
    expect(state.currentZoneId).toBe(outside.currentZoneId)
    expect(offline?.interrupted ?? null).toBeNull()
  })

  it('безопасная зона — законный выбор, а не заглушка', () => {
    expect(SAFE_ZONE).toBeDefined()
    expect(SAFE_ZONE.isSafe).toBe(true)
  })
})
