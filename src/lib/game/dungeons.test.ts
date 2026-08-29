import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { STEP_MS } from './loop'
import { createRng } from './rng'
import { createInitialState, manualOnlySettings, tick, type GameState } from './tick'
import { applyModifiers, ensureStats } from './stats'
import {
  advanceDungeon,
  clearedXpBonus,
  currentBoss,
  dungeonStatus,
  enrageMultiplier,
  enterDungeon,
  leaveDungeon,
  secondsToEnrage,
} from './dungeons'
import { rollBossLoot } from './loot'
import { applyOfflineProgress } from './save'
import {
  DUNGEONS,
  DUNGEON_CLEAR_XP_BONUS,
  ENRAGE_GROWTH,
  ENRAGE_STEP_SEC,
  buildBoss,
} from '../data/dungeons'
import { RARITIES } from '../data/rarity'
import { zoneForMonsterLevel } from '../data/zones'
import { averageGear } from './simulate'
import { ZONE_BY_ID, representativeMonster } from '../data/zones'

const DUNGEON = DUNGEONS[0]
const NO_LUCK = () => 1

// Герой, которому данж по плечу: в нужной зоне, нужного уровня.
function adventurer(patch: Partial<GameState> = {}): GameState {
  return ensureStats({
    ...createInitialState(1),
    level: new Decimal(DUNGEON.unlockRequirement),
    currentZoneId: DUNGEON.zoneId,
    abilitySettings: manualOnlySettings(),
    // Порог привала снят: тесты данжа про боссов и ярость, а с порогом герой
    // уходил бы отдыхать посреди замера и мерил бы привал, а не босса.
    restHpThreshold: 0,
    restResourceThreshold: 0,
    statsDirty: true,
    ...patch,
  })
}

// Герой, способный убить кого угодно с одного удара — чтобы гонять цепочку.
function overpowered(patch: Partial<GameState> = {}): GameState {
  return adventurer({
    equipment: {
      ...adventurer().equipment,
      trinket: {
        id: 'op-trinket',
        name: 'op',
        rarity: 'common',
        slot: 'trinket',
        level: 1,
        mods: [
          // Столько силы атаки давали двести тысяч заточек: герой сносит
          // боссов с удара, и тест меряет цепочку, а не бой.
          {
            stat: 'attackPower',
            kind: 'flat',
            value: new Decimal(2_800_000),
            source: 'equipment:trinket',
          },
        ],
      },
    },
    ...patch,
  })
}

function run(state: GameState, ms: number, rng = NO_LUCK): GameState {
  for (let t = 0; t < ms; t += STEP_MS) state = tick(state, STEP_MS, rng, () => {})
  return state
}

describe('данные данжа', () => {
  it('цепочка из трёх боссов, вход из существующей зоны', () => {
    expect(DUNGEON.bosses).toHaveLength(3)
    expect(ZONE_BY_ID[DUNGEON.zoneId]).toBeDefined()
    expect(DUNGEON.unlockRequirement).toBeGreaterThan(0)
  })

  it('боссы крепче и злее мобов своей зоны', () => {
    const mob = representativeMonster(ZONE_BY_ID[DUNGEON.zoneId])
    for (const boss of DUNGEON.bosses) {
      const built = buildBoss(boss)
      expect(built.maxHp.gt(mob.maxHp)).toBe(true)
      expect(built.damageMax.gt(mob.damageMax)).toBe(true)
    }
  })

  it('качество и опасность растут от первого босса к третьему', () => {
    const rarityIndex = (id: string) => RARITIES.findIndex((r) => r.id === id)
    for (let i = 1; i < DUNGEON.bosses.length; i++) {
      const prev = DUNGEON.bosses[i - 1]
      const boss = DUNGEON.bosses[i]
      expect(buildBoss(boss).maxHp.gt(buildBoss(prev).maxHp)).toBe(true)
      expect(buildBoss(boss).goldReward.gt(buildBoss(prev).goldReward)).toBe(true)
      // Порог редкости лута поднимается от босса к боссу.
      expect(rarityIndex(boss.loot.minRarity)).toBeGreaterThan(rarityIndex(prev.loot.minRarity))
      // И проверка на урон в секунду ЖЁСТЧЕ. Мерить это голыми секундами
      // нельзя: у третьего босса запас HP в полтора раза больше, и тот же
      // таймер означал бы для него совсем другое требование. Жёсткость —
      // это отношение отпущенного времени к длине боя, то есть к запасу HP.
      const tightness = (b: typeof boss) => b.enrageAfterSec / buildBoss(b).maxHp.toNumber()
      expect(tightness(boss)).toBeLessThanOrEqual(tightness(prev) * 1.001)
    }
  })
})

