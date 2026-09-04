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

/**
 * СВЯЗКА: умение работает только вместе с другим.
 *
 * Данными, а не веткой по id: «Разрыв» съедает кровотечение «Рваной раны», и
 * без неё в четвёрке он бесполезен. Интерфейс ОБЯЗАН сказать это прямо — иначе
 * игрок выясняет связку опытом, а четвёрка из одиннадцати выбирается вслепую.
 */
export interface AbilityCombo {
  /** Без какого умения в ряду это не работает. */
  needsAbilityId: string
}

/**
 * ОСЛАБЛЕНИЕ ЦЕЛИ: следующие её удары слабее. Флаг с payload'ом, как лечение,
 * а не свой тип умения: «дешёвый защитный удар» — это роль, а не механика.
 */
export interface AbilityWeaken {
  /** На какую долю слабее удар противника, 0..1. */
  damageShare: number
  /** Сколько ближайших ударов ослаблено. */
  hits: number
}

/**
 * ДЕТОНАТОР: съедает эффект по времени с цели и наносит его ОСТАТОК сразу,
 * с множителем. Своей цели умение не выбирает и своего эффекта не знает —
 * берёт то, что на мобе уже висит; поэтому связка описывается ДАННЫМИ
 * (`combo`), а не веткой по id в логике.
 */
export interface AbilityDetonate {
  /** Множитель к оставшемуся урону эффекта. */
  multiplier: number
}

/**
 * ПОГЛОЩЕНИЕ: щит на несколько секунд. Величина растёт ОТ БРОНИ И СИЛЫ
 * БЛОКА — так у щита появляется второй адрес, кроме самого блока, и
 * защитная сборка получает умение, которое её усиливает.
 */
export interface AbilityAbsorb {
  /** Доля брони героя в запасе щита. */
  armorShare: number
  /** Доля силы блока в запасе щита. */
  blockShare: number
  durationSec: number
}

/**
 * ДОБИВАНИЕ: умение доступно только когда цель ниже порога здоровья. Дёшево,
 * множитель большой — в бою на 8–15 секунд срабатывает один раз и укорачивает
 * ХВОСТ боя, то есть бьёт прямо по темпу.
 */
export interface AbilityExecute {
  /** Доступно, пока здоровье цели ниже этой доли запаса, 0..1. */
  belowHpShare: number
}

/**
 * КЛЕЙМО: цель получает больше урона какое-то время. Против рядового моба,
 * живущего 8–15 секунд, окупается едва; против босса — сильно. Это первое
 * умение, из-за которого четвёрку осмысленно менять ПЕРЕД боссом.
 */
export interface AbilityBrand {
  /** На какую долю больше урона получает цель, 0..1 и выше. */
  damageShare: number
  durationSec: number
  /**
   * АВТОКАСТ НЕ КЛЕЙМИТ УМИРАЮЩЕГО. Порог здоровья цели, выше которого
   * автокаст вообще берётся за клеймо: на мобе, который и так вот-вот умрёт,
   * оно не окупается, а ресурс тратит — и делал бы это систематически.
   * Руками игрок волен ставить его когда угодно.
   */
  autocastAboveHpShare: number
}

/**
 * СОСРЕДОТОЧЕНИЕ: следующие несколько умений ничего не стоят. Ценность
 * целиком зависит от того, насколько дорога остальная четвёрка: с дешёвой —
 * почти ноль, с дорогой — много. Экономика ресурса как козырь.
 */
export interface AbilityFreeCasts {
  /** Сколько ближайших применений бесплатны. */
  casts: number
}

/**
 * СТОЙКА: длинный собственный эффект — урон ниже, смягчение выше. Занимает
 * слот постоянно и обменивает одну ось на другую прямо, без обиняков.
 * Длительность примерно равна откату: автокаст просто поддерживает её, и
 * новых механизмов для этого не нужно.
 */
