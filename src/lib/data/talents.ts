
// =============================================================================
// Дерево талантов — данные. Ни одного «если талант такой-то» в логике:
// талант либо выдаёт модификаторы в конвейер статов, либо поднимает флаг,
// а поведение по флагу описано там же, в данных, вместе со своим payload.
//
// ДЕРЕВО ПРИВЯЗАНО К КЛАССУ. У каждого класса свои три ветки, и они не
// пересекаются: класс — это не только набор кнопок, но и то, во что растёт
// герой. Логика нигде не спрашивает «а это страж?» — она берёт ветки класса
// из данных (branchesOfClass) и работает с ними одинаково.
//
// ГЛУБИНА ВЕТКИ — РОВНО 61 ОЧКО, и это число не случайное. Очко даётся за
// уровень с TALENT_FIRST_LEVEL = 10, потолок уровня — сотый, значит за всю
// игру герой заработает 91 очко. Одна ветка до дна стоит 61 — остаётся 30
// на вторую. Две ветки до дна стоят 122, то есть НЕДОСТИЖИМЫ никогда:
// капстоун один на героя, и выбор ветки — это выбор, а не порядок покупок.
import type { IconName } from '../ui/icons/manifest'
import { Decimal } from '../game/numbers'
import type { ModifierKind, StatId, StatModifier } from '../game/stats'
import type { AbilityEffect, AbilityTune } from './abilities'

// ---------------------------------------------------------------------------
// Форма ветки
// ---------------------------------------------------------------------------

/**
 * Этажей в ветке и на сколько растёт требование каждого следующего.
 * 13 этажей по +5 очков: 0, 5, 10, …, 60.
 */
export const BRANCH_ROWS = 13
export const BRANCH_ROW_STEP = 5

/**
 * ГЛУБИНА И ЁМКОСТЬ — РАЗНЫЕ ВЕЩИ, И ПУТАТЬ ИХ НЕЛЬЗЯ.
 *
 * ГЛУБИНА — сколько очков надо ВЛОЖИТЬ В ВЕТКУ, чтобы открылся последний
 * этаж. Она задана формой: этаж k требует 5·(k−1), значит тринадцатый
 * требует 60. Число фиксированное и от наполнения не зависит.
 *
 * ЁМКОСТЬ — сколько очков ветка ВМЕЩАЕТ целиком, то есть сумма `maxRank`
 * всех её талантов. Она зависит от наполнения и меняется вместе с ним.
 *
 * Пока на этаже стоял ровно один талант, эти два числа почти совпадали (60 и
 * 61) и жили ОДНОЙ константой `BRANCH_DEPTH`. Как только на этаже становится
 * два-три таланта, ёмкость уходит вдвое выше глубины, и всякое место, где
 * смыслы перепутаны, ломается ТИХО: ветка «пройдена до венца» и ветка
 * «заполнена целиком» — разные состояния, и второе недостижимо по построению.
 * Ровно этот дефицит и делает выбор на этаже выбором.
 */
export const BRANCH_DEPTH = (BRANCH_ROWS - 1) * BRANCH_ROW_STEP // 60

/**
 * Этажи концептуальных талантов. Требуют 20, 40 и 60 очков в ветке, то есть
 * становятся 21-м, 41-м и 61-м вложенным очком — при очке за уровень с
 * десятого это ровно 30-й, 50-й и 70-й уровень героя. Отдельного требования
 * по уровню поэтому не нужно: пороги приходят сами.
 */
export const CONCEPT_ROWS: readonly number[] = [5, 9, 13]

/** Последний этаж — капстоун ветки. */
export const CAPSTONE_ROW = BRANCH_ROWS

// ---------------------------------------------------------------------------
// Ветки
// ---------------------------------------------------------------------------

/**
 * Стиль ветки. Ровно три на класс, и это не оформление: по стилю прогон
 * баланса понимает, чего от ветки ждать (урон бьёт сильнее, выносливость реже
 * умирает, автономность реже стоит). Раньше это знание жило таблицей в тесте.
 */
export type BranchStyle = 'damage' | 'survival' | 'autonomy'

export type BranchId =
  | 'warden-wrath'
  | 'warden-bulwark'
  | 'warden-vigil'
  | 'reaver-carnage'
  | 'reaver-sinew'
  | 'reaver-instinct'

export interface BranchDef {
  id: BranchId
  name: string
  /** Чей это стиль роста. Ссылка на data/classes.ts. */
  classId: string
  style: BranchStyle
}

export const BRANCHES: BranchDef[] = [
  // --- Страж: мана, одноручное и щит ---
  { id: 'warden-wrath', name: 'Гнев', classId: 'warden', style: 'damage' },
  { id: 'warden-bulwark', name: 'Оплот', classId: 'warden', style: 'survival' },
  { id: 'warden-vigil', name: 'Бдение', classId: 'warden', style: 'autonomy' },
  // --- Изувер: ярость, два клинка ---
  { id: 'reaver-carnage', name: 'Резня', classId: 'reaver', style: 'damage' },
  { id: 'reaver-sinew', name: 'Жилы', classId: 'reaver', style: 'survival' },
  { id: 'reaver-instinct', name: 'Чутьё', classId: 'reaver', style: 'autonomy' },
]

export const BRANCH_BY_ID: Record<string, BranchDef> = Object.fromEntries(
  BRANCHES.map((b) => [b.id, b]),
)

// ---------------------------------------------------------------------------
// Эффекты
// ---------------------------------------------------------------------------

// Модификатор таланта БЕЗ source: source проставляется как 'talent:<id>',
// а значение умножается на вложенный ранг.
export type TalentModifier = Omit<StatModifier, 'source'>

/**
 * Флаги включают ПОВЕДЕНИЕ, которое модификатором не выразить. У каждого
 * флага есть payload с числом: ослабить талант — правка одной строки здесь,
 * а не в логике. Ни один флаг не читается по id таланта — только по имени
 * флага, поэтому в src/lib/game нет ни одного «если талант такой-то».
 */
export type TalentFlag =
  // Умение начинает накладывать урон по времени (payload — сам эффект).
  | 'ability-learns-effect'
  // У умения появляется второй заряд: кулдаун копит их по одному.
  | 'ability-extra-charge'
  // Автоатака с шансом бьёт дважды (обе руки).
  | 'double-strike'
  // Удачный блок возвращает долю поглощённого урона в атакующего.
  | 'block-reflects'
  // Удачный блок возвращает долю запаса ресурса.
  | 'block-restores-resource'
  // Убийство моба множит оставшиеся кулдауны на долю.
  | 'kill-refunds-cooldowns'
  // Привал множит кулдауны на долю: ноль — снимает все.
  | 'rest-clears-cooldowns'
  // Привал длится долю от обычного.
  | 'shorter-rest'
  // Воскрешение занимает долю обычного времени.
  | 'faster-revive'

/**
 * ТРЕТИЙ РОД ЭФФЕКТА: талант правит УМЕНИЕ ДАННЫМИ.
 *
 * Модификаторами это не выразить (умение — не стат), а флагом пришлось бы
 * заводить по флагу на каждую правку: сорок талантов про умения означали бы
 * сорок вариантов объединения, то есть сорок веток логики — при прямом
 * запрете «ни одного if (талант такой-то)».
 *
 * Здесь талант называет УМЕНИЕ, ПОЛЕ и ОПЕРАЦИЮ, а применяет их один общий
 * конвейер (`game/abilityTune.ts`). Список полей закрыт (`ABILITY_TUNABLE` в
 * data/abilities.ts): талант не может тронуть то, что не объявлено
 * настраиваемым.
 */
export type TalentEffect =
  | { kind: 'modifiers'; mods: TalentModifier[] }
  | { kind: 'ability'; abilityId: string; tune: AbilityTune[] }
  | { kind: 'flag'; flag: 'ability-learns-effect'; abilityId: string; effect: AbilityEffect }
  | { kind: 'flag'; flag: 'ability-extra-charge'; abilityId: string; extraCharges: number }
  | { kind: 'flag'; flag: 'double-strike'; chance: number }
  | { kind: 'flag'; flag: 'block-reflects'; damageShare: number }
  | { kind: 'flag'; flag: 'block-restores-resource'; resourceShare: number }
  | { kind: 'flag'; flag: 'kill-refunds-cooldowns'; cooldownShare: number }
  | { kind: 'flag'; flag: 'rest-clears-cooldowns'; cooldownShare: number }
  | { kind: 'flag'; flag: 'shorter-rest'; durationMultiplier: number }
  | { kind: 'flag'; flag: 'faster-revive'; reviveMultiplier: number }

/**
 * СТРЕЛКА-ПРЕДПОСЫЛКА: талант дорабатывает конкретный талант выше.
 *
 * Ставится ТОЛЬКО там, где это буквально доработка — три-четыре на ветку, не
 * больше. Стрелка ради вида превращает дерево в коридор: если каждый узел
 * требует соседа сверху, альтернативы на этажах перестают браться вовсе, и
 * ветка снова становится лестницей, только с картинками.
 */
export interface TalentRequirement {
  /** Талант той же ветки на этаже ВЫШЕ. */
  talentId: string
  /** Сколько в него надо вложить. По умолчанию один ранг. */
  minRank?: number
}

export interface TalentDef {
  id: string
  name: string
  /** Иконка. Тип выведен из реестра: опечатка — ошибка проверки типов. */
  icon: IconName
  branch: BranchId
  row: number // этаж в ветке, 1 — верхний
  maxRank: number
  requiredPointsInBranch: number // сколько очков нужно вложить в ветку до него
  /** Стрелка от таланта выше; нет поля — талант самостоятельный. */
  requires?: TalentRequirement
  effect: TalentEffect
}

