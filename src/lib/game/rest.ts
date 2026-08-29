// Привал: управляемая пауза вместо смерти как единственной остановки.
//
// ЗАЧЕМ. Раньше просадка HP кончалась ровно одним способом — смертью, и
// повлиять на неё было нечем. С привалом выбор зоны становится непрерывной
// оптимизацией: порог повыше — меньше риска и меньше аптайма, пониже —
// наоборот. Смерть остаётся, но теперь это следствие того, что порог выставлен
// неверно, а не норма жизни.
//
// Текста для игрока здесь нет: наружу идут числа и состояния, подписи рисует UI.
import { Decimal } from './numbers'
import { expectedMonsterDamage } from './combat'
import { REST_FOOD_SPEEDUP } from '../data/balance'
import { zoneMonsterVariants, type Zone } from '../data/zones'
import type { StatBlock } from './stats'
import { restCooldownMultiplier } from './talents'
import { takeFood } from './crafting'
import type { GameState } from './state'

/**
 * Сколько длится привал прямо сейчас, мс.
 *
 * Ускорение приходит ИСТОЧНИКОМ (`restSpeedupSource`), а не правкой числа:
 * пока источника нет, привал полный. Сюда приедет еда из кулинарии — и это
 * единственное место, где длительность вообще считается.
 */
export function restDurationMs(state: GameState): number {
  const base = state.stats.restDuration * 1000
  return state.restSpeedupSource ? base / REST_FOOD_SPEEDUP : base
}

/** Пора ли на привал: HP или ресурс упали ниже своего порога. */
export function needsRest(state: GameState): boolean {
  // Порог — СТАТ: настройка игрока приходит в конвейер базой, а таланты её
  // сдвигают. Читать здесь сырое поле состояния значило бы обойти таланты.
  if (state.stats.restThreshold > 0) {
    if (state.currentHp.lt(state.stats.maxHp.times(state.stats.restThreshold))) return true
  }
  if (state.restResourceThreshold > 0) {
    if (state.currentMana.lt(state.stats.maxMana.times(state.restResourceThreshold))) return true
  }
  return false
}

/**
 * Уход на привал. Очередь и эффекты снимаются: они висели на прежнем мобе.
 *
 * Порция еды, если она есть, тратится ЗДЕСЬ и сокращает именно этот привал.
 * Еда не обязательна: без неё привал просто дольше — и это всё, что она даёт.
 */
export function startRest(state: GameState): GameState {
  const fed = takeFood(state)
  const withFood: GameState =
    fed.foodId === null ? state : { ...fed.state, restSpeedupSource: fed.foodId }
  const total = restDurationMs(withFood)
  return {
    ...withFood,
    heroState: 'resting',
    restMsLeft: total,
    restTotalMs: total,
    queuedAbilityId: null,
    activeEffects: [],
    autocastReadyMs: {},
  }
}

/**
 * Конец привала: полное восстановление.
 *
 * `progress` — какая доля привала отсижена, 0..1. Досидел до конца — единица и
 * полный запас; прервал руками — ровно столько, сколько высидел. Прерывание
 * бесплатным быть не должно, иначе порог перестаёт что-либо значить.
 */
export function finishRest(state: GameState, progress = 1): GameState {
  const share = Math.min(1, Math.max(0, progress))
  const heal = (current: Decimal, max: Decimal) =>
    Decimal.min(current.plus(max.minus(current).times(share)), max)
  // Талант ветки самообладания: из привала герой выходит с готовыми умениями.
  // Множитель приходит из данных таланта — своего числа у логики нет.
  const cooldownShare = restCooldownMultiplier(state.talents)
  const abilityCooldownsMs =
    cooldownShare >= 1
      ? state.abilityCooldownsMs
      : Object.fromEntries(
          Object.entries(state.abilityCooldownsMs).map(([id, left]) => [id, left * cooldownShare]),
        )
  return {
    ...state,
    abilityCooldownsMs,
    gcdMsLeft: cooldownShare >= 1 ? state.gcdMsLeft : state.gcdMsLeft * cooldownShare,
    heroState: 'alive',
    restMsLeft: 0,
    restTotalMs: 0,
    currentHp: heal(state.currentHp, state.stats.maxHp),
    currentMana: heal(state.currentMana, state.stats.maxMana),
    // Привал — это и есть окно восстановления: продолжать выжидать паузу
    // правила задержки после него незачем.
    regenDelayMsLeft: 0,
    // Еда расходуется по одной порции на привал: источник снимается здесь.
    restSpeedupSource: null,
  }
}

/** Доля отсиженного привала на данный момент. */
export function restProgress(state: GameState): number {
  if (state.restTotalMs <= 0) return 0
  return Math.min(1, Math.max(0, 1 - state.restMsLeft / state.restTotalMs))
}

// ---------------------------------------------------------------------------
// Безопасность зоны
// ---------------------------------------------------------------------------

/** Самый сильный удар, который может прилететь в этой зоне. */
export function maxMonsterHit(zone: Zone, stats: StatBlock): Decimal {
  return zoneMonsterVariants(zone).reduce((max, template) => {
    const hit = expectedMonsterDamage(
      { ...template, currentHp: template.maxHp, swingProgress: 0 },
      stats,
    )
    // Берём верхнюю границу разброса, а не среднее: безопасность — про худший
    // случай, иначе метка обещала бы то, чего не гарантирует.
    const worst = template.damageMax.times(1 - stats.damageReduction)
    return Decimal.max(max, Decimal.max(hit, worst))
  }, new Decimal(0))
}

export interface ZoneSafety {
  /** Запас HP на пороге привала: с него герой уходит отдыхать. */
  thresholdHp: Decimal
  /** Самый сильный удар зоны. */
  worstHit: Decimal
  /** Смерть невозможна: даже худший удар не пробивает порог насквозь. */
  safe: boolean
}

/**
 * Может ли герой погибнуть в этой зоне при текущем пороге привала.
 *
 * Если на пороге у героя больше HP, чем максимальный удар зоны, то любой удар
 * оставляет его живым, а следующий тик уже уводит на привал. Значит смерть
 * невозможна — и игрок вправе знать это ДО входа, а не выяснять опытом.
 * Именно это превращает выбор зоны из угадывания в расчёт.
 */
export function zoneSafety(state: GameState, zone: Zone): ZoneSafety {
  const thresholdHp = state.stats.maxHp.times(state.stats.restThreshold)
  const worstHit = maxMonsterHit(zone, state.stats)
  return {
    thresholdHp,
    worstHit,
    safe: state.stats.restThreshold > 0 && thresholdHp.gt(worstHit),
  }
}
