
// =============================================================================
// Таланты: сколько очков есть, куда их можно вложить и что из этого выходит.
// Правила вложения живут здесь, эффекты — в данных: талант либо отдаёт
// модификаторы в конвейер статов, либо поднимает флаг, по которому меняется
// поведение. Текста для игрока здесь нет — наружу идут коды причин.
//
// НИ ОДНОГО «ЕСЛИ ТАЛАНТ ТАКОЙ-ТО» И НИ ОДНОГО «ЕСЛИ КЛАСС ТАКОЙ-ТО».
// Дерево берётся по классу героя (talentsOfClass), а поведение — по ИМЕНИ
// ФЛАГА через общий flagPayload; число всегда приходит из payload данных.
import { Decimal } from './numbers'
import {
  BRANCH_BY_ID,
  TALENTS,
  TALENT_BY_ID,
  branchesOfClass,
  rankOf,
  talentModifiers,
  talentsInBranch,
  talentsOfClass,
  requiredRank,
  dependentsOf,
  type BranchDef,
  type BranchId,
  type TalentDef,
  type TalentEffect,
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
export { rankOf, talentModifiers, branchesOfClass, talentsOfClass } from '../data/talents'

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

export function spentInBranch(ranks: TalentRanks, branchId: BranchId): number {
  let total = 0
  for (const talent of talentsInBranch(branchId)) total += rankOf(ranks, talent.id)
  return total
}

/** Нераспределённые очки. Никогда не отрицательные, даже если сейв подправили. */
export function availablePoints(state: GameState): number {
  return Math.max(0, earnedPoints(state.level) - spentPoints(state.talents))
}

/** Ветки героя — в порядке колонок дерева. Класс читается из данных. */
export function heroBranches(state: GameState): BranchDef[] {
  return branchesOfClass(state.classId)
}

/** Все таланты, доступные герою этого класса. */
export function heroTalents(state: GameState): TalentDef[] {
  return talentsOfClass(state.classId)
}

// Почему очко сюда не вложить. Каждый случай — свой код, текст рендерит UI.
// 'other-class' появляется только на правленом руками сейве: в дереве своего
// класса чужих веток нет вовсе.
export type TalentBlockReason =
  | 'other-class'
  | 'no-points'
  | 'max-rank'
  | 'branch-locked'
  // Стрелка не набрана: опорный талант выше не вложен на нужный ранг.
  | 'needs-talent'

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
  // Дерево читается ПО КЛАССУ: ветка чужого класса не открывается ничем.
  if (BRANCH_BY_ID[talent.branch]?.classId !== state.classId) return blocked('other-class')
  if (pointsInBranch < talent.requiredPointsInBranch) return blocked('branch-locked')
  // СТРЕЛКА ПРОВЕРЯЕТСЯ ПОСЛЕ ПОРОГА ЭТАЖА: порог не лечится ничем, кроме
  // очков в ветке, а стрелка — конкретным талантом, и назвать игроку надо
  // ту причину, которая ближе к делу.
  if (talent.requires && rankOf(state.talents, talent.requires.talentId) < requiredRank(talent.requires)) {
    return blocked('needs-talent')
  }
  if (rank >= talent.maxRank) return blocked('max-rank')
  if (availablePoints(state) <= 0) return blocked('no-points')
  return { ...base, canInvest: true, reason: null }
}