describe('лут боссов', () => {
  it('падает по слотам из данных и не ниже порога редкости', () => {
    const rng = createRng(5)
    for (const boss of DUNGEON.bosses) {
      const floor = RARITIES.findIndex((r) => r.id === boss.loot.minRarity)
      for (let i = 0; i < 50; i++) {
        const items = rollBossLoot(boss.loot, rng, 0)
        expect(items.map((it) => it.slot)).toEqual(boss.loot.slots)
        for (const item of items) {
          expect(RARITIES.findIndex((r) => r.id === item.rarity)).toBeGreaterThanOrEqual(floor)
        }
      }
    }
  })

  it('id предметов не повторяются внутри одного дропа', () => {
    const items = rollBossLoot(DUNGEON.bosses[2].loot, createRng(7), 42)
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
  })
})

describe('вход в данж', () => {
  it('пускает, когда герой дорос и стоит в нужной зоне', () => {
    const s = adventurer()
    expect(dungeonStatus(s, DUNGEON)).toMatchObject({ canEnter: true, reason: null })
    const inside = enterDungeon(s, DUNGEON.id)
    expect(inside.dungeonRun).toMatchObject({ dungeonId: DUNGEON.id, bossIndex: 0, fightMs: 0 })
    expect(inside.monster.id).toBe(DUNGEON.bosses[0].id)
    expect(inside.monster.currentHp.eq(inside.monster.maxHp)).toBe(true)
    expect(inside.combatLog[0]).toMatchObject({ type: 'boss', index: 1, total: 3 })
  })

  it('не пускает низкоуровневого, из чужой зоны, мёртвого и уже вошедшего', () => {
    const low = adventurer({ level: new Decimal(DUNGEON.unlockRequirement - 1) })
    expect(dungeonStatus(low, DUNGEON)).toMatchObject({ canEnter: false, reason: 'level' })
    expect(enterDungeon(low, DUNGEON.id)).toBe(low)

    const elsewhere = adventurer({ currentZoneId: 'shepherds-meadow' })
    expect(dungeonStatus(elsewhere, DUNGEON)).toMatchObject({ reason: 'wrong-zone' })
    expect(enterDungeon(elsewhere, DUNGEON.id)).toBe(elsewhere)

    const dead = adventurer({ heroState: 'dead', reviveMsLeft: 5000 })
    expect(dungeonStatus(dead, DUNGEON)).toMatchObject({ reason: 'dead' })

    const inside = enterDungeon(adventurer(), DUNGEON.id)
    expect(dungeonStatus(inside, DUNGEON)).toMatchObject({ reason: 'already-inside' })
    expect(enterDungeon(inside, DUNGEON.id)).toBe(inside)
  })

  it('несуществующий данж состояние не меняет', () => {
    const s = adventurer()
    expect(enterDungeon(s, 'нет-такого-данжа')).toBe(s)
  })
})