// ---------------------------------------------------------------------------
// Сборка ветки
// ---------------------------------------------------------------------------

/**
 * Что задаётся руками. Этаж и требование считаются из формы ветки, а РАНГ
 * ТЕПЕРЬ ПРИНАДЛЕЖИТ ТАЛАНТУ, а не этажу: пока на этаже был один талант,
 * ранг можно было брать из таблицы по номеру этажа, но у двух альтернатив на
 * одном этаже ранги свои — тем они и различаются.
 */
interface TalentSpec {
  id: string
  name: string
  icon: IconName
  maxRank: number
  /** Стрелка от таланта выше — см. `TalentRequirement`. */
  requires?: TalentRequirement
  effect: TalentEffect
}

/**
 * ЭТАЖ — РЯД ИЗ ОДНОГО, ДВУХ ИЛИ ТРЁХ ТАЛАНТОВ. Массив, а не одна запись:
 * ради этого вся ночь и затевалась. Пустых мест в ряду нет — два таланта
 * значит два, а не два и дырка.
 */
type FloorSpec = TalentSpec[]

const m = (stat: StatId, kind: ModifierKind, value: number): TalentModifier => ({
  stat,
  kind,
  value: new Decimal(value),
})

const mods = (...list: TalentModifier[]): TalentEffect => ({ kind: 'modifiers', mods: list })

/** Талант, правящий умение: короткая запись третьего рода эффекта. */
const tunes = (abilityId: string, ...tune: AbilityTune[]): TalentEffect => ({
  kind: 'ability',
  abilityId,
  tune,
})

// ---------------------------------------------------------------------------
// ЧТО ТАЛАНТУ МОЖНО ТРОГАТЬ, А ЧТО НЕТ
// ---------------------------------------------------------------------------

/**
 * ПЛОСКАЯ ПРИБАВКА К ХАРАКТЕРИСТИКЕ — МЁРТВЫЙ УЗЕЛ, И ЭТО ИЗМЕРЕНО.
 *
 * «+3 к силе» за ранг, шесть рангов — восемнадцать силы, то есть +36 силы
 * атаки. У эталонного Стража это **12.5 % на 25-м уровне, 6.8 % на 55-м и
 * 4.2 % на сотом**: талант, за который платят тем же очком, что и за любой
 * другой, к концу игры превращается в шум. Игрок этого не видит — число на
 * карточке не меняется, — и узел молча становится ловушкой для новичка.
 *
 * Отсюда правило: **талант не трогает четыре базовые характеристики вовсе**,
 * а плоскую прибавку выдаёт только там, где стат сам по себе ДОЛЯ или
 * СЕКУНДЫ. Растёт от снаряжения — только процентом, он не устаревает.
 *
 * ПОЧЕМУ НЕ «ЗАПРЕТИТЬ FLAT ЦЕЛИКОМ», как просилось на словах. Ускорение и
 * шанс крита живут В ДОЛЯХ, и у них `percent` от нуля даёт ноль: «+10 %
 * ускорения» — это `{ haste, flat, 0.1 }` и никак иначе (правило записано в
 * CLAUDE.md и закреплено тестом). Запрет рода сломал бы ровно те таланты,
 * ради которых он затевался. Причина запрета — не слово «flat», а то, что
 * прибавка ОТСТАЁТ ОТ УРОВНЯ; у доли этой болезни нет.
 */
export type TalentStatRule =
  /** Четыре базовые: таланту нельзя ВОВСЕ — ни плоско, ни процентом. */
  | 'attribute'
  /** Настройка игрока: он ставит её сам и ждёт, что игра ей следует. */
  | 'setting'
  /** Доля 0..1 — плоская прибавка к ней и ЕСТЬ процент, она не устаревает. */
  | 'share'
  /** Секунды: время не растёт с уровнем, плоская правка честна и здесь. */
  | 'seconds'
  /** Растёт от снаряжения и уровня: плоская прибавка отстаёт — только процент. */
  | 'scaling'

export const TALENT_STAT_RULE: Record<StatId, TalentStatRule> = {
  strength: 'attribute',
  agility: 'attribute',
  intellect: 'attribute',
  vitality: 'attribute',
  restThreshold: 'setting',
  haste: 'share',
  critChance: 'share',
  critMultiplier: 'share',
  blockChance: 'share',
  damageReduction: 'share',
  offhandPenalty: 'share',
  regenDelay: 'seconds',
  restDuration: 'seconds',
  attackPower: 'scaling',
  weaponDamageMin: 'scaling',
  weaponDamageMax: 'scaling',
  offhandSpeed: 'scaling',
  offhandDamageMin: 'scaling',
  offhandDamageMax: 'scaling',
  blockValue: 'scaling',
  maxHp: 'scaling',
  maxMana: 'scaling',
  weaponSpeed: 'scaling',
  hpRegen: 'scaling',
  hpRegenOutOfCombat: 'scaling',
  manaRegen: 'scaling',
  armor: 'scaling',
}

/**
 * Ветка из тринадцати ЭТАЖЕЙ. Этаж и требование берутся ИЗ ФОРМЫ, а не
 * пишутся руками у каждой записи: иначе арифметика порогов расползлась бы по
 * сотне литералов и разъехалась при первой же правке. Ранг приходит от
 * самого таланта — см. `TalentSpec`.
 */
function branch(id: BranchId, floors: FloorSpec[]): TalentDef[] {
  return floors.flatMap((floor, index) =>
    floor.map((spec) => ({
      ...spec,
      branch: id,
      row: index + 1,
      requiredPointsInBranch: index * BRANCH_ROW_STEP,
    })),
  )
}

// Урон по времени, которому талант учит умение. Одна форма на оба класса:
// разница между стражем и изувером — в том, КАКОЕ умение учится, а не в том,
// как течёт кровь.
const BLEED: AbilityEffect = {
  kind: 'damageOverTime',
  weaponDamagePercent: new Decimal(0.35),
  ticks: 3,
  tickIntervalSec: 1.5,
}

// ---------------------------------------------------------------------------
// СТРАЖ
// ---------------------------------------------------------------------------

