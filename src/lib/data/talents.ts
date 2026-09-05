
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

// Гнев: всё про удар. Прибавки мелкие и однообразные намеренно — ветка
// платит не ими, а тремя концептуальными талантами на 21-м, 41-м и 61-м очке.
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
      effect: mods(m('attackPower', 'percent', 0.027)),
    },
  ],
  [
    {
      id: 'wrath-keen-eye',
      name: 'Острый глаз',
      icon: 'talent-keen-eye',
      maxRank: 6,
      effect: mods(m('critChance', 'flat', 0.012)),
    },
  ],
  [
    {
      id: 'wrath-savage-blows',
      name: 'Свирепые удары',
      icon: 'talent-savage-blows',
      maxRank: 6,
      effect: mods(m('critMultiplier', 'flat', 0.08)),
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
      effect: mods(m('haste', 'flat', 0.012)),
    },
  ],
  [
    {
      // 21-е очко. Умение перестаёт быть просто сильным ударом.
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
  ],
  [
    {
      id: 'wrath-firm-grip',
      name: 'Крепкая хватка',
      icon: 'talent-strength',
      maxRank: 6,
      effect: mods(m('strength', 'flat', 3)),
    },
  ],
  [
    {
      id: 'wrath-true-aim',
      name: 'Верный глазомер',
      icon: 'talent-keen-eye',
      maxRank: 6,
      effect: mods(m('critChance', 'flat', 0.008)),
    },
  ],
  [
    {
      id: 'wrath-momentum',
      name: 'Разгон',
      icon: 'talent-relentless',
      maxRank: 7,
      effect: mods(m('haste', 'flat', 0.008)),
    },
  ],
  [
    {
      // 41-е очко. Автоатака перестаёт быть ровным ручейком.
      id: 'wrath-double-flourish',
      name: 'Двойной росчерк',
      icon: 'talent-double-strike',
      maxRank: 1,
      effect: { kind: 'flag', flag: 'double-strike', chance: 0.2 },
    },
  ],
  [
    {
      id: 'wrath-precision',
      name: 'Точность удара',
      icon: 'talent-savage-blows',
      maxRank: 5,
      effect: mods(m('critMultiplier', 'flat', 0.06)),
    },
  ],
  [
    {
      id: 'wrath-heavy-swing',
      name: 'Мощь замаха',
      icon: 'talent-honed-edge',
      maxRank: 5,
      effect: mods(m('attackPower', 'percent', 0.027)),
    },
  ],
  [
    {
      id: 'wrath-light-blade',
      name: 'Лёгкость клинка',
      icon: 'talent-frenzy',
      maxRank: 5,
      effect: mods(m('haste', 'flat', 0.008)),
    },
  ],
  [
    {
      // 61-е очко, капстоун. Второй заряд самого дорогого умения: ротация
      // перестаёт упираться в один откат.
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
  ],
])

