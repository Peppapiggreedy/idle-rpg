// Единый конвейер статов — ЕДИНСТВЕННЫЙ источник правды для производных чисел.
// Никакой код за пределами этого модуля не меняет итоговые статы иначе, чем
// добавив или убрав модификатор (см. collectModifiers).
//
// Порядок применения СТРОГО фиксирован:
//   base -> + сумма всех flat -> * (1 + сумма всех percent) -> * произведение multiplier
// Ступень base: модификатор kind 'base' ЗАМЕНЯЕТ значение по умолчанию из
// data/balance.ts (не прибавляется к нему). Контракт — ровно один base-источник
// на стат (например, надетое оружие задаёт weaponSpeed); если base-модификаторов
// нет, берётся дефолт из BASE_STATS; если их несколько, выигрывает ПОСЛЕДНИЙ в
// порядке collectModifiers — поведение зафиксировано тестом, а не случайно.
// Проценты складываются аддитивно (+20% и +30% дают +50%, а не 1.2*1.3);
// множители перемножаются. Менять порядок нельзя — это баланс.
import { Decimal } from './numbers'
import type { GameState } from './state'
import { BASE_STATS } from '../data/balance'
import { UPGRADES } from '../data/upgrades'

// Модифицируемые статы. swingTime сюда НЕ входит намеренно: это производная
// величина, её нельзя модифицировать напрямую — только через weaponSpeed/haste.
export type StatId =
  | 'attackPower'
  | 'weaponDamageMin'
  | 'weaponDamageMax'
  | 'maxHp'
  | 'maxMana'
  | 'weaponSpeed'
  | 'haste'
  | 'critChance'
  | 'critMultiplier'
  | 'hpRegen'
  | 'hpRegenOutOfCombat'
  | 'manaRegen'
  | 'damageReduction'

export const STAT_IDS: StatId[] = [
  'attackPower',
  'weaponDamageMin',
  'weaponDamageMax',
  'maxHp',
  'maxMana',
  'weaponSpeed',
  'haste',
  'critChance',
  'critMultiplier',
  'hpRegen',
  'hpRegenOutOfCombat',
  'manaRegen',
  'damageReduction',
]

export type ModifierKind = 'base' | 'flat' | 'percent' | 'multiplier'

export interface StatModifier {
  stat: StatId
  kind: ModifierKind
  // base — замена базового значения; flat — абсолютная прибавка;
  // percent — доля (0.2 = +20%); multiplier — множитель.
  value: Decimal
  // Обязательный человекочитаемый источник: 'upgrade:weapon-sharpening',
  // 'equipment:weapon', 'talent:heavy_blows', 'zone:ashen_wastes'. UI показывает
  // раскладку по source построчно.
  source: string
}

// Готовые статы. Вероятности/доли/секунды — number (правило CLAUDE.md),
// неограниченно растущие величины — Decimal.
export interface StatBlock {
  attackPower: Decimal // сила атаки: вклад в удар через AP_NORMALIZATION
  weaponDamageMin: Decimal // нижняя граница урона оружия
  weaponDamageMax: Decimal // верхняя граница урона оружия
  maxHp: Decimal
  maxMana: Decimal
  weaponSpeed: number // секунд между ударами оружия (меньше = быстрее)
  haste: number // ускорение в долях: 0.2 = +20% скорости (больше = быстрее)
  swingTime: number // ПРОИЗВОДНАЯ: weaponSpeed / (1 + haste), секунд на замах
  critChance: number // вероятность 0..1
  critMultiplier: Decimal
  hpRegen: Decimal // в бою
  hpRegenOutOfCombat: Decimal // вне боя (пауза респауна)
  manaRegen: Decimal
  damageReduction: number // доля 0..1
}

// Все источники модификаторов персонажа. Новые системы (экипировка, таланты,
// зоны) добавляют свои модификаторы СЮДА — и автоматически попадают и в
// пересчёт, и в раскладку на панели статов.
export function collectModifiers(state: GameState): StatModifier[] {
  const mods: StatModifier[] = []
  // Апгрейды: урон пересчитывается из СЧЁТЧИКА покупок, а не хранится суммой.
  for (const def of UPGRADES) {
    const owned = state.upgrades[def.id]
    if (!owned || owned.lte(0)) continue
    mods.push({
      stat: 'attackPower',
      kind: 'flat',
      value: def.damageBonus.times(owned),
      source: `upgrade:${def.id}`,
    })
  }
  return mods
}

