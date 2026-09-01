// Лестница данжей: одно правило, проверенное сразу по всем восьми.
//
// ПРАВИЛО: обычные удары герой переживает, догоняет ЯРОСТЬ. Герой уровня
// входа в средней экипировке своей зоны проходит всю цепочку подряд — внутри
// данжа привала нет, — и ни один босс не успевает разъяриться. Кто отстал по
// урону в секунду, в отметку ярости не укладывается, и дальше его добивает
// не сам босс, а его ярость.
//
// Своей модели боя здесь нет: длина схватки берётся из estimateCombatRate,
// входящий урон — из expectedMonsterDamage, ярость — из enrageMultiplier.
// Иначе тест мерил бы не ту игру, в которую играют.
import { describe, expect, it } from 'vitest'
import { RESPAWN_DELAY_MS } from '../../data/balance'
import {
  ALL_DUNGEONS,
  DUNGEONS,
  GEAR_SHARE_MARGIN,
  HEROIC_DUNGEONS,
  buildBoss,
  requiredGearShare,
  type BossDef,
} from '../../data/dungeons'
import { REAGENTS } from '../../data/reagents'
import { zoneForMonsterLevel } from '../../data/zones'
import { estimateCombatRate, expectedMonsterDamage } from '../combat'
import { enrageMultiplier } from '../dungeons'
import { monsterFromTemplate, type GameState } from '../state'
import { buildSimState, referenceBuild } from '../simulate'

/** Доля запаса, которая обязана остаться у героя после всей цепочки. */
const CHAIN_HP_LEFT_MIN = 0.15
/** Насколько раньше отметки ярости эталонный герой обязан укладываться. */
const ENRAGE_HEADROOM = 0.9
/** Насколько слабее эталона герой, которого ярость обязана добить.
 *  Половина урона: при 0.6 мелкие данжи ещё дожимаются впритык, при 0.5
 *  не проходит ни один — это и есть граница «отстал по урону». */
const BEHIND_DPS_SHARE = 0.5
/** Насколько слабее эталона герой, который обязан упереться в саму ярость. */
const ENRAGE_DPS_SHARE = 0.6

// Герой уровня входа: тот же эталонный билд, что и в контракте темпа.
// Привал снят намеренно — в данже его и нет.
function heroAtEntry(level: number): GameState {
  const zone = zoneForMonsterLevel(level)
  // Вещи СВОЕЙ полосы, а не «своей глубины». Эталон таблицы темпа одевает
  // героя по самой дальней ОТКРЫТОЙ зоне, и на двадцатом уровне это вещи
  // тридцать третьего — против боссов двадцатых такой герой не почувствует
  // данжа вовсе. Дверь открывается тому, кто дошёл, а не тому, кто забежал.
  const state = buildSimState(
    { ...referenceBuild(level), level, gearLevel: zone.monsterLevelRange.max },
    zone.id,
    4242,
  )
  return { ...state, restHpThreshold: 0, restResourceThreshold: 0 }
}

/** Герой уровня входа в вещах заданной ДОЛИ от верхнего моба зоны входа. */
function heroWithGearShare(dungeon: (typeof DUNGEONS)[number], share: number): GameState {
  const zone = zoneForMonsterLevel(dungeon.unlockRequirement)
  const gearLevel = Math.max(1, Math.round(zone.monsterLevelRange.max * share))
  const state = buildSimState(
    { ...referenceBuild(dungeon.unlockRequirement), level: dungeon.unlockRequirement, gearLevel },
    zone.id,
    4242,
  )
  return { ...state, restHpThreshold: 0, restResourceThreshold: 0 }
}

/** Средний множитель ярости за бой длиной sec: считается ТОЙ ЖЕ формулой. */
function averageEnrage(boss: BossDef, sec: number): number {
  const stepMs = 250
  let sum = 0
  let steps = 0
  for (let ms = 0; ms < sec * 1000; ms += stepMs) {
    sum += enrageMultiplier(boss, ms)
    steps += 1
  }
  return steps === 0 ? 1 : sum / steps
}

interface ChainResult {
  /** Доля запаса HP, оставшаяся после всех трёх схваток; меньше нуля — смерть. */
  hpLeftShare: number
  /** Худшее отношение «длина боя / отметка ярости» по цепочке. */
  worstEnrageRatio: number
  seconds: number
}