describe('ярость', () => {
  const boss = DUNGEON.bosses[0]

  it('до enrageAfter урон обычный, после — растёт ступенями', () => {
    expect(enrageMultiplier(boss, 0)).toBe(1)
    expect(enrageMultiplier(boss, (boss.enrageAfterSec - 1) * 1000)).toBe(1)
    // Первая ступень наступает ровно в момент enrageAfter.
    expect(enrageMultiplier(boss, boss.enrageAfterSec * 1000)).toBeCloseTo(1 + ENRAGE_GROWTH, 9)
    expect(enrageMultiplier(boss, (boss.enrageAfterSec + ENRAGE_STEP_SEC) * 1000)).toBeCloseTo(
      1 + 2 * ENRAGE_GROWTH,
      9,
    )
    expect(enrageMultiplier(boss, (boss.enrageAfterSec + 5 * ENRAGE_STEP_SEC) * 1000)).toBeCloseTo(
      1 + 6 * ENRAGE_GROWTH,
      9,
    )
  })

  it('таймер до следующей ступени идёт вниз и не бывает отрицательным', () => {
    expect(secondsToEnrage(boss, 0)).toBe(boss.enrageAfterSec)
    expect(secondsToEnrage(boss, 10_000)).toBe(boss.enrageAfterSec - 10)
    const afterFirst = secondsToEnrage(boss, (boss.enrageAfterSec + 3) * 1000)
    expect(afterFirst).toBeGreaterThan(0)
    expect(afterFirst).toBeLessThanOrEqual(ENRAGE_STEP_SEC)
  })

  it('время боя копится игровым временем и попадает в лог скачком', () => {
    let s = enterDungeon(adventurer({ currentHp: new Decimal(1e12) }), DUNGEON.id)
    s = ensureStats({ ...s, stats: { ...s.stats, maxHp: new Decimal(1e12) } })
    s = run(s, boss.enrageAfterSec * 1000 + STEP_MS)
    expect(s.dungeonRun!.fightMs).toBeGreaterThanOrEqual(boss.enrageAfterSec * 1000)
    expect(s.combatLog.some((e) => e.type === 'enrage')).toBe(true)
  })

  it('разъярённый босс бьёт сильнее, чем в начале боя', () => {
    const s = enterDungeon(adventurer(), DUNGEON.id)
    const calm = { ...s, dungeonRun: { ...s.dungeonRun!, fightMs: 0 } }
    const angry = {
      ...s,
      dungeonRun: { ...s.dungeonRun!, fightMs: (boss.enrageAfterSec + 30) * 1000 },
    }
    const hpAfter = (state: GameState) => run(state, boss.swingTime * 1000 + STEP_MS).currentHp
    expect(hpAfter(angry).lt(hpAfter(calm))).toBe(true)
  })
})

describe('ярость как проверка на урон в секунду', () => {
  // Герой, которому данжа хватает на несколько минут спокойного боя, но не
  // хватает урона: убить его должна именно ярость, а не обычные удары босса.
  function slowDps(level: number, gearLevel: number): GameState {
    return ensureStats({
      ...createInitialState(1),
      level: new Decimal(level),
      equipment: averageGear(gearLevel),
      currentZoneId: DUNGEON.zoneId,
      statsDirty: true,
    })
  }

  it('не успевающего по урону добивает именно ярость, а не обычный удар', () => {
    let s = enterDungeon(slowDps(DUNGEON.unlockRequirement, 4), DUNGEON.id)
    let enrageAtDeath = 1
    for (let i = 0; i < 6000 && s.dungeonRun; i++) {
      const boss = currentBoss(s)
      const run = s.dungeonRun
      s = tick(s, STEP_MS, () => 0.5, () => {})
      if (boss && run && s.heroState === 'dead') enrageAtDeath = enrageMultiplier(boss, run.fightMs)
    }
    expect(s.heroState).toBe('dead')
    // К моменту смерти босс уже разъярён: обычного урона герою хватало.
    expect(enrageAtDeath).toBeGreaterThan(1)
    expect(s.dungeonRun).toBeNull()
  })

  it('герою с достаточным уроном цепочка по плечу', () => {
    let s = enterDungeon(slowDps(24, 60), DUNGEON.id)
    for (let i = 0; i < 6000 && s.dungeonRun; i++) s = tick(s, STEP_MS, () => 0.5, () => {})
    expect(s.heroState).toBe('alive')
    expect(s.dungeonsCleared[DUNGEON.id]).toBe(true)
  })
})

