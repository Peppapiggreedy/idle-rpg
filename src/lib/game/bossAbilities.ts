// Способности героических боссов.
//
// Все три читаются ТОЛЬКО по `effect.kind` с payload из данных: ни одного
// «если босс такой-то» и ни одного «если способность такая-то». Своего
// состояния у них нет — отметки считаются от времени боя (fightMs), ровно
// как ступени ярости, поэтому в сейв не добавляется ни одного счётчика.
//
// Живут они отдельным файлом, а не в dungeons.ts: там данные и переходы
// цепочки, а здесь — поведение в бою, и оно зовётся из тика и из траты
// ресурса (tick.ts -> abilities.ts). Поэтому босса мы достаём прямо из данных.
import { Decimal } from './numbers'
import { dungeonView } from '../data/dungeons'
import { BOSS_ABILITY_BY_ID, type BossAbilityDef } from '../data/heroic'
import { pushEvent, type GameState } from './state'

/** Способность босса, перед которым стоит герой. Вне героики — null. */
export function currentBossAbility(state: GameState): BossAbilityDef | null {
  const run = state.dungeonRun
  if (!run) return null
  const boss = dungeonView(run.dungeonId, run.difficulty)?.bosses[run.bossIndex]
  if (!boss?.abilityId) return null
  return BOSS_ABILITY_BY_ID[boss.abilityId] ?? null
}

/**
 * Время замаха босса. Ускорение на низком здоровье живёт ЗДЕСЬ, а не в
 * состоянии моба: прогресс замаха хранится долей 0..1, поэтому смена времени
 * замаха посреди боя ничего не сбрасывает и не даёт мгновенного удара —
 * то же правило, что и у оружия героя.
 */
export function bossSwingTime(state: GameState): number {
  const base = state.monster.swingTime
  const ability = currentBossAbility(state)
  if (!ability || ability.effect.kind !== 'frenzy-below-hp') return base
  if (state.monster.maxHp.lte(0)) return base
  const share = state.monster.currentHp.div(state.monster.maxHp).toNumber()
  if (share > ability.effect.hpShare) return base
  // Ускорение в ДОЛЯХ: делим, а не вычитаем, иначе замах ушёл бы в ноль.
  return base / (1 + ability.effect.hasteBonus)
}

/** Активна ли ярость низкого здоровья прямо сейчас — для HUD. */
export function bossFrenzyActive(state: GameState): boolean {
  return bossSwingTime(state) < state.monster.swingTime
}

/** Перешагнул ли отрезок [fromMs, toMs) очередную отметку периода. */
function crossed(fromMs: number, toMs: number, intervalMs: number): boolean {
  if (intervalMs <= 0) return false
  return Math.floor(toMs / intervalMs) > Math.floor(fromMs / intervalMs)
}

/**
 * Рассеивание наложенных эффектов. Отметки считаются ОТ ВРЕМЕНИ БОЯ (fightMs),
 * ровно как ступени ярости, поэтому своего таймера в состоянии нет и в сейв
 * ничего добавлять не надо: перезагрузка сбрасывает бой с боссом целиком.
 *
 * Зовётся ДО applyEnrage, то есть fightMs здесь ещё не сдвинут этим тиком.
 */
export function bossDispel(state: GameState, dtMs: number): GameState {
  const run = state.dungeonRun
  if (!run || state.heroState !== 'alive') return state
  const ability = currentBossAbility(state)
  if (!ability || ability.effect.kind !== 'dispel') return state
  if (!crossed(run.fightMs, run.fightMs + dtMs, ability.effect.intervalSec * 1000)) return state
  const clearsQueue = ability.effect.clearsQueue && state.queuedAbilityId !== null
  // Снимать нечего — и события в лог не пишем: пустая строка каждые двенадцать
  // секунд превратила бы лог в шум.
  if (state.activeEffects.length === 0 && !clearsQueue) return state
  return {
    ...state,
    activeEffects: [],
    queuedAbilityId: ability.effect.clearsQueue ? null : state.queuedAbilityId,
    combatLog: pushEvent(state.combatLog, { type: 'boss-ability', abilityId: ability.id }),
  }
}

/**
 * Отдача за трату ресурса. Зовётся из ОДНОГО места — payFor в abilities.ts,
 * то есть отовсюду, где ресурс реально списывается: мгновенное умение,
 * умение из очереди, автокаст и ручное нажатие между тиками.
 *
 * Урон считается ДОЛЕЙ ЗАПАСА потраченного ресурса, а не абсолютной тратой:
 * у стража мана, у изувера ярость, числа у них разные, а наказание обязано
 * быть одинаковым — иначе способность превратилась бы в налог на один класс.
 *
 * Смерть здесь НЕ оформляется: её подхватит applyLethalCheck в конвейере
 * тика, чтобы воскрешение, выход из данжа и лог шли одним путём.
 */
export function punishResourceSpend(state: GameState, spent: Decimal): GameState {
  if (spent.lte(0) || state.stats.maxMana.lte(0)) return state
  const ability = currentBossAbility(state)
  if (!ability || ability.effect.kind !== 'punish-resource') return state
  const damage = state.stats.maxHp
    .times(ability.effect.hpSharePerResource)
    .times(spent.div(state.stats.maxMana))
  if (damage.lte(0)) return state
  return {
    ...state,
    currentHp: Decimal.max(state.currentHp.minus(damage), new Decimal(0)),
    combatLog: pushEvent(state.combatLog, { type: 'boss-ability', abilityId: ability.id, damage }),
  }
}