// ГНЕВ: ВСЁ ПРО УДАР — И ТЕПЕРЬ ЭТО ВЫБОР, А НЕ ЛЕСТНИЦА.
//
// Ветка была тринадцатью ступенями по одному таланту: очки просто лились в
// единственный узел, и «дерево» состояло из трёх столбиков. Теперь на каждом
// этаже стоят двое-трое, и очков на всех НЕ ХВАТАЕТ по построению: ёмкость
// ветки 114 очков при глубине 60 и 91 очке у героя сотого уровня. Дефицит и
// делает выбор выбором.
//
// БОЛЬШЕ ПОЛОВИНЫ ТАЛАНТОВ ПРАВЯТ УМЕНИЯ (17 из 27), и начиная со второго
// этажа такой есть на каждом. Ветка, состоящая из процентов, меняет ЧИСЛА;
// ветка, правящая умения, меняет РОТАЦИЮ — а ротация и есть то немногое, чем
// игрок в idle-игре управляет.
//
// ПЛОСКИХ ПРИБАВОК К ХАРАКТЕРИСТИКАМ ЗДЕСЬ НЕТ НИ ОДНОЙ (см.
// TALENT_STAT_RULE): «Крепкая хватка» на +3 силы удалена, а не переписана —
// её место заняли таланты про умения, и это ОБМЕН, а не добавление.
const WARDEN_WRATH = branch('warden-wrath', [
  [
    {
      // 0.027 ВМЕСТО 0.02 (третья ночь, стадия 4: бюджет силы) — здесь и у
      // 'wrath-heavy-swing', двух процентных талантов силы атаки в ветке.
      // 91 очко в лучшей ветке давало ×1.433 темпа при коридоре бюджета
      // 1.45-1.75: ветка стоила дешевле, чем ей отведено. После правки ×1.46.
      id: 'wrath-honed-edge',
      name: 'Отточенный клинок',
      icon: 'talent-honed-edge',
      maxRank: 6,
      effect: mods(m('attackPower', 'percent', 0.01582)),
    },
    {
      // ОТКАТ ЗДЕСЬ ТРОГАТЬ НЕЛЬЗЯ, И ЭТО ЗАМЕРЕНО. У «Скорого выпада» откат
      // 2 секунды при общей задержке 1.5: срезать можно только четверть, а
      // дальше умение упирается в ГКД. Первая редакция таланта резала откат
      // на 35 % — из них работали 25, — и герой в данже первого тира
      // переставал проходить цепочку: пять очков уходили в никуда. Поэтому
      // талант растит УДАР, а дешевизну «Скорого выпада» правит «Скупая
      // кромка» этажом ниже.
      id: 'wrath-firm-hand',
      name: 'Твёрдая рука',
      icon: 'talent-firm-hand',
      maxRank: 5,
      effect: tunes('quick-strike', {
        field: 'weaponDamagePercent',
        kind: 'percent',
        value: 0.04,
      }),
    },
  ],
  [
    {
      id: 'wrath-keen-eye',
      name: 'Острый глаз',
      icon: 'talent-keen-eye',
      maxRank: 6,
      effect: mods(m('critChance', 'flat', 0.00703)),
    },
    {
      // Кровотечение «Рваной раны» — 0.5 удара оружия за тик, три тика.
      // Талант растит ТИК, а не сам удар: ветка на кровь должна окупаться
      // тем, что цель живёт дольше, а не тем, что её быстрее добивают.
      id: 'wrath-deep-cut',
      name: 'Глубокий надрез',
      icon: 'talent-deep-cut',
      maxRank: 5,
      effect: tunes('rending-wound', {
        field: 'effectWeaponDamagePercent',
        kind: 'percent',
        value: 0.08,
      }),
    },
  ],
  [
    {
      id: 'wrath-savage-blows',
      name: 'Свирепые удары',
      icon: 'talent-savage-blows',
      maxRank: 6,
      effect: mods(m('critMultiplier', 'flat', 0.04687)),
    },
    {
      // Цена «Скорого выпада» — 9 маны, самая низкая у класса. Пять рангов
      // срезают её до 5.4: заполнитель перестаёт конкурировать за ману с
      // крупными умениями вовсе.
      id: 'wrath-spare-edge',
      name: 'Скупая кромка',
      icon: 'talent-spare-edge',
      maxRank: 5,
      effect: tunes('quick-strike', { field: 'manaCost', kind: 'percent', value: -0.08 }),
    },
  ],
  [
    {
      id: 'wrath-frenzy',
      name: 'Исступление',
      icon: 'talent-frenzy',
      // Ускорение ВСЕГДА flat по haste и никогда прибавкой к weaponSpeed:
      // процент от нуля даёт ноль, а плоская правка скорости оружия увела бы
      // её в минус. Правило записано в CLAUDE.md и закреплено тестом.
      maxRank: 6,
      effect: mods(m('haste', 'flat', 0.00703)),
    },
    {
      id: 'wrath-swift-shatter',
      name: 'Скорое сокрушение',
      icon: 'talent-swift-shatter',
      maxRank: 5,
      effect: tunes('shattering-blow', { field: 'cooldownSec', kind: 'percent', value: -0.06 }),
    },
  ],
  [
    // 21-е очко, КОНЦЕПТ. Две альтернативы, и ни одна не «сильнее»: обе
    // меняют форму ротации, но в разные стороны.
    {
      // БЬЁТ ПО ПРИЧИНЕ ОБЯЗАТЕЛЬНОСТИ «РВАНОЙ РАНЫ». Она стоит в четвёрке
      // потому, что она единственный безусловный урон по времени; научив
      // кровотечению самое дешёвое умение, талант отбирает у неё монополию —
      // и четвёрка «Скорый выпад + три крупных» становится возможной.
      id: 'wrath-rupture',
      name: 'Рваный выпад',
      icon: 'talent-rupture',
      maxRank: 1,
      effect: {
        kind: 'flag',
        flag: 'ability-learns-effect',
        abilityId: 'quick-strike',
        effect: BLEED,
      },
    },
    {
      // Очередь на замах ОДНА, и «Сокрушение» занимает её на весь откат.
      // Мгновенным оно платит общей задержкой вместо чужого удара — ротация
      // разгружается, но каждый каст стоит полутора секунд ГКД.
      id: 'wrath-headlong',
      name: 'Очертя голову',
      icon: 'talent-headlong',
      maxRank: 1,
      effect: tunes('shattering-blow', { field: 'type', kind: 'set', value: 'instant' }),
    },
  ],
  [
    {
      id: 'wrath-true-aim',
      name: 'Верный глазомер',
      icon: 'talent-keen-eye',
      maxRank: 6,
      effect: mods(m('critChance', 'flat', 0.00469)),
    },
    {
      id: 'wrath-relentless',
      name: 'Неотступность',
      icon: 'talent-relentless',
      maxRank: 5,
      effect: tunes('rupture', { field: 'cooldownSec', kind: 'percent', value: -0.08 }),
    },
    {
      // «КРЕПКАЯ ХВАТКА» ОСТАЛАСЬ НА МЕСТЕ — ПЕРЕПИСАН ТОЛЬКО ЭФФЕКТ, и id у
      // неё прежний: у ветеранов в сейве лежат её ранги, и удалить талант
      // значило бы вернуть им очки свободными — то есть раздать бесплатный
      // сброс за чужой счёт.
      //
      // Было `strength flat 3`: восемнадцать силы — 12.5 % силы атаки на
      // 25-м уровне, 6.8 % на 55-м и 4.2 % на сотом. Процент по замеру на
      // 55-м: 6.8 % / 6 рангов = 1.1 % за ранг. Ветка при этом сохраняет
      // ШИРОКИЙ источник силы, работающий с любой четвёркой, — без него
      // Гнев проседал на данжах у тех, кто играет не тем набором, под
      // который собран путь.
      id: 'wrath-firm-grip',
      name: 'Крепкая хватка',
      icon: 'talent-strength',
      maxRank: 6,
      effect: mods(m('attackPower', 'percent', 0.00644)),
    },
  ],
  [
    {
      id: 'wrath-momentum',
      name: 'Разгон',
      icon: 'talent-relentless',
      maxRank: 7,
      effect: mods(m('haste', 'flat', 0.00469)),
    },
    {
      // Клеймо окупается на долгих схватках, то есть на боссах. Талант
      // усиливает саму уязвимость, а не урон каста: ветка на клеймо должна
      // платить в данже, а не на рядовом мобе.
      id: 'wrath-deep-brand',
      name: 'Глубокое клеймо',
      icon: 'talent-deep-brand',
      maxRank: 5,
      effect: tunes('brand', { field: 'brandDamageShare', kind: 'percent', value: 0.12 }),
    },
  ],
  [
    {
      id: 'wrath-precision',
      name: 'Точность удара',
      icon: 'talent-savage-blows',
      maxRank: 5,
      effect: mods(m('critMultiplier', 'flat', 0.03515)),
    },
    {
      // ПОРОГ СДВИГАЕТСЯ В ПУНКТАХ: 20 % + 5 рангов по 3 = 35 %. Процентом
      // от себя те же пять рангов дали бы 23 %, и талант не читался бы.
      id: 'wrath-wide-mercy',
      name: 'Широкая милость',
      icon: 'talent-wide-mercy',
      maxRank: 5,
      effect: tunes('mercy', { field: 'executeBelowHpShare', kind: 'points', value: 0.03 }),
    },
  ],
  [
    // 41-е очко, КОНЦЕПТ. Белый урон против крови: два разных ответа на один
    // вопрос «откуда берётся урон, когда умения на откате».
    {
      id: 'wrath-double-flourish',
      name: 'Двойной росчерк',
      icon: 'talent-double-strike',
      maxRank: 1,
      effect: { kind: 'flag', flag: 'double-strike', chance: 0.2 },
    },
    {
      // СТРЕЛКА: кровь удваивается только у того, кто её уже растил.
      // Кровотечение перестаёт быть довеском к удару и становится половиной
      // урона умения: шесть тиков вместо трёх и каждый тяжелее.
      id: 'wrath-bleeding-edge',
      name: 'Кровоточащая кромка',
      icon: 'talent-bleed-deep',
      maxRank: 1,
      requires: { talentId: 'wrath-deep-cut', minRank: 3 },
      effect: tunes(
        'rending-wound',
        { field: 'effectTicks', kind: 'percent', value: 0.34 },
        { field: 'effectWeaponDamagePercent', kind: 'percent', value: 0.1 },
      ),
    },
  ],
  [
    {
      id: 'wrath-heavy-swing',
      name: 'Мощь замаха',
      icon: 'talent-honed-edge',
      maxRank: 5,
      effect: mods(m('attackPower', 'percent', 0.01582)),
    },
    {
      // СТРЕЛКА: тот же адрес, что и у «Скорого сокрушения».
      id: 'wrath-heavy-shatter',
      name: 'Тяжёлое сокрушение',
      icon: 'talent-heavy-shatter',
      maxRank: 5,
      requires: { talentId: 'wrath-swift-shatter', minRank: 3 },
      effect: tunes('shattering-blow', {
        field: 'weaponDamagePercent',
        kind: 'percent',
        value: 0.06,
      }),
    },
  ],
  [
    {
      id: 'wrath-light-blade',
      name: 'Лёгкость клинка',
      icon: 'talent-frenzy',
      maxRank: 5,
      effect: mods(m('haste', 'flat', 0.00469)),
    },
    {
      // Три бесплатных применения — вся ценность «Сосредоточения», и она
      // ЧУЖАЯ: талант окупается только с дорогой четвёркой. Штучное поле
      // округляется к ближайшему: три ранга по 34 % дают шесть.
      id: 'wrath-long-focus',
      name: 'Долгое сосредоточение',
      icon: 'talent-long-focus',
      maxRank: 3,
      effect: tunes('focus', { field: 'freeCastsCasts', kind: 'percent', value: 0.34 }),
    },
  ],
  [
    {
      id: 'wrath-cold-blood',
      name: 'Хладнокровие',
      icon: 'talent-cold-blood',
      maxRank: 5,
      effect: mods(m('critChance', 'flat', 0.00586)),
    },
    {
      id: 'wrath-open-vein',
      name: 'Вскрытая жила',
      icon: 'talent-open-vein',
      maxRank: 3,
      effect: tunes('rending-wound', { field: 'effectTicks', kind: 'percent', value: 0.12 }),
    },
  ],
  [
    // 61-е очко, ДВА КАПСТОУНА. Взять оба нельзя не по запрету, а по
    // арифметике: до тринадцатого этажа доходят с 60 очками в ветке, и
    // лишнего очка на второй венец у героя сотого уровня уже не остаётся,
    // если он вложил хоть что-то в соседние ветки.
    {
      // Второй заряд самого дорогого умения: ротация перестаёт упираться в
      // один откат.
      id: 'wrath-second-swing',
      name: 'Второй замах',
      icon: 'talent-second-charge',
      maxRank: 1,
      effect: {
        kind: 'flag',
        flag: 'ability-extra-charge',
        abilityId: 'shattering-blow',
        extraCharges: 1,
      },
    },
    {
      // ВТОРОЙ ВЕНЕЦ — ДЛЯ ДРУГОГО ПУТИ, И ЭТО ОБЯЗАТЕЛЬНО. Ветка с двумя
      // путями и одним венцом — это ветка с одним путём: второй некуда
      // вести. «Второй замах» венчает взрыв, эта запись — кровь.
      //
      // СТРЕЛКА: третья ступень одной и той же мысли (надрез → кромка →
      // рана). Кровотечение перестаёт ждать замаха: «Рваная рана» бьёт
      // сразу, и очередь на замах освобождается под что угодно ещё.
      id: 'wrath-open-wound',
      name: 'Незаживающая рана',
      icon: 'talent-open-wound',
      maxRank: 1,
      requires: { talentId: 'wrath-bleeding-edge' },
      // ТОЛЬКО СМЕНА ТИПА, БЕЗ СРЕЗАННОГО ОТКАТА. Венец обязан менять форму
      // ротации, а не быть «то же самое, но полтора раза»: замер бюджета
      // показал, что откат сверху выводил ветку далеко за свою строку.
      effect: tunes('rending-wound', { field: 'type', kind: 'set', value: 'instant' }),
    },
  ],
])