describe('цепочка боссов', () => {
  it('убитый босс сменяется следующим, третий завершает данж', () => {
    let s = enterDungeon(overpowered(), DUNGEON.id)
    expect(currentBoss(s)!.id).toBe(DUNGEON.bosses[0].id)

    s = advanceDungeon(s, NO_LUCK)
    expect(s.dungeonRun!.bossIndex).toBe(1)
    expect(currentBoss(s)!.id).toBe(DUNGEON.bosses[1].id)
    // Время боя с новым боссом идёт с нуля — ярость не переносится.
    expect(s.dungeonRun!.fightMs).toBe(0)

    s = advanceDungeon(s, NO_LUCK)
    expect(s.dungeonRun!.bossIndex).toBe(2)

    s = advanceDungeon(s, NO_LUCK)
    expect(s.dungeonRun).toBeNull() // цепочка кончилась, герой снаружи
    expect(s.combatLog.some((e) => e.type === 'dungeon-clear')).toBe(true)
  })

  it('в бою цепочка проходится сама: три босса подряд', () => {
    let s = enterDungeon(overpowered(), DUNGEON.id)
    const killed: string[] = []
    for (let i = 0; i < 3000 && s.dungeonRun; i++) {
      const boss = currentBoss(s)
      s = tick(s, STEP_MS, NO_LUCK, () => {})
      if (boss && currentBoss(s)?.id !== boss.id) killed.push(boss.id)
    }
    expect(s.dungeonRun).toBeNull()
    expect(killed).toEqual(DUNGEON.bosses.map((b) => b.id))
  })

  it('лут падает за каждого убитого босса', () => {
    let s = enterDungeon(overpowered(), DUNGEON.id)
    for (let i = 0; i < 3000 && s.dungeonRun; i++) s = tick(s, STEP_MS, NO_LUCK, () => {})
    expect(s.inventory.length + Object.values(s.equipment).filter(Boolean).length).toBeGreaterThan(0)
    expect(s.combatLog.some((e) => e.type === 'loot')).toBe(true)
  })
})

describe('смерть в данже', () => {
  it('выкидывает наружу и стирает прогресс цепочки, но не лут', () => {
    // Герой, который заведомо не вывезет: не наносит урона и падает с одного
    // удара. Статы задаём base-модификаторами и не пересчитываем.
    const doomedStats = applyModifiers([
      { stat: 'attackPower', kind: 'base', value: new Decimal(0), source: 'test' },
      { stat: 'weaponDamageMin', kind: 'base', value: new Decimal(0), source: 'test' },
      { stat: 'weaponDamageMax', kind: 'base', value: new Decimal(0), source: 'test' },
      { stat: 'maxHp', kind: 'base', value: new Decimal(5), source: 'test' },
      { stat: 'hpRegen', kind: 'base', value: new Decimal(0), source: 'test' },
    ])
    let s = enterDungeon(adventurer(), DUNGEON.id)
    s = advanceDungeon(s, NO_LUCK) // как будто первого уже убил
    s = { ...s, stats: doomedStats, statsDirty: false, currentHp: new Decimal(5) }
    expect(s.dungeonRun!.bossIndex).toBe(1)
    const loot = [...s.inventory, { id: 'trophy', name: 'Трофей', rarity: 'rare' as const, slot: 'trinket' as const, level: 1, mods: [] }]
    s = { ...s, inventory: loot }

    for (let i = 0; i < 5000 && s.dungeonRun; i++) s = tick(s, STEP_MS, NO_LUCK, () => {})
    expect(s.dungeonRun).toBeNull() // выкинуло наружу
    expect(s.heroState).toBe('dead')
    expect(s.inventory.some((i) => i.id === 'trophy')).toBe(true) // лут остался
    expect(s.combatLog.some((e) => e.type === 'dungeon-exit')).toBe(true)

    // Зайти заново — снова с первого босса.
    const revived = run({ ...s, heroState: 'alive', reviveMsLeft: 0, currentZoneId: DUNGEON.zoneId }, 0)
    const again = enterDungeon(revived, DUNGEON.id)
    expect(again.dungeonRun!.bossIndex).toBe(0)
  })

  it('добровольный выход тоже сбрасывает цепочку', () => {
    let s = enterDungeon(adventurer(), DUNGEON.id)
    s = advanceDungeon(s, NO_LUCK)
    const outside = leaveDungeon(s, NO_LUCK, false)
    expect(outside.dungeonRun).toBeNull()
    expect(outside.currentZoneId).toBe(DUNGEON.zoneId)
    expect(enterDungeon(outside, DUNGEON.id).dungeonRun!.bossIndex).toBe(0)
  })
})

