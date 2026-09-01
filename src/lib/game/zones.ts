// Зоны: доступность, переходы и ЧЕСТНЫЙ прогноз опасности. Прогноз считается
// из статов героя и мобов зоны через ту же estimateCombatRate, что и бой, —
// в данных зоны нет ни слова про «тут опасно». Текст рендерит UI по вердикту.
import { Decimal } from './numbers'
import { restDurationMs, zoneSafety } from './rest'
import { estimateCombatRate, estimateTtk, expectedMonsterDamage, uptimeFromHpLoss } from './combat'
import type { PlayMode } from './rotation'
import { monsterFromTemplate, pushEvent, spawnMonster, type GameState } from './state'
import {
  TTK_AHEAD_MIN,
  TTK_BEHIND_MAX,
  ZONE_VERDICT_UPTIME,
  xpGapShare,
} from '../data/balance'
import {
  SAFE_ZONE,
  ZONES,
  ZONE_BY_ID,
  averageMonsterLevel,
  representativeMonster,
  zoneForMonsterLevel,
  zoneMonsterVariants,
  type Zone,
} from '../data/zones'
import { INITIAL_ZONE_IDS } from '../data/dungeons'
import type { Rng } from './rng'

export function zoneById(id: string): Zone {
  return ZONE_BY_ID[id] ?? SAFE_ZONE
}

export function currentZone(state: GameState): Zone {
  return zoneById(state.currentZoneId)
}

/**
 * Открыта ли зона: её открыл ПРОЙДЕННЫЙ ДАНЖ, либо она открыта с начала игры.
 *
 * Уровень героя тут больше ни при чём, и это главное изменение лестницы.
 * Раньше зона открывалась числом (`unlockRequirement`), которое шло тройками,
 * тогда как полосы мобов идут пятёрками: последняя зона открывалась на 58
 * уровне при мобах 96-100, а сорок два уровня второй половины игры не
 * приносили ни одной новой зоны. Двумя числами одну лестницу описать нельзя,
 * поэтому число осталось одно — тир данжа.
 */
export function isZoneUnlocked(state: GameState, zone: Zone): boolean {
  if (INITIAL_ZONE_IDS.includes(zone.id)) return true
  return state.unlockedZoneIds[zone.id] === true
}

/**
 * Куда игра ведёт героя на этом уровне: полоса мобов, КОТОРАЯ ЕМУ ПО СИЛАМ.
 * Это и есть «актуальная зона» контракта темпа.
 *
 * НЕ «самая дальняя открытая», и это важно. Зоны открываются заметно
 * быстрее, чем герой начинает в них выживать: на десятом уровне открыта
 * полоса шестнадцатых, и мерить контракт по ней значит мерить бой, в
 * который герой ещё не должен лезть. Ровно та же подмена ломала кривую
 * опыта и уровни боссов — там она уже исправлена, и здесь основание
 * обязано быть тем же.
 *
 * Само правило живёт в данных (`zoneForMonsterLevel`): по нему же считается
 * кривая опыта, а тянуть бой в `formulas.ts` нельзя — вышло бы кольцо.
 */
export const intendedZone = zoneForMonsterLevel

/**
 * Где зона относительно героя. Четыре положения, а не три, и четвёртое
 * появилось не для красоты:
 *
 *   current — та, на которую герой рассчитан (intendedZone);
 *   behind  — герой её перерос: мобы падают с ходу;
 *   ahead   — герой сунулся раньше времени, и это видно по длине боя;
 *   near    — соседняя ступень: заметно легче или тяжелее актуальной, но
 *             ещё не «с ходу» и не «безнадёжно».
 *
 * ПОЛОЖЕНИЕ СЧИТАЕТСЯ ПО ВРЕМЕНИ УБИЙСТВА, а не по разнице уровней. Раньше
 * было наоборот, и на лестнице из четырёх зон разница уровней работала: между
 * ступенями было столько же уровней, сколько нужно времени. На лестнице из
 * одиннадцати это сломалось бы молча — ступени стали короче, а пороги в
 * секундах остались прежними. Да и ярлык обязан значить то, что игрок
 * почувствует, а не то, что написано в данных: «отстающая» — это «мобы
 * умирают с ходу», и мерить это надо секундами.
 */
