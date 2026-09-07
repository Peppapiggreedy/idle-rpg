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
  /**
   * НАДБАВКА К МНОЖИТЕЛЮ ЗА ПОЛНУЮ ПОЛОСКУ РЕСУРСА. Ноль или поля нет —
   * детонатор от ресурса не зависит вовсе (так у Стража). У ярости это
   * второй смысл копить: полоска перестаёт быть только счётом кастов и
   * становится числом, которое сама по себе усиливает удар.
   */
  resourceMultiplier?: number
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

/**
 * ГЕНЕРАТОР: умение, которое ресурс НЕ ТРАТИТ, А ДАЁТ.
 *
 * Классу на ярости он нужен по построению, а не для разнообразия: ярость
 * приходит только из боя, значит первые секунды схватки герой почти пуст
 * (замер стадии 2 — 17 % запаса на входе). Дешёвая кнопка, которая эту паузу
 * окупает, — не роскошь, а условие того, что ротация вообще заводится.
 *
 * Доля ЗАПАСА, а не число: запас поднимают таланты, и плоская прибавка
 * обесценивалась бы ровно там, где в неё вложились.
 */
export interface AbilityGenerate {
  /** Сколько запаса приходит за применение, доля 0..1. */
  resourceShare: number
}

/**
 * ВАМПИРИЗМ: доля нанесённого ЭТИМ УДАРОМ урона возвращается здоровьем.
 *
 * Не второе лечение, а другое лечение: у манного класса оно стоит запаса и
 * работает всегда, здесь — стоит УДАРА и работает тем лучше, чем лучше идёт
 * бой. Проигранный бой оно не спасает, и это главное его свойство.
 */
export interface AbilityLeech {
  /** Какая доля урона возвращается здоровьем, 0..1 и выше. */
  healShare: number
}

/**
 * УПОР: смягчение растёт ЗА НЕПРЕРЫВНОСТЬ — с каждым пропущенным ударом,
 * пока держится.
 *
 * Обратная сторона класса, который обязан стоять в бою: чем дольше он стоит,
 * тем дешевле ему это обходится. Первый удар проходит целиком, пятый —
 * заметно мягче, и рост упирается в потолок из данных.
 */
export interface AbilityResolve {
  /** На сколько мягче становится входящее с каждым пропущенным ударом. */
  perHitTaken: number
  /** Потолок смягчения, 0..1: без него герой стал бы неуязвимым к концу боя. */
  maxShare: number
  durationSec: number
}

/**
 * ВОЗВРАТ: успешное применение возвращает долю запаса.
 *
 * Стоит на добивании и потому не разгоняет ротацию бесконечно: цель обязана
 * быть при смерти, то есть возврат приходит РАЗ ЗА БОЙ и достаётся
 * следующему бою — ровно там, где у ярости яма.
 */
export interface AbilityRefund {
  /** Доля полного запаса, возвращаемая применением, 0..1. */
  resourceShare: number
}

/**
 * ПЛАТА ЗДОРОВЬЕМ: доля максимума HP превращается в долю запаса.
 *
 * Единственный источник ресурса, не зависящий от боя вовсе, и потому самый
 * опасный: он же и единственная кнопка, которой герой может себя убить.
 * Убить не даёт логика (последнее очко здоровья не снимается), а глупость
 * автокаста — порог `autocast.heroHpAbove` в данных.
 */
export interface AbilityBloodPrice {
  /** Сколько максимального здоровья уходит, доля 0..1. */
  hpShare: number
  /** Сколько запаса приходит взамен, доля 0..1. */
  resourceShare: number
}

/**
 * ОКНО: несколько секунд умения не стоят ничего.
 *
 * Отличие от «Сосредоточения» Стража — не в числах, а в роде: там СЧЁТ
 * применений, здесь ВРЕМЯ. Со счётом окно тем ценнее, чем дороже четвёрка;
 * со временем — чем БЫСТРЕЕ она откатывается. Для ярости это и есть верный
 * род: узкое место у неё не откат, а то, успел ли герой накопить.
 */
export interface AbilityWindow {
  durationSec: number
}

/**
 * КОГДА АВТОКАСТ БЕРЁТСЯ ЗА УМЕНИЕ. Пороги В ДАННЫХ, ни одной ветки в логике.
 *
 * Умение, которое автокаст не умеет применять разумно, — плохое умение в
 * идл-игре, даже если в руках оно сильное. Поэтому у ситуативных умений
 * условие лежит здесь: плата здоровьем не жмётся на последних процентах
 * полоски, детонатор — на умирающем мобе, генератор и окно — на полном
 * запасе. РУКАМИ игрок волен жать что угодно: это пороги автокаста, а не
 * запреты игры.
 */