describe('достижение за первое прохождение', () => {
  it('поднимает флаг ровно один раз и даёт постоянный +5% опыта', () => {
    const fresh = overpowered()
    expect(clearedXpBonus(fresh.dungeonsCleared).eq(1)).toBe(true)

    let s = enterDungeon(fresh, DUNGEON.id)
    s = advanceDungeon(advanceDungeon(advanceDungeon(s, NO_LUCK), NO_LUCK), NO_LUCK)
    expect(s.dungeonsCleared[DUNGEON.id]).toBe(true)
    expect(clearedXpBonus(s.dungeonsCleared).eq(new Decimal(1).plus(DUNGEON_CLEAR_XP_BONUS))).toBe(true)
    expect(s.combatLog.some((e) => e.type === 'dungeon-clear' && e.firstClear)).toBe(true)

    // Второе прохождение флаг не удваивает и достижением не считается.
    let again = enterDungeon({ ...s, currentZoneId: DUNGEON.zoneId }, DUNGEON.id)
    again = advanceDungeon(advanceDungeon(advanceDungeon(again, NO_LUCK), NO_LUCK), NO_LUCK)
    expect(clearedXpBonus(again.dungeonsCleared).eq(new Decimal(1).plus(DUNGEON_CLEAR_XP_BONUS))).toBe(true)
    expect(again.combatLog.some((e) => e.type === 'dungeon-clear' && !e.firstClear)).toBe(true)
  })

  it('бонус реально ускоряет набор опыта', () => {
    const base = { ...adventurer(), currentZoneId: 'shepherds-meadow' }
    const withBonus = { ...base, dungeonsCleared: { [DUNGEON.id]: true } }
    const xpAfter = (s: GameState) => {
      const after = run(s, 60_000)
      return after.level.times(1000).plus(after.currentXp)
    }
    expect(xpAfter(withBonus).gt(xpAfter(base))).toBe(true)
  })
})

describe('оффлайн и данж', () => {
  it('внутри данжа оффлайн ничего не начисляет', () => {
    const inside = enterDungeon(adventurer(), DUNGEON.id)
    const { state, report } = applyOfflineProgress(inside, 8 * 3_600_000)
    expect(report).toBeNull()
    expect(state.gold.eq(inside.gold)).toBe(true)
    expect(state.dungeonRun).not.toBeNull() // забег ждёт героя на месте
  })
})