/** Цепочка боссов подряд: запас HP один на все три схватки. */
function runChain(state: GameState, bosses: BossDef[], dpsShare = 1): ChainResult {
  const maxHp = state.stats.maxHp.toNumber()
  const regen = state.stats.hpRegen.toNumber()
  let hp = maxHp
  let seconds = 0
  let worstEnrageRatio = 0
  for (const boss of bosses) {
    const monster = monsterFromTemplate(buildBoss(boss))
    const rate = estimateCombatRate({ ...state, monster }, 'auto')
    // idealKillsPerSecond — это 1 / (бой + респаун); сам бой получается вычитанием.
    const cycle = 1 / rate.idealKillsPerSecond.toNumber()
    const fight = Math.max(0, cycle - RESPAWN_DELAY_MS / 1000) / dpsShare
    const incoming = expectedMonsterDamage(monster, state.stats, state.level.toNumber()).toNumber() / boss.swingTime
    const loss = incoming * averageEnrage(boss, fight) - regen
    hp -= Math.max(0, loss) * fight
    seconds += fight
    worstEnrageRatio = Math.max(worstEnrageRatio, fight / boss.enrageAfterSec)
  }
  return { hpLeftShare: hp / maxHp, worstEnrageRatio, seconds }
}

describe('лестница данжей', () => {
  it('восемь ступеней: тиры подряд, вход каждые десять уровней', () => {
    expect(DUNGEONS.map((d) => d.tier)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(DUNGEONS.map((d) => d.unlockRequirement)).toEqual([20, 30, 40, 50, 60, 70, 80, 90])
    // Реагент на каждый тир КАЖДОЙ сложности, и ровно один: у героики свой,
    // иначе ходить в неё было бы незачем.
    const normalReagents = REAGENTS.filter((r) => r.difficulty === 'normal')
    const heroicReagents = REAGENTS.filter((r) => r.difficulty === 'heroic')
    expect(normalReagents.map((r) => r.tier)).toEqual(DUNGEONS.map((d) => d.tier))
    expect(heroicReagents.map((r) => r.tier)).toEqual(HEROIC_DUNGEONS.map((d) => d.tier))
    expect(new Set(ALL_DUNGEONS.map((d) => d.reagentId)).size).toBe(ALL_DUNGEONS.length)
  })

  it('таблица цепочек', () => {
    const rows = DUNGEONS.map((d) => {
      const chain = runChain(heroAtEntry(d.unlockRequirement), d.bosses)
      return {
        тир: d.tier,
        данж: d.name,
        вход: d.unlockRequirement,
        'боссы, ур.': d.bosses.map((b) => b.level).join('/'),
        'цепочка, с': Math.round(chain.seconds),
        'запас HP': chain.hpLeftShare.toFixed(2),
        'до ярости': chain.worstEnrageRatio.toFixed(2),
      }
    })
    console.table(rows)
    expect(rows).toHaveLength(8)
    // Своя рамка времени: таблица гоняет оценку боя по всем восьми цепочкам,
    // и на общем прогоне вместе с остальными файлами она не укладывалась
    // в стандартные пять секунд.
  }, 120_000)

  it.each(DUNGEONS.map((d) => [`${d.tier}. ${d.name}`, d] as const))(
    '%s: обычные удары герой переживает',
    (_title, dungeon) => {
      const chain = runChain(heroAtEntry(dungeon.unlockRequirement), dungeon.bosses)
      // Прошёл, и не впритык: запас — это место под неудачную рулетку урона.
      expect(chain.hpLeftShare).toBeGreaterThan(CHAIN_HP_LEFT_MIN)
      // И ни один босс не разъярился: ярость — не часть штатного прохождения.
      expect(chain.worstEnrageRatio).toBeLessThan(ENRAGE_HEADROOM)
    },
  )

  it.each(DUNGEONS.map((d) => [`${d.tier}. ${d.name}`, d] as const))(
    '%s: отставший по урону цепочку не проходит',
    (_title, dungeon) => {
      // Меряется на ПОГРАНИЧНОМ герое — том, для кого ворота и настроены
      // (requiredGearShare), а не на полностью одетом. У полностью одетого
      // запас такой, что отставание по урону он переживает просто временем:
      // урон боссов ниже его регенерации, и цепочка тянется, но не убивает.
      // Ворота проверяют того, кто пришёл к ним вовремя, а не того, кто
      // вернулся за ними через двадцать уровней.
      const hero = heroWithGearShare(dungeon, requiredGearShare(dungeon.tier))
      const chain = runChain(hero, dungeon.bosses, BEHIND_DPS_SHARE)
      expect(chain.hpLeftShare).toBeLessThan(0)
    },
  )

  it.each(DUNGEONS.map((d) => [`${d.tier}. ${d.name}`, d] as const))(
    '%s: отметка ярости достижима, а не нарисована',
    (_title, dungeon) => {
      // Ярость обязана быть НАСТОЯЩЕЙ проверкой урона в секунду: герой, который
      // отстал заметно, обязан до неё дожить и в неё упереться. Иначе отметка
      // стояла бы для красоты, а данж проверял бы одну живучесть.
      const chain = runChain(heroAtEntry(dungeon.unlockRequirement), dungeon.bosses, ENRAGE_DPS_SHARE)
      expect(chain.worstEnrageRatio).toBeGreaterThan(1)
    },
  )
})

// ---------------------------------------------------------------------------
// ЖЁСТКИЕ ВОРОТА: сколько экипировки нужно, чтобы пройти
// ---------------------------------------------------------------------------
//
// Данж закрывает две зоны, и не пройти его значит не пойти дальше. Поэтому
// требование к экипировке проверяется В ОБЕ СТОРОНЫ: с положенной долей
// цепочка проходится, с долей на GEAR_SHARE_MARGIN меньше — нет. Проверка
// в одну сторону пропустила бы данж, который проходится всегда, то есть
// перестал быть воротами вовсе.
describe('данж — жёсткие ворота, и требовательность растёт по тирам', () => {
  it('таблица требовательности', () => {
    const rows = DUNGEONS.map((d) => {
      const share = requiredGearShare(d.tier)
      const pass = runChain(heroWithGearShare(d, share), d.bosses)
      const fail = runChain(heroWithGearShare(d, share - GEAR_SHARE_MARGIN), d.bosses)
      const scan = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2]
        .map((x) => `${(x * 100).toFixed(0)}:${runChain(heroWithGearShare(d, x), d.bosses).hpLeftShare.toFixed(2)}`)
        .join(' ')
      return {
        тир: d.tier,
        данж: d.name,
        'нужно вещей': `${(share * 100).toFixed(0)}%`,
        'запас HP': pass.hpLeftShare.toFixed(2),
        'на 15 пп ниже': fail.hpLeftShare.toFixed(2),
        развёртка: scan,
      }
    })
    console.table(rows)
    expect(rows).toHaveLength(8)
  }, 300_000)

  it.each(DUNGEONS.map((d) => [`${d.tier}. ${d.name}`, d] as const))(
    '%s: с положенной долей экипировки проходится',
    (_title, dungeon) => {
      const chain = runChain(heroWithGearShare(dungeon, requiredGearShare(dungeon.tier)), dungeon.bosses)
      expect(chain.hpLeftShare).toBeGreaterThan(0)
    },
  )

  it.each(DUNGEONS.map((d) => [`${d.tier}. ${d.name}`, d] as const))(
    '%s: на 15 пунктов меньше экипировки — не проходится',
    (_title, dungeon) => {
      const share = requiredGearShare(dungeon.tier) - GEAR_SHARE_MARGIN
      const chain = runChain(heroWithGearShare(dungeon, share), dungeon.bosses)
      expect(chain.hpLeftShare).toBeLessThan(0)
    },
  )

  it('требовательность растёт от тира к тиру, а не стоит стеной', () => {
    const shares = DUNGEONS.map((d) => requiredGearShare(d.tier))
    for (let i = 1; i < shares.length; i += 1) {
      expect(shares[i], `тир ${DUNGEONS[i].tier}`).toBeGreaterThan(shares[i - 1])
    }
    expect(shares[0]).toBeCloseTo(0.6, 9)
    expect(shares[shares.length - 1]).toBeCloseTo(0.95, 9)
  })
})
