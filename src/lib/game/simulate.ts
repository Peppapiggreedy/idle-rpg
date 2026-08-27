// Прогон баланса без UI. Своей модели боя здесь НЕТ: симуляция крутит тот же
// самый конвейер `tick`, что и живая игра, поэтому цифры прогона и цифры на
// экране разойтись не могут. Всё, что делает этот модуль сверх тика, —
// собирает билд героя из описания и считает наблюдаемые метрики снаружи,
// не заглядывая внутрь шагов конвейера.
//
// Текста для игрока тут нет: наружу идут только числа и id.
import { Decimal } from './numbers'
import { STEP_MS } from './loop'
import { createRng } from './rng'
import { xpToNextLevel } from './formulas'
import {
  createInitialState,
  defaultAbilitySettings,
  manualOnlySettings,
  spawnMonster,
  type AbilitySettings,
  type GameState,
} from './state'
import { ensureStats } from './stats'
import { tick } from './tick'
import { weaponMods } from './loot'
import { travelToZone, zoneById, isZoneUnlocked, zoneRate } from './zones'
import { ABILITIES, ABILITY_BY_ID } from '../data/abilities'
import { RARITY_BY_ID } from '../data/rarity'
import { WEAPON_BY_ID } from '../data/items'
import { ZONES } from '../data/zones'
import type { AttackEvent, Item, Rarity } from '../types'

/** Оружие для прогона. `bare` снимает побочные статы шаблона и оставляет
 *  только три модификатора базы боя — так проверяется чистая нормализация
 *  скорости, без вклада крита и силы атаки конкретной модели. */
export interface SimWeapon {
  templateId: string
  rarity?: Rarity
  bare?: boolean
}

/** Кто именно бежит прогон. Всё, что влияет на статы, — источниками, как в
 *  игре: уровень, купленные заточки, надетое оружие, ранги талантов. */
export interface SimBuild {
  level?: number
  sharpening?: number // сколько раз куплена заточка оружия
  weapon?: SimWeapon | null // null — голые кулаки (UNARMED из баланса)
  talents?: Record<string, number>
  // Какие умения жмёт автокаст: 'all' — все, 'none' — ни одного (только
  // автоатака), список id — только они, в порядке приоритета.
  autocast?: 'all' | 'none' | string[]
}

export interface SimOptions {
  hours: number
  zoneId: string
  build?: SimBuild
  seed?: number
  // 'stay' — герой всю дорогу фармит заданную зону (так строится таблица),
  // 'best' — на каждом уровне переезжает в лучшую по опыту ОТКРЫТУЮ зону,
  // то есть ведёт себя как игрок, который следит за прокачкой.
  travel?: 'stay' | 'best'
  // Держать героя на стартовом уровне: опыт копится и попадает в метрики, но
  // уровень не растёт. Нужно для СРАВНЕНИЯ зон: за час свободного прогона
  // герой уходит на два десятка уровней вперёд, и строка «уровень 1» на самом
  // деле мерит уровни 1..30 — сравнивать такие строки между собой нечем.
  freezeLevel?: boolean
}

export interface SimResult {
  hours: number
  zoneId: string // зона, где прогон закончился (при travel: 'best' может отличаться)
  startZoneId: string
  killsPerHour: Decimal
  goldPerHour: Decimal
  xpPerHour: Decimal
  deathsPerHour: number
  // Сколько игровых секунд ещё копить до следующего уровня по темпу прогона;
  // null — темп нулевой, уровень не придёт никогда.
  secondsToNextLevel: number | null
  startLevel: Decimal
  finalLevel: Decimal
  kills: Decimal
  gold: Decimal
  xp: Decimal
  deaths: number
  // Доля игрового времени, которую герой прожил живым: 1 — не умирал вовсе.
  uptime: number
  // Урон, разложенный по источнику: автоатака и умения (вместе с их эффектами).
  autoDamage: Decimal
  abilityDamage: Decimal
  manaSpent: Decimal
  casts: number
  // Урон умений за единицу потраченной маны; null — умения не применялись.
  damagePerMana: Decimal | null
  // На какой игровой секунде впервые взят уровень: ключ — номер уровня.
  levelReachedAtSec: Record<number, number>
}

// Пресет таблицы прогона: одними и теми же числами пользуются тест баланса
// (game/__tests__/balance.test.ts) и страница /balance, чтобы «та же таблица»
// была той же буквально, а не похожей.
export const BALANCE_PRESET = {
  // Таблица зон: герой, которому открыты все четыре зоны.
  zoneHours: 8,
  zoneBuild: { level: 16, sharpening: 150 } as SimBuild,
  // Сравнение оружия: бой должен длиться полтора десятка замахов, иначе
  // сравнение меряет перебой добивающего удара, а не нормализацию скорости.
  weaponHours: 4,
  weaponZoneId: 'ashen-ridge',
  weaponBuild: { level: 30, sharpening: 100 } as SimBuild,
  // Урон за ману считается по умениям «на следующий удар».
  manaAbilities: ['rending-wound', 'shattering-blow'],
  // Порог расхождения итога между тремя оружиями с равным уроном в секунду.
  weaponSpreadLimit: 0.03,
} as const