// ОПЛОТ: ВСЁ ПРО ТО, ЧТОБЫ ДОЖИТЬ ДО КОНЦА СХВАТКИ — И ТЕПЕРЬ ЭТО ВЫБОР.
//
// Ветка была тринадцатью ступенями по одному таланту, и все тринадцать
// прибавляли ЧИСЛА: запас, блок, снижение урона. Половина ветки теперь правит
// защитные УМЕНИЯ — «Стену», «Глухую стойку», «Толчок щитом» и «Заживление
// ран», — потому что защита в бою это не запас, а то, чем герой её тратит.
//
// ТАЛАНТ, БЬЮЩИЙ ПО ПРИЧИНЕ ОБЯЗАТЕЛЬНОСТИ УМЕНИЯ, здесь «Упор». «Скорый
// выпад» стоит в четвёрке потому, что дёшев (9 маны); «Толчок щитом» дешевле
// (7), но за них платят одним и тем же очком выбора, а даёт он треть удара и
// одно ослабление. С «Упором» ослабление держится три удара — и дешёвая
// кнопка перестаёт быть одна.
//
// Числовые таланты срезаны в 0.586 раза — ровно тем же множителем, что и в
// Гневе, и по той же причине: ёмкость ветки выросла с 61 до 118, а строка в
// бюджете силы осталась прежней (см. docs/TALENTS.md, стадия 5).
const WARDEN_BULWARK = branch('warden-bulwark', [
  [
    {
      id: 'bulwark-thick-hide',
      name: 'Толстая шкура',
      icon: 'talent-thick-hide',
      maxRank: 6,
      effect: mods(m('maxHp', 'percent', 0.0293)),
    },
    {
      // Ослабление «Толчка» — 40 % следующего удара цели. Пять рангов дают
      // +40 % к самой доле, то есть 56 %: удар, который герой всё равно
      // получит, становится вдвое слабее.
      id: 'bulwark-press',
      name: 'Плотный заслон',
      icon: 'talent-press',
      maxRank: 5,
      effect: tunes('shield-shove', {
        field: 'weakenDamageShare',
        kind: 'percent',
        value: 0.08,
      }),
    },
  ],
  [
    {
      id: 'bulwark-shield-wall',
      name: 'Стена щитов',
      icon: 'talent-shield-wall',
      maxRank: 6,
      effect: mods(m('blockChance', 'flat', 0.0117)),
    },
    {
      // Щит держится восемь секунд при откате двадцать пять: аптайм — треть.
      // Пять рангов доводят его до половины схватки.
      id: 'bulwark-long-wall',
      name: 'Долгая стена',
      icon: 'talent-long-wall',
      maxRank: 5,
      effect: tunes('bulwark', { field: 'absorbDurationSec', kind: 'percent', value: 0.09 }),
    },
  ],
  [
    {
      id: 'bulwark-training',
      name: 'Выучка заслона',
      icon: 'talent-bulwark-training',
      maxRank: 6,
      effect: mods(m('blockValue', 'percent', 0.117)),
    },
    {
      id: 'bulwark-quick-mend',
      name: 'Скорое врачевание',
      icon: 'talent-quick-mend',
      maxRank: 5,
      effect: tunes('mend-wounds', { field: 'cooldownSec', kind: 'percent', value: -0.06 }),
    },
  ],
  [
    {
      id: 'bulwark-iron-skin',
      name: 'Железная кожа',
      icon: 'talent-iron-skin',
      maxRank: 6,
      effect: mods(m('damageReduction', 'flat', 0.0059)),
    },
    {
      // Стойка режет 15 % оставшегося урона ценой 30 % своего. Талант растит
      // ТОЛЬКО смягчение: цена остаётся, и обмен видно.
      id: 'bulwark-hard-stance',
      name: 'Крепкая стойка',
      icon: 'talent-hard-stance',
      maxRank: 5,
      effect: tunes('stance', { field: 'stanceMitigationShare', kind: 'percent', value: 0.1 }),
    },
  ],
  [
    // 21-е очко, КОНЦЕПТ. Щит кормит ротацию против дешёвой кнопки, которая
    // наконец работает.
    {
      id: 'bulwark-shield-grip',
      name: 'Хватка щита',
      icon: 'talent-block-resource',
      maxRank: 1,
      effect: { kind: 'flag', flag: 'block-restores-resource', resourceShare: 0.05 },
    },
    {
      // БЬЁТ ПО ПРИЧИНЕ ОБЯЗАТЕЛЬНОСТИ «СКОРОГО ВЫПАДА». Ослабление держится
      // три удара вместо одного: «Толчок щитом» перестаёт быть тычком и
      // становится главным защитным умением ротации.
      id: 'bulwark-braced',
      name: 'Упор',
      icon: 'talent-braced',
      maxRank: 1,
      effect: tunes('shield-shove', { field: 'weakenHits', kind: 'percent', value: 2 }),
    },
  ],
  [
    {
      id: 'bulwark-sturdy-frame',
      name: 'Крепость тела',
      icon: 'talent-vitality',
      maxRank: 6,
      // Было `vitality flat 3` — плоская характеристика отстаёт от уровня
      // (см. TALENT_STAT_RULE). Переведено в процент по замеру на 55-м
      // уровне и срезано общим множителем ветки.
      effect: mods(m('maxHp', 'percent', 0.0044)),
    },
    {
      id: 'bulwark-thrift-wall',
      name: 'Скупая стена',
      icon: 'talent-thrift-wall',
      maxRank: 5,
      effect: tunes('bulwark', { field: 'manaCost', kind: 'percent', value: -0.07 }),
    },
    {
      id: 'bulwark-deep-mend',
      name: 'Глубокое врачевание',
      icon: 'talent-deep-mend',
      maxRank: 5,
      effect: tunes('mend-wounds', { field: 'healMaxHpShare', kind: 'percent', value: 0.07 }),
    },
  ],
  [
    {
      id: 'bulwark-battle-breath',
      name: 'Дыхание в бою',
      icon: 'talent-second-wind',
      maxRank: 7,
      effect: mods(m('hpRegen', 'percent', 0.0299)),
    },
    {
      // Длительность стойки равна её откату — автокаст держит её постоянно.
      // Талант этого не ломает, а расширяет запас: с ним стойка переживает
      // и просадку кулдауна от отката умений.
      id: 'bulwark-long-stance',
      name: 'Долгая стойка',
      icon: 'talent-long-stance',
      maxRank: 5,
      effect: tunes('stance', { field: 'stanceDurationSec', kind: 'percent', value: 0.06 }),
    },
  ],
  [
    {
      id: 'bulwark-unyielding',
      name: 'Несгибаемость',
      icon: 'talent-thick-hide',
      maxRank: 7,
      effect: mods(m('maxHp', 'percent', 0.0176)),
    },
    {
      // ПОРОГ АВТОКАСТА ЛЕЧЕНИЯ — В ПУНКТАХ: 55 % + 5 рангов по 2 = 65 %.
      // Лечение начинает срабатывать раньше порога привала, и цикл держится
      // дольше. Правит НАСТРОЙКУ УМЕНИЯ, а не настройку игрока: порог привала
      // таланту трогать нельзя (см. TALENT_STAT_RULE).
      id: 'bulwark-early-call',
      name: 'Ранний зов',
      icon: 'talent-early-call',
      maxRank: 5,
      effect: tunes('mend-wounds', {
        field: 'healAutocastBelowHpShare',
        kind: 'points',
        value: 0.02,
      }),
    },
  ],
  [
    // 41-е очко, КОНЦЕПТ. Смерть дешевле против того, чтобы не умирать.
    {
      id: 'bulwark-swift-return',
      name: 'Скорое возвращение',
      icon: 'talent-swift-return',
      maxRank: 1,
      effect: { kind: 'flag', flag: 'faster-revive', reviveMultiplier: 0.5 },
    },
    {
      // СТРЕЛКА: щит, который герой уже растил. Откат вдвое короче — «Стена»
      // из козыря на схватку превращается в постоянную часть ротации.
      id: 'bulwark-often-wall',
      name: 'Частая стена',
      icon: 'talent-often-wall',
      maxRank: 1,
      requires: { talentId: 'bulwark-long-wall', minRank: 3 },
      effect: tunes('bulwark', { field: 'cooldownSec', kind: 'multiplier', value: 0.5 }),
    },
  ],
  [
    {
      id: 'bulwark-stone-skin',
      name: 'Каменная кожа',
      icon: 'talent-iron-skin',
      maxRank: 5,
      effect: mods(m('damageReduction', 'flat', 0.0047)),
    },
    {
      // СТРЕЛКА: та же «Стена». Щит растёт от брони — талант удваивает эту
      // долю, и броня получает третий адрес после смягчения и блока.
      id: 'bulwark-wide-wall',
      name: 'Широкая стена',
      icon: 'talent-wide-wall',
      maxRank: 5,
      requires: { talentId: 'bulwark-long-wall', minRank: 3 },
      effect: tunes('bulwark', { field: 'absorbArmorShare', kind: 'percent', value: 0.14 }),
    },
  ],
  [
    {
      id: 'bulwark-heavy-guard',
      name: 'Тяжёлый заслон',
      icon: 'talent-bulwark-training',
      maxRank: 5,
      effect: mods(m('blockValue', 'percent', 0.0879)),
    },
    {
      id: 'bulwark-firm-press',
      name: 'Крепкий упор',
      icon: 'talent-firm-press',
      maxRank: 5,
      effect: tunes('shield-shove', { field: 'cooldownSec', kind: 'percent', value: -0.07 }),
    },
  ],
  [
    {
      id: 'bulwark-firm-stance',
      name: 'Твёрдая стойка',
      icon: 'talent-shield-wall',
      maxRank: 5,
      effect: mods(m('blockChance', 'flat', 0.0088)),
    },
    {
      id: 'bulwark-quiet-mend',
      name: 'Тихое врачевание',
      icon: 'talent-quiet-mend',
      maxRank: 3,
      effect: tunes('mend-wounds', { field: 'manaCost', kind: 'percent', value: -0.1 }),
    },
  ],
  [
    // 61-е очко, ДВА КАПСТОУНА: оборона как источник урона против обороны,
    // которая больше ничего не стоит.
    {
      id: 'bulwark-mirror-shield',
      name: 'Зеркальный щит',
      icon: 'talent-block-reflect',
      maxRank: 1,
      effect: { kind: 'flag', flag: 'block-reflects', damageShare: 1 },
    },
    {
      // СТРЕЛКА: венец достаётся тому, кто растил стойку всю ветку. Стойка
      // перестаёт стоить урона вовсе — прямой обмен превращается в подарок,
      // и ради этого ветку и добивают.
      id: 'bulwark-immovable',
      name: 'Несдвигаемый',
      icon: 'talent-immovable',
      maxRank: 1,
      requires: { talentId: 'bulwark-hard-stance', minRank: 3 },
      effect: tunes('stance', { field: 'stanceDamageShare', kind: 'percent', value: -1 }),
    },
  ],
])

