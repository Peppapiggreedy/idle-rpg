// ЗАГОЛОВОК МЕСТА. Главное, что здесь проверяется, — он собирается ИЗ ДАННЫХ:
// новая зона обязана появиться в нём сама, без правки компонента.
import { describe, expect, it } from 'vitest'
import { Decimal } from '../game/numbers'
import { createInitialState, type GameState } from '../game/state'
import { ensureStats } from '../game/stats'
import { enterDungeon } from '../game/dungeons'
import { enterTemple } from '../game/temple'
import { travelToZone } from '../game/zones'
import { createRng } from '../game/rng'
import { averageGear } from '../game/simulate'
import { ZONES } from '../data/zones'
import { DUNGEONS } from '../data/dungeons'
import { TEMPLE } from '../data/temple'
import { placeTitle, placeTitleText } from './placeText'

const RNG = createRng(1)

function hero(patch: Partial<GameState> = {}): GameState {
  return ensureStats({ ...createInitialState(1), statsDirty: true, ...patch })
}

describe('заголовок места', () => {
  it('зона: название и полоса уровней мобов', () => {
    const zone = ZONES[0]
    const t = placeTitle(hero())
    expect(t.name).toBe(zone.name)
    expect(t.detail).toBe(`${zone.monsterLevelRange.min}–${zone.monsterLevelRange.max}`)
    expect(placeTitleText(hero())).toBe(
      `${zone.name} (${zone.monsterLevelRange.min}–${zone.monsterLevelRange.max})`,
    )
  })

  it('КАЖДАЯ зона игры получает заголовок из своих данных', () => {
    // Тот самый тест, ради которого функция и вынесена: перечня зон здесь
    // нет, он обходится целиком. Добавили зону — она проверяется сама.
    for (const zone of ZONES) {
      const level = zone.monsterLevelRange.min
      const s = travelToZone(
        hero({ level: new Decimal(level), equipment: averageGear(level), statsDirty: true }),
        zone.id,
        RNG,
      )
      const t = placeTitle(ensureStats(s))
      expect(t.name, zone.id).toBe(zone.name)
      expect(t.detail, zone.id).toBe(
        `${zone.monsterLevelRange.min}–${zone.monsterLevelRange.max}`,
      )
    }
  })

  it('данж: название и место в цепочке боссов', () => {
    const d = DUNGEONS[0]
    const level = d.unlockRequirement
    const inside = enterDungeon(
      hero({
        level: new Decimal(level),
        equipment: averageGear(level),
        currentZoneId: d.zoneId,
        lastSurvivedZoneId: d.zoneId,
        statsDirty: true,
      }),
      d.id,
    )
    const t = placeTitle(inside)
    expect(t.name).toBe(d.name)
    expect(t.detail).toBe(`бой 1 из ${d.bosses.length}`)
    expect(placeTitleText(inside)).toBe(`${d.name}, бой 1 из ${d.bosses.length}`)
  })

  it('храм: название и этаж', () => {
    const level = TEMPLE.unlockRequirement
    const inside = enterTemple(
      hero({
        level: new Decimal(level),
        equipment: averageGear(level),
        currentZoneId: TEMPLE.zoneId,
        lastSurvivedZoneId: TEMPLE.zoneId,
        statsDirty: true,
      }),
    )
    const t = placeTitle(inside)
    expect(t.name).toBe(TEMPLE.name)
    expect(t.detail).toBe(`этаж ${inside.templeRun!.wave}`)
    expect(placeTitleText(inside)).toContain('этаж')
  })

  it('забег важнее зоны: внутри данжа заголовок про данж, а не про зону входа', () => {
    const d = DUNGEONS[0]
    const level = d.unlockRequirement
    const outside = hero({
      level: new Decimal(level),
      equipment: averageGear(level),
      currentZoneId: d.zoneId,
      lastSurvivedZoneId: d.zoneId,
      statsDirty: true,
    })
    expect(placeTitle(outside).name).not.toBe(d.name)
    expect(placeTitle(enterDungeon(outside, d.id)).name).toBe(d.name)
  })
})
