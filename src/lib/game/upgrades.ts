// Покупка апгрейдов: чистые операции над состоянием, без DOM и Svelte.
import { Decimal } from './numbers'
import { upgradeCost } from './formulas'
import type { GameState } from './state'
import type { UpgradeDef } from '../types'

export function ownedCount(state: GameState, def: UpgradeDef): Decimal {
  return state.upgrades[def.id] ?? new Decimal(0)
}

// Покупает один апгрейд, если хватает золота; иначе возвращает состояние как есть.
export function buyUpgrade(state: GameState, def: UpgradeDef): GameState {
  const owned = ownedCount(state, def)
  const cost = upgradeCost(def, owned)
  if (state.gold.lt(cost)) return state
  return {
    ...state,
    gold: state.gold.minus(cost),
    baseDamage: state.baseDamage.plus(def.damageBonus),
    upgrades: { ...state.upgrades, [def.id]: owned.plus(1) },
  }
}