// Бдение: всё про паузы. Ветка ничего не добавляет к удару и почти ничего
// к запасу HP — её вклад в том, что герой реже останавливается.
const WARDEN_VIGIL = branch('warden-vigil', [
  [
    {
      id: 'vigil-steady-breath',
      name: 'Ровное дыхание',
      icon: 'talent-steady-breath',
      maxRank: 6,
      // То же и с восстановлением ресурса: 38.7/с на 25-м уровне против
      // 120.0/с на сотом. Замер на 55-м (72.5/с): 1.5 → 2.1 %.
      effect: mods(m('manaRegen', 'percent', 0.021)),
    },
  ],
  [
    {
      id: 'vigil-clear-mind',
      name: 'Ясный ум',
      icon: 'talent-clear-mind',
      // Пауза регенерации — стат: конвейер обрежет её по нулю, в минус не уйдёт.
      maxRank: 6,
      effect: mods(m('regenDelay', 'flat', -0.3)),
    },
  ],
  [
    {
      id: 'vigil-deep-well',
      name: 'Глубокий колодец',
      icon: 'talent-deep-well',
      // Запас важнее регена: пауза платится один раз за всплеск, и чем глубже
      // запас, тем реже она приходит.
      maxRank: 6,
      effect: mods(m('maxMana', 'percent', 0.1)),
    },
  ],
  [
    {
      id: 'vigil-quick-camp',
      name: 'Скорый привал',
      icon: 'talent-quick-camp',
      maxRank: 6,
      effect: mods(m('restDuration', 'flat', -0.5)),
    },
  ],
  [
    {
      // 21-е очко. Убийство начинает возвращать откаты — темп держится сам.
      id: 'vigil-trophy-spirit',
      name: 'Трофейный дух',
      icon: 'talent-kill-refund',
      maxRank: 1,
      effect: { kind: 'flag', flag: 'kill-refunds-cooldowns', cooldownShare: 0.75 },
    },
  ],
  [
    {
      id: 'vigil-learning',
      name: 'Учёность',
      icon: 'talent-intellect',
      maxRank: 6,
      // Было `intellect flat 3`: восемнадцать интеллекта — 13.1 % запаса
      // маны на 55-м уровне и 7.8 % на сотом. Процент по замеру на 55-м:
      // 13.1 % / 6 = 2.2 % за ранг.
      effect: mods(m('maxMana', 'percent', 0.022)),
    },
  ],
  [
    {
      // ЗДЕСЬ СТОЯЛА «ПОХОДНАЯ ПЕРЕВЯЗКА» — талант на +2% ПОРОГА привала за ранг,
      // и он был ошибкой уровня механики, а не числа. Порог привала — НАСТРОЙКА
      // ИГРОКА: он выставляет её ползунком и ждёт, что игра ей следует. Талант,
      // который молча двигает чужую настройку, читается как поломка: игрок
      // ставит 60%, а герой уходит отдыхать на 72% и объяснения этому на экране
      // нет. Настройки не бывают «прокачиваемыми» — прокачивается то, чем герой
      // ЯВЛЯЕТСЯ, а не то, что он себе назначил.
      //
      // На его месте — настоящая характеристика: длина привала. Процентом, а не
      // секундами: секунды уже заняты соседним «Скорым лагерем», а процент от
      // суммы конвейера складывается с ним по-другому и даёт выбор, а не
      // удвоение одного и того же.
      id: 'vigil-swift-camp',
      name: 'Скорые сборы',
      icon: 'talent-quick-camp',
      maxRank: 6,
      effect: mods(m('restDuration', 'percent', -0.04)),
    },
  ],
  [
    {
      id: 'vigil-slow-bleeding',
      name: 'Скорое заживление',
      icon: 'talent-second-wind',
      maxRank: 7,
      // Плоское восстановление ОТСТАЁТ ОТ УРОВНЯ (см. TALENT_STAT_RULE):
      // у эталонного Стража реген 19.2/с на 25-м уровне и 67.5/с на сотом,
      // то есть один и тот же «+1.5» стоит втрое меньше к концу игры.
      // Переведено в процент по замеру НА 55-М (39.5/с): 1.5 → 3.8 %.
      effect: mods(m('hpRegen', 'percent', 0.038)),
    },
  ],
  [
    {
      // 41-е очко.
      id: 'vigil-unbroken-focus',
      name: 'Несбитый настрой',
      icon: 'talent-unbroken-focus',
      maxRank: 1,
      effect: { kind: 'flag', flag: 'rest-clears-cooldowns', cooldownShare: 0 },
    },
  ],
  [
    {
      id: 'vigil-thrift',
      name: 'Бережливость',
      icon: 'talent-deep-well',
      maxRank: 5,
      effect: mods(m('maxMana', 'percent', 0.08)),
    },
  ],
  [
    {
      id: 'vigil-composure',
      name: 'Собранность',
      icon: 'talent-clear-mind',
      maxRank: 5,
      effect: mods(m('regenDelay', 'flat', -0.2)),
    },
  ],
  [
    {
      id: 'vigil-light-sleep',
      name: 'Чуткий сон',
      icon: 'talent-quick-camp',
      maxRank: 5,
      effect: mods(m('restDuration', 'flat', -0.3)),
    },
  ],
  [
    {
      // 61-е очко, капстоун. Привал перестаёт быть налогом: треть времени.
      id: 'vigil-campfire-on-the-move',
      name: 'Костёр на ходу',
      icon: 'talent-shorter-rest',
      maxRank: 1,
      effect: { kind: 'flag', flag: 'shorter-rest', durationMultiplier: 1 / 3 },
    },
  ],
])

// ---------------------------------------------------------------------------
// ИЗУВЕР
// ---------------------------------------------------------------------------

