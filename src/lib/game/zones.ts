// Зоны: доступность, переходы и ЧЕСТНЫЙ прогноз опасности. Прогноз считается
// из статов героя и мобов зоны через ту же estimateCombatRate, что и бой, —
// в данных зоны нет ни слова про «тут опасно». Текст рендерит UI по вердикту.
import { Decimal } from './numbers'
import { restDurationMs } from './rest'
import { estimateCombatRate, expectedMonsterDamage, uptimeFromHpLoss } from './combat'
import type { PlayMode } from './rotation'
import { monsterFromTemplate, pushEvent, spawnMonster, type GameState } from './state'
import { ZONE_BEHIND_GAP, ZONE_AHEAD_GAP, ZONE_VERDICT_UPTIME } from '../data/balance'
import {
  SAFE_ZONE,
  ZONES,
  ZONE_BY_ID,
  averageMonsterLevel,
  representativeMonster,
  zoneMonsterVariants,
  type Zone,
} from '../data/zones'
import type { Rng } from './rng'

export function zoneById(id: string): Zone {
  return ZONE_BY_ID[id] ?? SAFE_ZONE
}

export function currentZone(state: GameState): Zone {
  return zoneById(state.currentZoneId)
}

/** Открыта ли зона: уровень героя дорос до unlockRequirement. */
export function isZoneUnlocked(state: GameState, zone: Zone): boolean {
  return state.level.gte(zone.unlockRequirement)
}

/**
 * Куда игра ведёт героя на этом уровне: САМАЯ ДАЛЬНЯЯ открытая зона.
 * Это и есть «актуальная зона» контракта темпа — не та, где герой стоит
 * прямо сейчас (туда он мог заглянуть сам), а та, на которую рассчитан
 * его уровень.
 */
export function intendedZone(level: number): Zone {
  let intended = SAFE_ZONE
  for (const zone of ZONES) if (level >= zone.unlockRequirement) intended = zone
  return intended
}

/**
 * Где зона относительно героя. Четыре положения, а не три, и четвёртое
 * появилось не для красоты:
 *
 *   current — та, на которую герой рассчитан (intendedZone);
 *   behind  — герой её перерос: мобы падают с ходу;
 *   ahead   — герой сунулся раньше времени, и это видно по длине боя;
 *   near    — СОСЕДНЯЯ ступень лестницы: заметно легче или тяжелее
 *             актуальной, но ещё не «с ходу» и не «безнадёжно».
 *
 * Без `near` контракт темпа противоречил бы сам себе: соседняя зона отстоит
 * по времени убийства ровно на один шаг лестницы, а «отстающая» обязана
 * умирать в 2.7 раза быстрее актуальной — столько набегает только за три
 * ступени. Границы ZONE_BEHIND_GAP / ZONE_AHEAD_GAP и заданы этими тремя
 * ступенями (разбор — в data/balance.ts).
 */
export type ZoneStanding = 'behind' | 'near' | 'current' | 'ahead'

export function zoneStanding(level: number, zone: Zone): ZoneStanding {
  if (zone.id === intendedZone(level).id) return 'current'
  const gap = averageMonsterLevel(zone) - level
  if (gap <= -ZONE_BEHIND_GAP) return 'behind'
  if (gap >= ZONE_AHEAD_GAP) return 'ahead'
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
  for (const template of variants) {
    const rate = estimateCombatRate(facing(state, template), mode)
    kills = kills.plus(rate.idealKillsPerSecond)
    gold = gold.plus(rate.idealKillsPerSecond.times(template.goldReward))
    xp = xp.plus(rate.idealKillsPerSecond.times(template.xpReward))
    hpLoss = hpLoss.plus(rate.hpLossPerSecond)
  }
  // Привал — часть цикла зоны: герой не умирает, а отдыхает, и это время
  // тоже не приносит золота. Модель обязана его вычесть, иначе оффлайн
  // пообещает больше живой игры.
  const uptime = uptimeFromHpLoss(state.stats.maxHp, hpLoss.div(n), {
    hpThreshold: state.restHpThreshold,
    durationMs: restDurationMs(state),
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
  verdict: ZoneVerdict
}

/** Прогноз по зоне из текущих статов героя. Ничего не меняет. */
export function forecastZone(state: GameState, zone: Zone): ZoneForecast {
  const rate = zoneRate(state, zone)
  const typical = stateInZone(state, zone)
  const incoming = expectedMonsterDamage(typical.monster, state.stats)
  // Сколько ударов типичного моба герой держит с полного запаса: нулевой
  // входящий урон означает бесконечность, поэтому отдельной веткой.
  const hitsSurvived = incoming.lte(0)
    ? Number.POSITIVE_INFINITY
    : state.stats.maxHp.div(incoming).toNumber()
  const killsPerHour = rate.killsPerSecond.times(3600)
  return {
    zoneId: zone.id,
    unlocked: isZoneUnlocked(state, zone),
    monsterLevelRange: zone.monsterLevelRange,
    levelGap: averageMonsterLevel(zone) - state.level.toNumber(),
    uptime: rate.uptime,
    timeToDeathSec: estimateCombatRate(typical).timeToDeathSec,
    hitsSurvived,
    killsPerHour,
    goldPerHour: rate.goldPerSecond.times(3600),
    xpPerHour: rate.xpPerSecond.times(3600),
    verdict: verdictFor(rate.uptime, killsPerHour),
  }
}

function verdictFor(uptime: number, killsPerHour: Decimal): ZoneVerdict {
  // Ноль убийств в час — герой не дожимает даже одного моба между смертями.
  if (killsPerHour.lte(0)) return 'hopeless'
  if (uptime >= ZONE_VERDICT_UPTIME.safe) return 'safe'
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
  if (!isZoneUnlocked(state, zone)) return state
  if (zone.id === state.currentZoneId) return state
  return enterZone(state, zone, rng, 'travel')
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