/** Разброс между лучшим и худшим результатом — доля от худшего. */
export function spreadOf(values: Decimal[]): number {
  const numbers = values.map((v) => v.toNumber())
  const min = Math.min(...numbers)
  if (min <= 0) return Number.POSITIVE_INFINITY
  return (Math.max(...numbers) - min) / min
}

/** Предмет-оружие из шаблона данных. Модификаторы строит та же `weaponMods`,
 *  что и лут, — второй копии правил «оружие задаёт базу боя» не существует. */
export function simWeaponItem(weapon: SimWeapon): Item {
  const template = WEAPON_BY_ID[weapon.templateId]
  if (!template) throw new Error(`unknown weapon template: ${weapon.templateId}`)
  const rarity = RARITY_BY_ID[weapon.rarity ?? 'common']
  const mods = weaponMods(template, rarity)
  return {
    id: `sim-weapon-${template.id}`,
    name: template.noun,
    rarity: rarity.id,
    slot: 'weapon',
    // Голое оружие — только база боя: скорость и диапазон урона.
    mods: weapon.bare ? mods.filter((m) => m.kind === 'base') : mods,
  }
}

function settingsFor(autocast: SimBuild['autocast']): AbilitySettings {
  if (autocast === undefined || autocast === 'all') return defaultAbilitySettings()
  if (autocast === 'none') return manualOnlySettings()
  const settings = manualOnlySettings()
  autocast.forEach((id, index) => {
    if (settings[id]) settings[id] = { autocast: true, priority: index }
  })
  // Невыбранные умения уходят в конец списка приоритетов.
  ABILITIES.filter((a) => !autocast.includes(a.id)).forEach((a, index) => {
    settings[a.id] = { autocast: false, priority: autocast.length + index }
  })
  return settings
}

/** Стартовое состояние прогона: билд разложен по тем же источникам статов,
 *  что и в живой игре, поэтому конвейер считает его обычным путём. */
export function buildSimState(build: SimBuild, zoneId: string, seed: number): GameState {
  const zone = zoneById(zoneId)
  const level = new Decimal(build.level ?? 1)
  const weapon = build.weapon === null ? null : build.weapon ? simWeaponItem(build.weapon) : null
  const base = createInitialState(seed)
  const state: GameState = {
    ...base,
    level,
    currentXp: new Decimal(0),
    xpToNext: xpToNextLevel(level),
    upgrades: build.sharpening
      ? { 'weapon-sharpening': new Decimal(build.sharpening) }
      : {},
    talents: { ...(build.talents ?? {}) },
    equipment: { ...base.equipment, weapon },
    abilitySettings: settingsFor(build.autocast),
    // Прогон меряет ЗАДАННЫЙ билд: автонадевание подменило бы его на середине.
    autoEquip: false,
    currentZoneId: zone.id,
    // Смерть отбрасывает в последнюю зону, где герой выживал. Ставим её сразу:
    // иначе первая же смерть увела бы прогон в безопасную зону и он мерил бы
    // не ту зону, которую просили.
    lastSurvivedZoneId: zone.id,
    monster: spawnMonster(zone, createRng(seed)),
    statsDirty: true,
  }
  const ready = ensureStats(state)
  return { ...ready, currentHp: ready.stats.maxHp, currentMana: ready.stats.maxMana }
}

// Совокупный опыт от первого уровня: сумма пройденных порогов плюс остаток.
// Нужен, потому что при повышении уровня currentXp обнуляется, и разностью
// по состоянию опыт за прогон не посчитать.
export function totalXpEarned(level: Decimal, currentXp: Decimal): Decimal {
  let sum = currentXp
  const levels = level.toNumber()
  for (let l = 1; l < levels; l++) sum = sum.plus(xpToNextLevel(new Decimal(l)))
  return sum
}

// Лучшая по опыту ОТКРЫТАЯ зона: тот же zoneRate, которым игра считает прогноз.
function bestZoneId(state: GameState): string {
  let best = state.currentZoneId
  let bestXp = new Decimal(-1)
  for (const zone of ZONES) {
    if (!isZoneUnlocked(state, zone)) continue
    const xp = zoneRate(state, zone, 'auto').xpPerSecond
    if (xp.gt(bestXp)) {
      bestXp = xp
      best = zone.id
    }
  }
  return best
}

