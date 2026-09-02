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

/**
 * ЛЕЧЕНИЕ — ФЛАГ С PAYLOAD'ом, а не отдельный тип умения и не ветка по id.
 * Умение с этим полем не бьёт (его `weaponDamagePercent` — ноль), а
 * возвращает долю МАКСИМАЛЬНОГО здоровья: плоское число устарело бы к
 * тридцатому уровню. `autocastBelowHpShare` — порог, ниже которого автокаст
 * жмёт его первым: это и есть развилка «урон или выжить», ради которой
 * у класса на мане должно быть лечение.
 */
export interface AbilityHeal {
  /** Доля максимального здоровья за одно применение, 0..1. */
  maxHpShare: Decimal
  /** Автокаст лечит, когда здоровье ниже этой доли запаса, 0..1. */
  autocastBelowHpShare: number
}

export interface AbilityDef {
  id: string
  name: string
  /** Иконка. Тип выведен из реестра: опечатка — ошибка проверки типов. */
  icon: IconName
  type: AbilityType
  /** С какого уровня героя умение доступно. Кнопки открываются постепенно:
   *  первая с 1-го, дальше по одной, чтобы новичок не тонул в трёх сразу.
   *  У каждого класса ровно одно умение первого уровня — держит схема. */
  unlockLevel: number
  manaCost: Decimal
  cooldownSec: number
  weaponDamagePercent: Decimal // урон удара умения в долях удара оружия; у лечения ноль
  triggersGcd: boolean
  effect?: AbilityEffect
  /** Лечащее умение: см. AbilityHeal. Только у мгновенных. */
  heal?: AbilityHeal
}

export const ABILITIES: AbilityDef[] = [
  {
    id: 'quick-strike',
    icon: 'ability-quick-strike',
    name: 'Скорый выпад',
    type: 'instant',
    unlockLevel: 1,
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
    unlockLevel: 4,
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
    // ЛЕЧЕНИЕ СТРАЖА. Мана без лечения — это ярость под другим именем: пока
    // весь запас уходил в урон, выбирать было нечего. Четверть запаса за
    // применение — больше цены среднего боя (9–15 %), чтобы спасённый цикл
    // продолжался, а не кончался следующим же привалом. ПОРОГ АВТОКАСТА 0.55
    // — на пять пунктов НИЖЕ порога привала по умолчанию (0.6): медианный
    // бой (8–11 % запаса) до него не доходит, и герой садится отдыхать, как
    // и раньше; лечение срабатывает в бою глубже медианного — с здоровяком
    // или из запаса у самого порога. Замер тиком на эталонном герое (три
    // часа, 25/55/85 уровни): порог 0.5 снимал 10–13 % простоя на привалах,
    // порог 0.55 — 28–33 %; цель стадии 20–35 %. Порог у порога привала
    // (0.6 и выше) убирал бы привалы вовсе — мана окупает лечение с запасом.
    // Откат 12 с — короче цикла привала, но длиннее боя: дважды за один бой
    // не лечит. Цена 25 маны при запасе 360 на 25 уровне — заметная доля
    // всплеска боевых умений: на 25 уровне лечение стоит 5 % темпа, на 55 и
    // 85 — окупается.
    id: 'mend-wounds',
    icon: 'ability-mend-wounds',
    name: 'Заживление ран',
    type: 'instant',
    unlockLevel: 6,
    manaCost: new Decimal(25),
    cooldownSec: 12,
    weaponDamagePercent: new Decimal(0),
    triggersGcd: true,
    heal: { maxHpShare: new Decimal(0.25), autocastBelowHpShare: 0.55 },
  },
  {
    id: 'shattering-blow',
    icon: 'ability-shattering-blow',
    name: 'Сокрушение',
    type: 'onNextSwing',
    unlockLevel: 8,
    manaCost: new Decimal(30),
    cooldownSec: 12,
    weaponDamagePercent: new Decimal(5.0),
    triggersGcd: false,
  },

  // --- Умения Изувера ---
  // Ярость приходит из боя, а не со временем, поэтому её умения дешевле по
  // отдельности и с короткими кулдаунами: узкое место у изувера не откат,
  // а то, успел ли он накопить. Ритм другой, суммарный урон — тот же.
  {
    id: 'gut-rip',
    icon: 'ability-gut-rip',
    name: 'Потрошащий взмах',
    type: 'instant',
    unlockLevel: 1,
    manaCost: new Decimal(18),
    cooldownSec: 2,
    weaponDamagePercent: new Decimal(1.6),
    triggersGcd: true,
  },
  {
    id: 'blood-frenzy',
    icon: 'ability-blood-frenzy',
    name: 'Кровавое исступление',
    type: 'onNextSwing',
    unlockLevel: 4,
    manaCost: new Decimal(30),
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
    id: 'skull-splitter',
    icon: 'ability-skull-splitter',
    name: 'Череполом',
    type: 'onNextSwing',
    unlockLevel: 8,
    manaCost: new Decimal(60),
    cooldownSec: 12,
    weaponDamagePercent: new Decimal(5.0),
    triggersGcd: false,
  },
]

export const ABILITY_BY_ID: Record<string, AbilityDef> = Object.fromEntries(
  ABILITIES.map((a) => [a.id, a]),
)
