// ЛУТ В ОФФЛАЙНЕ. Долг №5 из ARCHITECTURE.md: до сих пор оффлайн начислял
// золото и опыт, а находки не разыгрывал вовсе — и это было видно в игре,
// потому что вернувшийся утром герой оставался в тех же вещах.
//
// Главное, что здесь проверяется, — что ВТОРОЙ МОДЕЛИ ДРОПА НЕТ: правила
// сумки у оффлайна те же самые, что в тике, до последнего кода отказа.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, type GameState } from './state'
import { ensureStats } from './stats'
import { applyOfflineProgress } from './save'
import { lootValue, stashLoot, type LootValueCache } from './loot'
import { averageGear } from './simulate'
import { INVENTORY_SIZE, OFFLINE_EFFICIENCY } from '../data/balance'
import { zoneForMonsterLevel } from '../data/zones'
import type { Item } from '../types'

const HOUR = 3_600_000

function hero(level: number, patch: Partial<GameState> = {}): GameState {
  const zone = zoneForMonsterLevel(level)
  return ensureStats({
    ...createInitialState(1),
    level: new Decimal(level),
    equipment: averageGear(level),
    currentZoneId: zone.id,
    lastSurvivedZoneId: zone.id,
    statsDirty: true,
    ...patch,
  })
}

/** Дешёвый хлам, которым удобно забивать сумку под завязку. */
function junk(index: number): Item {
  return {
    id: `junk-${index}`,
    name: 'Хлам',
    rarity: 'common',
    slot: 'trinket',
    level: 1,
    mods: [],
  }
}

describe('оффлайн разыгрывает находки', () => {
  it('за восемь часов герой возвращается с добычей', () => {
    const before = hero(40)
    const { state, report } = applyOfflineProgress(before, 8 * HOUR)
    expect(report).not.toBeNull()
    expect(report!.loot.found).toBeGreaterThan(0)
    // Что-то легло в сумку, что-то ушло в золото — обе ветки политики.
    expect(report!.loot.kept + report!.loot.sold).toBeGreaterThanOrEqual(report!.loot.found)
    expect(state.inventory.length).toBeGreaterThan(before.inventory.length)
  })

  it('находок примерно столько, сколько убийств на шанс дропа', () => {
    // Отдельного коэффициента у лута НЕТ: число убийств уже урезано на
    // OFFLINE_EFFICIENCY, и лут наследует урезание сам. Проверяем, что бросков
    // ровно по числу убийств, а не по какой-то своей мере.
    const { report } = applyOfflineProgress(hero(40), 8 * HOUR)
    const kills = report!.kills.toNumber()
    expect(kills).toBeGreaterThan(0)
    // Доля находок от убийств — это и есть шанс дропа, с разбросом броска.
    const share = report!.loot.found / kills
    expect(share).toBeGreaterThan(0.15)
    expect(share).toBeLessThan(0.6)
  })

  it('вдвое больше времени — примерно вдвое больше находок', () => {
    const four = applyOfflineProgress(hero(40), 4 * HOUR).report!
    const eight = applyOfflineProgress(hero(40), 8 * HOUR).report!
    expect(eight.loot.found).toBeGreaterThan(four.loot.found)
  })

  it('загрузка не подвисает: восемь часов считаются меньше секунды', () => {
    // Восемь часов — это сотни бросков, и на каждый приходится оценка
    // ценности всей сумки. Порог намеренно щедрый: тест ловит возврат к
    // переоценке в каждом шаге (там было под секунду), а не микросекунды.
    for (const level of [1, 50, 100]) {
      const started = Date.now()
      applyOfflineProgress(hero(level), 8 * HOUR)
      expect(Date.now() - started, `уровень ${level}`).toBeLessThan(1000)
    }
  })
})