export type ZoneStanding = 'behind' | 'near' | 'current' | 'ahead'

export function zoneStanding(state: GameState, zone: Zone): ZoneStanding {
  const level = state.level.toNumber()
  if (zone.id === intendedZone(level).id) return 'current'
  const ttk = estimateTtk(state, zone)
  if (ttk <= TTK_BEHIND_MAX) return 'behind'
  if (ttk >= TTK_AHEAD_MIN) return 'ahead'
  return 'near'
}

// Состояние «как если бы перед героем стоял этот моб»: статы те же, моб чужой.
function facing(state: GameState, template: ReturnType<typeof representativeMonster>): GameState {
  return { ...state, monster: monsterFromTemplate(template) }
}

/** Состояние против ТИПИЧНОГО моба зоны — для показателей вроде «держу N ударов». */
export function stateInZone(state: GameState, zone: Zone): GameState {
  return facing(state, representativeMonster(zone))
}

export interface ZoneRate {
  killsPerSecond: Decimal
  goldPerSecond: Decimal
  xpPerSecond: Decimal
  uptime: number // доля времени, которую герой в зоне жив
}

/**
 * Темп зоны: среднее по ВСЕМ мобам, которых может выдать спавн (пул × уровни).
 * Это та же estimateCombatRate, что и в бою, — своей формулы у зон нет.
 * Усредняем РЕЗУЛЬТАТЫ по каждому мобу, а не входные числа: hp входит в темп
 * нелинейно, через округление числа ударов вверх.
 * Смертность считается один раз на зону: запас HP у героя общий на всю череду
 * боёв, поэтому частоту смертей задаёт СРЕДНЯЯ потеря HP в секунду, а не
 * отдельная потеря против каждого моба.
 */
export function zoneRate(state: GameState, zone: Zone, mode: PlayMode = 'auto'): ZoneRate {
  const variants = zoneMonsterVariants(zone)
  const n = new Decimal(variants.length)
  let kills = new Decimal(0)
  let gold = new Decimal(0)
  let xp = new Decimal(0)
  let hpLoss = new Decimal(0)
  let cycleSec = 0
  for (const template of variants) {
    const rate = estimateCombatRate(facing(state, template), mode)
    kills = kills.plus(rate.idealKillsPerSecond)
    gold = gold.plus(rate.idealKillsPerSecond.times(template.goldReward))
    // Штраф за отставание — ПО КАЖДОМУ мобу отдельно, а не по зоне целиком:
    // внутри одной зоны пять уровней мобов, и на границе штрафа половина пула
    // может считаться полным опытом, а половина — половинным. Золото рядом
    // идёт без штрафа: он бьёт только по опыту.
    xp = xp.plus(
      rate.idealKillsPerSecond
        .times(template.xpReward)
        .times(xpGapShare(state.level.toNumber(), template.level)),
    )
    hpLoss = hpLoss.plus(rate.hpLossPerSecond)
    cycleSec += rate.idealKillsPerSecond.gt(0)
      ? new Decimal(1).div(rate.idealKillsPerSecond).toNumber()
      : 0
  }
  // Привал — часть цикла зоны: герой не умирает, а отдыхает, и это время
  // тоже не приносит золота. Модель обязана его вычесть, иначе оффлайн
  // пообещает больше живой игры.
  //
  // Считается ПО БОЯМ ЦЕЛИКОМ: длина средней схватки зоны — второй вход
  // модели, потому что уйти на привал герой может только между боями.
  // Порог берётся из конвейера (настройка плюс таланты), а не сырым полем.
  const uptime = uptimeFromHpLoss(state.stats.maxHp, hpLoss.div(n), {
    hpThreshold: state.stats.restThreshold,
    durationMs: restDurationMs(state),
    cycleSec: cycleSec / variants.length,
  })
  return {
    killsPerSecond: kills.div(n).times(uptime),
    goldPerSecond: gold.div(n).times(uptime),
    xpPerSecond: xp.div(n).times(uptime),
    uptime,
  }
}