// Эффективное базовое значение: последний base-модификатор либо дефолт баланса.
function effectiveBase(stat: StatId, mods: StatModifier[]): Decimal {
  let base = BASE_STATS[stat]
  for (const mod of mods) {
    if (mod.stat === stat && mod.kind === 'base') base = mod.value
  }
  return base
}

// Применяет конвейер к одной стате: base -> +flat -> *(1+percent) -> *multiplier.
function computeStat(stat: StatId, mods: StatModifier[]): Decimal {
  let flat = new Decimal(0)
  let percent = new Decimal(0)
  let multiplier = new Decimal(1)
  for (const mod of mods) {
    if (mod.stat !== stat) continue
    if (mod.kind === 'flat') flat = flat.plus(mod.value)
    else if (mod.kind === 'percent') percent = percent.plus(mod.value)
    else if (mod.kind === 'multiplier') multiplier = multiplier.times(mod.value)
  }
  return effectiveBase(stat, mods).plus(flat).times(percent.plus(1)).times(multiplier)
}

// Время замаха: скорость оружия, ускоренная haste. Меньше = чаще бьём.
export function computeSwingTime(weaponSpeed: number, haste: number): number {
  return weaponSpeed / (1 + haste)
}

// Чистое ядро конвейера: набор модификаторов -> готовый StatBlock.
export function applyModifiers(mods: StatModifier[]): StatBlock {
  const weaponSpeed = computeStat('weaponSpeed', mods).toNumber()
  const haste = computeStat('haste', mods).toNumber()
  return {
    attackPower: computeStat('attackPower', mods),
    weaponDamageMin: computeStat('weaponDamageMin', mods),
    weaponDamageMax: computeStat('weaponDamageMax', mods),
    maxHp: computeStat('maxHp', mods),
    maxMana: computeStat('maxMana', mods),
    weaponSpeed,
    haste,
    swingTime: computeSwingTime(weaponSpeed, haste),
    critChance: computeStat('critChance', mods).toNumber(),
    critMultiplier: computeStat('critMultiplier', mods),
    hpRegen: computeStat('hpRegen', mods),
    hpRegenOutOfCombat: computeStat('hpRegenOutOfCombat', mods),
    manaRegen: computeStat('manaRegen', mods),
    damageReduction: computeStat('damageReduction', mods).toNumber(),
  }
}

export function recomputeStats(state: GameState): StatBlock {
  return applyModifiers(collectModifiers(state))
}

// Кеш: пересчёт только при statsDirty — флаг взводят операции, меняющие набор
// источников (покупка апгрейда, загрузка сейва); чистое чтение бесплатно.
// При смене swingTime прогресс замаха пересчитывается пропорционально: смена
// оружия или баффа в середине замаха не сбрасывает удар и не даёт мгновенный.
export function ensureStats(state: GameState): GameState {
  if (!state.statsDirty) return state
  const stats = recomputeStats(state)
  const oldSwingTime = state.stats?.swingTime
  let swingTimerMs = state.swingTimerMs
  if (oldSwingTime && oldSwingTime > 0 && stats.swingTime > 0 && oldSwingTime !== stats.swingTime) {
    swingTimerMs = (swingTimerMs * stats.swingTime) / oldSwingTime
  }
  return { ...state, stats, swingTimerMs, statsDirty: false }
}

// Раскладка одной статы для панели «Статы»: откуда взялась итоговая цифра.
export interface StatBreakdown {
  stat: StatId
  base: Decimal // эффективная база (с учётом base-модификатора)
  baseSource: string | null // источник базы; null — дефолт из баланса
  entries: StatModifier[] // flat/percent/multiplier, влияющие на стат
  total: Decimal
}

export function explainStat(state: GameState, stat: StatId): StatBreakdown {
  const mods = collectModifiers(state).filter((m) => m.stat === stat)
  const baseMods = mods.filter((m) => m.kind === 'base')
  return {
    stat,
    base: effectiveBase(stat, mods),
    baseSource: baseMods.length > 0 ? baseMods[baseMods.length - 1].source : null,
    entries: mods.filter((m) => m.kind !== 'base'),
    total: computeStat(stat, mods),
  }
}

// Раскладка производного swingTime: логика отдаёт числа, текст рендерит UI.
export interface SwingTimeBreakdown {
  weaponSpeed: number
  haste: number
  swingTime: number
}

export function explainSwingTime(state: GameState): SwingTimeBreakdown {
  const { weaponSpeed, haste, swingTime } = state.stats
  return { weaponSpeed, haste, swingTime }
}
