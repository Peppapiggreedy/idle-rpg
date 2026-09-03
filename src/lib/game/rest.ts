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
import { estimateCombatRate, expectedMonsterDamage } from './combat'
import { levelGapDamageMult, MIN_REST_DURATION_S, REST_FOOD_SPEEDUP } from '../data/balance'
import { zoneSpawnVariants, type Zone } from '../data/zones'
import type { StatBlock } from './stats'
import { restCooldownMultiplier, restDurationMultiplier } from './talents'
import { takeFood } from './crafting'
import type { GameState } from './state'
import type { MonsterTemplate } from '../types'

/**
 * Сколько длится привал прямо сейчас, мс.
 *
 * Два независимых ускорителя: талант-капстоун (множитель из ДАННЫХ таланта)
 * и порция еды, которая приходит ИСТОЧНИКОМ (`restSpeedupSource`), а не
 * правкой числа. Нижняя граница та же, что у стата: короче MIN_REST_DURATION_S
 * привал перестаёт быть паузой и становится кнопкой «полный запас».
 */
export function restDurationMs(state: GameState): number {
  const base = state.stats.restDuration * 1000 * restDurationMultiplier(state.talents)
  const withFood = state.restSpeedupSource ? base / REST_FOOD_SPEEDUP : base
  return Math.max(MIN_REST_DURATION_S * 1000, withFood)
}

/** Пора ли на привал: HP упало ниже порога. */
export function needsRest(state: GameState): boolean {
  // Порог — СТАТ: настройка игрока приходит в конвейер базой, а таланты её
  // сдвигают. Читать здесь сырое поле состояния значило бы обойти таланты.
  if (state.stats.restThreshold > 0) {
    if (state.currentHp.lt(state.stats.maxHp.times(state.stats.restThreshold))) return true
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

/** Самый сильный удар, который может прилететь ЭТОМУ герою в этой зоне. */
export function maxMonsterHit(zone: Zone, stats: StatBlock, heroLevel: number): Decimal {
  // Тот же довод, что и у худшего боя ниже: спавн жмёт уровень моба к герою,
  // и верхний край полосы новичку зоны просто не выпадает.
  return zoneSpawnVariants(zone, heroLevel).reduce((max, { template }) => {
    const hit = expectedMonsterDamage(
      { ...template, currentHp: template.maxHp, swingProgress: 0 },
      stats,
      heroLevel,
    )
    // Берём верхнюю границу разброса, а не среднее: безопасность — про худший
    // случай, иначе метка обещала бы то, чего не гарантирует. Штраф за разрыв
    // уровней здесь тот же, что и в бою: иначе метка обещала бы безопасность
    // зоне, где герой не переживает и одного удара.
    const worst = template.damageMax
      .times(levelGapDamageMult(heroLevel, template.level))
      .times(1 - stats.damageReduction)
    return Decimal.max(max, Decimal.max(hit, worst))
  }, new Decimal(0))
}

/**
 * Квантиль нормального распределения, по которому меряется «не повезло».
 * 1.645 — это 95-й процентиль: метка обещает безопасность в девятнадцати
 * случаях из двадцати, а не «в среднем». Среднее здесь не годится вовсе:
 * зона, убивающая ровно в половине боёв, по среднему выглядела бы безопасной.
 */
const UNLUCKY_Z = 1.645

/**
 * Сколько HP снимет ОДИН ПОЛНЫЙ БОЙ с этим мобом, если не повезёт.
 *
 * Считается по бою целиком, а не по одному удару, и это главное изменение
 * шага: привал теперь между схватками, поэтому пережить нужно всю схватку,
 * а не отдельный удар. Разброс учитывается верхним квантилем — среднее
 * обещало бы безопасность зоне, которая убивает в половине случаев.
 */
export function fightLoss(state: GameState, template: MonsterTemplate): Decimal {
  const monster = { ...template, currentHp: template.maxHp, swingProgress: 0 }
  const facing: GameState = { ...state, monster }
  const rate = estimateCombatRate(facing)
  if (rate.idealKillsPerSecond.lte(0)) return state.stats.maxHp.times(2)
  const cycleSec = new Decimal(1).div(rate.idealKillsPerSecond)
  // Ответных ударов за бой — СРЕДНЕЕ по боям, как в самой оценке
  // (`бой/замах − 1/2`, не меньше нуля): целое одного боя делало цену
  // худшего боя ступенчатой, и лишний процент крита у героя ронял её на
  // треть — вместе с вердиктом «безопасно» и порогом привала.
  const hits = Math.max(0, cycleSec.div(template.swingTime).toNumber() - 0.5)
  if (hits === 0) return new Decimal(0)
  const mean = expectedMonsterDamage(monster, state.stats, state.level.toNumber())
  // Разброс одного удара: равномерное распределение min..max даёт
  // стандартное отклонение (max - min) / sqrt(12).
  const spread = template.damageMax
    .minus(template.damageMin)
    .times(1 - state.stats.damageReduction)
  const sigmaHit = spread.div(Math.sqrt(12))
  // Сумма независимых ударов: отклонение растёт как корень из их числа.
  const sigmaFight = sigmaHit.times(Math.sqrt(hits))
  const gross = mean.times(hits).plus(sigmaFight.times(UNLUCKY_Z))
  // Реген в бою работает всё это время и потерю уменьшает.
  const regen = state.stats.hpRegen.times(cycleSec)
  return Decimal.max(gross.minus(regen), new Decimal(0))
}

export interface ZoneSafety {
  /** Запас HP на пороге привала: с него герой уходит отдыхать. */
  thresholdHp: Decimal
  /** Самый сильный удар зоны — показываем игроку для наглядности. */
  worstHit: Decimal
  /** Сколько снимет самый тяжёлый бой зоны, если не повезёт. */
  worstFight: Decimal
  /** Смерть невозможна: даже неудачный бой не пробивает порог насквозь. */
  safe: boolean
}

/**
 * Может ли герой погибнуть в этой зоне при текущем пороге привала.
 *
 * ПРАВИЛО ИЗМЕНИЛОСЬ ВМЕСТЕ С ПРИВАЛОМ. Раньше «безопасно» значило «порог
 * выше одного удара»: герой выходил из боя, едва просев, и одного удара ему
 * хватало, чтобы успеть уйти. Теперь он доводит бой до конца, и пережить
 * нужно ВСЮ схватку — от первого удара до последнего. Порога должно хватать
 * на неудачный бой целиком, иначе обещание «умереть нельзя» держится ровно
 * до первого затяжного противника.
 */
export function zoneSafety(state: GameState, zone: Zone): ZoneSafety {
  const thresholdHp = state.stats.maxHp.times(state.stats.restThreshold)
  const worstHit = maxMonsterHit(zone, state.stats, state.level.toNumber())
  // ХУДШИЙ БОЙ — ИЗ ТЕХ, ЧТО ГЕРОЮ ВООБЩЕ ВЫДАДУТ. Раньше здесь перебиралась
  // вся полоса зоны, и это было правдой: спавн брал любой её уровень. Теперь
  // уровень жмётся к герою (SPAWN_LEVEL_SPREAD), и здоровяк с верхнего края
  // полосы новичку зоны просто не выпадает — считать по нему значило бы
  // пугать игрока боем, которого не будет.
  const worstFight = zoneSpawnVariants(zone, state.level.toNumber()).reduce(
    (max, { template }) => Decimal.max(max, fightLoss(state, template)),
    new Decimal(0),
  )
  return {
    thresholdHp,
    worstHit,
    worstFight,
    safe: state.stats.restThreshold > 0 && thresholdHp.gt(worstFight),
  }
}