export interface AbilityStance {
  /** На какую долю ниже свой урон, 0..1. */
  damageShare: number
  /** На какую долю выше смягчение входящего, 0..1. */
  mitigationShare: number
  durationSec: number
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
  /** Связка с другим умением: см. AbilityCombo. Нет поля — умение самостоятельно. */
  combo?: AbilityCombo
  /** Ослабляет следующие удары цели: см. AbilityWeaken. */
  weaken?: AbilityWeaken
  /** Съедает эффект по времени с цели: см. AbilityDetonate. */
  detonate?: AbilityDetonate
  /** Поглощает урон героя: см. AbilityAbsorb. */
  absorb?: AbilityAbsorb
  /** Добивание: см. AbilityExecute. */
  execute?: AbilityExecute
  /** Клеймо на цель: см. AbilityBrand. */
  brand?: AbilityBrand
  /** Бесплатные применения: см. AbilityFreeCasts. */
  freeCasts?: AbilityFreeCasts
  /** Стойка: см. AbilityStance. */
  stance?: AbilityStance
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
    // ТОЛЧОК ЩИТОМ. Конкурирует со «Скорым выпадом» за одну и ту же нишу
    // дешёвого заполнителя — и это первый выбор в игре: урон или сохранность.
    // Урона вдвое меньше, зато следующий удар противника слабее. Числа
    // черновые: под бюджет их сводит стадия 5.
    id: 'shield-shove',
    icon: 'ability-shield-shove',
    name: 'Толчок щитом',
    type: 'instant',
    unlockLevel: 2,
    manaCost: new Decimal(7),
    cooldownSec: 8,
    weaponDamagePercent: new Decimal(0.3),
    triggersGcd: true,
    weaken: { damageShare: 0.4, hits: 1 },
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
  {
    // РАЗРЫВ. Съедает кровотечение с цели и наносит его остаток сразу с
    // множителем. БЕЗ «РВАНОЙ РАНЫ» В ЧЕТВЁРКЕ БЕСПОЛЕЗЕН, и связка названа
    // данными (`combo`) — интерфейс обязан сказать это прямо, а логика
    // берёт с моба ЛЮБОЙ эффект по времени, а не «эффект такого-то умения».
    id: 'rupture',
    icon: 'ability-rupture',
    name: 'Разрыв',
    type: 'onNextSwing',
    unlockLevel: 10,
    manaCost: new Decimal(20),
    cooldownSec: 8,
    weaponDamagePercent: new Decimal(1.2),
    triggersGcd: false,
    detonate: { multiplier: 1.5 },
    combo: { needsAbilityId: 'rending-wound' },
  },
  {
    // СТЕНА. Поглощает урон несколько секунд, и запас щита растёт ОТ БРОНИ И
    // СИЛЫ БЛОКА: у щита появляется второй адрес, кроме самого блока. Бьёт
    // нулём — это поддержка, как и лечение, и схема знает про это отдельно.
    id: 'bulwark',
    icon: 'ability-bulwark',
    name: 'Стена',
    type: 'instant',
    unlockLevel: 12,
    manaCost: new Decimal(28),
    cooldownSec: 25,
    weaponDamagePercent: new Decimal(0),
    triggersGcd: true,
    absorb: { armorShare: 0.5, blockShare: 4, durationSec: 8 },
  },
  {
    // МИЛОСТЬ. Доступна только на добивании: в бою на 8–15 секунд срабатывает
    // один раз и укорачивает хвост. Дёшево и с большим множителем — это не
    // прибавка к урону, а срезанный конец боя.
    id: 'mercy',
    icon: 'ability-mercy',
    name: 'Милость',
    type: 'instant',
    unlockLevel: 14,
    manaCost: new Decimal(16),
    cooldownSec: 12,
    weaponDamagePercent: new Decimal(1.1),
    triggersGcd: true,
    execute: { belowHpShare: 0.25 },
  },
  {
    // КЛЕЙМО. Двадцать секунд повышенного урона: рядовому мобу оно едва
    // окупается, боссу — сильно. Ради него четвёрку и меняют перед данжем.
    // ТИП СМЕНЁН С onNextSwing НА instant, и это не косметика. Очередь на
    // замах ОДНА, и в ней уже стоят «Рваная рана» и «Сокрушение»: клеймо
    // конкурировало с ними за один и тот же замах, а платой за него был не
    // ресурс, а ЧУЖОЙ удар. При двух заходах усиления (+0.25 → +0.4 → +0.55)
    // оно так и не вошло ни в одну верхнюю четвёрку — потому что дело было не
    // в числе. Мгновенным оно платит общей задержкой, как и положено метке:
    // повесил и бьёшь дальше своим.
    id: 'brand',
    icon: 'ability-brand',
    name: 'Клеймо',
    type: 'instant',
    unlockLevel: 16,
    manaCost: new Decimal(18),
    cooldownSec: 20,
    weaponDamagePercent: new Decimal(1.0),
    triggersGcd: true,
    brand: { damageShare: 0.55, durationSec: 20, autocastAboveHpShare: 0.5 },
  },
  {
    // СОСРЕДОТОЧЕНИЕ. Само по себе не бьёт почти ничего: его ценность — цена
    // ТРЁХ следующих умений, то есть чужая. С дешёвой четвёркой это пустышка,
    // с дорогой — козырь.
    id: 'focus',
    icon: 'ability-focus',
    name: 'Сосредоточение',
    type: 'instant',
    unlockLevel: 18,
    manaCost: new Decimal(0),
    cooldownSec: 45,
    weaponDamagePercent: new Decimal(0.5),
    triggersGcd: true,
    freeCasts: { casts: 3 },
  },
  {
    // ГЛУХАЯ СТОЙКА. Прямой обмен одной оси на другую, и он должен быть
    // ЗАМЕТНЫМ: половина смягчения за четверть урона. Длительность равна
    // откату — автокаст поддерживает её без единого нового правила.
    id: 'stance',
    icon: 'ability-stance',
    name: 'Глухая стойка',
    type: 'instant',
    unlockLevel: 20,
    manaCost: new Decimal(15),
    cooldownSec: 30,
    weaponDamagePercent: new Decimal(0.6),
    triggersGcd: true,
    stance: { damageShare: 0.3, mitigationShare: 0.15, durationSec: 30 },
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
