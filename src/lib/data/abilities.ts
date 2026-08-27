// Активные умения — чистые данные. Урон выражен ДОЛЕЙ УДАРА ОРУЖИЯ
// (weaponDamagePercent), а не множителем к силе атаки: иначе умения перестали
// бы масштабироваться от оружия, и менять оружие было бы незачем.
import type { IconName } from '../ui/icons/manifest'
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
  /** Иконка. Тип выведен из реестра: опечатка — ошибка проверки типов. */
  icon: IconName
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
    icon: 'ability-quick-strike',
    name: 'Скорый выпад',
    type: 'instant',
    manaCost: new Decimal(9),
    cooldownSec: 2,
    weaponDamagePercent: new Decimal(1.6),
    triggersGcd: true,
  },
  {
    id: 'rending-wound',
    icon: 'ability-rending-wound',
    name: 'Рваная рана',
    type: 'onNextSwing',
    manaCost: new Decimal(15),
    cooldownSec: 5,
    weaponDamagePercent: new Decimal(1.8),
    triggersGcd: false,
    effect: {
      kind: 'damageOverTime',
      weaponDamagePercent: new Decimal(0.5),
      ticks: 3,
      tickIntervalSec: 1.5,
    },
  },
  {
    id: 'shattering-blow',
    icon: 'ability-shattering-blow',
    name: 'Сокрушение',
    type: 'onNextSwing',
    manaCost: new Decimal(30),
    cooldownSec: 12,
    weaponDamagePercent: new Decimal(5.0),
    triggersGcd: false,
  },
]

export const ABILITY_BY_ID: Record<string, AbilityDef> = Object.fromEntries(
  ABILITIES.map((a) => [a.id, a]),
)
