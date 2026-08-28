// Таланты: сколько очков есть, куда их можно вложить и что из этого выходит.
// Правила вложения живут здесь, эффекты — в данных: талант либо отдаёт
// модификаторы в конвейер статов, либо поднимает флаг, по которому меняется
// поведение. Текста для игрока здесь нет — наружу идут коды причин.
import { Decimal } from './numbers'
import {
  TALENTS,
  TALENT_BY_ID,
  rankOf,
  talentModifiers,
  talentsInBranch,
  type BranchId,
  type TalentDef,
  type TalentFlag,
} from '../data/talents'
import {
  TALENT_FIRST_LEVEL,
  TALENT_RESET_BASE_COST,
  TALENT_RESET_COST_GROWTH,
} from '../data/balance'
import { ensureStats } from './stats'
import type { GameState } from './state'

// Реэкспорт: чистые производные живут в данных, правила — здесь.
export { rankOf, talentModifiers } from '../data/talents'

export type TalentRanks = Record<string, number>

/** Сколько очков герой заработал за всю жизнь: по одному с TALENT_FIRST_LEVEL. */
export function earnedPoints(level: Decimal): number {
  const earned = level.minus(TALENT_FIRST_LEVEL - 1)
  return earned.lte(0) ? 0 : Math.floor(earned.toNumber())
}

export function spentPoints(ranks: TalentRanks): number {
  let total = 0
  for (const talent of TALENTS) total += rankOf(ranks, talent.id)
  return total
}

export function spentInBranch(ranks: TalentRanks, branch: BranchId): number {
  let total = 0
  for (const talent of talentsInBranch(branch)) total += rankOf(ranks, talent.id)
  return total
}

/** Нераспределённые очки. Никогда не отрицательные, даже если сейв подправили. */
export function availablePoints(state: GameState): number {
  return Math.max(0, earnedPoints(state.level) - spentPoints(state.talents))
}

// Почему очко сюда не вложить. Каждый случай — свой код, текст рендерит UI.
export type TalentBlockReason = 'no-points' | 'max-rank' | 'branch-locked'

export interface TalentStatus {
  talentId: string
  rank: number
  maxRank: number
  canInvest: boolean
  reason: TalentBlockReason | null
  pointsInBranch: number // сколько уже вложено в ветку
  requiredPointsInBranch: number
}

/**
 * Проверки идут в фиксированном порядке — от него зависит, какую причину
 * увидит игрок: сперва то, что не лечится ожиданием.
 */
export function talentStatus(state: GameState, talent: TalentDef): TalentStatus {
  const rank = rankOf(state.talents, talent.id)
  const pointsInBranch = spentInBranch(state.talents, talent.branch)
  const base = {
    talentId: talent.id,
    rank,
    maxRank: talent.maxRank,
    pointsInBranch,
    requiredPointsInBranch: talent.requiredPointsInBranch,
  }
  const blocked = (reason: TalentBlockReason) => ({ ...base, canInvest: false, reason })
  if (pointsInBranch < talent.requiredPointsInBranch) return blocked('branch-locked')
  if (rank >= talent.maxRank) return blocked('max-rank')
  if (availablePoints(state) <= 0) return blocked('no-points')
  return { ...base, canInvest: true, reason: null }
}

export function allTalentStatuses(state: GameState): TalentStatus[] {
  return TALENTS.map((t) => talentStatus(state, t))
}

/** Вложить одно очко. Недоступный талант состояние не меняет вовсе. */
export function investTalent(state: GameState, talentId: string): GameState {
  const talent = TALENT_BY_ID[talentId]
  if (!talent) return state
  if (!talentStatus(state, talent).canInvest) return state
  return ensureStats({
    ...state,
    talents: { ...state.talents, [talentId]: rankOf(state.talents, talentId) + 1 },
    statsDirty: true, // таланты — источник статов
  })
}

/** Цена очередного сброса: растёт с каждым уже сделанным сбросом. */
export function resetCost(state: GameState): Decimal {
  return TALENT_RESET_BASE_COST.times(TALENT_RESET_COST_GROWTH.pow(state.talentResets))
}

export function canResetTalents(state: GameState): boolean {
  return spentPoints(state.talents) > 0 && state.gold.gte(resetCost(state))
}

/** Сброс за золото: все ранги обнуляются, счётчик сбросов растёт. */
export function resetTalents(state: GameState): GameState {
  if (!canResetTalents(state)) return state
  return ensureStats({
    ...state,
    gold: state.gold.minus(resetCost(state)),
    talents: {},
    talentResets: state.talentResets + 1,
    statsDirty: true,
  })
}

/** Поднятые флаги: талант-флаг включается с первого же ранга. */
export function talentFlags(ranks: TalentRanks): Set<TalentFlag> {
  const flags = new Set<TalentFlag>()
  for (const talent of TALENTS) {
    if (talent.effect.kind !== 'flag') continue
    if (rankOf(ranks, talent.id) > 0) flags.add(talent.effect.flag)
  }
  return flags
}

export function hasTalentFlag(ranks: TalentRanks, flag: TalentFlag): boolean {
  return talentFlags(ranks).has(flag)
}

/**
 * Эффект, который талант добавляет умению (если такой талант взят).
 * Так «Рваный выпад» учит Скорый выпад накладывать урон по времени, не
 * заставляя abilities.ts знать про таланты по имени.
 */
export function talentAbilityEffect(ranks: TalentRanks, abilityId: string) {
  for (const talent of TALENTS) {
    if (talent.effect.kind !== 'flag') continue
    if (talent.effect.flag !== 'quick-strike-bleeds') continue
    if (talent.effect.abilityId !== abilityId) continue
    if (rankOf(ranks, talent.id) > 0) return talent.effect.effect
  }
  return null
}

/**
 * Во сколько раз множатся кулдауны после привала (1 — не трогаются).
 *
 * Число приходит из ДАННЫХ таланта, а не зашито здесь: ослабить талант
 * можно правкой одной строки в data/talents.ts, не заходя в логику.
 */
export function restCooldownMultiplier(ranks: TalentRanks): number {
  for (const talent of TALENTS) {
    if (talent.effect.kind !== 'flag') continue
    if (talent.effect.flag !== 'rest-clears-cooldowns') continue
    if (rankOf(ranks, talent.id) > 0) return talent.effect.cooldownShare
  }
  return 1
}

/** Множитель времени воскрешения от талантов (1 — без изменений). */
export function reviveMultiplier(ranks: TalentRanks): number {
  for (const talent of TALENTS) {
    if (talent.effect.kind !== 'flag') continue
    if (talent.effect.flag !== 'halved-revive') continue
    if (rankOf(ranks, talent.id) > 0) return talent.effect.reviveMultiplier
  }
  return 1
}