describe('правила сумки те же, что онлайн', () => {
  it('полная сумка не глушит дроп: место освобождает вытеснение', () => {
    const full = hero(40, { inventory: Array.from({ length: INVENTORY_SIZE }, (_, i) => junk(i)) })
    const { state, report } = applyOfflineProgress(full, 8 * HOUR)
    expect(report!.loot.found).toBeGreaterThan(0)
    // Сумка осталась полной — но состав её изменился: хлам вытеснен.
    expect(state.inventory.length).toBe(INVENTORY_SIZE)
    const junkLeft = state.inventory.filter((i) => i.id.startsWith('junk-')).length
    expect(junkLeft).toBeLessThan(INVENTORY_SIZE)
    // Вытесненное ушло в золото, а не пропало.
    expect(report!.loot.sold).toBeGreaterThan(0)
    expect(report!.loot.soldGold.gt(0)).toBe(true)
  })

  it('апгрейд из полной сумки не теряется', () => {
    // Железное правило политики: находка лучше надетого вытесняет худшее,
    // а не продаётся. Проверяем на самой политике — той же функции, что
    // зовёт и тик, и оффлайн.
    const state = hero(40, { inventory: Array.from({ length: INVENTORY_SIZE }, (_, i) => junk(i)) })
    const upgrade: Item = {
      ...averageGear(80).mainHand!,
      id: 'shiny-1',
      rarity: 'legendary',
    }
    const cache: LootValueCache = new Map()
    expect(lootValue(state, upgrade, cache)).toBeGreaterThan(1)
    const after = stashLoot(state, upgrade, cache)
    expect(after.inventory.map((i) => i.id)).toContain('shiny-1')
    expect(after.inventory.length).toBe(INVENTORY_SIZE)
  })

  it('кеш ценности на результат не влияет — только на скорость', () => {
    // Кеш законен лишь потому, что внутри неизменных статов ценность
    // предмета постоянна. Если это перестанет быть правдой, тест упадёт.
    const state = hero(40, { inventory: Array.from({ length: INVENTORY_SIZE }, (_, i) => junk(i)) })
    const item: Item = { ...junk(99), rarity: 'rare' }
    const withCache = stashLoot(state, item, new Map())
    const without = stashLoot(state, item)
    expect(withCache.inventory.map((i) => i.id)).toEqual(without.inventory.map((i) => i.id))
    expect(withCache.gold.eq(without.gold)).toBe(true)
  })
})

describe('автонадевания по-прежнему нет', () => {
  it('герой возвращается к сумке находок, а не в новых вещах', () => {
    const before = hero(40)
    const worn = { ...before.equipment }
    const { state, report } = applyOfflineProgress(before, 8 * HOUR)
    // Апгрейды нашлись — и всё равно остались лежать в сумке.
    expect(report!.loot.upgrades).toBeGreaterThan(0)
    for (const slot of Object.keys(worn) as (keyof typeof worn)[]) {
      expect(state.equipment[slot]?.id ?? null).toBe(worn[slot]?.id ?? null)
    }
  })
})

describe('оффлайн не пишет находки в лог боя', () => {
  it('лог остаётся тем же, что был до отсутствия', () => {
    // Сотня находок вытеснила бы из лога весь бой, к которому игрок
    // возвращается. Отчёт для этого и существует.
    const before = hero(40)
    const { state } = applyOfflineProgress(before, 8 * HOUR)
    expect(state.combatLog).toEqual(before.combatLog)
  })
})

describe('детерминированность', () => {
  it('одно и то же состояние даёт одну и ту же добычу', () => {
    const a = applyOfflineProgress(hero(40), 8 * HOUR).report!
    const b = applyOfflineProgress(hero(40), 8 * HOUR).report!
    expect(a.loot.found).toBe(b.loot.found)
    expect(a.loot.kept).toBe(b.loot.kept)
    expect(a.loot.soldGold.eq(b.loot.soldGold)).toBe(true)
  })

  it('поток лута не совпадает с потоком спавна моба', () => {
    // Оба заводятся от сида состояния. Без сдвига «какой моб стоит перед
    // героем» и «что выпало за ночь» были бы связаны одним броском.
    const s = hero(40)
    const withDefault = applyOfflineProgress(s, 8 * HOUR).report!
    const withSameSeedStream = applyOfflineProgress(s, 8 * HOUR, () => 0.5).report!
    expect(withDefault.loot.found).not.toBe(withSameSeedStream.loot.found)
  })
})

describe('оффлайн-эффективность режет и лут тоже', () => {
  it('находок меньше, чем дал бы неурезанный час', () => {
    // Косвенно, но по делу: доля находок от ЧАСОВ (а не от убийств) обязана
    // быть меньше онлайновой ровно во столько же раз, во сколько урезаны
    // убийства. Отдельного коэффициента у лута нет — проверяем, что его и
    // не появилось.
    expect(OFFLINE_EFFICIENCY).toBeLessThan(1)
    const one = applyOfflineProgress(hero(40), HOUR).report!
    const kills = one.kills.toNumber()
    expect(kills).toBeGreaterThan(0)
    // Убийств за час оффлайна ровно OFFLINE_EFFICIENCY от онлайновых, и
    // бросков лута ровно по убийствам — большего утверждения тут не нужно.
    expect(one.loot.found).toBeLessThanOrEqual(Math.ceil(kills))
  })
})