// Резня: тот же стиль, что и Гнев, но растёт в две руки — вместо ускорения
// на четвёртом этаже стоит сила левой руки, и оба заряда-капстоуна другие.
const REAVER_CARNAGE = branch('reaver-carnage', [
  [
    {
      id: 'carnage-bloodlust',
      name: 'Жажда крови',
      icon: 'talent-honed-edge',
      maxRank: 6,
      effect: mods(m('attackPower', 'percent', 0.02)),
    },
  ],
  [
    {
      id: 'carnage-predator-eye',
      name: 'Хищный взгляд',
      icon: 'talent-keen-eye',
      maxRank: 6,
      effect: mods(m('critChance', 'flat', 0.012)),
    },
  ],
  [
    {
      id: 'carnage-ferocity',
      name: 'Свирепость',
      icon: 'talent-savage-blows',
      maxRank: 6,
      effect: mods(m('critMultiplier', 'flat', 0.08)),
    },
  ],
  [
    {
      id: 'carnage-offhand',
      name: 'Левая рука',
      icon: 'talent-offhand-mastery',
      // Штраф левой руки — СТАТ, поэтому талант правит его модификатором.
      // Со щитом или двуручным он не даёт ничего, и это честно.
      maxRank: 6,
      effect: mods(m('offhandPenalty', 'flat', 0.03)),
    },
  ],
  [
    {
      // 21-е очко.
      id: 'carnage-bleeding-wound',
      name: 'Кровавая рана',
      icon: 'talent-bleed-deep',
      maxRank: 1,
      effect: {
        kind: 'flag',
        flag: 'ability-learns-effect',
        abilityId: 'gut-rip',
        effect: BLEED,
      },
    },
  ],
  [
    {
      id: 'carnage-wild-strength',
      name: 'Дикая сила',
      icon: 'talent-strength',
      maxRank: 6,
      // Было `strength flat 3`: восемнадцать силы — 6.8 % силы атаки на
      // 55-м уровне и 4.2 % на сотом. Процент по замеру на 55-м:
      // 6.8 % / 6 = 1.1 % за ранг.
      effect: mods(m('attackPower', 'percent', 0.011)),
    },
  ],
  [
    {
      id: 'carnage-beast-aim',
      name: 'Звериная точность',
      icon: 'talent-keen-eye',
      maxRank: 6,
      effect: mods(m('critChance', 'flat', 0.008)),
    },
  ],
  [
    {
      id: 'carnage-drive',
      name: 'Разгон резни',
      icon: 'talent-frenzy',
      maxRank: 7,
      effect: mods(m('haste', 'flat', 0.008)),
    },
  ],
  [
    {
      // 41-е очко. Шанс ниже, чем у стража: изувер бьёт вдвое чаще, и на
      // равном шансе двойной удар весил бы у него вдвое больше.
      id: 'carnage-blade-storm',
      name: 'Вихрь клинков',
      icon: 'talent-relentless',
      maxRank: 1,
      effect: { kind: 'flag', flag: 'double-strike', chance: 0.12 },
    },
  ],
  [
    {
      id: 'carnage-discord',
      name: 'Раздор',
      icon: 'talent-savage-blows',
      maxRank: 5,
      effect: mods(m('critMultiplier', 'flat', 0.06)),
    },
  ],
  [
    {
      id: 'carnage-second-hand',
      name: 'Вторая рука',
      icon: 'talent-offhand-mastery',
      maxRank: 5,
      effect: mods(m('offhandPenalty', 'flat', 0.02)),
    },
  ],
  [
    {
      id: 'carnage-onslaught',
      name: 'Напор',
      icon: 'talent-honed-edge',
      maxRank: 5,
      effect: mods(m('attackPower', 'percent', 0.02)),
    },
  ],
  [
    {
      // 61-е очко, капстоун.
      id: 'carnage-blood-charge',
      name: 'Кровавый запал',
      icon: 'talent-blood-charge',
      maxRank: 1,
      effect: {
        kind: 'flag',
        flag: 'ability-extra-charge',
        abilityId: 'skull-splitter',
        extraCharges: 1,
      },
    },
  ],
])

// Жилы: выносливость изувера. Числа те же, что у Оплота, а капстоун злее —
// отражается ПОЛТОРА поглощённого: изувер защищается нападая.
const REAVER_SINEW = branch('reaver-sinew', [
  [
    {
      id: 'sinew-beast-hide',
      name: 'Шкура зверя',
      icon: 'talent-thick-hide',
      maxRank: 6,
      effect: mods(m('maxHp', 'percent', 0.05)),
    },
  ],
  [
    {
      id: 'sinew-forearm-guard',
      name: 'Заслон предплечьем',
      icon: 'talent-shield-wall',
      maxRank: 6,
      effect: mods(m('blockChance', 'flat', 0.02)),
    },
  ],
  [
    {
      id: 'sinew-heavy-riposte',
      name: 'Тяжёлый отпор',
      icon: 'talent-bulwark-training',
      maxRank: 6,
      effect: mods(m('blockValue', 'percent', 0.2)),
    },
  ],
  [
    {
      id: 'sinew-tanned-hide',
      name: 'Дублёная кожа',
      icon: 'talent-iron-skin',
      maxRank: 6,
      effect: mods(m('damageReduction', 'flat', 0.01)),
    },
  ],
  [
    {
      // 21-е очко. Ярость приходит из боя — и теперь ещё и из чужих ударов
      // по щиту.
      id: 'sinew-blood-for-blood',
      name: 'Кровь за кровь',
      icon: 'talent-guard-echo',
      maxRank: 1,
      effect: { kind: 'flag', flag: 'block-restores-resource', resourceShare: 0.07 },
    },
  ],
  [
    {
      id: 'sinew-hardened',
      name: 'Матёрость',
      icon: 'talent-vitality',
      maxRank: 6,
      // Было `vitality flat 3`. Плоская характеристика отстаёт от уровня
      // (см. TALENT_STAT_RULE): восемнадцать выносливости — 4.5 % запаса у
      // эталонного Стража на 55-м уровне и 2.7 % на сотом. Переведено в
      // процент по замеру НА 55-М: 4.5 % / 6 рангов = 0.75 % за ранг.
      // Настоящая переделка ветки — своей стадией; здесь только правило.
      effect: mods(m('maxHp', 'percent', 0.0075)),
    },
  ],
  [
    {
      id: 'sinew-knitting',
      name: 'Затягивание ран',
      icon: 'talent-second-wind',
      maxRank: 6,
      // Плоское восстановление ОТСТАЁТ ОТ УРОВНЯ (см. TALENT_STAT_RULE):
      // у эталонного Стража реген 19.2/с на 25-м уровне и 67.5/с на сотом,
      // то есть один и тот же «+2» стоит втрое меньше к концу игры.
      // Переведено в процент по замеру НА 55-М (39.5/с): 2 → 5.1 %.
      effect: mods(m('hpRegen', 'percent', 0.051)),
    },
  ],
  [
    {
      id: 'sinew-frame',
      name: 'Костяк',
      icon: 'talent-thick-hide',
      maxRank: 7,
      effect: mods(m('maxHp', 'percent', 0.03)),
    },
  ],
  [
    {
      // 41-е очко.
      id: 'sinew-not-finished',
      name: 'Не добит',
      icon: 'talent-hard-to-kill',
      maxRank: 1,
      effect: { kind: 'flag', flag: 'faster-revive', reviveMultiplier: 0.4 },
    },
  ],
  [
    {
      id: 'sinew-carapace',
      name: 'Панцирь',
      icon: 'talent-iron-skin',
      maxRank: 5,
      effect: mods(m('damageReduction', 'flat', 0.008)),
    },
  ],
  [
    {
      id: 'sinew-counterblow',
      name: 'Встречный удар',
      icon: 'talent-bulwark-training',
      maxRank: 5,
      effect: mods(m('blockValue', 'percent', 0.15)),
    },
  ],
  [
    {
      id: 'sinew-brace',
      name: 'Упор',
      icon: 'talent-shield-wall',
      maxRank: 5,
      effect: mods(m('blockChance', 'flat', 0.015)),
    },
  ],
  [
    {
      // 61-е очко, капстоун.
      id: 'sinew-spiked-guard',
      name: 'Шипастый заслон',
      icon: 'talent-spiked-guard',
      maxRank: 1,
      effect: { kind: 'flag', flag: 'block-reflects', damageShare: 1 },
    },
  ],
])