export interface AbilityAutocast {
  /** Только пока здоровье героя выше этой доли запаса. */
  heroHpAbove?: number
  /** Только пока цель здоровее этой доли своего запаса. */
  targetHpAbove?: number
  /** Только пока своего ресурса МЕНЬШЕ этой доли запаса. */
  resourceBelow?: number
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
  /** Даёт ресурс вместо траты: см. AbilityGenerate. */
  generate?: AbilityGenerate
  /** Возвращает здоровье за нанесённый урон: см. AbilityLeech. */
  leech?: AbilityLeech
  /** Смягчение за непрерывность боя: см. AbilityResolve. */
  resolve?: AbilityResolve
  /** Возврат ресурса за успешное применение: см. AbilityRefund. */
  refund?: AbilityRefund
  /** Здоровье в ресурс: см. AbilityBloodPrice. */
  bloodPrice?: AbilityBloodPrice
  /** Окно бесплатных умений: см. AbilityWindow. */
  window?: AbilityWindow
  /** Пороги автокаста: см. AbilityAutocast. */
  autocast?: AbilityAutocast
}

/**
 * ЧТО ТАЛАНТ ВПРАВЕ ПОДКРУТИТЬ У УМЕНИЯ. Список ЗАКРЫТЫЙ и лежит здесь, в
 * данных: талант не может править то, что не объявлено настраиваемым.
 *
 * Без такого списка сорок талантов про умения означали бы сорок вариантов
 * «что именно меняется», то есть сорок веток логики — при прямом запрете
 * «ни одного if (талант === ...)». С ним талант описывает ПОЛЕ и ОПЕРАЦИЮ,
 * а применяет их один общий конвейер.
 *
 * ДВА РОДА ПОЛЕЙ, И ОПЕРАЦИИ У НИХ РАЗНЫЕ:
 *
 *   'scale' — величина: откат, стоимость, урон, длительность, число тиков,
 *             доля поглощения. Её масштабируют — `percent` или `multiplier`.
 *   'shift' — ПОРОГ УСЛОВИЯ (добивание, автокаст клейма, автокаст лечения).
 *             Порог живёт в долях 0..1, и множить его нельзя: «на 20 % выше»
 *             от 0.2 это 0.24, а игрок читает пороги в ПУНКТАХ. Поэтому
 *             только сдвиг: `points`.
 *
 * Тип умения (`instant` ↔ `onNextSwing`) — не величина и не порог, его
 * только ЗАМЕНЯЮТ целиком.
 */
export const ABILITY_TUNABLE = {
  cooldownSec: 'scale',
  manaCost: 'scale',
  weaponDamagePercent: 'scale',
  effectWeaponDamagePercent: 'scale',
  effectTicks: 'scale',
  healMaxHpShare: 'scale',
  weakenDamageShare: 'scale',
  weakenHits: 'scale',
  detonateMultiplier: 'scale',
  absorbArmorShare: 'scale',
  absorbBlockShare: 'scale',
  absorbDurationSec: 'scale',
  brandDamageShare: 'scale',
  brandDurationSec: 'scale',
  freeCastsCasts: 'scale',
  stanceDamageShare: 'scale',
  stanceMitigationShare: 'scale',
  stanceDurationSec: 'scale',
  generateResourceShare: 'scale',
  leechHealShare: 'scale',
  resolveMaxShare: 'scale',
  resolvePerHitTaken: 'scale',
  resolveDurationSec: 'scale',
  refundResourceShare: 'scale',
  bloodPriceResourceShare: 'scale',
  windowDurationSec: 'scale',
  detonateResourceMultiplier: 'scale',
  executeBelowHpShare: 'shift',
  brandAutocastAboveHpShare: 'shift',
  healAutocastBelowHpShare: 'shift',
  autocastHeroHpAbove: 'shift',
} as const

export type AbilityTuneField = keyof typeof ABILITY_TUNABLE
export type ScaleField = {
  [K in AbilityTuneField]: (typeof ABILITY_TUNABLE)[K] extends 'scale' ? K : never
}[AbilityTuneField]
export type ShiftField = {
  [K in AbilityTuneField]: (typeof ABILITY_TUNABLE)[K] extends 'shift' ? K : never
}[AbilityTuneField]

/**
 * ОДНА ПРАВКА ОДНОГО ПОЛЯ. Форма нарочно та же, что у модификатора статов:
 * поле, род операции, значение — и значение множится на ранг, как везде.
 *
 * `multiplier` возводится в СТЕПЕНЬ ранга, а не множится на него: два ранга
 * «вдвое дольше» — это вчетверо, а не «умножить на 4». У `percent` и
 * `points` сложение по рангам — то же самое действие, повторённое дважды,
 * поэтому там обычное умножение.
 */
export type AbilityTune =
  | { field: ScaleField; kind: 'percent' | 'multiplier'; value: number }
  | { field: ShiftField; kind: 'points'; value: number }
  | { field: 'type'; kind: 'set'; value: AbilityType }

