// Единственный источник оценки боевого темпа. Использовать и в UI (урон в
// секунду), и в оффлайн-агрегате — чтобы формула боя не жила в двух местах.
import { Decimal } from './numbers'
import type { GameState } from './state'
import { RESPAWN_DELAY_MS } from '../data/balance'

export interface CombatRate {
  damagePerSecond: Decimal // средний урон в секунду с учётом матожидания критов
  killsPerSecond: Decimal // убийств в секунду с учётом дискретных ударов и респауна
}

export function estimateCombatRate(state: GameState): CombatRate {
  // Матожидание множителя урона: 1 + шанс_крита * (множитель - 1).
  const critFactor = new Decimal(1).plus(
    state.critMultiplier.minus(1).times(state.critChance),
  )
  const damagePerSecond = state.damagePerSwing
    .times(critFactor)
    .div(state.attackSpeed)
  // Ударов на моба считаем по базовому урону (без критов): дискретность важнее
  // редких критов, при крит-шансе ~5% погрешность оценки в пределах пары процентов.
  const hitsPerKill = state.monster.maxHp.div(state.damagePerSwing).ceil()
  const killCycleSec = hitsPerKill.times(state.attackSpeed).plus(RESPAWN_DELAY_MS / 1000)
  return { damagePerSecond, killsPerSecond: new Decimal(1).div(killCycleSec) }
}