// Чутьё: автономность изувера. Мана и пауза восстановления ему чужды
// (класс гасит их множителем-нулём), поэтому ветка растит не реген, а
// ЁМКОСТЬ ярости, порог привала и заживление в бою.
const REAVER_INSTINCT = branch('reaver-instinct', [
  [
    {
      id: 'instinct-beast-breath',
      name: 'Дыхание зверя',
      icon: 'talent-second-wind',
      maxRank: 6,
      // Плоское восстановление ОТСТАЁТ ОТ УРОВНЯ (см. TALENT_STAT_RULE):
      // у эталонного Стража реген 19.2/с на 25-м уровне и 67.5/с на сотом,
      // то есть один и тот же «+1.5» стоит втрое меньше к концу игры.
      // Переведено в процент по замеру НА 55-М (39.5/с): 1.5 → 3.8 %.
      effect: mods(m('hpRegen', 'percent', 0.038)),
    },
  ],
  [
    {
      id: 'instinct-short-rest',
      name: 'Короткий роздых',
      icon: 'talent-quick-camp',
      maxRank: 6,
      effect: mods(m('restDuration', 'flat', -0.5)),
    },
  ],
  [
    {
      id: 'instinct-rage-capacity',
      name: 'Ёмкость ярости',
      icon: 'talent-deep-well',
      // СТАВКА НАМЕРЕННО НИЖЕ, чем у «Глубокого колодца» стража, и вот почему.
      // Доход ярости — ДОЛЯ запаса (resourceIncome), а цены умений — числа:
      // у изувера ёмкость это ещё и урон, а у стража только глубина. С равной
      // ставкой ветка автономности изувера обгоняла бы по урону его же ветку
      // урона — то есть выбор стиля переставал бы существовать.
      maxRank: 6,
      effect: mods(m('maxMana', 'percent', 0.04)),
    },
  ],
  [
    {
      // Как и «Походная перевязка» у стража: талант двигал ПОРОГ привала, то
      // есть настройку игрока. Заменён на длину привала процентом.
      id: 'instinct-light-camp',
      name: 'Лёгкий лагерь',
      icon: 'talent-quick-camp',
      maxRank: 6,
      effect: mods(m('restDuration', 'percent', -0.04)),
    },
  ],
  [
    {
      // 21-е очко.
      id: 'instinct-taste-of-victory',
      name: 'Вкус победы',
      icon: 'talent-kill-refund',
      maxRank: 1,
      effect: { kind: 'flag', flag: 'kill-refunds-cooldowns', cooldownShare: 0.7 },
    },
  ],
  [
    {
      id: 'instinct-hardy-stock',
      name: 'Выносливая порода',
      icon: 'talent-vitality',
      maxRank: 6,
      // Было `vitality flat 3`. Плоская характеристика отстаёт от уровня
      // (см. TALENT_STAT_RULE): восемнадцать выносливости — 4.5 % запаса у
      // эталонного Стража на 55-м уровне и 2.7 % на сотом. Переведено в
      // процент по замеру НА 55-М: 4.5 % / 6 рангов = 0.75 % за ранг.
      // Настоящая переделка ветки — своей стадией; здесь только правило.
      effect: mods(m('maxHp', 'percent', 0.0075)),
    },
  ],
  [
    {
      id: 'instinct-hunger',
      name: 'Голод',
      icon: 'talent-deep-well',
      // Та же поправка, что и у «Ёмкости ярости» этажом выше.
      maxRank: 6,
      effect: mods(m('maxMana', 'percent', 0.03)),
    },
  ],
  [
    {
      id: 'instinct-second-breath',
      name: 'Второе дыхание',
      icon: 'talent-second-wind',
      maxRank: 7,
      // Плоское восстановление ОТСТАЁТ ОТ УРОВНЯ (см. TALENT_STAT_RULE):
      // у эталонного Стража реген 19.2/с на 25-м уровне и 67.5/с на сотом,
      // то есть один и тот же «+1.5» стоит втрое меньше к концу игры.
      // Переведено в процент по замеру НА 55-М (39.5/с): 1.5 → 3.8 %.
      effect: mods(m('hpRegen', 'percent', 0.038)),
    },
  ],
  [
    {
      // 41-е очко.
      id: 'instinct-never-cooling',
      name: 'Не остывая',
      icon: 'talent-unbroken-focus',
      maxRank: 1,
      effect: { kind: 'flag', flag: 'rest-clears-cooldowns', cooldownShare: 0 },
    },
  ],
  [
    {
      id: 'instinct-deep-sleep',
      name: 'Крепкий сон',
      icon: 'talent-quick-camp',
      maxRank: 5,
      effect: mods(m('restDuration', 'flat', -0.3)),
    },
  ],
  [
    {
      // Третий талант на ПОРОГ привала — по тому же доводу заменён на длину.
      id: 'instinct-restless',
      name: 'Неугомонность',
      icon: 'talent-quick-camp',
      maxRank: 5,
      effect: mods(m('restDuration', 'percent', -0.03)),
    },
  ],
  [
    {
      id: 'instinct-patience',
      name: 'Терпение',
      icon: 'talent-second-wind',
      maxRank: 5,
      // Плоское восстановление ОТСТАЁТ ОТ УРОВНЯ (см. TALENT_STAT_RULE):
      // у эталонного Стража реген 19.2/с на 25-м уровне и 67.5/с на сотом,
      // то есть один и тот же «+1» стоит втрое меньше к концу игры.
      // Переведено в процент по замеру НА 55-М (39.5/с): 1 → 2.5 %.
      effect: mods(m('hpRegen', 'percent', 0.025)),
    },
  ],
  [
    {
      // 61-е очко, капстоун.
      id: 'instinct-wolf-camp',
      name: 'Волчий привал',
      icon: 'talent-shorter-rest',
      maxRank: 1,
      effect: { kind: 'flag', flag: 'shorter-rest', durationMultiplier: 1 / 3 },
    },
  ],
])

export const TALENTS: TalentDef[] = [
  ...WARDEN_WRATH,
  ...WARDEN_BULWARK,
  ...WARDEN_VIGIL,
  ...REAVER_CARNAGE,
  ...REAVER_SINEW,
  ...REAVER_INSTINCT,
]

export const TALENT_BY_ID: Record<string, TalentDef> = Object.fromEntries(
  TALENTS.map((t) => [t.id, t]),
)

// ---------------------------------------------------------------------------
// Производные от данных
// ---------------------------------------------------------------------------

export function talentsInBranch(branchId: BranchId): TalentDef[] {
  return TALENTS.filter((t) => t.branch === branchId).sort((a, b) => a.row - b.row)
}

/** Ветки класса в порядке колонок на экране. */
export function branchesOfClass(classId: string): BranchDef[] {
  return BRANCHES.filter((b) => b.classId === classId)
}

/** Все таланты класса. Логика читает дерево ТОЛЬКО так — по классу героя. */
export function talentsOfClass(classId: string): TalentDef[] {
  const own = new Set(branchesOfClass(classId).map((b) => b.id))
  return TALENTS.filter((t) => own.has(t.branch))
}

/** Вложенный ранг с обрезкой по maxRank: мусор из сейва не даст лишнего. */
export function rankOf(ranks: Record<string, number>, talentId: string): number {
  const rank = ranks[talentId]
  const max = TALENT_BY_ID[talentId]?.maxRank ?? 0
  if (typeof rank !== 'number' || !Number.isFinite(rank) || rank <= 0) return 0
  return Math.min(Math.floor(rank), max)
}

/**
 * Ранги -> модификаторы конвейера статов. Чистая производная от данных:
 * значение множится на ранг, source — 'talent:<id>', поэтому раскладка на
 * панели статов показывает таланты построчно.
 *
 * classId обязателен там, где ранги приходят из сейва: правленый руками файл
 * не должен дать герою чужую ветку.
 */
export function talentModifiers(
  ranks: Record<string, number>,
  classId?: string,
): StatModifier[] {
  const list = classId ? talentsOfClass(classId) : TALENTS
  const result: StatModifier[] = []
  for (const talent of list) {
    const rank = rankOf(ranks, talent.id)
    if (rank <= 0 || talent.effect.kind !== 'modifiers') continue
    for (const mod of talent.effect.mods) {
      result.push({ ...mod, value: mod.value.times(rank), source: `talent:${talent.id}` })
    }
  }
  return result
}

/**
 * Заполнить ветку сверху вниз заданным числом очков, соблюдая требования
 * этажей. Чистая функция от данных: ею пользуются и миграция сейва (перенести
 * очки старого дерева), и прогон баланса (чистый билд ветки).
 */
/** Минимальный ранг предпосылки: поле необязательное, умолчание — один. */
export const requiredRank = (req: TalentRequirement): number => req.minRank ?? 1

/**
 * Кто зависит от этого таланта — прямо или через цепочку.
 *
 * Нужно для СНЯТИЯ: убрал опорный талант — зависимые обязаны уйти вместе с
 * ним, иначе в дереве остаётся узел, который по правилам не мог быть взят.
 */
export function dependentsOf(talentId: string): TalentDef[] {
  const out: TalentDef[] = []
  const queue = [talentId]
  const seen = new Set<string>([talentId])
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const talent of TALENTS) {
      if (talent.requires?.talentId !== current) continue
      if (seen.has(talent.id)) continue
      seen.add(talent.id)
      out.push(talent)
      queue.push(talent.id)
    }
  }
  return out
}

/**
 * ЁМКОСТЬ ВЕТКИ — сумма `maxRank` всех её талантов. Производная от
 * наполнения, а не константа: добавили талант на этаж — ёмкость выросла,
 * глубина осталась прежней.
 */
export function branchCapacity(branchId: BranchId): number {
  return talentsInBranch(branchId).reduce((sum, t) => sum + t.maxRank, 0)
}

/**
 * Сколько очков помещается на этажах ВЫШЕ данного. Этим и меряется
 * достижимость: порог этажа обязан быть не больше того, что можно вложить
 * над ним, иначе до этажа не добраться никогда.
 */
export function capacityAbove(branchId: BranchId, row: number): number {
  return talentsInBranch(branchId)
    .filter((t) => t.row < row)
    .reduce((sum, t) => sum + t.maxRank, 0)
}

// ---------------------------------------------------------------------------
// ПУТИ ВНУТРИ ВЕТКИ
// ---------------------------------------------------------------------------

/**
 * ПУТЬ — ЭТО ПОРЯДОК ПОКУПКИ, И ОН ЛЕЖИТ В ДАННЫХ. НЕ УКРАШЕНИЕ, А ПРИБОР.
 *
 * Пока на этаже стоял один талант, «взять ветку» значило одно и то же для
 * всех: очки лились сверху вниз, и модель прогона так их и тратила. С
 * альтернативами такой модели не существует — сверху вниз она берёт ПЕРВОЕ
 * по порядку в файле, то есть автор ветки задаёт лучшую сборку случайно, тем,
 * в каком порядке напечатал записи. Хуже того: ёмкость ветки (114 у Гнева)
 * теперь БОЛЬШЕ, чем очков у героя на сотом уровне (91), и жадная заливка
 * тратит всё до тринадцатого этажа так и не дойдя — то есть меряет ветку
 * БЕЗ ВЕНЦА, ради которого её и берут.
 *
 * Поэтому путь называется ЯВНО. Добавленный талант больше не двигает модель
 * молча: чтобы модель начала его покупать, его надо вписать в путь — то есть
 * принять решение, а не напечатать строку.
 */
export interface TalentPath {
  id: string
  /** Имя для отчёта и для теста «в ветке два жизнеспособных пути». */
  name: string
  /** Порядок покупки. Талант берётся ДО ПОТОЛКА, потом черёд следующего. */
  order: string[]
  /**
   * ЧЕТВЁРКА, ПОД КОТОРУЮ ПУТЬ И СОБРАН. Не украшение: талант, правящий
   * умение, которого нет в ряду, не делает НИЧЕГО — умение вне четвёрки не
   * участвует ни в автокасте, ни в модели боя. Путь «Взрыв», сыгранный
   * четвёркой по умолчанию, тратит одиннадцать очков в пустоту, и прогон
   * честно показывает героя слабее прежнего.
   *
   * Не названа — играется четвёрка по умолчанию (так у веток-лестниц: у них
   * талантов про умения нет вовсе).
   */
  abilities?: string[]
}