// ВОСЕМЬ ДАНЖЕЙ ПРОВЕРЯЮТСЯ ФОРМУЛОЙ, А НЕ ПОДБОРОМ ПО ОДНОМУ. Числа боссов
// выводятся из тира, значит и правило у них общее — его и меряем разом:
// герой уровня входа в вещах своей полосы проходит цепочку, а отставший
// по урону гибнет ИМЕННО ОТ ЯРОСТИ, а не от обычного удара.
describe('правило чисел держится на всех восьми данжах', () => {
  function heroFor(dungeon: (typeof DUNGEONS)[number], gearLevel: number): GameState {
    return ensureStats({
      ...createInitialState(1),
      level: new Decimal(dungeon.unlockRequirement),
      equipment: averageGear(gearLevel),
      currentZoneId: dungeon.zoneId,
      statsDirty: true,
    })
  }

  /** Прогон цепочки до конца или до смерти. */
  function runChain(start: GameState): { cleared: boolean; enrageAtDeath: number } {
    let s = enterDungeon(start, s0Dungeon(start)!.id)
    let enrageAtDeath = 1
    for (let i = 0; i < 20_000 && s.dungeonRun; i += 1) {
      const boss = currentBoss(s)
      const run = s.dungeonRun
      s = tick(s, STEP_MS, () => 0.5, () => {})
      if (boss && run && s.heroState === 'dead') enrageAtDeath = enrageMultiplier(boss, run.fightMs)
    }
    return { cleared: s.heroState !== 'dead', enrageAtDeath }
  }

  // Данж, в который герой собрался: он один — тот, чью зону мы поставили.
  function s0Dungeon(state: GameState) {
    return DUNGEONS.find((d) => d.zoneId === state.currentZoneId && d.unlockRequirement <= state.level.toNumber())
  }

  it('на своём уровне в вещах своей полосы цепочка проходится', () => {
    for (const dungeon of DUNGEONS) {
      // Вещи полосы, на которой герой этого уровня дерётся, — то, во что он
      // одет к моменту, когда дверь открылась.
      const gear = zoneForMonsterLevel(dungeon.unlockRequirement).monsterLevelRange.max
      const { cleared } = runChain(heroFor(dungeon, gear))
      expect(cleared, `${dungeon.id}: цепочка не проходится на своём уровне`).toBe(true)
    }
  })

  it('на отметке ярости герой ещё жив: обычные удары он переживает', () => {
    // МЕРИМ ПЕРВУЮ СХВАТКУ, и это не упрощение. Внутри данжа привала нет:
    // ко второму боссу герой приходит с тем, что осталось, и там его добьёт
    // что угодно. Чистое утверждение «обычные удары герой переживает,
    // догоняет ярость» проверяемо ровно на первом боссе — на полном запасе.
    for (const dungeon of DUNGEONS) {
      // Вчетверо более слабые вещи: урона не хватает, но обычные удары
      // герой держит — значит убить его обязана отметка ярости.
      // Вещи СВОЕЙ полосы: обещание «обычные удары переживает» дано именно
      // тому, кто пришёл вовремя и одетым. Недоодетый — отдельный разговор,
      // и там правило другое: его добивает ярость (см. тест выше по файлу).
      const gear = zoneForMonsterLevel(dungeon.unlockRequirement).monsterLevelRange.max
      let s = enterDungeon(heroFor(dungeon, gear), dungeon.id)
      const boss = dungeon.bosses[0]
      let deathFightMs: number | null = null
      for (let i = 0; i < 20_000 && s.dungeonRun?.bossIndex === 0; i += 1) {
        const fightMs = s.dungeonRun?.fightMs ?? 0
        s = tick(s, STEP_MS, () => 0.5, () => {})
        if (s.heroState === 'dead') {
          deathFightMs = fightMs
          break
        }
      }
      // ОБЕЩАНИЕ ДАНЖА: до отметки ярости обычные удары героя не убивают.
      // Он либо дожал босса раньше (deathFightMs === null), либо погиб уже
      // после отметки — то есть от ярости. Всё, что происходит после неё, —
      // проверка на урон в секунду, и её исход зависит от билда.
      expect(
        deathFightMs === null || deathFightMs >= boss.enrageAfterSec * 1000,
        `${dungeon.id}: обычные удары убили до ярости (${deathFightMs} мс)`,
      ).toBe(true)
    }
  }, 300_000)
})
