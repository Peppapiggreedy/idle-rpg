// Активные умения — чистые данные. Урон выражен ДОЛЕЙ УДАРА ОРУЖИЯ
// (weaponDamagePercent), а не множителем к силе атаки: иначе умения перестали
// бы масштабироваться от оружия, и менять оружие было бы незачем.
import { Decimal } from '../game/numbers'

// instant       — срабатывает сразу, тратит GCD, таймер автоатаки не трогает.
// onNextSwing   — встаёт в очередь и ЗАМЕНЯЕТ следующую автоатаку: GCD не
//                 тратит, отменяется повторным нажатием, мана списывается
//                 в момент удара. В очереди одновременно только одно такое.
export type AbilityType = 'instant' | 'onNextSwing'

// Эффект умения. Пока один вид — урон по времени; урон тика тоже в долях
// удара оружия, поэтому эффект масштабируется вместе с ним.
export interface AbilityEffect {
  kind: 'damageOverTime'
  weaponDamagePercent: Decimal // урон ОДНОГО тика
  ticks: number
  tickIntervalSec: number
}

export interface AbilityDef {
  id: string
  name: string
  type: AbilityType
  manaCost: Decimal
  cooldownSec: number
  weaponDamagePercent: Decimal // урон удара умения в долях удара оружия
  triggersGcd: boolean
  effect?: AbilityEffect
}

export const ABILITIES: AbilityDef[] = [
  {
    id: 'quick-strike',
    name: 'Скорый выпад',
    type: 'instant',
    manaCost: new Decimal(8),
    cooldownSec: 3,
    weaponDamagePercent: new Decimal(0.7),
    triggersGcd: true,
  },
  {
    id: 'rending-wound',
    name: 'Рваная рана',
    type: 'onNextSwing',
    manaCost: new Decimal(14),
    cooldownSec: 9,
    weaponDamagePercent: new Decimal(1.1),
    triggersGcd: false,
    effect: {
      kind: 'damageOverTime',
      weaponDamagePercent: new Decimal(0.25),
      ticks: 4,
      tickIntervalSec: 1.5,
    },
  },
  {
    id: 'shattering-blow',
    name: 'Сокрушение',
    type: 'onNextSwing',
    manaCost: new Decimal(32),
    cooldownSec: 22,
    weaponDamagePercent: new Decimal(3.4),
    triggersGcd: false,
  },
]

export const ABILITY_BY_ID: Record<string, AbilityDef> = Object.fromEntries(
  ABILITIES.map((a) => [a.id, a]),
)