/**
 * Явные пути там, где на этажах есть выбор. Ветка-лестница пути не объявляет:
 * у неё он ровно один и тривиальный — сверху вниз, — и `pathsOf` строит его
 * сам. Списывать очевидное руками значит заводить второй источник правды.
 */
const BRANCH_PATHS: Partial<Record<BranchId, TalentPath[]>> = {
  'warden-wrath': [
    {
      // КРОВЬ. Урон по времени: дешёвое умение учится кровить, кровотечение
      // «Рваной раны» удваивается и перестаёт ждать замаха. Урон идёт РОВНО,
      // а не всплесками.
      //
      // ЭТОТ ПУТЬ СТОИТ ПЕРВЫМ, И ЭТО РЕШЕНИЕ, А НЕ ПОРЯДОК НАБОРА. Первый
      // путь — тот, по которому ветку считает ПРОГОН, и он обязан быть тем,
      // что герой играет БЕЗ подсказок: его четвёрка и есть четвёрка по
      // умолчанию. Поставь первым «Взрыв» — прибор мерил бы героя, треть
      // очков которого уходит в умения, которых у него в ряду нет.
      //
      // ОБЩЕЕ ЯДРО ИДЁТ ПЕРВЫМ, А ЛИЦО ВЕТКИ — ПОСЛЕ, и это не размывает
      // путь. Опорные таланты кровотечения стоят на девятом и тринадцатом
      // этажах, то есть требуют сорока и шестидесяти очков в ветке: до них
      // герой сорокового уровня не дотягивается никак, и «сперва проценты»
      // — не выбор автора, а форма ветки.
      id: 'wrath-bleed',
      name: 'Кровь',
      // ЧЕТВЁРКА ПУТИ — ТА ЖЕ, ЧТО У ГЕРОЯ ПО УМОЛЧАНИЮ, и это решение, а не
      // совпадение: первый путь мерит того, кто НИЧЕГО не менял, и контракты
      // цены схватки не должны ехать от того, какой набор сегодня кажется
      // авторам правильным. Порядок здесь — приоритет автокаста.
      abilities: ['quick-strike', 'rending-wound', 'mend-wounds', 'shattering-blow'],
      order: [
        'wrath-honed-edge',
        'wrath-keen-eye',
        'wrath-deep-cut',
        'wrath-savage-blows',
        'wrath-frenzy',
        'wrath-firm-hand',
        'wrath-spare-edge',
        'wrath-rupture',
        'wrath-firm-grip',
        'wrath-momentum',
        'wrath-bleeding-edge',
        // «Точность удара» стоит раньше добавок к кровотечению НАРОЧНО.
        // Шестьдесят очков этого пути — тот самый герой, на котором меряются
        // контракты данжей, и множитель крита работает у него с любым
        // набором; три лишних тика кровотечения — только с «Рваной раной».
        'wrath-precision',
        'wrath-open-vein',
        'wrath-light-blade',
        'wrath-heavy-swing',
        'wrath-true-aim',
        'wrath-open-wound',
        'wrath-cold-blood',
        'wrath-relentless',
        'wrath-double-flourish',
        'wrath-swift-shatter',
        'wrath-heavy-shatter',
        'wrath-wide-mercy',
        'wrath-deep-brand',
        'wrath-long-focus',
        'wrath-headlong',
        'wrath-second-swing',
      ],
    },
    {
      // ВЗРЫВ. Два крупных удара: «Сокрушение» бьёт чаще и тяжелее, «Милость»
      // из окна в конце боя превращается в постоянную кнопку.
      id: 'wrath-burst',
      name: 'Взрыв',
      abilities: ['shattering-blow', 'mercy', 'quick-strike', 'mend-wounds'],
      order: [
        'wrath-honed-edge',
        'wrath-savage-blows',
        'wrath-swift-shatter',
        'wrath-precision',
        'wrath-keen-eye',
        'wrath-wide-mercy',
        'wrath-heavy-swing',
        'wrath-heavy-shatter',
        'wrath-headlong',
        'wrath-true-aim',
        'wrath-cold-blood',
        'wrath-second-swing',
        'wrath-frenzy',
        'wrath-momentum',
        'wrath-light-blade',
        'wrath-deep-brand',
        'wrath-long-focus',
        'wrath-firm-hand',
        'wrath-spare-edge',
        'wrath-firm-grip',
        'wrath-relentless',
        'wrath-rupture',
        'wrath-deep-cut',
        'wrath-bleeding-edge',
        'wrath-open-vein',
        'wrath-open-wound',
        'wrath-double-flourish',
      ],
    },
  ],
  'warden-bulwark': [
    {
      // ЗАСЛОН. Ставка на щит и блок: «Стена» держится дольше и приходит
      // чаще, ослабление «Толчка» — на три удара вместо одного. Четвёрка та
      // же, что у героя по умолчанию: первый путь ветки — прибор, и мерить
      // он обязан того, кто ничего не менял.
      id: 'bulwark-guard',
      name: 'Заслон',
      abilities: ['quick-strike', 'rending-wound', 'mend-wounds', 'shattering-blow'],
      order: [
        'bulwark-thick-hide',
        'bulwark-shield-wall',
        'bulwark-training',
        'bulwark-iron-skin',
        'bulwark-press',
        'bulwark-long-wall',
        'bulwark-shield-grip',
        'bulwark-sturdy-frame',
        'bulwark-battle-breath',
        'bulwark-unyielding',
        'bulwark-braced',
        'bulwark-often-wall',
        'bulwark-wide-wall',
        'bulwark-stone-skin',
        'bulwark-heavy-guard',
        'bulwark-firm-stance',
        'bulwark-mirror-shield',
        'bulwark-thrift-wall',
        'bulwark-firm-press',
        'bulwark-quick-mend',
        'bulwark-deep-mend',
        'bulwark-early-call',
        'bulwark-hard-stance',
        'bulwark-long-stance',
        'bulwark-quiet-mend',
        'bulwark-swift-return',
        'bulwark-immovable',
      ],
    },
    {
      // СТОЙКА И ЛЕЧЕНИЕ. Другой ответ на тот же вопрос: не поглощать удар
      // щитом, а не получать его вовсе и доливать полоску. Венец — стойка,
      // которая больше не стоит урона.
      id: 'bulwark-warden',
      name: 'Стойка',
      abilities: ['quick-strike', 'shield-shove', 'mend-wounds', 'stance'],
      order: [
        'bulwark-hard-stance',
        'bulwark-thick-hide',
        'bulwark-iron-skin',
        'bulwark-quick-mend',
        'bulwark-braced',
        'bulwark-press',
        'bulwark-deep-mend',
        'bulwark-long-stance',
        'bulwark-early-call',
        'bulwark-unyielding',
        'bulwark-immovable',
        'bulwark-battle-breath',
        'bulwark-sturdy-frame',
        'bulwark-stone-skin',
        'bulwark-quiet-mend',
        'bulwark-firm-press',
        'bulwark-shield-wall',
        'bulwark-training',
        'bulwark-heavy-guard',
        'bulwark-firm-stance',
        'bulwark-shield-grip',
        'bulwark-long-wall',
        'bulwark-wide-wall',
        'bulwark-thrift-wall',
        'bulwark-often-wall',
        'bulwark-swift-return',
        'bulwark-mirror-shield',
      ],
    },
  ],
}

/** Тривиальный путь ветки-лестницы: сверху вниз, как записано в данных. */
function ladderPath(branchId: BranchId): TalentPath {
  return {
    id: `${branchId}-ladder`,
    name: 'Сверху вниз',
    order: talentsInBranch(branchId).map((t) => t.id),
  }
}

/** Все объявленные пути ветки. Их всегда хотя бы один. */
export function pathsOf(branchId: BranchId): TalentPath[] {
  return BRANCH_PATHS[branchId] ?? [ladderPath(branchId)]
}

/**
 * Разложить очки по пути.
 *
 * Проходов несколько, и это не оптимизация: талант с ЭТАЖА НИЖЕ может стоять
 * в пути раньше своей опоры по порогу — тогда он пропускается и берётся на
 * следующем проходе, когда очков в ветке набралось достаточно. Так путь
 * остаётся списком ПРИОРИТЕТОВ, а не расписанием, которое автор обязан
 * сверять с арифметикой порогов вручную.
 */
export function pathRanks(path: TalentPath, points: number): Record<string, number> {
  const ranks: Record<string, number> = {}
  let spent = 0
  let moved = true
  while (moved && spent < points) {
    moved = false
    for (const id of path.order) {
      const talent = TALENT_BY_ID[id]
      if (!talent) continue
      const have = ranks[id] ?? 0
      if (have >= talent.maxRank) continue
      if (spent < talent.requiredPointsInBranch) continue
      const need = talent.requires
      if (need && (ranks[need.talentId] ?? 0) < requiredRank(need)) continue
      const take = Math.min(talent.maxRank - have, points - spent)
      if (take <= 0) continue
      ranks[id] = have + take
      spent += take
      moved = true
    }
  }
  return ranks
}

/**
 * Ветка, залитая очками ПО ПЕРВОМУ ОБЪЯВЛЕННОМУ ПУТИ. Это и есть «сборка
 * ветки» для прогонов и тестов: одна на всю игру, названная в данных.
 */
export function fillBranchRanks(branchId: BranchId, points: number): Record<string, number> {
  return pathRanks(pathsOf(branchId)[0], points)
}