/**
 * N игровых часов настоящим конвейером тика. Возвращает метрики темпа.
 *
 * Зона задаётся напрямую, БЕЗ проверки unlockRequirement: это измерительный
 * прибор, и «что будет, если сунуться раньше времени» — законный вопрос.
 * Правило входа живёт в `travelToZone` и продолжает работать в игре.
 */
export function simulate(options: SimOptions): SimResult {
  const { hours, zoneId, build = {}, seed = 12345, travel = 'stay', freezeLevel = false } = options
  const rng = createRng(seed)
  let state = buildSimState(build, zoneId, seed)
  const startLevel = state.level
  const startGold = state.gold
  const frozen = { level: state.level, currentXp: state.currentXp, xpToNext: state.xpToNext }

  let xp = new Decimal(0)
  let kills = new Decimal(0)
  let deaths = 0
  let deadMs = 0
  let autoDamage = new Decimal(0)
  let abilityDamage = new Decimal(0)
  let manaSpent = new Decimal(0)
  let casts = 0
  const levelReachedAtSec: Record<number, number> = {}

  // Урон копим прямо из шины ударов тика: это те же события, что рисуют
  // цифры на экране, — отдельного учёта урона симуляция не заводит.
  const collect = (event: AttackEvent) => {
    if (event.targetId === 'hero') return
    if (event.abilityId === null) autoDamage = autoDamage.plus(event.amount)
    else abilityDamage = abilityDamage.plus(event.amount)
  }

  const steps = Math.round((hours * 3600 * 1000) / STEP_MS)
  for (let step = 1; step <= steps; step++) {
    const prev = state
    state = tick(prev, STEP_MS, rng, collect)

    // Опыт копим потиково: при повышении уровня currentXp обнуляется, поэтому
    // разность по концам прогона его не увидит. Пока уровень тот же — растёт
    // только остаток; на самом уровне считаем через совокупный опыт.
    xp = xp.plus(
      state.level.eq(prev.level)
        ? state.currentXp.minus(prev.currentXp)
        : totalXpEarned(state.level, state.currentXp).minus(
            totalXpEarned(prev.level, prev.currentXp),
          ),
    )

    // Убийство видно снаружи по взведённому таймеру респауна: во время
    // отсчёта он только убывает, вверх его двигает ровно смерть моба.
    if (prev.respawnMsLeft <= 0 && state.respawnMsLeft > 0) kills = kills.plus(1)
    if (prev.heroState === 'alive' && state.heroState === 'dead') deaths += 1
    if (state.heroState === 'dead') deadMs += STEP_MS
    // Каст виден по кулдауну: он тоже только убывает, а вверх его ставит
    // только применение умения (см. payFor в abilities.ts).
    for (const ability of ABILITIES) {
      const before = prev.abilityCooldownsMs[ability.id] ?? 0
      const after = state.abilityCooldownsMs[ability.id] ?? 0
      if (after > before) {
        casts += 1
        manaSpent = manaSpent.plus(ABILITY_BY_ID[ability.id].manaCost)
      }
    }
    if (state.level.gt(prev.level)) {
      const level = state.level.toNumber()
      if (levelReachedAtSec[level] === undefined) {
        levelReachedAtSec[level] = (step * STEP_MS) / 1000
      }
      if (travel === 'best') state = travelToZone(state, bestZoneId(state), rng)
      // Откат уровня делаем ПОСЛЕ учёта опыта: метрики видят настоящий темп,
      // а статы героя остаются теми, про которые спросили. statsDirty уже
      // взведён шагом уровня — следующий тик пересчитает конвейер обратно.
      if (freezeLevel) state = { ...state, ...frozen, statsDirty: true }
    }
  }

  const seconds = hours * 3600
  const gold = state.gold.minus(startGold)
  const xpPerSecond = xp.div(seconds)
  const remaining = state.xpToNext.minus(state.currentXp)
  return {
    hours,
    zoneId: state.currentZoneId,
    startZoneId: zoneId,
    killsPerHour: kills.div(hours),
    goldPerHour: gold.div(hours),
    xpPerHour: xp.div(hours),
    deathsPerHour: deaths / hours,
    secondsToNextLevel: xpPerSecond.lte(0) ? null : remaining.div(xpPerSecond).toNumber(),
    startLevel,
    finalLevel: state.level,
    kills,
    gold,
    xp,
    deaths,
    uptime: 1 - deadMs / (seconds * 1000),
    autoDamage,
    abilityDamage,
    manaSpent,
    casts,
    damagePerMana: manaSpent.lte(0) ? null : abilityDamage.div(manaSpent),
    levelReachedAtSec,
  }
}