/** Статусы только СВОЕГО дерева — чужое герою даже не показывается. */
export function allTalentStatuses(state: GameState): TalentStatus[] {
  return heroTalents(state).map((t) => talentStatus(state, t))
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

// ---------------------------------------------------------------------------
// Снятие очка в пределах открытого экрана
// ---------------------------------------------------------------------------

/**
 * ОТМЕНА, ПОКА ЭКРАН ОТКРЫТ. Очки, вложенные в ЭТОТ заход, снимаются
 * бесплатно; закрыл экран — только платный сброс.
 *
 * Зачем вообще: дерево из тридцати с лишним узлов на ветку читается не с
 * первого раза, и «ткнул не туда» на первом же очке не должно стоить
 * золотого сброса. Но и бесплатной перекладкой всего дерева это быть не
 * может — иначе денежный сток перестаёт работать вовсе.
 *
 * ЧТО ВЛОЖЕНО В ЭТОТ ЗАХОД, ЗНАЕТ ЭКРАН, А НЕ СОСТОЯНИЕ. Черновик приходит
 * ПАРАМЕТРОМ: в сейве ему делать нечего — «я только что вложил три очка»
 * переживать перезагрузку не должно, это «где я сейчас».
 */
export type TakeBackReason =
  // Ранга нет вовсе.
  | 'nothing-invested'
  // Ранг есть, но вложен не в этот заход — снимается только платным сбросом.
  | 'not-this-visit'
  // Снятие оборвёт стрелку: ниже стоит талант, которому этот ранг нужен.
  | 'blocks-dependent'

export interface TakeBackStatus {
  canTakeBack: boolean
  reason: TakeBackReason | null
  /** Сколько рангов этого таланта вложено в текущий заход. */
  fromThisVisit: number
}

/** Черновик захода: сколько рангов каждого таланта вложено с открытия экрана. */
export type TalentDraft = Readonly<Record<string, number>>

export function takeBackStatus(
  state: GameState,
  talent: TalentDef,
  draft: TalentDraft,
): TakeBackStatus {
  const rank = rankOf(state.talents, talent.id)
  const fromThisVisit = Math.max(0, Math.min(rank, Math.floor(draft[talent.id] ?? 0)))
  const blocked = (reason: TakeBackReason): TakeBackStatus => ({
    canTakeBack: false,
    reason,
    fromThisVisit,
  })
  if (rank <= 0) return blocked('nothing-invested')
  if (fromThisVisit <= 0) return blocked('not-this-visit')
  // СНЯТИЕ НЕ ОБРЫВАЕТ СТРЕЛКУ. Каскадно убирать зависимые нельзя: их очки
  // могли быть вложены в ПРОШЛЫЙ заход, и молча вернуть их значило бы
  // раздать бесплатный сброс. Проще и честнее — отказать с причиной.
  for (const dependent of dependentsOf(talent.id)) {
    const need = dependent.requires
    if (!need || need.talentId !== talent.id) continue
    if (rankOf(state.talents, dependent.id) <= 0) continue
    if (rank - 1 < requiredRank(need)) return blocked('blocks-dependent')
  }
  return { canTakeBack: true, reason: null, fromThisVisit }
}

/** Снять одно очко. Недоступное снятие состояние не меняет вовсе. */
export function takeBackTalent(
  state: GameState,
  talentId: string,
  draft: TalentDraft,
): GameState {
  const talent = TALENT_BY_ID[talentId]
  if (!talent) return state
  if (!takeBackStatus(state, talent, draft).canTakeBack) return state
  const rank = rankOf(state.talents, talentId) - 1
  const talents = { ...state.talents }
  if (rank <= 0) delete talents[talentId]
  else talents[talentId] = rank
  return ensureStats({ ...state, talents, statsDirty: true })
}

/** Цена очередного сброса: растёт с каждым уже сделанным сбросом. */
export function resetCost(state: GameState): Decimal {
  return TALENT_RESET_BASE_COST.times(TALENT_RESET_COST_GROWTH.pow(state.talentResets))
}

// Почему таланты не сбросить. Каждый случай — свой код, текст рендерит UI.
export type ResetBlockReason = 'nothing-spent' | 'gold'

export interface ResetStatus {
  canReset: boolean
  reason: ResetBlockReason | null
  cost: Decimal
  /** Сколько золота не хватает. Ноль — хватает. */
  short: Decimal
}

/** Порядок фиксирован: сперва то, что не лечится золотом. */
export function resetStatus(state: GameState): ResetStatus {
  const cost = resetCost(state)
  // СКОЛЬКО НЕ ХВАТАЕТ — числом, а не словом. «Не хватает золота» не говорит,
  // сколько ещё копить, и цель превращается в стену без расстояния до неё.
  const short = Decimal.max(cost.minus(state.gold), new Decimal(0))
  if (spentPoints(state.talents) <= 0) {
    return { canReset: false, reason: 'nothing-spent', cost, short }
  }
  if (short.gt(0)) return { canReset: false, reason: 'gold', cost, short }
  return { canReset: true, reason: null, cost, short }
}

export function canResetTalents(state: GameState): boolean {
  return resetStatus(state).canReset
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

// ---------------------------------------------------------------------------
// Флаги
// ---------------------------------------------------------------------------

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
 * PAYLOAD ВЗЯТОГО ФЛАГА — ЕДИНСТВЕННЫЙ СПОСОБ, КОТОРЫМ ЛОГИКА ЧИТАЕТ ТАЛАНТ.
 *
 * Поиск идёт по ИМЕНИ ФЛАГА, а не по id таланта: два класса поднимают один и
 * тот же флаг разными талантами и с разными числами, и логике всё равно,
 * каким именно. Отсюда и правило «ни одного if по id»: добавить талант —
 * значит дописать строку в data/talents.ts, а не ветку в игру.
 */
export function flagPayload<F extends TalentFlag>(
  ranks: TalentRanks,
  flag: F,
): Extract<TalentEffect, { kind: 'flag'; flag: F }> | null {
  for (const talent of TALENTS) {
    const effect = talent.effect
    if (effect.kind !== 'flag' || effect.flag !== flag) continue
    if (rankOf(ranks, talent.id) <= 0) continue
    return effect as Extract<TalentEffect, { kind: 'flag'; flag: F }>
  }
  return null
}

/**
 * Эффект, который талант добавляет умению (если такой талант взят).
 * Так «Рваный выпад» учит Скорый выпад накладывать урон по времени, не
 * заставляя abilities.ts знать про таланты по имени.
 */
export function talentAbilityEffect(ranks: TalentRanks, abilityId: string) {
  for (const talent of TALENTS) {
    const effect = talent.effect
    if (effect.kind !== 'flag' || effect.flag !== 'ability-learns-effect') continue
    if (effect.abilityId !== abilityId) continue
    if (rankOf(ranks, talent.id) > 0) return effect.effect
  }
  return null
}

/** Сколько ДОПОЛНИТЕЛЬНЫХ зарядов талант даёт этому умению. */
export function talentExtraCharges(ranks: TalentRanks, abilityId: string): number {
  let extra = 0
  for (const talent of TALENTS) {
    const effect = talent.effect
    if (effect.kind !== 'flag' || effect.flag !== 'ability-extra-charge') continue
    if (effect.abilityId !== abilityId) continue
    if (rankOf(ranks, talent.id) > 0) extra += Math.max(0, Math.floor(effect.extraCharges))
  }
  return extra
}

/** Шанс, что автоатака бьёт дважды. 0 — таланта нет, бросок не делается вовсе. */
export function doubleStrikeChance(ranks: TalentRanks): number {
  return flagPayload(ranks, 'double-strike')?.chance ?? 0
}

/** Какая доля ПОГЛОЩЁННОГО щитом урона уходит обратно в атакующего. */
export function blockReflectShare(ranks: TalentRanks): number {
  return flagPayload(ranks, 'block-reflects')?.damageShare ?? 0
}

/** Какую долю полного запаса ресурса возвращает удачный блок. */
export function blockResourceShare(ranks: TalentRanks): number {
  return flagPayload(ranks, 'block-restores-resource')?.resourceShare ?? 0
}

/** Во сколько раз множатся кулдауны после УБИЙСТВА (1 — не трогаются). */
export function killCooldownMultiplier(ranks: TalentRanks): number {
  return flagPayload(ranks, 'kill-refunds-cooldowns')?.cooldownShare ?? 1
}

/** Во сколько раз множатся кулдауны после ПРИВАЛА (1 — не трогаются). */
export function restCooldownMultiplier(ranks: TalentRanks): number {
  return flagPayload(ranks, 'rest-clears-cooldowns')?.cooldownShare ?? 1
}

/** Во сколько раз короче привал (1 — обычный). */
export function restDurationMultiplier(ranks: TalentRanks): number {
  return flagPayload(ranks, 'shorter-rest')?.durationMultiplier ?? 1
}

/** Множитель времени воскрешения от талантов (1 — без изменений). */
export function reviveMultiplier(ranks: TalentRanks): number {
  return flagPayload(ranks, 'faster-revive')?.reviveMultiplier ?? 1
}