// Насколько всё плохо. Порядок вердиктов от лучшего к худшему.
export type ZoneVerdict = 'safe' | 'risky' | 'deadly' | 'hopeless'

export interface ZoneForecast {
  zoneId: string
  unlocked: boolean
  monsterLevelRange: { min: number; max: number }
  levelGap: number // средний уровень мобов минус уровень героя
  uptime: number // доля времени, которую герой жив
  timeToDeathSec: number | null // null — не умирает вовсе
  hitsSurvived: number // сколько ударов среднего моба держит герой
  killsPerHour: Decimal
  goldPerHour: Decimal
  xpPerHour: Decimal
  /**
   * Доля опыта за отставание — 1, 0.5 или 0 (см. XP_GAP_PENALTY). Считается
   * по СРЕДНЕМУ уровню мобов зоны, то есть по тому же разрыву, что и levelGap
   * рядом: два числа в одной строке обязаны быть об одном и том же.
   *
   * Реальное начисление идёт ПО КАЖДОМУ мобу, поэтому зона, лежащая на
   * границе ступени, платит между двумя долями. Точное число видно в
   * xpPerHour здесь же — это поле для ярлыка, а не для расчёта.
   */
  xpShare: number
  verdict: ZoneVerdict
}

/** Прогноз по зоне из текущих статов героя. Ничего не меняет. */
export function forecastZone(state: GameState, zone: Zone): ZoneForecast {
  const rate = zoneRate(state, zone)
  const typical = stateInZone(state, zone)
  const incoming = expectedMonsterDamage(typical.monster, state.stats, state.level.toNumber())
  // Сколько ударов типичного моба герой держит с полного запаса: нулевой
  // входящий урон означает бесконечность, поэтому отдельной веткой.
  const hitsSurvived = incoming.lte(0)
    ? Number.POSITIVE_INFINITY
    : state.stats.maxHp.div(incoming).toNumber()
  const killsPerHour = rate.killsPerSecond.times(3600)
  const timeToDeathSec = estimateCombatRate(typical).timeToDeathSec
  return {
    zoneId: zone.id,
    unlocked: isZoneUnlocked(state, zone),
    monsterLevelRange: zone.monsterLevelRange,
    levelGap: averageMonsterLevel(zone) - state.level.toNumber(),
    uptime: rate.uptime,
    timeToDeathSec,
    hitsSurvived,
    killsPerHour,
    goldPerHour: rate.goldPerSecond.times(3600),
    xpPerHour: rate.xpPerSecond.times(3600),
    xpShare: xpGapShare(state.level.toNumber(), averageMonsterLevel(zone)),
    verdict: verdictFor(rate.uptime, killsPerHour, zoneSafety(state, zone).safe),
  }
}

/**
 * Код вердикта. «По силам» больше НЕ значит «не теряю здоровья»: с привалом
 * между боями герой теряет его всегда, а важно другое — переживёт ли он
 * неудачную схватку. Поэтому safe выдаётся ровно тогда, когда порога хватает
 * на бой целиком с запасом на разброс (zoneSafety, 95-й процентиль), а не
 * когда баланс HP сошёлся в ноль.
 */
function verdictFor(uptime: number, killsPerHour: Decimal, safeByThreshold: boolean): ZoneVerdict {
  // «Безнадёжно» — герой не дожимает даже одного моба: убийств нет вовсе.
  // Порог uptime этого не ловит сам по себе, поэтому проверка отдельная.
  if (killsPerHour.lte(0)) return 'hopeless'
  if (safeByThreshold) return 'safe'
  if (uptime >= ZONE_VERDICT_UPTIME.risky) return 'risky'
  if (uptime >= ZONE_VERDICT_UPTIME.deadly) return 'deadly'
  return 'hopeless'
}

export function forecastAllZones(state: GameState): ZoneForecast[] {
  return ZONES.map((zone) => forecastZone(state, zone))
}

