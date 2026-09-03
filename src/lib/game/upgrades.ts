// Покупки за золото: цена, правила и применение. Текста для игрока здесь нет —
// только коды отказа, как у умений, талантов и крафта.
import { Decimal } from './numbers'
import type { GameState } from './state'
import {
  GOLD_UPGRADES,
  GOLD_UPGRADE_BY_ID,
  LOOT_POLICIES,
  type GoldUpgradeDef,
  type LootPolicy,
} from '../data/upgrades'
import { INVENTORY_SIZE } from '../data/balance'
import { goldPerHourAt } from '../data/recipes'

/**
 * ЦЕНА ПОКУПКИ — доля часового дохода СВОЕГО уровня, как и пошлина крафта.
 * Второй модели дохода в игре нет: `goldPerHourAt` берётся там же, где её
 * берёт `craftToll`, и правка кривой золота двигает обе цены сразу.
 */
export function upgradeCost(def: GoldUpgradeDef): Decimal {
  return goldPerHourAt(def.level).times(def.costHours).ceil()
}

export type UpgradeBlockReason = 'owned' | 'level' | 'gold'

export interface UpgradeStatus {
  def: GoldUpgradeDef
  canBuy: boolean
  reason: UpgradeBlockReason | null
  cost: Decimal
  /** Сколько золота не хватает. Ноль — хватает. */
  short: Decimal
}

export function upgradeStatus(state: GameState, def: GoldUpgradeDef): UpgradeStatus {
  const cost = upgradeCost(def)
  const short = Decimal.max(cost.minus(state.gold), new Decimal(0))
  const blocked = (reason: UpgradeBlockReason): UpgradeStatus => ({
    def,
    canBuy: false,
    reason,
    cost,
    short,
  })
  if (state.purchasedUpgradeIds.includes(def.id)) return blocked('owned')
  // Уровень — первым: эта причина не лечится золотом.
  if (state.level.lt(def.level)) return blocked('level')
  if (short.gt(0)) return blocked('gold')
  return { def, canBuy: true, reason: null, cost, short }
}

/**
 * ЧТО ВИДНО НА ЭКРАНЕ. Закрытая покупка не показывается вовсе — то же
 * правило, что у разделов: интригу держит лестница открытий, а не серая
 * кнопка с ценой, до которой ещё сорок уровней. Купленная тоже уходит:
 * список покупок — это «что можно взять», а не витрина достижений.
 */
export function availableUpgrades(state: GameState): UpgradeStatus[] {
  return GOLD_UPGRADES.filter(
    (def) => state.level.gte(def.level) && !state.purchasedUpgradeIds.includes(def.id),
  ).map((def) => upgradeStatus(state, def))
}

/** Купить. Нельзя — состояние не меняется вовсе, причину показывает кнопка. */
export function buyUpgrade(state: GameState, id: string): GameState {
  const def = GOLD_UPGRADE_BY_ID[id]
  if (!def) return state
  const status = upgradeStatus(state, def)
  if (!status.canBuy) return state
  return {
    ...state,
    gold: state.gold.minus(status.cost),
    purchasedUpgradeIds: [...state.purchasedUpgradeIds, def.id],
  }
}

/**
 * РАЗМЕР СУМКИ — ПРОИЗВОДНАЯ от покупок, а не поле состояния. Отдельное поле
 * пришлось бы чинить миграцией при каждой правке лестницы и разъезжалось бы
 * с ней молча; здесь оно пересчитывается из списка купленного, как статы
 * пересчитываются из источников.
 */
export function inventorySize(state: Pick<GameState, 'purchasedUpgradeIds'>): number {
  let size = INVENTORY_SIZE
  for (const id of state.purchasedUpgradeIds) {
    const effect = GOLD_UPGRADE_BY_ID[id]?.effect
    if (effect?.kind === 'bag') size += effect.slots
  }
  return size
}

/**
 * Какие положения переключателя «что делать с лишним» открыты. «Не трогать»
 * открыто всегда — это и есть игра без покупок.
 */
export function availableLootPolicies(state: Pick<GameState, 'purchasedUpgradeIds'>): LootPolicy[] {
  const open = new Set<LootPolicy>(['keep'])
  for (const id of state.purchasedUpgradeIds) {
    const effect = GOLD_UPGRADE_BY_ID[id]?.effect
    if (effect?.kind === 'policy') open.add(effect.policy)
  }
  return LOOT_POLICIES.filter((p) => open.has(p))
}

/** Действующее положение: купленное игроком, но не выше открытого. */
export function lootPolicyOf(state: Pick<GameState, 'purchasedUpgradeIds' | 'lootPolicy'>): LootPolicy {
  return availableLootPolicies(state).includes(state.lootPolicy) ? state.lootPolicy : 'keep'
}
