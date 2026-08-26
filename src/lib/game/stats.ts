// Единый конвейер статов — ЕДИНСТВЕННЫЙ источник правды для производных чисел.
// Никакой код за пределами этого модуля не меняет итоговые статы иначе, чем
// добавив или убрав модификатор (см. collectModifiers).
//
// Порядок применения СТРОГО фиксирован:
//   base -> + сумма всех flat -> * (1 + сумма всех percent) -> * произведение multiplier
// Проценты складываются аддитивно (+20% и +30% дают +50%, а не 1.2*1.3);
// множители перемножаются. Менять порядок нельзя — это баланс.
import { Decimal } from './numbers'
import type { GameState } from './state'
import { BASE_STATS } from '../data/balance'
import { UPGRADES } from '../data/upgrades'

export type StatId =
  | 'attackPower'
  | 'maxHp'
  | 'maxMana'
  | 'attackSpeed'
  | 'critChance'
  | 'critMultiplier'
  | 'hpRegen'
  | 'manaRegen'
  | 'damageReduction'

export const STAT_IDS: StatId[] = [
  'attackPower',
  'maxHp',
  'maxMana',
  'attackSpeed',
  'critChance',
  'critMultiplier',
  'hpRegen',
  'manaRegen',
  'damageReduction',
]

export type ModifierKind = 'flat' | 'percent' | 'multiplier'

export interface StatModifier {
  stat: StatId
  kind: ModifierKind
  // flat — абсолютная прибавка; percent — доля (0.2 = +20%); multiplier — множитель.
  value: Decimal
  // Обязательный человекочитаемый источник: 'base', 'upgrade:weapon-sharpening',
  // 'equipment:weapon', 'talent:heavy_blows', 'zone:ashen_wastes'. UI показывает
  // раскладку по source построчно.
  source: string
}

// Готовые статы. Вероятности/доли/секунды — number (правило CLAUDE.md),
// неограниченно растущие величины — Decimal.
export interface StatBlock {
  attackPower: Decimal
  maxHp: Decimal
  maxMana: Decimal
  attackSpeed: number // секунд между ударами
  critChance: number // вероятность 0..1
  critMultiplier: Decimal
  hpRegen: Decimal
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

// Применяет конвейер к одной стате: base -> +flat -> *(1+percent) -> *multiplier.
function computeStat(stat: StatId, mods: StatModifier[]): Decimal {
  let flat = new Decimal(0)
  let percent = new Decimal(0)
  let multiplier = new Decimal(1)
  for (const mod of mods) {
    if (mod.stat !== stat) continue
    if (mod.kind === 'flat') flat = flat.plus(mod.value)
    else if (mod.kind === 'percent') percent = percent.plus(mod.value)
    else multiplier = multiplier.times(mod.value)
  }
  return BASE_STATS[stat].plus(flat).times(percent.plus(1)).times(multiplier)
}

export function recomputeStats(state: GameState): StatBlock {
  const mods = collectModifiers(state)
  return {
    attackPower: computeStat('attackPower', mods),
    maxHp: computeStat('maxHp', mods),
    maxMana: computeStat('maxMana', mods),
    attackSpeed: computeStat('attackSpeed', mods).toNumber(),
    critChance: computeStat('critChance', mods).toNumber(),
    critMultiplier: computeStat('critMultiplier', mods),
    hpRegen: computeStat('hpRegen', mods),
    manaRegen: computeStat('manaRegen', mods),
    damageReduction: computeStat('damageReduction', mods).toNumber(),
  }
}

// Кеш: пересчёт только при statsDirty — флаг взводят операции, меняющие набор
// источников (покупка апгрейда, загрузка сейва); чистое чтение бесплатно.
export function ensureStats(state: GameState): GameState {
  if (!state.statsDirty) return state
  return { ...state, stats: recomputeStats(state), statsDirty: false }
}

// Раскладка одной статы для панели «Статы»: откуда взялась итоговая цифра.
export interface StatBreakdown {
  stat: StatId
  base: Decimal
  entries: StatModifier[]
  total: Decimal
}

export function explainStat(state: GameState, stat: StatId): StatBreakdown {
  const mods = collectModifiers(state).filter((m) => m.stat === stat)
  return { stat, base: BASE_STATS[stat], entries: mods, total: computeStat(stat, mods) }
}
