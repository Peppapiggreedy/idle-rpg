// Дерево талантов — данные. Ни одного «если талант такой-то» в логике:
// талант либо выдаёт модификаторы в конвейер статов, либо поднимает флаг,
// а поведение по флагу описано там же, в данных.
import { Decimal } from '../game/numbers'
import type { StatModifier } from '../game/stats'
import type { AbilityEffect } from './abilities'


export type BranchId = 'fury' | 'endurance'

export interface BranchDef {
  id: BranchId
  name: string
}

export const BRANCHES: BranchDef[] = [
  { id: 'fury', name: 'Ярость' },
  { id: 'endurance', name: 'Стойкость' },
]

// Модификатор таланта БЕЗ source: source проставляется как 'talent:<id>',
// а значение умножается на вложенный ранг.
export type TalentModifier = Omit<StatModifier, 'source'>

// Флаги включают поведение, которое модификатором не выразить.
export type TalentFlag =
  // Скорый выпад начинает накладывать урон по времени.
  | 'quick-strike-bleeds'
  // Воскрешение занимает вдвое меньше времени.
  | 'halved-revive'

export type TalentEffect =
  | { kind: 'modifiers'; mods: TalentModifier[] }
  // Флаг включается с первого ранга; payload описывает, ЧТО он включает.
  | { kind: 'flag'; flag: 'quick-strike-bleeds'; abilityId: string; effect: AbilityEffect }
  | { kind: 'flag'; flag: 'halved-revive'; reviveMultiplier: number }

export interface TalentDef {
  id: string
  name: string
  branch: BranchId
  row: number // ряд в ветке, 1 — верхний
  maxRank: number
  requiredPointsInBranch: number // сколько очков нужно вложить в ветку до него
  effect: TalentEffect
}

export const TALENTS: TalentDef[] = [
  {
    id: 'honed-edge',
    name: 'Отточенный клинок',
    branch: 'fury',
    row: 1,
    maxRank: 5,
    requiredPointsInBranch: 0,
    effect: {
      kind: 'modifiers',
      mods: [{ stat: 'attackPower', kind: 'percent', value: new Decimal(0.04) }],
    },
  },
  {
    id: 'keen-eye',
    name: 'Острый глаз',
    branch: 'fury',
    row: 2,
    maxRank: 3,
    requiredPointsInBranch: 5,
    effect: {
      kind: 'modifiers',
      mods: [{ stat: 'critChance', kind: 'flat', value: new Decimal(0.03) }],
    },
  },
  {
    id: 'savage-blows',
    name: 'Свирепые удары',
    branch: 'fury',
    row: 3,
    maxRank: 3,
    requiredPointsInBranch: 8,
    effect: {
      kind: 'modifiers',
      mods: [{ stat: 'critMultiplier', kind: 'flat', value: new Decimal(0.25) }],
    },
  },
  {
    id: 'rupture',
    name: 'Рваный выпад',
    branch: 'fury',
    row: 4,
    maxRank: 1,
    requiredPointsInBranch: 11,
    // Пример «флага»: умение начинает вести себя иначе, а не просто бьёт сильнее.
    effect: {
      kind: 'flag',
      flag: 'quick-strike-bleeds',
      abilityId: 'quick-strike',
      effect: {
        kind: 'damageOverTime',
        weaponDamagePercent: new Decimal(0.35),
        ticks: 3,
        tickIntervalSec: 1.5,
      },
    },
  },
  {
    id: 'thick-hide',
    name: 'Толстая шкура',
    branch: 'endurance',
    row: 1,
    maxRank: 5,
    requiredPointsInBranch: 0,
    effect: {
      kind: 'modifiers',
      mods: [{ stat: 'maxHp', kind: 'percent', value: new Decimal(0.06) }],
    },
  },
  {
    id: 'second-wind',
    name: 'Второе дыхание',
    branch: 'endurance',
    row: 2,
    maxRank: 3,
    requiredPointsInBranch: 5,
    effect: {
      kind: 'modifiers',
      mods: [{ stat: 'hpRegen', kind: 'flat', value: new Decimal(2) }],
    },
  },
  {
    id: 'clear-mind',
    name: 'Ясный ум',
    branch: 'endurance',
    row: 3,
    maxRank: 3,
    requiredPointsInBranch: 8,
    effect: {
      kind: 'modifiers',
      mods: [
        { stat: 'manaRegen', kind: 'flat', value: new Decimal(1) },
        { stat: 'damageReduction', kind: 'flat', value: new Decimal(0.02) },
      ],
    },
  },
  {
    id: 'swift-return',
    name: 'Скорое возвращение',
    branch: 'endurance',
    row: 4,
    maxRank: 1,
    requiredPointsInBranch: 11,
    effect: { kind: 'flag', flag: 'halved-revive', reviveMultiplier: 0.5 },
  },
]

export const TALENT_BY_ID: Record<string, TalentDef> = Object.fromEntries(
  TALENTS.map((t) => [t.id, t]),
)

export function talentsInBranch(branch: BranchId): TalentDef[] {
  return TALENTS.filter((t) => t.branch === branch).sort((a, b) => a.row - b.row)
}

/** Вложенный ранг с обрезкой по maxRank: мусор из сейва не даст лишнего. */
export function rankOf(ranks: Record<string, number>, talentId: string): number {
  const rank = ranks[talentId]
  const max = TALENT_BY_ID[talentId]?.maxRank ?? 0
  if (typeof rank !== 'number' || !Number.isFinite(rank) || rank <= 0) return 0
  return Math.min(Math.floor(rank), max)
}

/**
 * Ранги -> модификаторы конвейера статов. Чистая производная от данных, как
 * buildMonster: значение множится на ранг, source — 'talent:<id>', поэтому
 * раскладка на панели статов показывает таланты построчно.
 */
export function talentModifiers(ranks: Record<string, number>): StatModifier[] {
  const mods: StatModifier[] = []
  for (const talent of TALENTS) {
    const rank = rankOf(ranks, talent.id)
    if (rank <= 0 || talent.effect.kind !== 'modifiers') continue
    for (const mod of talent.effect.mods) {
      mods.push({ ...mod, value: mod.value.times(rank), source: `talent:${talent.id}` })
    }
  }
  return mods
}