/**
 * КАКОЙ ПОЛНОТОЙ ПОЛОСКИ МОДЕЛЬ СЧИТАЕТ ДЕТОНАТОР, растущий от ресурса.
 *
 * Тик читает настоящую полоску, а модель боя — долгосрочное среднее, и
 * текущего запаса в ней нет вовсе (её вход — статы и моб, а не секунда боя).
 * Половина — это середина шкалы, и она же близка к замеру: у эталонного
 * Изувера полоска ходит от 17 % на входе в бой до полной перед крупным
 * умением. Число лежит В ДАННЫХ рядом с самим полем, а не в модели: правка
 * умения и правка допущения о нём обязаны быть видны в одном месте.
 */
export const MODEL_RESOURCE_FILL = 0.5

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
    // ПОРОГ 0.20, А НЕ 0.25. Милость срабатывает реже — и это решение о
    // самом умении: добивание обязано быть окном, а не почти-всегда-доступной
    // кнопкой. Число видно игроку: описание собирается из этого поля.
    execute: { belowHpShare: 0.2 },
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
    manaCost: new Decimal(10),
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
    manaCost: new Decimal(17),
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
    manaCost: new Decimal(33),
    cooldownSec: 12,
    weaponDamagePercent: new Decimal(5.0),
    triggersGcd: false,
  },
  {
    // КРОВОПУСКАНИЕ — РАЗГОН. Второй уровень, потому что раньше он не нужен,
    // а позже уже поздно: с первой же схватки герой упирается в полторы
    // секунды немоты, и это единственная кнопка, которая её укорачивает.
    // Сама ничего не стоит и бьёт слабо: она про РЕСУРС, а не про урон.
    // Четверть запаса за применение — два «Потрошащих взмаха».
    id: 'blood-letting',
    icon: 'ability-blood-letting',
    name: 'Кровопускание',
    type: 'instant',
    unlockLevel: 2,
    manaCost: new Decimal(0),
    cooldownSec: 6,
    weaponDamagePercent: new Decimal(0.5),
    triggersGcd: true,
    generate: { resourceShare: 0.25 },
    // На полной полоске автокаст его не жмёт: лишняя ярость сгорает, а ГКД
    // тратится настоящий.
    autocast: { resourceBelow: 0.7 },
  },
  {
    // ЖАЖДА — ЛЕЧЕНИЕ, КОТОРОЕ ПЛАТИТ УРОНОМ. У Изувера нет ни лечащего
    // умения, ни налива ресурса привалом; цена схватки при этом ВЫШЕ, чем у
    // Стража (17.95 % против 16.52 валово). Возвращать здоровье он обязан
    // тем, что умеет, — ударом. Шестой уровень — тот же, на котором лечение
    // приходит к Стражу: правило одно, механика разная.
    id: 'blood-thirst',
    icon: 'ability-blood-thirst',
    name: 'Жажда',
    type: 'instant',
    unlockLevel: 6,
    manaCost: new Decimal(14),
    cooldownSec: 9,
    weaponDamagePercent: new Decimal(1.4),
    triggersGcd: true,
    // ДОЛЯ ПОДОБРАНА ЗАМЕРОМ, А НЕ НА ГЛАЗ. При 0.7 «Жажда» одна снимала
    // цену боя с 17.0 % до 4.0 % — то есть класс переставал ходить на привал
    // вовсе, а вместе с привалом исчезал и весь риск. При 0.35 она снимает
    // около трети счёта — примерно столько же, сколько лечение снимает
    // Стражу (16.5 % валово против 10.0 % нетто).
    leech: { healShare: 0.35 },
  },
  {
    // РАЗРЫВ ЖИЛ — ДЕТОНАТОР, КОТОРЫЙ ЧИТАЕТ ПОЛОСКУ. Съедает кровотечение
    // «Кровавого исступления», как «Разрыв» у Стража, но множитель растёт от
    // полноты ярости: 1.2 на пустой полоске и 2.5 на полной. Отсюда у ярости
    // появляется второй смысл, кроме счёта кастов, — накопить перед ударом.
    id: 'sinew-tear',
    icon: 'ability-sinew-tear',
    name: 'Разрыв жил',
    type: 'onNextSwing',
    unlockLevel: 10,
    manaCost: new Decimal(15),
    cooldownSec: 8,
    weaponDamagePercent: new Decimal(1.2),
    triggersGcd: false,
    detonate: { multiplier: 1.2, resourceMultiplier: 1.3 },
    combo: { needsAbilityId: 'blood-frenzy' },
    // Не рвать умирающего: остаток кровотечения на нём и так почти дотикает,
    // а откат уйдёт.
    autocast: { targetHpAbove: 0.35 },
  },
  {
    // УПОР — СМЯГЧЕНИЕ ЗА НЕПРЕРЫВНОСТЬ. Класс, который обязан стоять в бою,
    // получает награду именно за это: каждый пропущенный удар делает
    // следующий мягче, до потолка в 24 %. Стойка Стража даёт своё смягчение
    // сразу и целиком; здесь оно НАРАСТАЕТ, то есть окупается в долгом бою и
    // не окупается в коротком.
    id: 'dug-in',
    icon: 'ability-dug-in',
    name: 'Упор',
    type: 'instant',
    unlockLevel: 12,
    manaCost: new Decimal(16),
    cooldownSec: 24,
    weaponDamagePercent: new Decimal(0.4),
    triggersGcd: true,
    resolve: { perHitTaken: 0.05, maxShare: 0.24, durationSec: 14 },
  },
  {
    // РАСПРАВА — ДОБИВАНИЕ, ВОЗВРАЩАЮЩЕЕ ЯРОСТЬ. Порог тот же, что у
    // «Милости» Стража (0.2), и урон сопоставим; разница в том, что здесь
    // добивание платит НЕ ТОЛЬКО уроном: пятая часть запаса переезжает в
    // следующий бой — то есть ровно в ту яму, с которой у ярости начинается
    // каждая схватка.
    id: 'reckoning',
    icon: 'ability-reckoning',
    name: 'Расправа',
    type: 'instant',
    unlockLevel: 14,
    manaCost: new Decimal(12),
    cooldownSec: 10,
    weaponDamagePercent: new Decimal(1.3),
    triggersGcd: true,
    execute: { belowHpShare: 0.2 },
    refund: { resourceShare: 0.2 },
  },
  {
    // КРОВАВАЯ ПЛАТА — ЗДОРОВЬЕ В ЯРОСТЬ. Единственный источник ресурса,
    // который не зависит от боя, и потому самый опасный: 12 % запаса
    // здоровья за 45 % ярости. Здоровье у Изувера — расходник (см. «Жажда»),
    // и это осознанный обмен одной оси на другую.
    //
    // АВТОКАСТ НЕ ЖМЁТ ЕЁ НА НИЗКОМ ЗДОРОВЬЕ (порог 0.65 — выше порога
    // привала 0.6): иначе герой платил бы здоровьем ровно тогда, когда
    // собрался отдыхать, и оплачивал бы привал сам себе.
    id: 'blood-price',
    icon: 'ability-blood-price',
    name: 'Кровавая плата',
    type: 'instant',
    unlockLevel: 16,
    manaCost: new Decimal(0),
    cooldownSec: 18,
    weaponDamagePercent: new Decimal(0.3),
    triggersGcd: true,
    bloodPrice: { hpShare: 0.12, resourceShare: 0.45 },
    autocast: { heroHpAbove: 0.65, resourceBelow: 0.4 },
  },
  {
    // КРОВАВЫЙ РЁВ — ОКНО. Восемь секунд, в которые умения не стоят ничего.
    // От «Сосредоточения» Стража отличается РОДОМ, а не числом: там счёт
    // применений, здесь время. Ярости это подходит: её узкое место не откат,
    // а накопление, и окно снимает именно его — на восемь секунд герой жмёт
    // всё, что откатилось.
    //
    // Само окно стоит ярости: платить за скидку нельзя было бы, будь она
    // счётной («Сосредоточение» бесплатно и обязано быть таким), но окно во
    // времени тратится и впустую — если жать нечего.
    id: 'blood-roar',
    icon: 'ability-blood-roar',
    name: 'Кровавый рёв',
    type: 'instant',
    unlockLevel: 18,
    manaCost: new Decimal(20),
    cooldownSec: 60,
    weaponDamagePercent: new Decimal(0.5),
    triggersGcd: true,
    window: { durationSec: 8 },
  },
  {
    // БЕШЕНСТВО — СТОЙКА НАОБОРОТ, и это ТОТ ЖЕ флаг с обратным знаком, а не
    // второй механизм. Стойка Стража: урон ниже, смягчение выше. Здесь:
    // урон ВЫШЕ на четверть, смягчение НИЖЕ на пятнадцать пунктов. Схема
    // держит правило «обмен обязан быть обменом» — знаки обеих долей
    // совпадают, и чистого усиления из этого поля не сделать.
    id: 'berserk',
    icon: 'ability-berserk',
    name: 'Бешенство',
    type: 'instant',
    unlockLevel: 20,
    manaCost: new Decimal(15),
    cooldownSec: 30,
    weaponDamagePercent: new Decimal(0.6),
    triggersGcd: true,
    stance: { damageShare: -0.25, mitigationShare: -0.15, durationSec: 30 },
  },
]

export const ABILITY_BY_ID: Record<string, AbilityDef> = Object.fromEntries(
  ABILITIES.map((a) => [a.id, a]),
)