// Оплот: всё про то, чтобы дожить до конца схватки. Привал теперь между
// боями, и цена ошибки — смерть, поэтому ветка окупается глубиной зоны.
const WARDEN_BULWARK = branch('warden-bulwark', [
  [
    {
      id: 'bulwark-thick-hide',
      name: 'Толстая шкура',
      icon: 'talent-thick-hide',
      maxRank: 6,
      effect: mods(m('maxHp', 'percent', 0.05)),
    },
  ],
  [
    {
      id: 'bulwark-shield-wall',
      name: 'Стена щитов',
      icon: 'talent-shield-wall',
      maxRank: 6,
      effect: mods(m('blockChance', 'flat', 0.02)),
    },
  ],
  [
    {
      id: 'bulwark-training',
      name: 'Выучка заслона',
      icon: 'talent-bulwark-training',
      maxRank: 6,
      effect: mods(m('blockValue', 'percent', 0.2)),
    },
  ],
  [
    {
      id: 'bulwark-iron-skin',
      name: 'Железная кожа',
      icon: 'talent-iron-skin',
      maxRank: 6,
      effect: mods(m('damageReduction', 'flat', 0.01)),
    },
  ],
  [
    {
      // 21-е очко. Щит начинает кормить ротацию, а не только беречь HP.
      id: 'bulwark-shield-grip',
      name: 'Хватка щита',
      icon: 'talent-block-resource',
      maxRank: 1,
      effect: { kind: 'flag', flag: 'block-restores-resource', resourceShare: 0.05 },
    },
  ],
  [
    {
      id: 'bulwark-sturdy-frame',
      name: 'Крепость тела',
      icon: 'talent-vitality',
      maxRank: 6,
      effect: mods(m('vitality', 'flat', 3)),
    },
  ],
  [
    {
      id: 'bulwark-battle-breath',
      name: 'Дыхание в бою',
      icon: 'talent-second-wind',
      maxRank: 6,
      effect: mods(m('hpRegen', 'flat', 2)),
    },
  ],
  [
    {
      id: 'bulwark-unyielding',
      name: 'Несгибаемость',
      icon: 'talent-thick-hide',
      maxRank: 7,
      effect: mods(m('maxHp', 'percent', 0.03)),
    },
  ],
  [
    {
      // 41-е очко.
      id: 'bulwark-swift-return',
      name: 'Скорое возвращение',
      icon: 'talent-swift-return',
      maxRank: 1,
      effect: { kind: 'flag', flag: 'faster-revive', reviveMultiplier: 0.5 },
    },
  ],
  [
    {
      id: 'bulwark-stone-skin',
      name: 'Каменная кожа',
      icon: 'talent-iron-skin',
      maxRank: 5,
      effect: mods(m('damageReduction', 'flat', 0.008)),
    },
  ],
  [
    {
      id: 'bulwark-heavy-guard',
      name: 'Тяжёлый заслон',
      icon: 'talent-bulwark-training',
      maxRank: 5,
      effect: mods(m('blockValue', 'percent', 0.15)),
    },
  ],
  [
    {
      id: 'bulwark-firm-stance',
      name: 'Твёрдая стойка',
      icon: 'talent-shield-wall',
      maxRank: 5,
      effect: mods(m('blockChance', 'flat', 0.015)),
    },
  ],
  [
    {
      // 61-е очко, капстоун. Оборона становится источником урона: поглощённое
      // щитом целиком уходит обратно.
      id: 'bulwark-mirror-shield',
      name: 'Зеркальный щит',
      icon: 'talent-block-reflect',
      maxRank: 1,
      effect: { kind: 'flag', flag: 'block-reflects', damageShare: 1 },
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
      effect: mods(m('manaRegen', 'flat', 1.5)),
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
      effect: mods(m('intellect', 'flat', 3)),
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
      effect: mods(m('hpRegen', 'flat', 1.5)),
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
      effect: mods(m('strength', 'flat', 3)),
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
      effect: mods(m('vitality', 'flat', 3)),
    },
  ],
  [
    {
      id: 'sinew-knitting',
      name: 'Затягивание ран',
      icon: 'talent-second-wind',
      maxRank: 6,
      effect: mods(m('hpRegen', 'flat', 2)),
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
      effect: mods(m('hpRegen', 'flat', 1.5)),
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
      effect: mods(m('vitality', 'flat', 3)),
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
      effect: mods(m('hpRegen', 'flat', 1.5)),
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
      effect: mods(m('hpRegen', 'flat', 1)),
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

export function fillBranchRanks(branchId: BranchId, points: number): Record<string, number> {
  const ranks: Record<string, number> = {}
  let spent = 0
  for (const talent of talentsInBranch(branchId)) {
    if (spent < talent.requiredPointsInBranch) break
    const rank = Math.min(talent.maxRank, points - spent)
    if (rank <= 0) break
    ranks[talent.id] = rank
    spent += rank
  }
  return ranks
}