// Переход в зону: свежий моб, сброшенный замах и пауза респауна.
// Прогресс замаха обнуляем намеренно — по новому мобу бьём с полного размаха.
function enterZone(
  state: GameState,
  zone: Zone,
  rng: Rng,
  reason: 'travel' | 'retreat',
): GameState {
  const monster = spawnMonster(zone, rng)
  let combatLog = pushEvent(state.combatLog, {
    type: 'zone',
    zoneName: zone.name,
    reason,
  })
  combatLog = pushEvent(combatLog, { type: 'spawn', monsterName: monster.name })
  return {
    ...state,
    currentZoneId: zone.id,
    monster,
    swingProgress: 0,
    respawnMsLeft: 0,
    combatLog,
  }
}

/** Путешествие по воле игрока. В закрытую зону не пускаем — состояние как было. */
export function travelToZone(state: GameState, zoneId: string, rng: Rng): GameState {
  const zone = ZONE_BY_ID[zoneId]
  if (!zone) return state
  // Из храма выходят выходом, а не переездом: иначе смена зоны оставила бы
  // забег висеть, а героя — драться с мобами зоны под флагом храма.
  if (state.templeRun) return state
  if (!isZoneUnlocked(state, zone)) return state
  if (zone.id === state.currentZoneId) return state
  return enterZone(state, zone, rng, 'travel')
}

/**
 * КУДА ВЫХОДИТ ГЕРОЙ ИЗ ПРЕРВАННОГО ЗАБЕГА — данжа, храма и всего закрытого,
 * что появится позже. Одно правило на всех и полностью детерминированное:
 * оффлайн начисляется по выбранной зоне, и «зависит от порядка вызовов» здесь
 * означало бы, что за одно и то же отсутствие платят по-разному.
 *
 * Порядок:
 *   1) последняя зона, где герой выживал, если её мобы не отстали (gap <= 5);
 *   2) иначе самая высокая ОТКРЫТАЯ зона, где герой не гибнет и мобы не
 *      отстали;
 *   3) иначе безопасная.
 *
 * «Мобы не отстали» проверяется по НИЖНЕМУ краю полосы: в зоне пять уровней
 * мобов, и если разрыв велик хотя бы у самого мелкого, часть пула уже платит
 * половину. Выкидывать героя в такую зону — значит начислить ему оффлайн со
 * скрытым штрафом.
 *
 * «Не гибнет» — вердикт safe или risky. Требование звучало как «не deadly»,
 * но hopeless ХУЖЕ deadly: там герой не добивает даже одного моба, и оффлайн
 * вышел бы нулевым. Пропустить вердикт хуже названного значило бы исполнить
 * требование буквально и с обратным смыслом.
 */
export function offlineZone(state: GameState): Zone {
  const level = state.level.toNumber()
  // Отставание зоны — по самому мелкому её мобу: он ломается первым.
  const notBehind = (zone: Zone) => xpGapShare(level, zone.monsterLevelRange.min) >= 1
  const last = state.lastSurvivedZoneId ? ZONE_BY_ID[state.lastSurvivedZoneId] : null
  if (last && notBehind(last)) return last
  // Сверху вниз: первая подходящая и есть самая высокая.
  for (let i = ZONES.length - 1; i >= 0; i -= 1) {
    const zone = ZONES[i]
    if (!isZoneUnlocked(state, zone) || !notBehind(zone)) continue
    const verdict = forecastZone(state, zone).verdict
    if (verdict === 'safe' || verdict === 'risky') return zone
  }
  return SAFE_ZONE
}

/** Куда отбрасывает смерть: последняя зона, где герой выживал, иначе безопасная. */
export function retreatZone(state: GameState): Zone {
  const last = state.lastSurvivedZoneId ? ZONE_BY_ID[state.lastSurvivedZoneId] : null
  return last ?? SAFE_ZONE
}

/** Воскрешение: герой приходит в себя в зоне, где ему по силам. */
export function reviveInZone(state: GameState, rng: Rng): GameState {
  return enterZone(state, retreatZone(state), rng, 'retreat')
}
