
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
import { TALENT_FIRST_LEVEL } from './balance'

// ---------------------------------------------------------------------------
// Форма ветки
// ---------------------------------------------------------------------------

/**
 * СТОЛБЦОВ В СЕТКЕ ДЕРЕВА — ДО ПЯТИ, И СКОЛЬКО ИМЕННО, РЕШАЕТ ВЕТКА.
 *
 * Пять — это потолок сетки, а не ширина каждой ветки: `cols` у `BranchDef`
 * говорит, сколько клеток ветка занимает на самом деле. Потолок нужен типу
 * `TalentColumn`: столбец шестым не станет опечаткой, он станет ошибкой
 * проверки типов.
 */
export const TREE_MAX_COLUMNS = 5
export type TalentColumn = 1 | 2 | 3 | 4 | 5

/**
 * ФОРМА ВЕТКИ — ДАННЫЕ, А НЕ ОБЩАЯ КОНСТАНТА.
 *
 * Здесь стояли `BRANCH_ROWS = 13`, `BRANCH_ROW_STEP = 5` и выведенная из них
 * `BRANCH_DEPTH = 60` — одна форма на все девять веток. Это читалось как
 * закон мира, а было всего лишь первой формой, какую придумали: ветка из
 * тринадцати этажей по одному-двум талантам — это лестница, по которой очки
 * ЛЬЮТСЯ, а ветка из семи этажей по четыре-пять — сетка, в которой их
 * ВЫБИРАЮТ. Разница не в оформлении: на тринадцати этажах порог следующего
 * этажа отстаёт от прокачки на пять очков и открывается сам собой, а на семи
 * он стоит десяти очков и его надо ЗАРАБОТАТЬ.
 *
 * Поэтому форма переехала в `BranchDef` полями `rows`, `step` и `cols`, а
 * глубина СЧИТАЕТСЯ из них (`branchDepth`) и отдельной константой не лежит:
 * два числа, описывающих одно и то же, разъезжаются на первой же правке.
 *
 * СМЕШАННОЕ СОСТОЯНИЕ ЗАКОННО И ВРЕМЕННО. Сегодня Гнев живёт на семи этажах
 * с шагом 10, остальные восемь веток — на тринадцати с шагом 5. Это не
 * недоделка формы, а порядок переезда: машинерия строится и обкатывается на
 * ОДНОЙ ветке, а восемь оставшихся переезжают следом почти чистыми данными.
 */


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
  | 'houndmaster-chase'
  | 'houndmaster-leash'
  | 'houndmaster-trail'

export interface BranchDef {
  id: BranchId
  name: string
  /** Чей это стиль роста. Ссылка на data/classes.ts. */
  classId: string
  style: BranchStyle
  /** Этажей в ветке, считая сверху. Последний — венец. */
  rows: number
  /** На сколько очков растёт порог каждого следующего этажа. */
  step: number
  /** Сколько столбцов ветка занимает в сетке: до `TREE_MAX_COLUMNS`. */
  cols: TalentColumn
}

/** Форма, с которой ветки жили до переезда: тринадцать этажей по пять очков. */
const LADDER = { rows: 13, step: 5, cols: 4 } as const

export const BRANCHES: BranchDef[] = [
  // --- Страж: мана, одноручное и щит ---
  // ГНЕВ ПЕРЕЕХАЛ НА СЕМЬ ЭТАЖЕЙ ПО ДЕСЯТЬ ОЧКОВ. Глубина та же — 60, — но
  // этажей вдвое меньше, а ряд вдвое шире: этаж стал местом выбора, а не
  // ступенькой. Пороги 0, 10, 20 … 60 при очке за уровень с десятого дают
  // уровни героя 10, 20 … 70, и три майлстоуна прокачки (30, 50, 70) падают
  // на этажи 3, 5 и 7 сами собой — ровно туда, где стоят пары выбора.
  { id: 'warden-wrath', name: 'Гнев', classId: 'warden', style: 'damage', rows: 7, step: 10, cols: 5 },
  { id: 'warden-bulwark', name: 'Оплот', classId: 'warden', style: 'survival', ...LADDER },
  { id: 'warden-vigil', name: 'Бдение', classId: 'warden', style: 'autonomy', ...LADDER },
  // --- Изувер: ярость, два клинка ---
  { id: 'reaver-carnage', name: 'Резня', classId: 'reaver', style: 'damage', ...LADDER },
  { id: 'reaver-sinew', name: 'Жилы', classId: 'reaver', style: 'survival', ...LADDER },
  { id: 'reaver-instinct', name: 'Чутьё', classId: 'reaver', style: 'autonomy', ...LADDER },
  // --- Псарь: энергия, лёгкий клинок и пёс ---
  { id: 'houndmaster-chase', name: 'Гон', classId: 'houndmaster', style: 'damage', ...LADDER },
  { id: 'houndmaster-leash', name: 'Привязь', classId: 'houndmaster', style: 'survival', ...LADDER },
  { id: 'houndmaster-trail', name: 'Тропа', classId: 'houndmaster', style: 'autonomy', ...LADDER },
]

export const BRANCH_BY_ID: Record<string, BranchDef> = Object.fromEntries(
  BRANCHES.map((b) => [b.id, b]),
)

/**
 * ГЛУБИНА ВЕТКИ — СКОЛЬКО ОЧКОВ НАДО ВЛОЖИТЬ, ЧТОБЫ ОТКРЫЛСЯ ВЕНЕЦ. Считается
 * из формы, а не лежит числом: этаж k требует `step·(k−1)`, значит последний
 * требует `step·(rows−1)`.
 *
 * ГЛУБИНА И ЁМКОСТЬ — РАЗНЫЕ ВЕЛИЧИНЫ, и путать их нельзя. Ёмкость
 * (`branchCapacity`) — сумма `maxRank` всех талантов ветки, то есть сколько
 * очков ветка ВМЕЩАЕТ; она зависит от наполнения, а глубина — только от
 * формы. Ёмкость выше глубины всегда: дефицит и делает выбор выбором.
 */
export function branchDepth(id: BranchId): number {
  const branch = BRANCH_BY_ID[id]
  return branch ? (branch.rows - 1) * branch.step : 0
}

/** Порог этажа: сколько очков в ветке он требует. */
export function rowRequirement(id: BranchId, row: number): number {
  return (row - 1) * (BRANCH_BY_ID[id]?.step ?? 0)
}

/**
 * УРОВЕНЬ ГЕРОЯ, НА КОТОРОМ ЭТАЖ ОТКРЫВАЕТСЯ ПРИ ВЛОЖЕНИИ В ОДНУ ВЕТКУ.
 *
 * Очко даётся за уровень с `TALENT_FIRST_LEVEL`, поэтому порог в очках и
 * уровень героя — одно и то же число в разных единицах. Игрок считает
 * уровнями («мне до этого этажа ещё десять уровней»), а дерево — очками;
 * показывать надо оба, и считать их обязано одно место.
 */
export function rowHeroLevel(id: BranchId, row: number): number {
  return TALENT_FIRST_LEVEL + rowRequirement(id, row)
}

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
  // Число спутника (укус, замах, доля перенаправления, запас, возврат,
  // восстановление) правится полем и операцией — как правка умения.
  | 'hound-tune'
  // Пока пёс на ногах, весь урон героя выше на долю.
  | 'pack-tactics'
  // Пал пёс — герой несколько секунд бьёт сильнее на долю.
  | 'hound-avenge'

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
  | { kind: 'flag'; flag: 'hound-tune'; field: HoundTuneField; op: 'percent' | 'points'; value: number }
  | { kind: 'flag'; flag: 'pack-tactics'; bonusShare: number }
  | { kind: 'flag'; flag: 'hound-avenge'; bonusShare: number; durationSec: number }

/**
 * ЧТО У СПУТНИКА МОЖНО ПРАВИТЬ ТАЛАНТОМ. Список закрыт: поле спутника, которого
 * здесь нет, талант тронуть не может — тот же довод, что у `ABILITY_TUNABLE`.
 * Величина × ранг, как у всех правок; `percent` — доля от базы, `points` —
 * сдвиг в пунктах (для долей вроде перенаправления).
 */
export type HoundTuneField =
  | 'hitShare'
  | 'swingTime'
  | 'redirectShare'
  | 'maxHpShare'
  | 'returnSec'
  | 'regenInCombat'
  | 'regenOutOfCombat'
/**
 * ФЛАГИ, КОТОРЫМ НУЖЕН СПУТНИК. Это общая машинерия классов со спутником, а не
 * своя машинерия одного класса: любой класс с `companion` прочёл бы их той же
 * логикой. У класса без спутника такой талант мёртв — держит `content:check`.
 */
export const COMPANION_FLAGS: readonly TalentFlag[] = ['hound-tune', 'pack-tactics', 'hound-avenge']

export const HOUND_TUNE_FIELDS: readonly HoundTuneField[] = [
  'hitShare',
  'swingTime',
  'redirectShare',
  'maxHpShare',
  'returnSec',
  'regenInCombat',
  'regenOutOfCombat',
]

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
  /**
   * МЕСТО В РЯДУ — ДАННЫМИ, как место слота на кукле. Дерево рисуется сеткой
   * в четыре столбца; стрелка-предпосылка идёт ПРЯМОЙ вертикальной линией, а
   * значит опора и зависимый обязаны стоять в одном столбце — и решать это
   * должен автор ветки, а не порядок записей в файле. Держится
   * `content:check`: на этаже столбцы не повторяются, стрелка не гнётся,
   * этаж с выбором расставлен весь. Нет поля — талант один на этаже и
   * стоит по центру (так у лестниц Изувера).
   */
  col?: TalentColumn
  maxRank: number
  requiredPointsInBranch: number // сколько очков нужно вложить в ветку до него
  /** Стрелка от таланта выше; нет поля — талант самостоятельный. */
  requires?: TalentRequirement
  /**
   * ВЗАИМОИСКЛЮЧАЮЩАЯ ГРУППА. Таланты с одним именем группы стоят на одном
   * этаже одной ветки, и взять можно ТОЛЬКО ОДИН: как только в один вложено
   * очко, остальные заперты. Нет поля — талант ни с кем не спорит.
   *
   * СТРЕЛКА И ГРУППА — РАЗНЫЕ ВЕЩИ, и одна другую не заменяет: стрелка
   * ТРЕБУЕТ (вложи сперва в опору), группа ЗАПРЕЩАЕТ (вложил в соседа —
   * сюда уже нельзя). Ночь «три ветки» оставила ключевые этажи без групп и
   * считала, что венцы «разведены путями»; путь — это порядок покупки для
   * модели, и запретить он ничего не может — оба венца брались.
   */
  exclusiveGroup?: string
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
  /** Столбец в сетке дерева — см. `TalentDef.col`. */
  col?: TalentColumn
  /** Стрелка от таланта выше — см. `TalentRequirement`. */
  requires?: TalentRequirement
  /** Взаимоисключающая группа — см. `TalentDef.exclusiveGroup`. */
  exclusiveGroup?: string
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

/** Талант, правящий число спутника: поле, операция, величина за ранг. */
const houndTune = (field: HoundTuneField, op: 'percent' | 'points', value: number): TalentEffect => ({
  kind: 'flag',
  flag: 'hound-tune',
  field,
  op,
  value,
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
 * Ветка ЭТАЖАМИ. Номер этажа и его порог берутся ИЗ ФОРМЫ ВЕТКИ, а не пишутся
 * руками у каждой записи: иначе арифметика порогов расползлась бы по сотне
 * литералов и разъехалась при первой же правке. Форма теперь у каждой ветки
 * своя (`rows`, `step`), поэтому шаг берётся у ветки, а не из общей
 * константы. Ранг приходит от самого таланта — см. `TalentSpec`.
 */
function branch(id: BranchId, floors: FloorSpec[]): TalentDef[] {
  const step = BRANCH_BY_ID[id].step
  return floors.flatMap((floor, index) =>
    floor.map((spec) => ({
      ...spec,
      branch: id,
      row: index + 1,
      requiredPointsInBranch: index * step,
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
// ГНЕВ: СЕМЬ ЭТАЖЕЙ ПО ДЕСЯТЬ ОЧКОВ.
//
// Ветка переехала с тринадцати этажей по пять очков на семь по десять.
// Глубина та же — шестьдесят очков до венца, — а вот РИТМ другой, и в этом
// весь смысл переезда. На тринадцати этажах порог следующего отставал от
// прокачки на пять очков: он открывался сам собой, по дороге, и «этаж» был
// просто местом, куда очередное очко ляжет. На семи этажах порог стоит
// десяти очков и открывается РЕДКО — раз в десять уровней, — а в ряду ждут
// четыре-пять узлов, из которых возьмёшь не все. Этаж стал местом ВЫБОРА.
//
// ПОРОГИ 0, 10, 20 … 60 — ЭТО УРОВНИ ГЕРОЯ 10, 20 … 70 при вложении в одну
// ветку: очко даётся за уровень с десятого. Три майлстоуна прокачки (30, 50,
// 70) падают на этажи 3, 5 и 7 сами собой — туда, где стоят пары выбора.
//
// ЭТО ПЕРВАЯ СТАДИЯ ПЕРЕЕЗДА, И ТАЛАНТЫ ЗДЕСЬ ПРЕЖНИЕ. Ночь строит МАШИНЕРИЮ
// и переносит на неё ветку; задуманные таланты приходят стадиями следом,
// заменяя эти по одному. Поэтому за Гнев можно играть после КАЖДОЙ стадии:
// ветка целая всегда, просто пока менее интересная.
//
// РАНГИ ПРИВЕДЕНЫ К СЛОВАРЮ 5/3/1, А СИЛА ВЕТКИ НЕ ТРОНУТА. Ранги были 6, 7,
// 5, 3 и 1 вперемешку — числа, за которыми не стояло ничего, кроме подгонки
// ёмкости. Теперь ранг ЗНАЧИТ: 5 — фон и постепенная настройка, 3 — крупная
// настройка, 1 — переключатель. Ёмкость от этого упала со 115 до 103 (окно
// 94–104), и чтобы падение не оказалось молчаливым ослаблением, у каждого
// перенумерованного таланта величина за ранг умножена на отношение рангов:
// шесть по 0.01582 и пять по 0.018984 — это одни и те же 9.5 %. Совпадение
// держится до седьмого знака и проверено тестом.
//
// СТОЛБЕЦ — ЭТО ПОЛОСА. Узел стоит в столбце по тому, ЧЕГО он касается:
// первый — фон (характеристики), второй — «Рваная рана», третий —
// «Сокрушение», четвёртый и пятый — «Клеймо», «Разрыв» и пары выбора. Так
// стрелка-предпосылка идёт прямой линией вниз по своей полосе, а не наискось
// через чужие узлы.
const WARDEN_WRATH = branch('warden-wrath', [
  // --- ЭТАЖ 1 · порог 0 · с уровня 10 -------------------------------------
  [
    {
      // 0.018984 = 0.01582 × 6 / 5: ранг сменился, суммарные 9.5 % силы атаки
      // за полный талант остались прежними.
      id: 'wrath-honed-edge',
      name: 'Отточенный клинок',
      icon: 'talent-honed-edge',
      maxRank: 5,
      col: 1,
      effect: mods(m('attackPower', 'percent', 0.018984)),
    },
    {
      id: 'wrath-deep-cut',
      name: 'Глубокий надрез',
      icon: 'talent-deep-cut',
      maxRank: 5,
      col: 2,
      effect: tunes('rending-wound', {
        field: 'effectWeaponDamagePercent',
        kind: 'percent',
        value: 0.08,
      }),
    },
    {
      // ПОРЯДОК ПАРЫ «СОКРУШЕНИЯ» ПЕРЕВЁРНУТ. Раньше откат стоял выше урона, и
      // стрелка вела от дешевизны к силе; теперь наоборот — сперва удар, потом
      // частота. Так читается лучше: сначала решают, что удар вообще стоит
      // этой кнопки, и только потом делают его чаще.
      id: 'wrath-heavy-shatter',
      name: 'Тяжёлое сокрушение',
      icon: 'talent-heavy-shatter',
      maxRank: 5,
      col: 3,
      effect: tunes('shattering-blow', {
        field: 'weaponDamagePercent',
        kind: 'percent',
        value: 0.06,
      }),
    },
    {
      // 0.056244 = 0.04687 × 6 / 5.
      id: 'wrath-savage-blows',
      name: 'Свирепые удары',
      icon: 'talent-savage-blows',
      maxRank: 5,
      col: 4,
      effect: mods(m('critMultiplier', 'flat', 0.056244)),
    },
  ],
  // --- ЭТАЖ 2 · порог 10 · с уровня 20 ------------------------------------
  [
    {
      // 0.008436 = 0.00703 × 6 / 5.
      id: 'wrath-keen-eye',
      name: 'Острый глаз',
      icon: 'talent-keen-eye',
      maxRank: 5,
      col: 1,
      effect: mods(m('critChance', 'flat', 0.008436)),
    },
    {
      id: 'wrath-open-vein',
      name: 'Вскрытая жила',
      icon: 'talent-open-vein',
      maxRank: 3,
      col: 2,
      requires: { talentId: 'wrath-deep-cut', minRank: 3 },
      effect: tunes('rending-wound', { field: 'effectTicks', kind: 'percent', value: 0.12 }),
    },
    {
      id: 'wrath-swift-shatter',
      name: 'Скорое сокрушение',
      icon: 'talent-swift-shatter',
      maxRank: 5,
      col: 3,
      requires: { talentId: 'wrath-heavy-shatter', minRank: 3 },
      effect: tunes('shattering-blow', { field: 'cooldownSec', kind: 'percent', value: -0.06 }),
    },
    {
      // 0.006566 = 0.00469 × 7 / 5.
      id: 'wrath-momentum',
      name: 'Разгон',
      icon: 'talent-relentless',
      maxRank: 5,
      col: 4,
      effect: mods(m('haste', 'flat', 0.006566)),
    },
  ],
  // --- ЭТАЖ 3 · порог 20 · с уровня 30 · ПЕРВАЯ ПАРА ВЫБОРА ---------------
  [
    {
      // 0.008436 = 0.00703 × 6 / 5.
      id: 'wrath-frenzy',
      name: 'Исступление',
      icon: 'talent-frenzy',
      maxRank: 5,
      col: 1,
      effect: mods(m('haste', 'flat', 0.008436)),
    },
    {
      id: 'wrath-relentless',
      name: 'Неотступность',
      icon: 'talent-relentless',
      maxRank: 5,
      col: 2,
      effect: tunes('rupture', { field: 'cooldownSec', kind: 'percent', value: -0.08 }),
    },
    {
      id: 'wrath-deep-brand',
      name: 'Глубокое клеймо',
      icon: 'talent-deep-brand',
      maxRank: 5,
      col: 3,
      effect: tunes('brand', { field: 'brandDamageShare', kind: 'percent', value: 0.12 }),
    },
    {
      id: 'wrath-rupture',
      name: 'Рваный выпад',
      icon: 'talent-rupture',
      maxRank: 1,
      col: 4,
      exclusiveGroup: 'wrath-key-3',
      effect: {
        kind: 'flag',
        flag: 'ability-learns-effect',
        abilityId: 'quick-strike',
        effect: BLEED,
      },
    },
    {
      id: 'wrath-headlong',
      name: 'Очертя голову',
      icon: 'talent-headlong',
      maxRank: 1,
      col: 5,
      exclusiveGroup: 'wrath-key-3',
      effect: tunes('shattering-blow', { field: 'type', kind: 'set', value: 'instant' }),
    },
  ],
  // --- ЭТАЖ 4 · порог 30 · с уровня 40 ------------------------------------
  [
    {
      // 0.005628 = 0.00469 × 6 / 5.
      id: 'wrath-true-aim',
      name: 'Верный глазомер',
      icon: 'talent-keen-eye',
      maxRank: 5,
      col: 1,
      effect: mods(m('critChance', 'flat', 0.005628)),
    },
    {
      id: 'wrath-firm-hand',
      name: 'Твёрдая рука',
      icon: 'talent-firm-hand',
      maxRank: 5,
      col: 2,
      effect: tunes('quick-strike', { field: 'weaponDamagePercent', kind: 'percent', value: 0.04 }),
    },
    {
      id: 'wrath-spare-edge',
      name: 'Скупая кромка',
      icon: 'talent-spare-edge',
      maxRank: 5,
      col: 3,
      effect: tunes('quick-strike', { field: 'manaCost', kind: 'percent', value: -0.08 }),
    },
    {
      id: 'wrath-wide-mercy',
      name: 'Широкая милость',
      icon: 'talent-wide-mercy',
      maxRank: 5,
      col: 4,
      effect: tunes('mercy', { field: 'executeBelowHpShare', kind: 'points', value: 0.03 }),
    },
    {
      // 0.0585833 = 0.03515 × 5 / 3.
      id: 'wrath-precision',
      name: 'Точность удара',
      icon: 'talent-savage-blows',
      maxRank: 3,
      col: 5,
      effect: mods(m('critMultiplier', 'flat', 0.0585833)),
    },
  ],
  // --- ЭТАЖ 5 · порог 40 · с уровня 50 · ВТОРАЯ ПАРА ВЫБОРА ---------------
  [
    {
      // 0.007728 = 0.00644 × 6 / 5.
      id: 'wrath-firm-grip',
      name: 'Крепкая хватка',
      icon: 'talent-strength',
      maxRank: 5,
      col: 1,
      effect: mods(m('attackPower', 'percent', 0.007728)),
    },
    {
      // 0.0078167 = 0.00469 × 5 / 3.
      id: 'wrath-light-blade',
      name: 'Лёгкость клинка',
      icon: 'talent-frenzy',
      maxRank: 3,
      col: 2,
      effect: mods(m('haste', 'flat', 0.0078167)),
    },
    {
      id: 'wrath-cold-blood',
      name: 'Хладнокровие',
      icon: 'talent-cold-blood',
      maxRank: 5,
      col: 3,
      effect: mods(m('critChance', 'flat', 0.00586)),
    },
    {
      id: 'wrath-double-flourish',
      name: 'Двойной росчерк',
      icon: 'talent-double-strike',
      maxRank: 1,
      col: 4,
      exclusiveGroup: 'wrath-key-5',
      effect: { kind: 'flag', flag: 'double-strike', chance: 0.2 },
    },
    {
      id: 'wrath-bleeding-edge',
      name: 'Кровоточащая кромка',
      icon: 'talent-bleed-deep',
      maxRank: 1,
      col: 5,
      exclusiveGroup: 'wrath-key-5',
      effect: tunes(
        'rending-wound',
        { field: 'effectTicks', kind: 'percent', value: 0.34 },
        { field: 'effectWeaponDamagePercent', kind: 'percent', value: 0.1 },
      ),
    },
  ],
  // --- ЭТАЖ 6 · порог 50 · с уровня 60 ------------------------------------
  [
    {
      id: 'wrath-heavy-swing',
      name: 'Мощь замаха',
      icon: 'talent-honed-edge',
      maxRank: 5,
      col: 1,
      effect: mods(m('attackPower', 'percent', 0.01582)),
    },
    {
      id: 'wrath-long-focus',
      name: 'Долгое сосредоточение',
      icon: 'talent-long-focus',
      maxRank: 3,
      col: 2,
      effect: tunes('focus', { field: 'freeCastsCasts', kind: 'percent', value: 0.34 }),
    },
  ],
  // --- ЭТАЖ 7 · порог 60 · с уровня 70 · ВЕНЕЦ ----------------------------
  [
    {
      id: 'wrath-second-swing',
      name: 'Второй замах',
      icon: 'talent-second-charge',
      maxRank: 1,
      col: 4,
      exclusiveGroup: 'wrath-key-7',
      effect: {
        kind: 'flag',
        flag: 'ability-extra-charge',
        abilityId: 'shattering-blow',
        extraCharges: 1,
      },
    },
    {
      id: 'wrath-open-wound',
      name: 'Незаживающая рана',
      icon: 'talent-open-wound',
      maxRank: 1,
      col: 5,
      exclusiveGroup: 'wrath-key-7',
      requires: { talentId: 'wrath-bleeding-edge' },
      effect: tunes('rending-wound', { field: 'type', kind: 'set', value: 'instant' }),
    },
  ],
])

const WARDEN_BULWARK = branch('warden-bulwark', [
  [
    {
      id: 'bulwark-thick-hide',
      name: 'Толстая шкура',
      icon: 'talent-thick-hide',
      maxRank: 6,
      col: 2,
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
      col: 3,
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
      col: 2,
      effect: mods(m('blockChance', 'flat', 0.0117)),
    },
    {
      // Щит держится восемь секунд при откате двадцать пять: аптайм — треть.
      // Пять рангов доводят его до половины схватки.
      id: 'bulwark-long-wall',
      name: 'Долгая стена',
      icon: 'talent-long-wall',
      maxRank: 5,
      col: 4,
      effect: tunes('bulwark', { field: 'absorbDurationSec', kind: 'percent', value: 0.09 }),
    },
  ],
  [
    {
      id: 'bulwark-training',
      name: 'Выучка заслона',
      icon: 'talent-bulwark-training',
      maxRank: 6,
      col: 2,
      effect: mods(m('blockValue', 'percent', 0.117)),
    },
    {
      id: 'bulwark-quick-mend',
      name: 'Скорое врачевание',
      icon: 'talent-quick-mend',
      maxRank: 5,
      col: 3,
      effect: tunes('mend-wounds', { field: 'cooldownSec', kind: 'percent', value: -0.06 }),
    },
  ],
  [
    {
      id: 'bulwark-iron-skin',
      name: 'Железная кожа',
      icon: 'talent-iron-skin',
      maxRank: 6,
      col: 2,
      effect: mods(m('damageReduction', 'flat', 0.0059)),
    },
    {
      // Стойка режет 15 % оставшегося урона ценой 30 % своего. Талант растит
      // ТОЛЬКО смягчение: цена остаётся, и обмен видно.
      id: 'bulwark-hard-stance',
      name: 'Крепкая стойка',
      icon: 'talent-hard-stance',
      maxRank: 5,
      col: 1,
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
      col: 2,
      exclusiveGroup: 'bulwark-key-5',
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
      col: 3,
      exclusiveGroup: 'bulwark-key-5',
      effect: tunes('shield-shove', { field: 'weakenHits', kind: 'percent', value: 2 }),
    },
  ],
  [
    {
      id: 'bulwark-sturdy-frame',
      name: 'Крепость тела',
      icon: 'talent-vitality',
      maxRank: 6,
      col: 2,
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
      col: 3,
      effect: tunes('bulwark', { field: 'manaCost', kind: 'percent', value: -0.07 }),
    },
    {
      id: 'bulwark-deep-mend',
      name: 'Глубокое врачевание',
      icon: 'talent-deep-mend',
      maxRank: 5,
      col: 1,
      effect: tunes('mend-wounds', { field: 'healMaxHpShare', kind: 'percent', value: 0.07 }),
    },
  ],
  [
    {
      id: 'bulwark-battle-breath',
      name: 'Дыхание в бою',
      icon: 'talent-second-wind',
      maxRank: 7,
      col: 2,
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
      col: 3,
      effect: tunes('stance', { field: 'stanceDurationSec', kind: 'percent', value: 0.06 }),
    },
  ],
  [
    {
      id: 'bulwark-unyielding',
      name: 'Несгибаемость',
      icon: 'talent-thick-hide',
      maxRank: 7,
      col: 2,
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
      col: 3,
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
      col: 2,
      exclusiveGroup: 'bulwark-key-9',
      effect: { kind: 'flag', flag: 'faster-revive', reviveMultiplier: 0.5 },
    },
    {
      // СТРЕЛКИ ЗДЕСЬ БОЛЬШЕ НЕТ, И ЭТО НЕ ПОТЕРЯ СВЯЗИ, А ПОЧИНКА КАРТИНКИ.
      // Из «Долгой стены» выходили ДВЕ стрелки — сюда (этаж 9) и на «Широкую
      // стену» (этаж 10), — обе в четвёртом столбце, одна поверх другой.
      // Нижняя накрывала верхнюю целиком, и наконечник на девятом этаже
      // читался как конец чужой линии: ровно жалоба «стрелка тянется не от
      // предыдущего таланта». Держит `content:check` (одна исходящая на узел).
      //
      // Смысл связки при этом никуда не делся: «Стена» стоит на втором этаже
      // той же ветки, и до девятого этажа игрок всё равно проходит через неё.
      id: 'bulwark-often-wall',
      name: 'Частая стена',
      icon: 'talent-often-wall',
      maxRank: 1,
      col: 4,
      exclusiveGroup: 'bulwark-key-9',
      effect: tunes('bulwark', { field: 'cooldownSec', kind: 'multiplier', value: 0.5 }),
    },
  ],
  [
    {
      id: 'bulwark-stone-skin',
      name: 'Каменная кожа',
      icon: 'talent-iron-skin',
      maxRank: 5,
      col: 2,
      effect: mods(m('damageReduction', 'flat', 0.0047)),
    },
    {
      // ВТОРАЯ ИЗ ПАРЫ, У КОТОРОЙ СНЯТА СТРЕЛКА: из «Долгой стены» выходили
      // две линии в один столбец (подробности — у «Частой стены» выше).
      // Щит растёт от брони, талант удваивает эту долю, и броня получает
      // третий адрес после смягчения и блока — это остаётся.
      id: 'bulwark-wide-wall',
      name: 'Широкая стена',
      icon: 'talent-wide-wall',
      maxRank: 5,
      col: 4,
      effect: tunes('bulwark', { field: 'absorbArmorShare', kind: 'percent', value: 0.14 }),
    },
  ],
  [
    {
      id: 'bulwark-heavy-guard',
      name: 'Тяжёлый заслон',
      icon: 'talent-bulwark-training',
      maxRank: 5,
      col: 2,
      effect: mods(m('blockValue', 'percent', 0.0879)),
    },
    {
      id: 'bulwark-firm-press',
      name: 'Крепкий упор',
      icon: 'talent-firm-press',
      maxRank: 5,
      col: 3,
      effect: tunes('shield-shove', { field: 'cooldownSec', kind: 'percent', value: -0.07 }),
    },
  ],
  [
    {
      id: 'bulwark-firm-stance',
      name: 'Твёрдая стойка',
      icon: 'talent-shield-wall',
      maxRank: 5,
      col: 2,
      effect: mods(m('blockChance', 'flat', 0.0088)),
    },
    {
      id: 'bulwark-quiet-mend',
      name: 'Тихое врачевание',
      icon: 'talent-quiet-mend',
      maxRank: 3,
      col: 3,
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
      col: 2,
      exclusiveGroup: 'bulwark-key-13',
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
      col: 1,
      exclusiveGroup: 'bulwark-key-13',
      requires: { talentId: 'bulwark-hard-stance', minRank: 3 },
      effect: tunes('stance', { field: 'stanceDamageShare', kind: 'percent', value: -1 }),
    },
  ],
])

// БДЕНИЕ: ВСЁ ПРО ПАУЗЫ — И ТЕПЕРЬ ЭТО ВЫБОР.
//
// Ветка ничего не добавляет к удару и почти ничего к запасу HP: её вклад в
// том, что герой реже ОСТАНАВЛИВАЕТСЯ. Прежние тринадцать талантов правили
// только числа пауз — реген, задержку, длину привала. Половина ветки теперь
// правит ЭКОНОМИКУ РОТАЦИИ: цену умений, откат «Сосредоточения» и жизнь
// «Клейма», то есть то, из-за чего паузы вообще случаются.
//
// ТАЛАНТ, БЬЮЩИЙ ПО ПРИЧИНЕ ОБЯЗАТЕЛЬНОСТИ УМЕНИЯ, здесь «Полный разрыв».
// «Сокрушение» стоит в четвёрке потому, что незаменимо: 5.0 удара оружия —
// вдвое больше следующего. «Разрыв» со «Рваной раной» бьёт всплеском тоже,
// но множитель детонации 1.5 не догоняет; три ранга доводят его до 2.2, и
// связка становится вторым ответом на тот же вопрос.
//
// Числа срезаны множителем 0.586 — тем же, что в Гневе и Оплоте.
const WARDEN_VIGIL = branch('warden-vigil', [
  [
    {
      id: 'vigil-steady-breath',
      name: 'Ровное дыхание',
      icon: 'talent-steady-breath',
      maxRank: 6,
      col: 2,
      // Плоское восстановление ресурса отстаёт от уровня (38.7/с на 25-м
      // против 120.0/с на сотом), поэтому процент; замер на 55-м (72.5/с).
      effect: mods(m('manaRegen', 'percent', 0.0123)),
    },
    {
      // «Сосредоточение» — откат 45 секунд, самый длинный у класса, и вся
      // его ценность ЧУЖАЯ: три бесплатных применения. Пять рангов срезают
      // ожидание на треть.
      id: 'vigil-quick-focus',
      name: 'Скорое сосредоточение',
      icon: 'talent-quick-focus',
      maxRank: 5,
      col: 4,
      effect: tunes('focus', { field: 'cooldownSec', kind: 'percent', value: -0.06 }),
    },
  ],
  [
    {
      id: 'vigil-clear-mind',
      name: 'Ясный ум',
      icon: 'talent-clear-mind',
      // Пауза регенерации — стат: конвейер обрежет её по нулю, в минус не уйдёт.
      maxRank: 6,
      col: 2,
      effect: mods(m('regenDelay', 'flat', -0.176)),
    },
    {
      id: 'vigil-long-brand',
      name: 'Долгое клеймо',
      icon: 'talent-long-brand',
      maxRank: 5,
      col: 1,
      effect: tunes('brand', { field: 'brandDurationSec', kind: 'percent', value: 0.08 }),
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
      col: 2,
      effect: mods(m('maxMana', 'percent', 0.0586)),
    },
    {
      id: 'vigil-thrift-rupture',
      name: 'Скупой разрыв',
      icon: 'talent-thrift-rupture',
      maxRank: 5,
      col: 3,
      effect: tunes('rupture', { field: 'manaCost', kind: 'percent', value: -0.08 }),
    },
  ],
  [
    {
      id: 'vigil-quick-camp',
      name: 'Скорый привал',
      icon: 'talent-quick-camp',
      maxRank: 6,
      col: 2,
      effect: mods(m('restDuration', 'flat', -0.293)),
    },
    {
      id: 'vigil-thrift-shatter',
      name: 'Скупое сокрушение',
      icon: 'talent-thrift-shatter',
      maxRank: 5,
      col: 3,
      effect: tunes('shattering-blow', { field: 'manaCost', kind: 'percent', value: -0.07 }),
    },
  ],
  [
    // 21-е очко, КОНЦЕПТ. Откаты против ресурса: два разных ответа на вопрос
    // «почему герой стоит без дела».
    {
      id: 'vigil-trophy-spirit',
      name: 'Трофейный дух',
      icon: 'talent-kill-refund',
      maxRank: 1,
      col: 2,
      exclusiveGroup: 'vigil-key-5',
      effect: { kind: 'flag', flag: 'kill-refunds-cooldowns', cooldownShare: 0.75 },
    },
    {
      // Три бесплатных применения становятся шестью. Умение, у которого своя
      // ценность около нуля, превращается в половину всплеска — но только у
      // того, кто носит ДОРОГУЮ четвёрку.
      id: 'vigil-long-mind',
      name: 'Долгий настрой',
      icon: 'talent-long-mind',
      maxRank: 1,
      col: 3,
      exclusiveGroup: 'vigil-key-5',
      effect: tunes('focus', { field: 'freeCastsCasts', kind: 'percent', value: 1 }),
    },
  ],
  [
    {
      id: 'vigil-learning',
      name: 'Учёность',
      icon: 'talent-intellect',
      maxRank: 6,
      col: 2,
      // Было `intellect flat 3` — плоская характеристика отстаёт от уровня.
      effect: mods(m('maxMana', 'percent', 0.0129)),
    },
    {
      // ПОРОГ АВТОКАСТА КЛЕЙМА — В ПУНКТАХ: 50 % − 5 рангов по 4 = 30 %.
      // Автокаст вешает метку и на подраненного, а не только на свежего.
      id: 'vigil-early-brand',
      name: 'Ранняя метка',
      icon: 'talent-early-brand',
      maxRank: 5,
      col: 3,
      effect: tunes('brand', {
        field: 'brandAutocastAboveHpShare',
        kind: 'points',
        value: -0.04,
      }),
    },
    {
      id: 'vigil-thrift-wound',
      name: 'Скупая рана',
      icon: 'talent-thrift-wound',
      maxRank: 5,
      col: 1,
      effect: tunes('rending-wound', { field: 'manaCost', kind: 'percent', value: -0.07 }),
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
      col: 2,
      effect: mods(m('restDuration', 'percent', -0.0234)),
    },
    {
      id: 'vigil-thrift-mercy',
      name: 'Скупая милость',
      icon: 'talent-thrift-mercy',
      maxRank: 5,
      col: 3,
      effect: tunes('mercy', { field: 'manaCost', kind: 'percent', value: -0.08 }),
    },
  ],
  [
    {
      id: 'vigil-slow-bleeding',
      name: 'Скорое заживление',
      icon: 'talent-second-wind',
      maxRank: 7,
      col: 2,
      effect: mods(m('hpRegen', 'percent', 0.0223)),
    },
    {
      id: 'vigil-often-brand',
      name: 'Частая метка',
      icon: 'talent-often-brand',
      maxRank: 5,
      col: 3,
      effect: tunes('brand', { field: 'cooldownSec', kind: 'percent', value: -0.07 }),
    },
  ],
  [
    // 41-е очко, КОНЦЕПТ. Привал против метки: снять цену остановки или
    // сделать так, чтобы метка её пережила.
    {
      id: 'vigil-unbroken-focus',
      name: 'Несбитый настрой',
      icon: 'talent-unbroken-focus',
      maxRank: 1,
      col: 2,
      exclusiveGroup: 'vigil-key-9',
      effect: { kind: 'flag', flag: 'rest-clears-cooldowns', cooldownShare: 0 },
    },
    {
      // СТРЕЛКА: метка, которую герой уже растил. Сорок секунд — дольше
      // любой обычной схватки: клеймо перестаёт быть решением «на кого» и
      // становится фоном.
      id: 'vigil-lasting-brand',
      name: 'Затяжное клеймо',
      icon: 'talent-lasting-brand',
      maxRank: 1,
      col: 1,
      exclusiveGroup: 'vigil-key-9',
      requires: { talentId: 'vigil-long-brand', minRank: 3 },
      effect: tunes('brand', { field: 'brandDurationSec', kind: 'multiplier', value: 2 }),
    },
  ],
  [
    {
      id: 'vigil-thrift',
      name: 'Бережливость',
      icon: 'talent-deep-well',
      maxRank: 5,
      col: 2,
      effect: mods(m('maxMana', 'percent', 0.0469)),
    },
    {
      id: 'vigil-thrift-stance',
      name: 'Скупая стойка',
      icon: 'talent-thrift-stance',
      maxRank: 5,
      col: 3,
      effect: tunes('stance', { field: 'manaCost', kind: 'percent', value: -0.08 }),
    },
  ],
  [
    {
      id: 'vigil-composure',
      name: 'Собранность',
      icon: 'talent-clear-mind',
      maxRank: 5,
      col: 2,
      effect: mods(m('regenDelay', 'flat', -0.117)),
    },
    {
      id: 'vigil-quick-mercy',
      name: 'Скорая милость',
      icon: 'talent-quick-mercy',
      maxRank: 5,
      col: 3,
      effect: tunes('mercy', { field: 'cooldownSec', kind: 'percent', value: -0.07 }),
    },
  ],
  [
    {
      id: 'vigil-light-sleep',
      name: 'Чуткий сон',
      icon: 'talent-quick-camp',
      maxRank: 5,
      col: 2,
      effect: mods(m('restDuration', 'flat', -0.176)),
    },
    {
      // БЬЁТ ПО ПРИЧИНЕ ОБЯЗАТЕЛЬНОСТИ «СОКРУШЕНИЯ». Оно незаменимо потому,
      // что бьёт вдвое сильнее следующего; «Разрыв» со «Рваной раной» тоже
      // всплеск, но множитель 1.5 не догоняет. Три ранга доводят его до 2.2 —
      // и связка становится вторым ответом на тот же вопрос.
      id: 'vigil-full-rupture',
      name: 'Полный разрыв',
      icon: 'talent-full-rupture',
      maxRank: 3,
      col: 3,
      effect: tunes('rupture', { field: 'detonateMultiplier', kind: 'percent', value: 0.15 }),
    },
  ],
  [
    // 61-е очко, ДВА КАПСТОУНА: привал перестаёт быть налогом против того,
    // чтобы всплеск приходил вдвое чаще.
    {
      id: 'vigil-campfire-on-the-move',
      name: 'Костёр на ходу',
      icon: 'talent-shorter-rest',
      maxRank: 1,
      col: 2,
      exclusiveGroup: 'vigil-key-13',
      effect: { kind: 'flag', flag: 'shorter-rest', durationMultiplier: 1 / 3 },
    },
    {
      // СТРЕЛКА: венец достаётся тому, кто растил откат всю ветку.
      id: 'vigil-endless-mind',
      name: 'Неиссякаемость',
      icon: 'talent-endless-mind',
      maxRank: 1,
      col: 4,
      exclusiveGroup: 'vigil-key-13',
      requires: { talentId: 'vigil-quick-focus', minRank: 3 },
      effect: tunes('focus', { field: 'cooldownSec', kind: 'multiplier', value: 0.5 }),
    },
  ],
])

// ---------------------------------------------------------------------------
// ИЗУВЕР
// ---------------------------------------------------------------------------

// Резня: тот же стиль, что и Гнев, но растёт в две руки — вместо ускорения
// на четвёртом этаже стоит сила левой руки, и оба заряда-капстоуна другие.
// ---------------------------------------------------------------------------
// ИЗУВЕР
// ---------------------------------------------------------------------------

// РЕЗНЯ: ВСЁ ПРО УДАР И ПРО ТО, ЧЕМ ЕГО ОПЛАЧИВАЮТ.
//
// Ветка была лестницей из тринадцати одиночных узлов — очки лились в
// единственный доступный талант, и выбора не было ни на одном этаже. Теперь
// на этаже двое-трое, ёмкость больше, чем очков у героя, и это и есть цена
// выбора.
//
// БОЛЬШЕ ПОЛОВИНЫ ТАЛАНТОВ ПРАВЯТ УМЕНИЯ, и это не украшение: у класса их
// теперь одиннадцать, и ветка, состоящая из процентов, меняла бы ЧИСЛА, а не
// ротацию. Ключевые этажи (5, 9, 13) — пары взаимоисключающих, и обе стороны
// пары различаются РОДОМ, а не величиной.
const REAVER_CARNAGE = branch('reaver-carnage', [
  [
    {
      id: 'carnage-bloodlust',
      name: 'Жажда крови',
      icon: 'talent-honed-edge',
      maxRank: 6,
      col: 2,
      effect: mods(m('attackPower', 'percent', 0.02)),
    },
    {
      id: 'carnage-quick-cleaver',
      name: 'Скорый тесак',
      icon: 'talent-firm-hand',
      maxRank: 5,
      col: 3,
      effect: tunes('gut-rip', { field: 'cooldownSec', kind: 'percent', value: -0.06 }),
    },
  ],
  [
    {
      id: 'carnage-predator-eye',
      name: 'Хищный взгляд',
      icon: 'talent-keen-eye',
      maxRank: 6,
      col: 2,
      effect: mods(m('critChance', 'flat', 0.012)),
    },
    {
      // ПЕРЕЦЕЛЕН, А НЕ УДАЛЁН. Талант правил урон КРОВОТЕЧЕНИЯ «Кровавого
      // исступления»; кровотечение уехало Стражу вместе со всем механизмом
      // меток, и правка стала правкой пустоты — тихой, потому что схема
      // проверяла только имя поля. Теперь он правит РАЗГОН, то есть то, чем
      // это умение стало: прирост за каждый свой удар.
      id: 'carnage-deep-frenzy',
      name: 'Глубокое исступление',
      icon: 'talent-bleed-deep',
      maxRank: 5,
      col: 3,
      effect: tunes('blood-frenzy', {
        field: 'rampPerSwing',
        kind: 'percent',
        value: 0.08,
      }),
    },
  ],
  [
    {
      id: 'carnage-ferocity',
      name: 'Свирепость',
      icon: 'talent-savage-blows',
      maxRank: 6,
      col: 1,
      effect: mods(m('critMultiplier', 'flat', 0.08)),
    },
    {
      id: 'carnage-heavy-splitter',
      name: 'Тяжёлый череполом',
      icon: 'talent-heavy-shatter',
      maxRank: 5,
      col: 2,
      effect: tunes('skull-splitter', {
        field: 'weaponDamagePercent',
        kind: 'percent',
        value: 0.06,
      }),
    },
    {
      id: 'carnage-thirsty-blade',
      name: 'Жадный клинок',
      icon: 'talent-deep-cut',
      maxRank: 5,
      col: 3,
      effect: tunes('blood-thirst', {
        field: 'weaponDamagePercent',
        kind: 'percent',
        value: 0.07,
      }),
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
      col: 1,
      effect: mods(m('offhandPenalty', 'flat', 0.03)),
    },
    {
      id: 'carnage-swift-cleaver',
      name: 'Широкий тесак',
      icon: 'talent-spare-edge',
      maxRank: 5,
      col: 3,
      effect: tunes('gut-rip', { field: 'weaponDamagePercent', kind: 'percent', value: 0.05 }),
      // Стрелка по смыслу: оба таланта про «Потрошащий взмах», и второй
      // буквально дорабатывает первый — сперва чаще, потом сильнее.
      requires: { talentId: 'carnage-quick-cleaver' },
    },
  ],
  [
    // 21-е очко, КЛЮЧЕВОЙ ЭТАЖ, И ОН ПЕРЕСОБРАН ЦЕЛИКОМ.
    //
    // Пара была такая: слева дешёвый удар НАЧИНАЛ КРОВИТЬ, справа
    // кровотечение переставало ЖДАТЬ ЗАМАХА. Оба таланта — про метку на
    // цели, то есть про механизм СТРАЖА, выданный Изуверу под другими
    // именами; а после того как кровотечение уехало Стражу целиком, правый
    // и вовсе стал ставить «мгновенное» умению, которое уже мгновенное.
    // Ключевой этаж, где ОБА варианта ничего не делают, — худшее, что
    // бывает с деревом: игрок платит 21 очко за выбор между двумя нулями.
    //
    // Новая пара — про СБРОС, главную кнопку класса, и различается она
    // родом: слева меняется МОМЕНТ (автокаст ждёт почти полной полоски),
    // справа — СПОСОБ (удар перестаёт ждать замаха). Числа тут ни при чём:
    // при них ротация разная — редкие огромные удары против частых сразу.
    {
      id: 'carnage-bleeding-wound',
      name: 'Полный размах',
      icon: 'talent-bleed-deep',
      maxRank: 1,
      col: 2,
      exclusiveGroup: 'carnage-key-5',
      effect: tunes('skull-splitter', {
        field: 'autocastResourceAbove',
        kind: 'points',
        value: 0.3,
      }),
    },
    {
      id: 'carnage-open-veins',
      name: 'Рваный размах',
      icon: 'talent-open-vein',
      maxRank: 1,
      col: 3,
      exclusiveGroup: 'carnage-key-5',
      effect: tunes('skull-splitter', { field: 'type', kind: 'set', value: 'instant' }),
    },
  ],
  [
    {
      id: 'carnage-wild-strength',
      name: 'Дикая сила',
      icon: 'talent-strength',
      maxRank: 6,
      col: 1,
      // Процент, а не плоская сила: плоская прибавка к характеристике
      // обесценивается к сотому уровню (см. TALENT_STAT_RULE).
      effect: mods(m('attackPower', 'percent', 0.011)),
    },
    {
      // Правил множитель детонации — детонация уехала Стражу. На месте того
      // же умения теперь ГРАНЬ, и талант правит её силу.
      id: 'carnage-hungry-tear',
      name: 'Голодная грань',
      icon: 'talent-full-rupture',
      maxRank: 5,
      col: 2,
      effect: tunes('sinew-tear', { field: 'edgeDamagePerShare', kind: 'percent', value: 0.06 }),
    },
    {
      id: 'carnage-brutal-reckoning',
      name: 'Жестокая расправа',
      icon: 'talent-wide-mercy',
      maxRank: 5,
      col: 3,
      effect: tunes('reckoning', { field: 'weaponDamagePercent', kind: 'percent', value: 0.07 }),
    },
  ],
  [
    {
      id: 'carnage-beast-aim',
      name: 'Звериный глазомер',
      icon: 'talent-cold-blood',
      maxRank: 6,
      col: 1,
      effect: mods(m('critChance', 'flat', 0.01)),
    },
    {
      // ПОРОГ ДОБИВАНИЯ — В ПУНКТАХ: 20 % + 5 рангов по 2 = 30 %.
      id: 'carnage-wide-reckoning',
      name: 'Ранняя расправа',
      icon: 'talent-quick-mercy',
      maxRank: 5,
      col: 3,
      effect: tunes('reckoning', {
        field: 'executeBelowHpShare',
        kind: 'points',
        value: 0.02,
      }),
    },
  ],
  [
    {
      id: 'carnage-drive',
      name: 'Напор',
      icon: 'talent-frenzy',
      maxRank: 6,
      col: 2,
      effect: mods(m('haste', 'flat', 0.01)),
    },
    {
      id: 'carnage-long-roar',
      name: 'Долгий рёв',
      icon: 'talent-long-focus',
      maxRank: 5,
      col: 3,
      effect: tunes('blood-roar', { field: 'windowDurationSec', kind: 'percent', value: 0.08 }),
    },
  ],
  [
    // 41-е очко, КЛЮЧЕВОЙ ЭТАЖ. Слева ПРОК (иногда бьёшь дважды), справа —
    // снятие ожидания замаха у детонатора. Первое добавляет ударов, второе
    // переставляет их во времени: разные роды, а не разные числа.
    {
      id: 'carnage-blade-storm',
      name: 'Буря клинков',
      icon: 'talent-double-strike',
      maxRank: 1,
      col: 2,
      exclusiveGroup: 'carnage-key-9',
      effect: { kind: 'flag', flag: 'double-strike', chance: 0.12 },
    },
    {
      // Ставил «мгновенное» умению, которое стало мгновенным само: после
      // переделки правая половина ключевого этажа не делала НИЧЕГО. Теперь
      // она опускает порог ГРАНИ на двадцать пять пунктов — состояние
      // начинает платить почти сразу и держится всё время, но каждая
      // единица ярости в нём стоит меньше. Против «Бури клинков» это выбор
      // рода: лишние замахи рулеткой против ровной прибавки от полоски.
      id: 'carnage-frenzied-tear',
      name: 'Через край',
      icon: 'talent-rupture',
      maxRank: 1,
      col: 3,
      exclusiveGroup: 'carnage-key-9',
      effect: tunes('sinew-tear', {
        field: 'edgeResourceAbove',
        kind: 'points',
        value: -0.25,
      }),
    },
  ],
  [
    {
      id: 'carnage-second-hand',
      name: 'Вторая рука',
      icon: 'talent-offhand-mastery',
      maxRank: 5,
      col: 1,
      effect: mods(m('offhandPenalty', 'flat', 0.02)),
    },
    {
      // Правил ЦЕНУ Череполома. Своей цены у него больше нет вовсе — он
      // тратит всю полоску, — и скидка в −7 % от нуля была нулём. Талант
      // переехал к грани, к соседу по столбцу, и стрелка вслед за ним.
      id: 'carnage-cheap-splitter',
      name: 'Затяжная грань',
      icon: 'talent-thrift-shatter',
      maxRank: 5,
      col: 2,
      effect: tunes('sinew-tear', { field: 'edgeDurationSec', kind: 'percent', value: 0.09 }),
      requires: { talentId: 'carnage-hungry-tear' },
    },
    {
      // Правил число тиков кровотечения — теперь правит то, что от «долгого»
      // и осталось: сколько секунд держится разгон.
      id: 'carnage-deeper-frenzy',
      name: 'Долгое исступление',
      icon: 'talent-open-wound',
      maxRank: 3,
      col: 3,
      effect: tunes('blood-frenzy', { field: 'rampDurationSec', kind: 'percent', value: 0.2 }),
      requires: { talentId: 'carnage-deep-frenzy' },
    },
  ],
  [
    {
      id: 'carnage-onslaught',
      name: 'Натиск',
      icon: 'talent-relentless',
      maxRank: 6,
      col: 2,
      effect: mods(m('attackPower', 'percent', 0.012)),
    },
    {
      id: 'carnage-swift-splitter',
      name: 'Скорый череполом',
      icon: 'talent-swift-shatter',
      maxRank: 5,
      col: 3,
      effect: tunes('skull-splitter', { field: 'cooldownSec', kind: 'percent', value: -0.06 }),
    },
  ],
  [
    {
      id: 'carnage-blood-charge',
      name: 'Кровавый разгон',
      icon: 'talent-blood-charge',
      maxRank: 5,
      col: 1,
      effect: mods(m('haste', 'flat', 0.012)),
    },
    {
      id: 'carnage-fierce-berserk',
      name: 'Лютое бешенство',
      icon: 'talent-hard-stance',
      maxRank: 5,
      col: 2,
      // Доля стойки отрицательная (урон ВЫШЕ), и процент её усиливает —
      // знак при этом не меняется, обмен остаётся обменом.
      effect: tunes('berserk', { field: 'stanceDamageShare', kind: 'percent', value: 0.08 }),
    },
  ],
  [
    // 61-е очко, ВЕНЕЦ. Слева расправа становится двигателем ротации: вдвое
    // чаще и вдвое щедрее на ярость. Справа бешенство становится почти
    // постоянным. Первое про ХВОСТ боя, второе про весь бой целиком.
    {
      id: 'carnage-carnage',
      name: 'Резня',
      icon: 'talent-second-charge',
      maxRank: 1,
      col: 2,
      exclusiveGroup: 'carnage-key-13',
      // ВТОРОЙ ЗАРЯД ДОБИВАНИЯ. Хвост боя срезается дважды подряд, и ярость
      // возвращается дважды — на следующий бой герой входит не пустым.
      effect: {
        kind: 'flag',
        flag: 'ability-extra-charge',
        abilityId: 'reckoning',
        extraCharges: 1,
      },
    },
    {
      id: 'carnage-red-haze',
      name: 'Багровая пелена',
      icon: 'talent-long-stance',
      maxRank: 1,
      col: 3,
      exclusiveGroup: 'carnage-key-13',
      effect: tunes(
        'berserk',
        { field: 'stanceDurationSec', kind: 'multiplier', value: 2 },
        { field: 'cooldownSec', kind: 'multiplier', value: 0.6 },
      ),
    },
  ],
])

// ЖИЛЫ: ЧЕМ ДОЛЬШЕ СТОИШЬ, ТЕМ ДЕШЕВЛЕ СТОЯТЬ.
//
// Ветка живучести класса, у которого нет ни лечащего умения, ни налива
// ресурса привалом: держится он тем, что БЬЁТ (вампиризм) и тем, что
// НЕ УХОДИТ (упор). Отсюда и наполнение — половина талантов правит именно
// эти два умения.
const REAVER_SINEW = branch('reaver-sinew', [
  [
    {
      id: 'sinew-beast-hide',
      name: 'Звериная шкура',
      icon: 'talent-thick-hide',
      maxRank: 6,
      col: 2,
      effect: mods(m('armor', 'percent', 0.03)),
    },
    {
      id: 'sinew-braced-guard',
      name: 'Упрямая стойка',
      icon: 'talent-braced',
      maxRank: 5,
      col: 3,
      effect: tunes('dug-in', { field: 'resolveMaxShare', kind: 'percent', value: 0.06 }),
    },
  ],
  [
    {
      id: 'sinew-forearm-guard',
      name: 'Наручи',
      icon: 'talent-iron-skin',
      maxRank: 6,
      col: 2,
      effect: mods(m('maxHp', 'percent', 0.02)),
    },
    {
      id: 'sinew-thirsty-bite',
      name: 'Жадный укус',
      icon: 'talent-deep-mend',
      maxRank: 5,
      col: 3,
      effect: tunes('blood-thirst', { field: 'leechHealShare', kind: 'percent', value: 0.07 }),
    },
  ],
  [
    {
      id: 'sinew-tanned-hide',
      name: 'Дублёная кожа',
      icon: 'talent-hard-to-kill',
      maxRank: 6,
      col: 1,
      effect: mods(m('damageReduction', 'flat', 0.008)),
    },
    {
      id: 'sinew-long-dig',
      name: 'Долгий упор',
      icon: 'talent-long-wall',
      maxRank: 5,
      col: 2,
      effect: tunes('dug-in', { field: 'resolveDurationSec', kind: 'percent', value: 0.08 }),
    },
    {
      id: 'sinew-cheap-thirst',
      name: 'Скупая жажда',
      icon: 'talent-thrift-wound',
      maxRank: 5,
      col: 3,
      effect: tunes('blood-thirst', { field: 'manaCost', kind: 'percent', value: -0.07 }),
      requires: { talentId: 'sinew-thirsty-bite' },
    },
  ],
  [
    {
      id: 'sinew-hardened',
      name: 'Задубелость',
      icon: 'talent-bulwark-training',
      maxRank: 6,
      col: 1,
      effect: mods(m('armor', 'percent', 0.025)),
    },
    {
      id: 'sinew-firm-dig',
      name: 'Твёрдый упор',
      icon: 'talent-firm-press',
      maxRank: 5,
      col: 3,
      effect: tunes('dug-in', { field: 'resolvePerHitTaken', kind: 'percent', value: 0.08 }),
      requires: { talentId: 'sinew-braced-guard' },
    },
  ],
  [
    // 21-е очко, КЛЮЧЕВОЙ ЭТАЖ. Слева блок начинает платить ЯРОСТЬЮ — щит
    // становится источником ресурса. Справа упор перестаёт быть окном и
    // держится почти всегда — ресурса не прибавляет, зато счёт меньше. Пара
    // про одно и то же (как пережить бой), но ответы разного рода.
    {
      id: 'sinew-blood-for-blood',
      name: 'Отдача щита',
      icon: 'talent-block-resource',
      maxRank: 1,
      col: 2,
      exclusiveGroup: 'sinew-key-5',
      // ЯРОСТЬ ИЗ БЛОКА. Работает только со щитом в руке, и это осознанно:
      // сборка «щит и упор» получает ресурс оттуда, откуда обычно приходит
      // только урон.
      effect: { kind: 'flag', flag: 'block-restores-resource', resourceShare: 0.08 },
    },
    {
      id: 'sinew-iron-dig',
      name: 'Железный упор',
      icon: 'talent-often-wall',
      maxRank: 1,
      col: 3,
      exclusiveGroup: 'sinew-key-5',
      effect: tunes('dug-in', { field: 'cooldownSec', kind: 'multiplier', value: 0.6 }),
    },
  ],
  [
    {
      id: 'sinew-knitting',
      name: 'Сращение',
      icon: 'talent-second-wind',
      maxRank: 6,
      col: 1,
      effect: mods(m('hpRegen', 'percent', 0.06)),
    },
    {
      id: 'sinew-deep-price',
      name: 'Дорогая плата',
      icon: 'talent-blood-charge',
      maxRank: 5,
      col: 2,
      effect: tunes('blood-price', {
        field: 'bloodPriceResourceShare',
        kind: 'percent',
        value: 0.08,
      }),
    },
  ],
  [
    {
      id: 'sinew-frame',
      name: 'Костяк',
      icon: 'talent-vitality',
      maxRank: 6,
      col: 1,
      effect: mods(m('maxHp', 'percent', 0.02)),
    },
    {
      id: 'sinew-swift-dig',
      name: 'Скорый упор',
      icon: 'talent-quick-focus',
      maxRank: 5,
      col: 2,
      effect: tunes('dug-in', { field: 'cooldownSec', kind: 'percent', value: -0.06 }),
    },
  ],
  [
    {
      id: 'sinew-carapace',
      name: 'Панцирь',
      icon: 'talent-shield-wall',
      maxRank: 6,
      col: 1,
      effect: mods(m('armor', 'percent', 0.025)),
    },
    {
      id: 'sinew-guarded-roar',
      name: 'Осторожный рёв',
      icon: 'talent-thrift-stance',
      maxRank: 5,
      col: 3,
      effect: tunes('blood-roar', { field: 'manaCost', kind: 'percent', value: -0.08 }),
    },
  ],
  [
    // 41-е очко, КЛЮЧЕВОЙ ЭТАЖ. Слева смерть перестаёт быть дорогой, справа
    // бешенство перестаёт быть опасным. Первое про ПОСЛЕ боя, второе про
    // сам бой.
    {
      id: 'sinew-not-finished',
      name: 'Не добит',
      icon: 'talent-swift-return',
      maxRank: 1,
      col: 2,
      exclusiveGroup: 'sinew-key-9',
      effect: { kind: 'flag', flag: 'faster-revive', reviveMultiplier: 0.5 },
    },
    {
      id: 'sinew-stone-skin',
      name: 'Каменная кожа',
      icon: 'talent-guard-echo',
      maxRank: 1,
      col: 3,
      exclusiveGroup: 'sinew-key-9',
      // Смягчение стойки у «Бешенства» отрицательное (входящее ЖЁСТЧЕ);
      // множитель 0.4 делает штраф втрое меньше, знак не трогая.
      effect: tunes('berserk', { field: 'stanceMitigationShare', kind: 'multiplier', value: 0.4 }),
    },
  ],
  [
    {
      id: 'sinew-counterblow',
      name: 'Ответный удар',
      icon: 'talent-block-reflect',
      maxRank: 5,
      col: 1,
      effect: mods(m('blockValue', 'percent', 0.05)),
    },
    {
      // ПОРОГ АВТОКАСТА ПЛАТЫ — В ПУНКТАХ: 65 % − 5 рангов по 3 = 50 %.
      // Герой начинает платить здоровьем и на просевшей полоске.
      id: 'sinew-tough-price',
      name: 'Дешёвая кровь',
      icon: 'talent-early-brand',
      maxRank: 5,
      col: 2,
      effect: tunes('blood-price', {
        field: 'autocastHeroHpAbove',
        kind: 'points',
        value: -0.03,
      }),
    },
  ],
  [
    {
      id: 'sinew-brace',
      name: 'Упрямство',
      icon: 'talent-press',
      maxRank: 6,
      col: 1,
      effect: mods(m('damageReduction', 'flat', 0.006)),
    },
    {
      id: 'sinew-lasting-dig',
      name: 'Стойкий упор',
      icon: 'talent-lasting-brand',
      maxRank: 5,
      col: 2,
      effect: tunes('dug-in', { field: 'resolveMaxShare', kind: 'percent', value: 0.05 }),
      requires: { talentId: 'sinew-long-dig' },
    },
  ],
  [
    {
      id: 'sinew-spiked-guard',
      name: 'Шипастая защита',
      icon: 'talent-spiked-guard',
      maxRank: 5,
      col: 1,
      effect: mods(m('armor', 'percent', 0.02)),
    },
    {
      id: 'sinew-red-thirst',
      name: 'Красная жажда',
      icon: 'talent-quiet-mend',
      maxRank: 5,
      col: 2,
      effect: tunes('blood-thirst', { field: 'cooldownSec', kind: 'percent', value: -0.06 }),
    },
  ],
  [
    // 61-е очко, ВЕНЕЦ. Слева упор держится почти постоянно — герой ПЛАТИТ
    // за бой меньше. Справа блок отвечает шипами — герой платит столько же,
    // но и берёт с нападающего. Разные ответы на один вопрос.
    {
      id: 'sinew-unbroken',
      name: 'Несгибаемый',
      icon: 'talent-immovable',
      maxRank: 1,
      col: 2,
      exclusiveGroup: 'sinew-key-13',
      effect: tunes(
        'dug-in',
        { field: 'resolveDurationSec', kind: 'multiplier', value: 2 },
        { field: 'cooldownSec', kind: 'multiplier', value: 0.5 },
      ),
    },
    {
      id: 'sinew-thorned-answer',
      name: 'Шипастый ответ',
      icon: 'talent-block-reflect',
      maxRank: 1,
      col: 3,
      exclusiveGroup: 'sinew-key-13',
      // Половина поглощённого блоком возвращается бьющему. Как и «Отдача
      // щита», работает только со щитом — ветка честно предлагает СБОРКУ,
      // а не прибавку всем.
      effect: { kind: 'flag', flag: 'block-reflects', damageShare: 0.5 },
    },
  ],
])

// ЧУТЬЁ: ПРО РЕСУРС И ПРО ВРЕМЯ ВНЕ БОЯ.
//
// Автономность у класса на ярости — это не «реже отдыхать», а «меньше стоять
// пустым»: ветка про ёмкость полоски, про разгон и про окно, в котором
// умения ничего не стоят.
const REAVER_INSTINCT = branch('reaver-instinct', [
  [
    {
      id: 'instinct-beast-breath',
      name: 'Звериное дыхание',
      icon: 'talent-steady-breath',
      maxRank: 6,
      col: 2,
      effect: mods(m('hpRegenOutOfCombat', 'percent', 0.06)),
    },
    {
      id: 'instinct-quick-letting',
      name: 'Скорое кровопускание',
      icon: 'talent-quick-focus',
      maxRank: 5,
      col: 3,
      effect: tunes('blood-letting', { field: 'cooldownSec', kind: 'percent', value: -0.06 }),
    },
  ],
  [
    {
      id: 'instinct-rage-capacity',
      name: 'Ёмкость ярости',
      icon: 'talent-deep-well',
      maxRank: 6,
      col: 2,
      // ЕДИНСТВЕННЫЙ СПОСОБ поднять запас ярости выше ста: ни уровень, ни
      // характеристики, ни находки его не двигают.
      effect: mods(m('maxMana', 'percent', 0.05)),
    },
    {
      id: 'instinct-rich-letting',
      name: 'Щедрое кровопускание',
      icon: 'talent-open-vein',
      maxRank: 5,
      col: 3,
      effect: tunes('blood-letting', {
        field: 'generateResourceShare',
        kind: 'percent',
        value: 0.06,
      }),
      requires: { talentId: 'instinct-quick-letting' },
    },
  ],
  [
    {
      id: 'instinct-short-rest',
      name: 'Короткий привал',
      icon: 'talent-quick-camp',
      maxRank: 6,
      col: 1,
      effect: mods(m('restDuration', 'flat', -0.25)),
    },
    {
      // ПРОЦЕНТОМ, А НЕ СЕКУНДАМИ: секунды уже заняты соседом по этажу
      // («Короткий привал»), и два одинаковых по роду таланта в одном ряду
      // выбором не были бы. Это же место — то, куда переехал удалённый
      // талант на ПОРОГ привала: настройка игрока таланту не принадлежит.
      id: 'instinct-light-camp',
      name: 'Лёгкий привал',
      icon: 'talent-shorter-rest',
      maxRank: 5,
      col: 2,
      effect: mods(m('restDuration', 'percent', -0.0234)),
    },
  ],
  [
    {
      id: 'instinct-hardy-stock',
      name: 'Гулкий рёв',
      icon: 'talent-early-call',
      maxRank: 6,
      col: 1,
      effect: tunes('blood-roar', { field: 'weaponDamagePercent', kind: 'percent', value: 0.06 }),
    },
    {
      id: 'instinct-swift-roar',
      name: 'Скорый рёв',
      icon: 'talent-early-call',
      maxRank: 5,
      col: 3,
      effect: tunes('blood-roar', { field: 'cooldownSec', kind: 'percent', value: -0.06 }),
    },
  ],
  [
    // 21-е очко, КЛЮЧЕВОЙ ЭТАЖ. Слева убийство сбрасывает откаты — ротация
    // разгоняется УБИЙСТВАМИ, то есть рывками. Справа разгон жмётся вдвое
    // чаще — ярость идёт РОВНО. Оба про «меньше стоять без дела», и ответы
    // у них разного рода.
    {
      id: 'instinct-taste-of-victory',
      name: 'Вкус победы',
      icon: 'talent-kill-refund',
      maxRank: 1,
      col: 2,
      exclusiveGroup: 'instinct-key-5',
      effect: { kind: 'flag', flag: 'kill-refunds-cooldowns', cooldownShare: 0.75 },
    },
    {
      id: 'instinct-endless-letting',
      name: 'Открытая жила',
      icon: 'talent-open-vein',
      maxRank: 1,
      col: 3,
      exclusiveGroup: 'instinct-key-5',
      // Разгон вдвое чаще: ярость идёт РОВНО, а не приходит с убийствами.
      effect: tunes('blood-letting', { field: 'cooldownSec', kind: 'multiplier', value: 0.5 }),
    },
  ],
  [
    {
      id: 'instinct-hunger',
      name: 'Голод',
      icon: 'talent-intellect',
      maxRank: 6,
      col: 2,
      effect: mods(m('maxMana', 'percent', 0.03)),
    },
    {
      id: 'instinct-cheap-tear',
      name: 'Скупой разрыв',
      icon: 'talent-thrift-rupture',
      maxRank: 5,
      col: 3,
      effect: tunes('sinew-tear', { field: 'manaCost', kind: 'percent', value: -0.07 }),
    },
  ],
  [
    {
      id: 'instinct-second-breath',
      name: 'Второе дыхание',
      icon: 'talent-second-wind',
      maxRank: 6,
      col: 1,
      effect: mods(m('hpRegen', 'percent', 0.05)),
    },
    {
      id: 'instinct-full-roar',
      name: 'Полный рёв',
      icon: 'talent-long-focus',
      maxRank: 5,
      col: 3,
      effect: tunes('blood-roar', { field: 'windowDurationSec', kind: 'percent', value: 0.07 }),
      // Оба про «Кровавый рёв»: сперва чаще, потом дольше.
      requires: { talentId: 'instinct-swift-roar' },
    },
  ],
  [
    {
      id: 'instinct-never-cooling',
      name: 'Неостывающий',
      icon: 'talent-relentless',
      maxRank: 6,
      col: 2,
      effect: mods(m('haste', 'flat', 0.008)),
    },
    {
      id: 'instinct-rich-price',
      name: 'Щедрая плата',
      icon: 'talent-blood-charge',
      maxRank: 5,
      col: 3,
      effect: tunes('blood-price', {
        field: 'bloodPriceResourceShare',
        kind: 'percent',
        value: 0.07,
      }),
    },
  ],
  [
    // 41-е очко, КЛЮЧЕВОЙ ЭТАЖ. Слева герой встаёт с привала с готовыми
    // умениями — привал перестаёт стоить откатов. Справа окно бесплатных
    // умений вдвое длиннее — привал реже нужен вовсе. Первое про ПОСЛЕ
    // привала, второе про то, чтобы до него не доводить.
    {
      id: 'instinct-deep-sleep',
      name: 'Крепкий сон',
      icon: 'talent-clear-mind',
      maxRank: 1,
      col: 2,
      exclusiveGroup: 'instinct-key-9',
      effect: { kind: 'flag', flag: 'rest-clears-cooldowns', cooldownShare: 0 },
    },
    {
      id: 'instinct-restless',
      name: 'Неугомонный',
      icon: 'talent-long-focus',
      maxRank: 1,
      col: 3,
      exclusiveGroup: 'instinct-key-9',
      // Окно вдвое длиннее: шестнадцать секунд, в которые умения не стоят
      // ничего. Не «отдыхать быстрее», а «дольше не нуждаться в отдыхе».
      effect: tunes('blood-roar', { field: 'windowDurationSec', kind: 'multiplier', value: 2 }),
    },
  ],
  [
    {
      id: 'instinct-wide-throat',
      name: 'Широкая глотка',
      icon: 'talent-deep-well',
      maxRank: 6,
      col: 1,
      effect: mods(m('maxMana', 'percent', 0.025)),
    },
    {
      // ТАЛАНТ, КОТОРЫЙ ДЕЛАЕТ РОТАЦИЮ ДРУГОЙ, А НЕ СИЛЬНЕЕ. Правил цену
      // Череполома, которой больше нет; теперь опускает ПОРОГ, с которого
      // автокаст решается его бить: полоска сбрасывается раньше и мельче —
      // чаще, но слабее. Ветка про саму ярость, и это вопрос ровно о ней.
      id: 'instinct-thrifty-splitter',
      name: 'Скупой замах',
      icon: 'talent-thrift-shatter',
      maxRank: 5,
      col: 2,
      effect: tunes('skull-splitter', {
        field: 'autocastResourceAbove',
        kind: 'points',
        value: -0.04,
      }),
    },
  ],
  [
    {
      // Второе место удалённого таланта на порог привала — тоже процентом.
      id: 'instinct-wolf-camp',
      name: 'Волчий привал',
      icon: 'talent-quick-camp',
      maxRank: 5,
      col: 1,
      effect: mods(m('restDuration', 'percent', -0.0234)),
    },
    {
      id: 'instinct-long-berserk',
      name: 'Долгое бешенство',
      icon: 'talent-long-stance',
      maxRank: 5,
      col: 2,
      effect: tunes('berserk', { field: 'stanceDurationSec', kind: 'percent', value: 0.08 }),
    },
  ],
  [
    {
      id: 'instinct-steady-hand',
      name: 'Скорая плата',
      icon: 'talent-firm-hand',
      maxRank: 5,
      col: 2,
      effect: tunes('blood-price', { field: 'cooldownSec', kind: 'percent', value: -0.06 }),
    },
    {
      id: 'instinct-cheap-roar',
      name: 'Дешёвый рёв',
      icon: 'talent-thrift-wall',
      maxRank: 5,
      col: 3,
      effect: tunes('blood-roar', { field: 'manaCost', kind: 'percent', value: -0.08 }),
      requires: { talentId: 'instinct-full-roar' },
    },
  ],
  [
    // 61-е очко, ВЕНЕЦ. Слева привал вдвое короче — герой быстрее
    // возвращается в бой. Справа окно открывается вдвое чаще — герой реже
    // упирается в пустую полоску. Время против ресурса.
    {
      id: 'instinct-wolf-sleep',
      name: 'Волчий сон',
      icon: 'talent-shorter-rest',
      maxRank: 1,
      col: 2,
      exclusiveGroup: 'instinct-key-13',
      // Привал вдвое короче. Ярость он не наливает — и не должен; венец
      // ветки автономности торгует ВРЕМЕНЕМ, а не ресурсом.
      effect: { kind: 'flag', flag: 'shorter-rest', durationMultiplier: 0.5 },
    },
    {
      id: 'instinct-endless-roar',
      name: 'Бесконечный рёв',
      icon: 'talent-endless-mind',
      maxRank: 1,
      col: 3,
      exclusiveGroup: 'instinct-key-13',
      effect: tunes('blood-roar', { field: 'cooldownSec', kind: 'multiplier', value: 0.5 }),
    },
  ],
])

// ---------------------------------------------------------------------------
// ПСАРЬ
// ---------------------------------------------------------------------------
//
// ТРИ ВЕТКИ СТРОЯТСЯ СТАДИЯМИ ночи «два тела»: первый этаж заведён вместе с
// классом, остальные двенадцать приходят своими стадиями — по коммиту на
// ветку. Первый этаж намеренно из базовых чисел: до появления пса и его
// команд править умения нечем.
//
//   ГОН     — урон: герой и пёс вместе.
//   ПРИВЯЗЬ — живучесть ЧЕРЕЗ ПСА: доля перенаправления, здоровье пса, его
//             возвращение, — а не щит и не броня героя.
//   ТРОПА   — автономность ЭНЕРГИИ: скорость восстановления, цена умений,
//             порог, поведение в оффлайне.
// ГОН: УРОН — ГЕРОЙ И ПЁС ВМЕСТЕ.
//
// Ветка Псаря про урон, и урон у него ДВУХТЕЛЫЙ: половина талантов правит
// команды псу (`hound-tune` на укус и замах, правки травли, спуска, серии),
// половина — руку героя. Ключевые этажи — пары: «стая» (герой сильнее, пока
// пёс стоит) против «спуск вдвое злее»; «мститель» (пал пёс — герой в ярости)
// против «четвёртый удар серии»; венец — «двойной укус спуска» против «второй
// замах» автоатаки.
const HOUNDMASTER_CHASE = branch('houndmaster-chase', [
  [
    {
      // Ускорение — flat по haste (правило про weaponSpeed см. у Стража).
      id: 'chase-quick-hands',
      name: 'Быстрые руки',
      icon: 'talent-quick-hands',
      maxRank: 6,
      col: 2,
      effect: mods(m('haste', 'flat', 0.00703)),
    },
    {
      id: 'chase-sure-cut',
      name: 'Верный надрез',
      icon: 'talent-sure-cut',
      maxRank: 5,
      col: 3,
      effect: tunes('undercut', { field: 'weaponDamagePercent', kind: 'percent', value: 0.04 }),
    },
  ],
  [
    {
      // ПЁС КУСАЕТ СИЛЬНЕЕ: число спутника правится флагом с payload'ом —
      // `hound-tune`, поле и операция как у правки умения.
      id: 'chase-sharp-fangs',
      name: 'Острые клыки',
      icon: 'talent-sharp-fangs',
      maxRank: 5,
      col: 2,
      effect: houndTune('hitShare', 'percent', 0.06),
    },
    {
      id: 'chase-deep-hamstring',
      name: 'Глубокий подрез',
      icon: 'talent-deep-cut',
      maxRank: 5,
      col: 3,
      effect: tunes('hamstring', { field: 'weaponDamagePercent', kind: 'percent', value: 0.05 }),
    },
  ],
  [
    {
      id: 'chase-keen-eye',
      name: 'Зоркий глаз',
      icon: 'talent-keen-eye',
      maxRank: 5,
      col: 1,
      effect: mods(m('critChance', 'flat', 0.01)),
    },
    {
      id: 'chase-long-chase',
      name: 'Долгий гон',
      icon: 'talent-long-focus',
      maxRank: 4,
      col: 2,
      effect: tunes('sic', { field: 'houndHasteDurationSec', kind: 'percent', value: 0.15 }),
    },
    {
      id: 'chase-wide-flurry',
      name: 'Широкая серия',
      icon: 'talent-savage-blows',
      maxRank: 5,
      col: 3,
      effect: tunes('flurry', { field: 'weaponDamagePercent', kind: 'percent', value: 0.05 }),
    },
  ],
  [
    {
      // ЗАМАХ ПСА КОРОЧЕ — процентом от секунд, а не плоско: плоская правка
      // увела бы замах в ноль тем же путём, что и у оружия героя.
      id: 'chase-fast-jaws',
      name: 'Быстрые челюсти',
      icon: 'talent-fast-jaws',
      maxRank: 5,
      col: 2,
      effect: houndTune('swingTime', 'percent', -0.05),
    },
    {
      id: 'chase-heavy-hand',
      name: 'Тяжёлая рука',
      icon: 'talent-heavy-shatter',
      maxRank: 5,
      col: 3,
      effect: mods(m('critMultiplier', 'flat', 0.04)),
    },
  ],
  [
    // КЛЮЧЕВОЙ ЭТАЖ 5: два поворота, берётся один.
    {
      // СТАЯ: пока пёс на ногах, ВЕСЬ урон героя выше. Состояние второго
      // тела становится множителем первого — вопрос класса в одном флаге.
      id: 'chase-pack-tactics',
      name: 'Стая',
      icon: 'talent-pack-tactics',
      maxRank: 1,
      col: 2,
      exclusiveGroup: 'chase-key-5',
      effect: { kind: 'flag', flag: 'pack-tactics', bonusShare: 0.12 },
    },
    {
      // ЗЛОЙ СПУСК: укус по команде в полтора раза злее. Всплеск против
      // ровного множителя стаи — разные роды, а не разные величины.
      id: 'chase-savage-unleash',
      name: 'Злой спуск',
      icon: 'talent-savage-unleash',
      maxRank: 1,
      col: 3,
      exclusiveGroup: 'chase-key-5',
      effect: tunes('unleash', { field: 'unleashBiteMult', kind: 'percent', value: 0.5 }),
    },
  ],
  [
    {
      id: 'chase-honed',
      name: 'Точёный нож',
      icon: 'talent-honed-edge',
      maxRank: 5,
      col: 2,
      effect: mods(m('attackPower', 'percent', 0.02)),
    },
    {
      id: 'chase-cheap-cut',
      name: 'Лёгкая подсечка',
      icon: 'talent-thrift-wound',
      maxRank: 5,
      col: 3,
      effect: tunes('undercut', { field: 'manaCost', kind: 'percent', value: -0.06 }),
    },
    {
      id: 'chase-sic-fury',
      name: 'Азарт травли',
      icon: 'talent-frenzy',
      maxRank: 4,
      col: 1,
      effect: tunes('sic', { field: 'houndHasteShare', kind: 'percent', value: 0.1 }),
    },
  ],
  [
    {
      // Стрелка: развивает «Быстрые руки» — тот же столбец, доработка буквально.
      id: 'chase-swift',
      name: 'Стремительность',
      icon: 'talent-headlong',
      maxRank: 5,
      col: 2,
      requires: { talentId: 'chase-quick-hands', minRank: 3 },
      effect: mods(m('haste', 'flat', 0.007)),
    },
    {
      id: 'chase-crush-grip',
      name: 'Дробящая хватка',
      icon: 'talent-firm-press',
      maxRank: 5,
      col: 3,
      effect: tunes('grip', { field: 'weaponDamagePercent', kind: 'percent', value: 0.06 }),
    },
  ],
  [
    {
      // Стрелка: развивает «Острые клыки».
      id: 'chase-relentless',
      name: 'Неотступный',
      icon: 'talent-relentless',
      maxRank: 5,
      col: 2,
      requires: { talentId: 'chase-sharp-fangs', minRank: 3 },
      effect: houndTune('hitShare', 'percent', 0.04),
    },
    {
      id: 'chase-lean-flurry',
      name: 'Экономная серия',
      icon: 'talent-thrift-shatter',
      maxRank: 5,
      col: 3,
      effect: tunes('flurry', { field: 'manaCost', kind: 'percent', value: -0.07 }),
    },
  ],
  [
    // КЛЮЧЕВОЙ ЭТАЖ 9.
    {
      // МСТИТЕЛЬ: пал пёс — герой шесть секунд бьёт на треть сильнее. Урон,
      // растущий из ПОТЕРИ второго тела: наказание за слабого пса становится
      // окном.
      id: 'chase-avenger',
      name: 'Мститель',
      icon: 'talent-avenger',
      maxRank: 1,
      col: 2,
      exclusiveGroup: 'chase-key-9',
      effect: { kind: 'flag', flag: 'hound-avenge', bonusShare: 0.3, durationSec: 6 },
    },
    {
      // ЧЕТВЁРТЫЙ УДАР: серия из четырёх, и пёс кусает четыре раза. Ровный
      // прирост против окна мстителя.
      id: 'chase-fourth-cut',
      name: 'Четвёртый удар',
      icon: 'talent-fourth-cut',
      maxRank: 1,
      col: 3,
      exclusiveGroup: 'chase-key-9',
      effect: tunes('flurry', { field: 'flurryHits', kind: 'percent', value: 0.34 }),
    },
  ],
  [
    {
      id: 'chase-power',
      name: 'Сила удара',
      icon: 'talent-strength',
      maxRank: 5,
      col: 2,
      effect: mods(m('attackPower', 'percent', 0.02)),
    },
    {
      id: 'chase-quick-unleash',
      name: 'Скорый спуск',
      icon: 'talent-quick-mercy',
      maxRank: 5,
      col: 3,
      effect: tunes('unleash', { field: 'cooldownSec', kind: 'percent', value: -0.08 }),
    },
    {
      id: 'chase-keener-eye',
      name: 'Зорче',
      icon: 'talent-wide-mercy',
      maxRank: 5,
      col: 1,
      effect: mods(m('critChance', 'flat', 0.01)),
    },
  ],
  [
    {
      // Стрелка: развивает «Неотступного» — третья ступень клыков.
      id: 'chase-fangs-of-old',
      name: 'Клыки матёрого',
      icon: 'talent-fangs-of-old',
      maxRank: 5,
      col: 2,
      requires: { talentId: 'chase-relentless', minRank: 3 },
      effect: houndTune('hitShare', 'percent', 0.04),
    },
    {
      id: 'chase-pack-cut',
      name: 'Стайный подрез',
      icon: 'talent-open-wound',
      maxRank: 4,
      col: 3,
      effect: tunes('hamstring', { field: 'packStrikeBonusShare', kind: 'percent', value: 0.15 }),
    },
  ],
  [
    {
      id: 'chase-haste-of-hunt',
      name: 'Охотничий шаг',
      icon: 'talent-swift-return',
      maxRank: 5,
      col: 2,
      effect: mods(m('haste', 'flat', 0.007)),
    },
    {
      id: 'chase-cheap-sic',
      name: 'Лёгкая травля',
      icon: 'talent-thrift-rupture',
      maxRank: 5,
      col: 3,
      effect: tunes('sic', { field: 'manaCost', kind: 'percent', value: -0.07 }),
    },
  ],
  [
    // ВЕНЕЦ: два капстоуна, берётся один.
    {
      // ДВОЙНОЙ УКУС: спуск вдвое злее. Козырь класса целиком в зубах пса.
      id: 'chase-twin-fang',
      name: 'Двойной укус',
      icon: 'talent-twin-fang',
      maxRank: 1,
      col: 2,
      exclusiveGroup: 'chase-key-13',
      effect: tunes('unleash', { field: 'unleashBiteMult', kind: 'multiplier', value: 2 }),
    },
    {
      // ВТОРОЙ ЗАМАХ: автоатака героя с шансом бьёт дважды — общий флаг,
      // урон руки против урона зубов.
      id: 'chase-double-strike',
      name: 'Второй замах',
      icon: 'talent-double-strike',
      maxRank: 1,
      col: 3,
      exclusiveGroup: 'chase-key-13',
      effect: { kind: 'flag', flag: 'double-strike', chance: 0.2 },
    },
  ],
])

// ПРИВЯЗЬ: ЖИВУЧЕСТЬ ЧЕРЕЗ ПСА.
//
// Ветка Псаря про выживание, и выживает он ВТОРЫМ ТЕЛОМ: запас пса, доля
// ударов, которые он принимает, его возврат и лечение — а не щит и не броня
// героя. Ключевые пары: «долгое зализывание» (отзыв лечит вдвое) против
// «второго дыхания» (быстрое воскрешение героя) — пёс живёт против герой не
// умирает; «железная привязь» (скрадывание вдвое) против «полного оклика»
// (пёс встаёт целым); венец — «неутомимый оклик» против «тени» (скрадывание
// вдвое дольше) — часто поднимать против долго прятаться.
const HOUNDMASTER_LEASH = branch('houndmaster-leash', [
  [
    {
      id: 'leash-thick-coat',
      name: 'Густая шерсть',
      icon: 'talent-thick-coat',
      maxRank: 5,
      col: 2,
      effect: mods(m('maxHp', 'percent', 0.02)),
    },
    {
      id: 'leash-steady-breath',
      name: 'Ровное дыхание',
      icon: 'talent-even-breath',
      maxRank: 5,
      col: 3,
      effect: mods(m('hpRegen', 'percent', 0.05)),
    },
  ],
  [
    {
      // ЗАПАС ПСА — доля запаса героя, и талант растит именно доли: пёс
      // остаётся собой на любом уровне.
      id: 'leash-tough-hide',
      name: 'Крепкая шкура',
      icon: 'talent-thick-hide',
      maxRank: 5,
      col: 2,
      effect: houndTune('maxHpShare', 'percent', 0.08),
    },
    {
      id: 'leash-quick-bandage',
      name: 'Быстрая перевязка',
      icon: 'talent-quick-mend',
      maxRank: 5,
      col: 3,
      effect: tunes('bandage', { field: 'cooldownSec', kind: 'percent', value: -0.08 }),
    },
  ],
  [
    {
      id: 'leash-firm-grip',
      name: 'Крепкая хватка',
      icon: 'talent-firm-press',
      maxRank: 5,
      col: 1,
      effect: tunes('grip', { field: 'gripSlowShare', kind: 'percent', value: 0.08 }),
    },
    {
      // ДОЛЯ ПЕРЕНАПРАВЛЕНИЯ — В ПУНКТАХ: она доля, и «на 10 % больше» от 0.3
      // игрок прочитал бы как 40 %, а не 33.
      id: 'leash-fur-shield',
      name: 'Живой щит',
      icon: 'talent-fur-shield',
      maxRank: 5,
      col: 2,
      effect: houndTune('redirectShare', 'points', 0.03),
    },
    {
      id: 'leash-deep-bandage',
      name: 'Тугая перевязка',
      icon: 'talent-deep-mend',
      maxRank: 5,
      col: 3,
      effect: tunes('bandage', { field: 'houndHealMaxHpShare', kind: 'percent', value: 0.08 }),
    },
  ],
  [
    {
      id: 'leash-fast-return',
      name: 'Скорый возврат',
      icon: 'talent-fast-return',
      maxRank: 5,
      col: 2,
      effect: houndTune('returnSec', 'percent', -0.08),
    },
    {
      id: 'leash-cheap-recall',
      name: 'Лёгкий отзыв',
      icon: 'talent-thrift-mercy',
      maxRank: 5,
      col: 3,
      effect: tunes('recall', { field: 'manaCost', kind: 'percent', value: -0.07 }),
    },
  ],
  [
    // КЛЮЧЕВОЙ ЭТАЖ 5.
    {
      // ДОЛГОЕ ЗАЛИЗЫВАНИЕ: отзыв лечит вдвое. Пёс живёт — герой платит уроном.
      id: 'leash-long-lick',
      name: 'Зализать раны',
      icon: 'talent-quiet-mend',
      maxRank: 1,
      col: 2,
      exclusiveGroup: 'leash-key-5',
      effect: tunes('recall', { field: 'recallHealShare', kind: 'percent', value: 1.0 }),
    },
    {
      // ВТОРОЕ ДЫХАНИЕ: герой воскресает вдвое быстрее — общий флаг. Другой род:
      // не пёс не падает, а смерть героя стоит дешевле.
      id: 'leash-second-wind',
      name: 'Второе дыхание',
      icon: 'talent-second-wind',
      maxRank: 1,
      col: 3,
      exclusiveGroup: 'leash-key-5',
      effect: { kind: 'flag', flag: 'faster-revive', reviveMultiplier: 0.5 },
    },
  ],
  [
    {
      id: 'leash-hound-mending',
      name: 'Зализывание на ходу',
      icon: 'talent-hound-mending',
      maxRank: 5,
      col: 1,
      effect: houndTune('regenInCombat', 'points', 0.01),
    },
    {
      id: 'leash-vitality',
      name: 'Крепость тела',
      icon: 'talent-vitality',
      maxRank: 5,
      col: 2,
      effect: mods(m('maxHp', 'percent', 0.02)),
    },
    {
      id: 'leash-long-skulk',
      name: 'Долгое скрадывание',
      icon: 'talent-long-stance',
      maxRank: 5,
      col: 3,
      effect: tunes('skulk', { field: 'skulkDurationSec', kind: 'percent', value: 0.12 }),
    },
  ],
  [
    {
      id: 'leash-armor',
      name: 'Кожаный доспех',
      icon: 'talent-shield-wall',
      maxRank: 5,
      col: 2,
      effect: mods(m('armor', 'percent', 0.03)),
    },
    {
      id: 'leash-cheap-bandage',
      name: 'Лёгкая перевязка',
      icon: 'talent-thrift-wall',
      maxRank: 5,
      col: 3,
      effect: tunes('bandage', { field: 'manaCost', kind: 'percent', value: -0.07 }),
    },
  ],
  [
    {
      // Стрелка: развивает «Крепкую шкуру».
      id: 'leash-thicker-hide',
      name: 'Толстая шкура',
      icon: 'talent-hard-to-kill',
      maxRank: 5,
      col: 2,
      requires: { talentId: 'leash-tough-hide', minRank: 3 },
      effect: houndTune('maxHpShare', 'percent', 0.06),
    },
    {
      id: 'leash-quick-rally',
      name: 'Скорый оклик',
      icon: 'talent-early-call',
      maxRank: 5,
      col: 3,
      effect: tunes('rally', { field: 'cooldownSec', kind: 'percent', value: -0.1 }),
    },
  ],
  [
    // КЛЮЧЕВОЙ ЭТАЖ 9.
    {
      // ЖЕЛЕЗНАЯ ПРИВЯЗЬ: скрадывание перекладывает на пса вдвое больше.
      id: 'leash-iron-leash',
      name: 'Железная привязь',
      icon: 'talent-immovable',
      maxRank: 1,
      col: 2,
      exclusiveGroup: 'leash-key-9',
      effect: tunes('skulk', { field: 'skulkRedirectBonus', kind: 'percent', value: 1.0 }),
    },
    {
      // ПОЛНЫЙ ОКЛИК: павший пёс встаёт целым. Не «пёс держит больше», а
      // «падение стоит меньше» — другой род.
      id: 'leash-full-rally',
      name: 'Полный оклик',
      icon: 'talent-full-rally',
      maxRank: 1,
      col: 3,
      exclusiveGroup: 'leash-key-9',
      effect: tunes('rally', { field: 'rallyHpShare', kind: 'percent', value: 1.0 }),
    },
  ],
  [
    {
      id: 'leash-even-breath',
      name: 'Глубокое дыхание',
      icon: 'talent-steady-breath',
      maxRank: 5,
      col: 2,
      effect: mods(m('hpRegen', 'percent', 0.05)),
    },
    {
      // Стрелка: развивает «Долгое скрадывание» — тот же столбец.
      id: 'leash-deep-skulk',
      name: 'Глубокое скрадывание',
      icon: 'talent-spiked-guard',
      maxRank: 5,
      col: 3,
      requires: { talentId: 'leash-long-skulk', minRank: 2 },
      effect: tunes('skulk', { field: 'skulkRedirectBonus', kind: 'percent', value: 0.1 }),
    },
  ],
  [
    {
      // Стрелка: развивает «Скорый возврат».
      id: 'leash-swift-return',
      name: 'Стремительный возврат',
      icon: 'talent-swift-return',
      maxRank: 5,
      col: 2,
      requires: { talentId: 'leash-fast-return', minRank: 3 },
      effect: houndTune('returnSec', 'percent', -0.06),
    },
    {
      id: 'leash-long-recall',
      name: 'Долгий отзыв',
      icon: 'talent-long-wall',
      maxRank: 4,
      col: 3,
      effect: tunes('recall', { field: 'recallDurationSec', kind: 'percent', value: 0.15 }),
    },
  ],
  [
    {
      id: 'leash-hardened',
      name: 'Закалка',
      icon: 'talent-bulwark-training',
      maxRank: 5,
      col: 2,
      effect: mods(m('maxHp', 'percent', 0.02)),
    },
    {
      id: 'leash-long-grip',
      name: 'Долгая хватка',
      icon: 'talent-braced',
      maxRank: 5,
      col: 3,
      effect: tunes('grip', { field: 'gripDurationSec', kind: 'percent', value: 0.12 }),
    },
  ],
  [
    // ВЕНЕЦ.
    {
      // НЕУТОМИМЫЙ ОКЛИК: откат оклика в два с половиной раза короче —
      // павший пёс почти не лежит.
      id: 'leash-tireless-rally',
      name: 'Неутомимый оклик',
      icon: 'ability-rally',
      maxRank: 1,
      col: 2,
      exclusiveGroup: 'leash-key-13',
      effect: tunes('rally', { field: 'cooldownSec', kind: 'multiplier', value: 0.4 }),
    },
    {
      // ТЕНЬ: скрадывание вдвое дольше — герой почти не выходит из-за пса.
      id: 'leash-shadow-hound',
      name: 'Тень пса',
      icon: 'ability-skulk',
      maxRank: 1,
      col: 3,
      exclusiveGroup: 'leash-key-13',
      effect: tunes('skulk', { field: 'skulkDurationSec', kind: 'multiplier', value: 2 }),
    },
  ],
])

// ТРОПА: АВТОНОМНОСТЬ ЭНЕРГИИ.
//
// Ветка Псаря про то, сколько игра идёт сама: скорость возвращения энергии,
// цена команд, длина привала, восстановление вне боя — героя и пса. Ключевые
// пары — про РИТМ, а не про числа: «привал снимает откаты» против «убийство
// срезает откаты» (пауза против непрерывности); «привал вдвое короче» против
// «второй заряд серии» (меньше ждать против больше выстрелить); венец —
// «неутомимая серия» (вдвое дешевле) против «дыхания охоты» (травля дешевле и
// дольше) — рука против пса.
const HOUNDMASTER_TRAIL = branch('houndmaster-trail', [
  [
    {
      // Энергия восстанавливается статом manaRegen: процент от постоянной
      // базы — единственная законная правка её скорости.
      id: 'trail-restless-legs',
      name: 'Неутомимые ноги',
      icon: 'talent-restless-legs',
      maxRank: 5,
      col: 2,
      effect: mods(m('manaRegen', 'percent', 0.04)),
    },
    {
      id: 'trail-short-camp',
      name: 'Короткая стоянка',
      icon: 'talent-short-camp',
      maxRank: 5,
      col: 3,
      effect: mods(m('restDuration', 'percent', -0.04)),
    },
  ],
  [
    {
      id: 'trail-light-step',
      name: 'Лёгкий шаг',
      icon: 'talent-thrift-wound',
      maxRank: 5,
      col: 2,
      effect: tunes('undercut', { field: 'manaCost', kind: 'percent', value: -0.06 }),
    },
    {
      id: 'trail-second-breath',
      name: 'Второе дыхание тропы',
      icon: 'talent-clear-mind',
      maxRank: 5,
      col: 3,
      effect: mods(m('hpRegenOutOfCombat', 'percent', 0.06)),
    },
  ],
  [
    {
      id: 'trail-quick-camp',
      name: 'Быстрый лагерь',
      icon: 'talent-quick-camp',
      maxRank: 5,
      col: 1,
      effect: mods(m('restDuration', 'percent', -0.04)),
    },
    {
      // Стрелка: развивает «Неутомимые ноги».
      id: 'trail-flow',
      name: 'Ровный ток',
      icon: 'talent-deep-well',
      maxRank: 5,
      col: 2,
      requires: { talentId: 'trail-restless-legs', minRank: 3 },
      effect: mods(m('manaRegen', 'percent', 0.04)),
    },
    {
      id: 'trail-cheap-sic',
      name: 'Лёгкая команда',
      icon: 'talent-thrift-rupture',
      maxRank: 5,
      col: 3,
      effect: tunes('sic', { field: 'manaCost', kind: 'percent', value: -0.07 }),
    },
  ],
  [
    {
      // ПЁС ОТДЫХАЕТ ВМЕСТЕ С ГЕРОЕМ: восстановление вне боя — в пунктах доли
      // запаса в секунду.
      id: 'trail-hound-rests',
      name: 'Пёс у костра',
      icon: 'talent-hound-rests',
      maxRank: 5,
      col: 2,
      effect: houndTune('regenOutOfCombat', 'points', 0.02),
    },
    {
      id: 'trail-cheap-grip',
      name: 'Лёгкая хватка',
      icon: 'talent-thrift-stance',
      maxRank: 5,
      col: 3,
      effect: tunes('grip', { field: 'manaCost', kind: 'percent', value: -0.07 }),
    },
  ],
  [
    // КЛЮЧЕВОЙ ЭТАЖ 5: пауза против непрерывности.
    {
      id: 'trail-camp-refresh',
      name: 'Отдых снимает усталость',
      icon: 'talent-quick-focus',
      maxRank: 1,
      col: 2,
      exclusiveGroup: 'trail-key-5',
      effect: { kind: 'flag', flag: 'rest-clears-cooldowns', cooldownShare: 0.5 },
    },
    {
      id: 'trail-hunt-rhythm',
      name: 'Ритм охоты',
      icon: 'talent-kill-refund',
      maxRank: 1,
      col: 3,
      exclusiveGroup: 'trail-key-5',
      effect: { kind: 'flag', flag: 'kill-refunds-cooldowns', cooldownShare: 0.7 },
    },
  ],
  [
    {
      id: 'trail-quick-undercut',
      name: 'Частая подсечка',
      icon: 'talent-firm-hand',
      maxRank: 5,
      col: 1,
      effect: tunes('undercut', { field: 'cooldownSec', kind: 'percent', value: -0.05 }),
    },
    {
      id: 'trail-deep-breath',
      name: 'Глубокий вдох',
      icon: 'talent-long-mind',
      maxRank: 5,
      col: 2,
      effect: mods(m('manaRegen', 'percent', 0.04)),
    },
    {
      id: 'trail-cheap-flurry',
      name: 'Лёгкая серия',
      icon: 'talent-thrift-shatter',
      maxRank: 5,
      col: 3,
      effect: tunes('flurry', { field: 'manaCost', kind: 'percent', value: -0.06 }),
    },
  ],
  [
    {
      id: 'trail-lean-bandage',
      name: 'Бережная перевязка',
      icon: 'talent-thrift-wall',
      maxRank: 5,
      col: 2,
      effect: tunes('bandage', { field: 'manaCost', kind: 'percent', value: -0.08 }),
    },
    {
      id: 'trail-cheap-unleash',
      name: 'Лёгкий спуск',
      icon: 'talent-thrift-mercy',
      maxRank: 5,
      col: 3,
      effect: tunes('unleash', { field: 'manaCost', kind: 'percent', value: -0.06 }),
    },
  ],
  [
    {
      // Стрелка: развивает «Короткую стоянку».
      id: 'trail-brief-camp',
      name: 'Стоянка на ходу',
      icon: 'talent-shorter-rest',
      maxRank: 5,
      col: 3,
      requires: { talentId: 'trail-short-camp', minRank: 3 },
      effect: mods(m('restDuration', 'percent', -0.04)),
    },
    {
      id: 'trail-cheap-hamstring',
      name: 'Лёгкий подрез',
      icon: 'talent-spare-edge',
      maxRank: 5,
      col: 2,
      effect: tunes('hamstring', { field: 'manaCost', kind: 'percent', value: -0.06 }),
    },
  ],
  [
    // КЛЮЧЕВОЙ ЭТАЖ 9: меньше ждать против больше выстрелить.
    {
      id: 'trail-short-rest',
      name: 'Полпривала',
      icon: 'stat-hpRegenOutOfCombat',
      maxRank: 1,
      col: 2,
      exclusiveGroup: 'trail-key-9',
      effect: { kind: 'flag', flag: 'shorter-rest', durationMultiplier: 0.5 },
    },
    {
      id: 'trail-flurry-charge',
      name: 'Вторая серия',
      icon: 'talent-second-charge',
      maxRank: 1,
      col: 3,
      exclusiveGroup: 'trail-key-9',
      effect: { kind: 'flag', flag: 'ability-extra-charge', abilityId: 'flurry', extraCharges: 1 },
    },
  ],
  [
    {
      id: 'trail-out-regen',
      name: 'Отдых у тропы',
      icon: 'talent-cold-blood',
      maxRank: 5,
      col: 1,
      effect: mods(m('hpRegenOutOfCombat', 'percent', 0.06)),
    },
    {
      id: 'trail-endless-legs',
      name: 'Бесконечные ноги',
      icon: 'talent-endless-mind',
      maxRank: 5,
      col: 2,
      effect: mods(m('manaRegen', 'percent', 0.04)),
    },
    {
      id: 'trail-cheap-skulk',
      name: 'Лёгкое скрадывание',
      icon: 'talent-thrift-stance',
      maxRank: 5,
      col: 3,
      effect: tunes('skulk', { field: 'manaCost', kind: 'percent', value: -0.06 }),
    },
  ],
  [
    {
      // Стрелка: развивает «Пса у костра».
      id: 'trail-hound-sleeps',
      name: 'Пёс спит у ног',
      icon: 'talent-hound-sleeps',
      maxRank: 5,
      col: 2,
      requires: { talentId: 'trail-hound-rests', minRank: 3 },
      effect: houndTune('regenOutOfCombat', 'points', 0.02),
    },
    {
      id: 'trail-cheap-rally',
      name: 'Лёгкий оклик',
      icon: 'talent-early-call',
      maxRank: 4,
      col: 3,
      effect: tunes('rally', { field: 'manaCost', kind: 'percent', value: -0.1 }),
    },
  ],
  [
    {
      id: 'trail-short-halt',
      name: 'Короткий привал',
      icon: 'talent-long-focus',
      maxRank: 5,
      col: 2,
      effect: mods(m('restDuration', 'percent', -0.04)),
    },
    {
      // БЫЛ «ЛЁГКИЙ ЗОВ» — СКИДКА НА «СВОРУ», И ОН УМЕР ВМЕСТЕ С ЕЁ ЦЕНОЙ.
      // «Свора» стала пассивной, её цена — ноль, а процент от нуля есть ноль:
      // талант проходил бы все ссылочные проверки и не делал РОВНО НИЧЕГО.
      // Ловит это `checkTalentTunes` (TUNE_NEEDS.manaCost требует цены), и
      // поймал он это сразу — то есть правило работает ровно так, как
      // задумано: тихая поломка дерева стала громкой.
      //
      // НА ЕГО МЕСТЕ — СКИДКА НА ПОДСЕЧКУ, единственное умение класса, цены
      // которого «Тропа» ещё не касалась (откат ей режет «Частая подсечка»
      // этажом выше). Ставка ВТРОЕ МЕНЬШЕ соседей по ветке (-0.03 против
      // -0.06…-0.10) нарочно: те режут цену умений с откатом в 14–45 секунд,
      // а подсечка жмётся раз в две секунды — та же доля стоила бы на порядок
      // дороже в энергии за минуту.
      id: 'trail-cheap-undercut',
      name: 'Лёгкая подсечка',
      icon: 'talent-unbroken-focus',
      maxRank: 5,
      col: 3,
      effect: tunes('undercut', { field: 'manaCost', kind: 'percent', value: -0.03 }),
    },
  ],
  [
    // ВЕНЕЦ: рука против пса.
    {
      id: 'trail-tireless-flurry',
      name: 'Неутомимая серия',
      icon: 'ability-flurry',
      maxRank: 1,
      col: 2,
      exclusiveGroup: 'trail-key-13',
      effect: tunes('flurry', { field: 'manaCost', kind: 'multiplier', value: 0.5 }),
    },
    {
      id: 'trail-hunting-breath',
      name: 'Дыхание охоты',
      icon: 'ability-sic',
      maxRank: 1,
      col: 3,
      exclusiveGroup: 'trail-key-13',
      effect: tunes(
        'sic',
        { field: 'manaCost', kind: 'multiplier', value: 0.5 },
        { field: 'houndHasteDurationSec', kind: 'multiplier', value: 1.5 },
      ),
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
  ...HOUNDMASTER_CHASE,
  ...HOUNDMASTER_LEASH,
  ...HOUNDMASTER_TRAIL,
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
 * КЛЮЧЕВЫЕ ЭТАЖИ — ТЕ, ГДЕ СТОИТ ВЫБОР, И ЭТО ВЫВОД ИЗ ДАННЫХ, А НЕ СПИСОК.
 *
 * Здесь лежал общий `CONCEPT_ROWS = [5, 9, 13]`: три номера, одинаковые на
 * все девять веток. Список решал сразу две вещи — где стоит выбор и что на
 * этаже с выбором можно ставить, — и обе неверно: выбор описывается
 * `exclusiveGroup` у самих талантов, а этаж с выбором может нести рядом и
 * обычные узлы (в семиэтажной ветке иначе и не выйдет). Номер этажа больше
 * не решает ничего: ключевой этаж — тот, на котором есть взаимоисключающая
 * группа, и узнаётся он у талантов.
 */
export function keyRowsOf(branchId: BranchId): number[] {
  const rows = new Set<number>()
  for (const talent of talentsInBranch(branchId)) {
    if (talent.exclusiveGroup) rows.add(talent.row)
  }
  return [...rows].sort((a, b) => a - b)
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
        // КЛЮЧЕВЫЕ И ИХ ОПОРЫ — В ГОЛОВЕ ПУТИ. Путь — список приоритетов, и
        // ключевые этажи это то, ради чего сборка существует: стоя в хвосте,
        // они не покупались вовсе — очки кончались раньше.
        'wrath-deep-cut',
        'wrath-bleeding-edge',
        'wrath-open-wound',
        'wrath-honed-edge',
        'wrath-keen-eye',
        'wrath-savage-blows',
        'wrath-frenzy',
        'wrath-firm-hand',
        'wrath-spare-edge',
        // ИСКЛЮЧЕНИЕ — «РВАНЫЙ ВЫПАД», И ОНО ЗАПИСАНО ДВАЖДЫ, ПОТОМУ ЧТО
        // ВОЗВРАЩАЛОСЬ ДВАЖДЫ. Ключ стоит не в голове пути, а за процентами
        // верхних этажей, и берётся около СОРОКОВОГО очка ветки. Причина —
        // контракт цены схватки с боссом: числа боссов калибровались под
        // героя, у которого «Рваного выпада» на тридцати очках ещё не было.
        // Купи его раньше — и первый босс третьего тира стоит 54–58 % запаса
        // при поле коридора 60: герой первого пути оказывается сильнее того,
        // под кого босса считали.
        //
        // ПЕРЕЕЗД НА СЕМЬ ЭТАЖЕЙ ВЕРНУЛ ЭТО САМО СОБОЙ, и вот как. Порядок
        // пути — это ПРИОРИТЕТ, а покупается на каждом шаге первое ДОСТУПНОЕ
        // по списку. «Твёрдая рука» и «Скупая кромка» стояли перед ключом и
        // жили на первом этаже, то есть были доступны всегда и оттягивали
        // очки на себя; в новой форме они переехали на четвёртый этаж (порог
        // 30) и на двадцать шестом очке недоступны — очередь доходила до
        // ключа. Замер: боссы «Кипящих штолен» подешевели до 58 %.
        // Поэтому перед ключом теперь стоят таланты ВЕРХНИХ этажей, которые
        // на этом отрезке доступны заведомо. Это правка ПРИБОРА под прежнюю
        // калибровку, а не игры: ни урон босса, ни талант не тронуты.
        'wrath-momentum',
        'wrath-relentless',
        'wrath-deep-brand',
        'wrath-rupture',
        'wrath-firm-grip',
        'wrath-precision',
        'wrath-open-vein',
        'wrath-light-blade',
        'wrath-heavy-swing',
        'wrath-true-aim',
        'wrath-cold-blood',
        'wrath-double-flourish',
        'wrath-swift-shatter',
        'wrath-heavy-shatter',
        'wrath-wide-mercy',
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
        // КЛЮЧЕВЫЕ И ИХ ОПОРЫ — В ГОЛОВЕ ПУТИ. Путь — список приоритетов, и
        // ключевые этажи это то, ради чего сборка существует: стоя в хвосте,
        // они не покупались вовсе — очки кончались раньше.
        'wrath-headlong',
        'wrath-double-flourish',
        'wrath-second-swing',
        'wrath-honed-edge',
        'wrath-savage-blows',
        'wrath-swift-shatter',
        'wrath-precision',
        'wrath-keen-eye',
        'wrath-wide-mercy',
        'wrath-heavy-swing',
        'wrath-heavy-shatter',
        'wrath-true-aim',
        'wrath-cold-blood',
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
        // КЛЮЧЕВЫЕ И ИХ ОПОРЫ — В ГОЛОВЕ ПУТИ. Путь — список приоритетов, и
        // ключевые этажи это то, ради чего сборка существует: стоя в хвосте,
        // они не покупались вовсе — очки кончались раньше.
        'bulwark-shield-grip',
        'bulwark-long-wall',
        'bulwark-often-wall',
        'bulwark-mirror-shield',
        'bulwark-thick-hide',
        'bulwark-shield-wall',
        'bulwark-training',
        'bulwark-iron-skin',
        'bulwark-press',
        'bulwark-sturdy-frame',
        'bulwark-battle-breath',
        'bulwark-unyielding',
        'bulwark-braced',
        'bulwark-wide-wall',
        'bulwark-stone-skin',
        'bulwark-heavy-guard',
        'bulwark-firm-stance',
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
        // КЛЮЧЕВЫЕ И ИХ ОПОРЫ — В ГОЛОВЕ ПУТИ. Путь — список приоритетов, и
        // ключевые этажи это то, ради чего сборка существует: стоя в хвосте,
        // они не покупались вовсе — очки кончались раньше.
        'bulwark-braced',
        'bulwark-swift-return',
        'bulwark-hard-stance',
        'bulwark-immovable',
        'bulwark-thick-hide',
        'bulwark-iron-skin',
        'bulwark-quick-mend',
        'bulwark-press',
        'bulwark-deep-mend',
        'bulwark-long-stance',
        'bulwark-early-call',
        'bulwark-unyielding',
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
        'bulwark-mirror-shield',
      ],
    },
  ],
  'warden-vigil': [
    {
      // ЭКОНОМИЯ. Ставка на цену ротации: каждое умение дешевле, запас глубже,
      // пауза короче. Четвёрка по умолчанию — первый путь ветки это прибор.
      id: 'vigil-thrifty',
      name: 'Экономия',
      abilities: ['quick-strike', 'rending-wound', 'mend-wounds', 'shattering-blow'],
      order: [
        // КЛЮЧЕВЫЕ И ИХ ОПОРЫ — В ГОЛОВЕ ПУТИ. Путь — список приоритетов, и
        // ключевые этажи это то, ради чего сборка существует: стоя в хвосте,
        // они не покупались вовсе — очки кончались раньше.
        'vigil-trophy-spirit',
        'vigil-unbroken-focus',
        'vigil-campfire-on-the-move',
        'vigil-steady-breath',
        'vigil-clear-mind',
        'vigil-deep-well',
        'vigil-quick-camp',
        'vigil-thrift-wound',
        'vigil-thrift-shatter',
        'vigil-learning',
        'vigil-swift-camp',
        'vigil-slow-bleeding',
        'vigil-thrift',
        'vigil-composure',
        'vigil-light-sleep',
        'vigil-thrift-rupture',
        'vigil-thrift-mercy',
        'vigil-thrift-stance',
        'vigil-quick-mercy',
        'vigil-full-rupture',
        'vigil-quick-focus',
        'vigil-long-mind',
        'vigil-endless-mind',
        'vigil-long-brand',
        'vigil-early-brand',
        'vigil-often-brand',
        'vigil-lasting-brand',
      ],
    },
    {
      // КЛЕЙМО. Другой ответ: не экономить на каждом умении, а поставить метку
      // и бить сквозь неё. Венец другой — «Неиссякаемость»: всплеск приходит
      // вдвое чаще, и метка успевает окупиться.
      id: 'vigil-brandbearer',
      name: 'Клеймо',
      abilities: ['quick-strike', 'brand', 'mend-wounds', 'focus'],
      order: [
        // КЛЮЧЕВЫЕ И ИХ ОПОРЫ — В ГОЛОВЕ ПУТИ. Путь — список приоритетов, и
        // ключевые этажи это то, ради чего сборка существует: стоя в хвосте,
        // они не покупались вовсе — очки кончались раньше.
        'vigil-long-mind',
        'vigil-long-brand',
        'vigil-lasting-brand',
        'vigil-quick-focus',
        'vigil-endless-mind',
        'vigil-early-brand',
        'vigil-often-brand',
        'vigil-steady-breath',
        'vigil-deep-well',
        'vigil-clear-mind',
        'vigil-learning',
        'vigil-thrift',
        'vigil-full-rupture',
        'vigil-quick-mercy',
        'vigil-thrift-mercy',
        'vigil-thrift-stance',
        'vigil-thrift-rupture',
        'vigil-thrift-wound',
        'vigil-thrift-shatter',
        'vigil-quick-camp',
        'vigil-swift-camp',
        'vigil-light-sleep',
        'vigil-composure',
        'vigil-slow-bleeding',
        'vigil-trophy-spirit',
        'vigil-unbroken-focus',
        'vigil-campfire-on-the-move',
      ],
    },
  ],
  // ИЗУВЕР. По два пути на ветку, как у Стража: первый — ПРИБОР (по нему
  // считается «чистая ветка»), второй — вторая сторона ключевых этажей.
  // Без явных путей ветку заливала бы жадность сверху вниз, а ёмкость здесь
  // больше, чем очков у героя: до венца заливка не доходит вовсе.
  'reaver-carnage': [
    {
      // КРОВЬ. Дешёвый удар учится кровить, автоатака иногда бьёт дважды,
      // добивание получает второй заряд. Урон идёт РОВНО.
      id: 'carnage-blood',
      name: 'Кровь',
      abilities: ['gut-rip', 'blood-letting', 'blood-frenzy', 'blood-thirst'],
      order: [
        'carnage-bleeding-wound',
        'carnage-blade-storm',
        'carnage-carnage',
        'carnage-bloodlust',
        'carnage-quick-cleaver',
        'carnage-predator-eye',
        'carnage-deep-frenzy',
        'carnage-ferocity',
        'carnage-heavy-splitter',
        'carnage-thirsty-blade',
        'carnage-offhand',
        'carnage-swift-cleaver',
        'carnage-wild-strength',
        'carnage-hungry-tear',
        'carnage-brutal-reckoning',
        'carnage-beast-aim',
        'carnage-wide-reckoning',
        'carnage-drive',
        'carnage-long-roar',
        'carnage-second-hand',
        'carnage-cheap-splitter',
        'carnage-deeper-frenzy',
        'carnage-onslaught',
        'carnage-swift-splitter',
        'carnage-blood-charge',
        'carnage-fierce-berserk',
      ],
    },
    {
      // ЯРОСТЬ. Кровотечение и разрыв перестают ждать замаха, бешенство
      // держится почти постоянно. Урон идёт ВСПЛЕСКАМИ, и четвёрка другая.
      id: 'carnage-fury',
      name: 'Ярость',
      abilities: ['gut-rip', 'blood-letting', 'reckoning', 'berserk'],
      order: [
        'carnage-open-veins',
        'carnage-frenzied-tear',
        'carnage-red-haze',
        'carnage-bloodlust',
        'carnage-quick-cleaver',
        'carnage-predator-eye',
        'carnage-deep-frenzy',
        'carnage-ferocity',
        'carnage-heavy-splitter',
        'carnage-thirsty-blade',
        'carnage-offhand',
        'carnage-swift-cleaver',
        'carnage-wild-strength',
        'carnage-hungry-tear',
        'carnage-brutal-reckoning',
        'carnage-beast-aim',
        'carnage-wide-reckoning',
        'carnage-drive',
        'carnage-long-roar',
        'carnage-second-hand',
        'carnage-cheap-splitter',
        'carnage-deeper-frenzy',
        'carnage-onslaught',
        'carnage-swift-splitter',
        'carnage-blood-charge',
        'carnage-fierce-berserk',
      ],
    },
  ],
  'reaver-sinew': [
    {
      // УПОР. Смягчение за непрерывность держится почти весь бой, смерть
      // дешевеет. Сборка без щита: герой просто не уходит.
      id: 'sinew-dug',
      name: 'Упор',
      abilities: ['gut-rip', 'blood-letting', 'blood-thirst', 'dug-in'],
      order: [
        'sinew-iron-dig',
        'sinew-not-finished',
        'sinew-unbroken',
        'sinew-beast-hide',
        'sinew-braced-guard',
        'sinew-forearm-guard',
        'sinew-thirsty-bite',
        'sinew-tanned-hide',
        'sinew-long-dig',
        'sinew-cheap-thirst',
        'sinew-hardened',
        'sinew-firm-dig',
        'sinew-knitting',
        'sinew-deep-price',
        'sinew-frame',
        'sinew-swift-dig',
        'sinew-carapace',
        'sinew-guarded-roar',
        'sinew-counterblow',
        'sinew-tough-price',
        'sinew-brace',
        'sinew-lasting-dig',
        'sinew-spiked-guard',
        'sinew-red-thirst',
      ],
    },
    {
      // ЩИТ. Блок платит ЯРОСТЬЮ и отвечает шипами, бешенство перестаёт быть
      // опасным. Единственная сборка Изувера, которой нужен щит в руке.
      id: 'sinew-shield',
      name: 'Щит',
      abilities: ['gut-rip', 'blood-thirst', 'dug-in', 'berserk'],
      order: [
        'sinew-blood-for-blood',
        'sinew-stone-skin',
        'sinew-thorned-answer',
        'sinew-beast-hide',
        'sinew-braced-guard',
        'sinew-forearm-guard',
        'sinew-thirsty-bite',
        'sinew-tanned-hide',
        'sinew-long-dig',
        'sinew-cheap-thirst',
        'sinew-hardened',
        'sinew-firm-dig',
        'sinew-knitting',
        'sinew-deep-price',
        'sinew-frame',
        'sinew-swift-dig',
        'sinew-carapace',
        'sinew-guarded-roar',
        'sinew-counterblow',
        'sinew-tough-price',
        'sinew-brace',
        'sinew-lasting-dig',
        'sinew-spiked-guard',
        'sinew-red-thirst',
      ],
    },
  ],
  'reaver-instinct': [
    {
      // РЁВ. Убийство сбрасывает откаты, привал возвращает готовые умения и
      // сам вдвое короче. Ветка про то, чтобы меньше стоять без дела.
      id: 'instinct-roar',
      name: 'Рёв',
      abilities: ['gut-rip', 'blood-letting', 'blood-frenzy', 'blood-thirst'],
      order: [
        'instinct-taste-of-victory',
        'instinct-deep-sleep',
        'instinct-wolf-sleep',
        'instinct-beast-breath',
        'instinct-quick-letting',
        'instinct-rage-capacity',
        'instinct-rich-letting',
        'instinct-short-rest',
        'instinct-light-camp',
        'instinct-hardy-stock',
        'instinct-swift-roar',
        'instinct-hunger',
        'instinct-cheap-tear',
        'instinct-second-breath',
        'instinct-full-roar',
        'instinct-never-cooling',
        'instinct-rich-price',
        'instinct-wide-throat',
        'instinct-thrifty-splitter',
        'instinct-wolf-camp',
        'instinct-long-berserk',
        'instinct-steady-hand',
        'instinct-cheap-roar',
      ],
    },
    {
      // ОКНО. Разгон вдвое чаще, окно вдвое длиннее и вдвое чаще: ярость
      // перестаёт быть узким местом, и четвёрка собрана вокруг рёва.
      id: 'instinct-window',
      name: 'Окно',
      abilities: ['gut-rip', 'blood-letting', 'blood-roar', 'blood-frenzy'],
      order: [
        'instinct-endless-letting',
        'instinct-restless',
        'instinct-endless-roar',
        'instinct-beast-breath',
        'instinct-quick-letting',
        'instinct-rage-capacity',
        'instinct-rich-letting',
        'instinct-short-rest',
        'instinct-light-camp',
        'instinct-hardy-stock',
        'instinct-swift-roar',
        'instinct-hunger',
        'instinct-cheap-tear',
        'instinct-second-breath',
        'instinct-full-roar',
        'instinct-never-cooling',
        'instinct-rich-price',
        'instinct-wide-throat',
        'instinct-thrifty-splitter',
        'instinct-wolf-camp',
        'instinct-long-berserk',
        'instinct-steady-hand',
        'instinct-cheap-roar',
      ],
    },
  ],
  'houndmaster-chase': [
    {
      // СТАЯ. Герой и пёс сильнее вместе: стая, мститель, двойной укус —
      // всё про то, чтобы пёс стоял и кусал, а герой бил рядом. Четвёрка —
      // та же, что по умолчанию: первый путь — прибор.
      id: 'chase-pack',
      name: 'Стая',
      abilities: ['undercut', 'sic', 'hamstring', 'recall'],
      order: [
        'chase-pack-tactics',
        'chase-avenger',
        'chase-twin-fang',
        'chase-sharp-fangs',
        'chase-quick-hands',
        'chase-sure-cut',
        'chase-deep-hamstring',
        'chase-long-chase',
        'chase-fast-jaws',
        'chase-keen-eye',
        'chase-heavy-hand',
        'chase-sic-fury',
        'chase-honed',
        'chase-cheap-cut',
        'chase-relentless',
        'chase-swift',
        'chase-crush-grip',
        'chase-lean-flurry',
        'chase-power',
        'chase-keener-eye',
        'chase-fangs-of-old',
        'chase-pack-cut',
        'chase-haste-of-hunt',
        'chase-cheap-sic',
        'chase-quick-unleash',
        'chase-wide-flurry',
      ],
    },
    {
      // ЗУБЫ И СЕРИЯ. Всплески: злой спуск, четвёртый удар серии, второй
      // замах героя. Четвёрка другая — спуск и серия вместо отзыва и подреза.
      id: 'chase-burst',
      name: 'Зубы',
      abilities: ['undercut', 'sic', 'flurry', 'unleash'],
      order: [
        'chase-savage-unleash',
        'chase-fourth-cut',
        'chase-double-strike',
        'chase-wide-flurry',
        'chase-quick-unleash',
        'chase-lean-flurry',
        'chase-sharp-fangs',
        'chase-quick-hands',
        'chase-sure-cut',
        'chase-fast-jaws',
        'chase-heavy-hand',
        'chase-keen-eye',
        'chase-long-chase',
        'chase-sic-fury',
        'chase-honed',
        'chase-cheap-cut',
        'chase-relentless',
        'chase-swift',
        'chase-crush-grip',
        'chase-power',
        'chase-keener-eye',
        'chase-fangs-of-old',
        'chase-haste-of-hunt',
        'chase-cheap-sic',
        'chase-deep-hamstring',
        'chase-pack-cut',
      ],
    },
  ],
  'houndmaster-leash': [
    {
      // ПРИВЯЗЬ. Пёс стоит: крепче, чаще возвращается, отзыв лечит вдвое,
      // оклик почти без отката. Четвёрка по умолчанию — первый путь прибор.
      id: 'leash-hold',
      name: 'Привязь',
      abilities: ['undercut', 'sic', 'hamstring', 'recall'],
      order: [
        'leash-long-lick',
        'leash-iron-leash',
        'leash-tireless-rally',
        'leash-tough-hide',
        'leash-thick-coat',
        'leash-steady-breath',
        'leash-fur-shield',
        'leash-fast-return',
        'leash-cheap-recall',
        'leash-hound-mending',
        'leash-vitality',
        'leash-thicker-hide',
        'leash-quick-rally',
        'leash-even-breath',
        'leash-swift-return',
        'leash-long-recall',
        'leash-hardened',
        'leash-firm-grip',
        'leash-armor',
        'leash-quick-bandage',
        'leash-deep-bandage',
        'leash-cheap-bandage',
        'leash-long-grip',
        'leash-long-skulk',
        'leash-deep-skulk',
      ],
    },
    {
      // ТЕНЬ. Герой прячется за псом: скрадывание вдвое и вдвое дольше, пёс
      // встаёт целым, герой воскресает вдвое быстрее. Четвёрка другая.
      id: 'leash-shadow',
      name: 'Тень',
      abilities: ['undercut', 'skulk', 'bandage', 'rally'],
      order: [
        'leash-second-wind',
        'leash-full-rally',
        'leash-shadow-hound',
        'leash-long-skulk',
        'leash-deep-skulk',
        'leash-quick-bandage',
        'leash-deep-bandage',
        'leash-cheap-bandage',
        'leash-quick-rally',
        'leash-tough-hide',
        'leash-thick-coat',
        'leash-steady-breath',
        'leash-fur-shield',
        'leash-fast-return',
        'leash-hound-mending',
        'leash-vitality',
        'leash-thicker-hide',
        'leash-even-breath',
        'leash-swift-return',
        'leash-hardened',
        'leash-armor',
        'leash-firm-grip',
        'leash-long-grip',
        'leash-cheap-recall',
        'leash-long-recall',
      ],
    },
  ],
  'houndmaster-trail': [
    {
      // ТРОПА. Привал снимает откаты и короче вдвое, травля дешевле и дольше:
      // герой идёт сам и почти не стоит. Четвёрка по умолчанию — прибор.
      id: 'trail-walk',
      name: 'Тропа',
      abilities: ['undercut', 'sic', 'hamstring', 'recall'],
      order: [
        'trail-camp-refresh',
        'trail-short-rest',
        'trail-hunting-breath',
        'trail-restless-legs',
        'trail-short-camp',
        'trail-light-step',
        'trail-second-breath',
        'trail-flow',
        'trail-cheap-sic',
        'trail-quick-camp',
        'trail-hound-rests',
        'trail-cheap-grip',
        'trail-quick-undercut',
        'trail-deep-breath',
        'trail-lean-bandage',
        'trail-brief-camp',
        'trail-cheap-hamstring',
        'trail-out-regen',
        'trail-endless-legs',
        'trail-hound-sleeps',
        'trail-cheap-rally',
        'trail-short-halt',
        'trail-cheap-flurry',
        'trail-cheap-unleash',
        'trail-cheap-skulk',
        'trail-cheap-undercut',
      ],
    },
    {
      // РИТМ. Убийство срезает откаты, серия с двумя зарядами и вдвое
      // дешевле: непрерывный бой без пауз. Четвёрка — всплесковая.
      id: 'trail-rhythm',
      name: 'Ритм',
      abilities: ['undercut', 'sic', 'flurry', 'unleash'],
      order: [
        'trail-hunt-rhythm',
        'trail-flurry-charge',
        'trail-tireless-flurry',
        'trail-cheap-flurry',
        'trail-cheap-unleash',
        'trail-restless-legs',
        'trail-light-step',
        'trail-flow',
        'trail-cheap-sic',
        'trail-quick-undercut',
        'trail-deep-breath',
        'trail-endless-legs',
        'trail-short-camp',
        'trail-second-breath',
        'trail-quick-camp',
        'trail-hound-rests',
        'trail-cheap-grip',
        'trail-lean-bandage',
        'trail-brief-camp',
        'trail-cheap-hamstring',
        'trail-out-regen',
        'trail-hound-sleeps',
        'trail-cheap-rally',
        'trail-short-halt',
        'trail-cheap-skulk',
        'trail-cheap-undercut',
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
      // ГРУППА ЗАПИРАЕТ И МОДЕЛЬ ТОЖЕ. Иначе прогон мерил бы героя, который
      // берёт оба ключевых, — того, которого в игре не существует.
      if (groupHolder(ranks, talent)) continue
      const take = Math.min(talent.maxRank - have, points - spent)
      if (take <= 0) continue
      ranks[id] = have + take
      spent += take
      moved = true
      // ПОСЛЕ КАЖДОЙ ПОКУПКИ — СНОВА С ГОЛОВЫ СПИСКА. Иначе «приоритет»
      // держится только в пределах одного прохода: талант с пятого этажа,
      // стоящий в пути первым, пропускался по порогу, а когда порог набирался
      // — очередь уже ушла в хвост и тратила там всё до последнего очка.
      // Так шесть сборок «сторона А / сторона Б» вышли без единого ключевого
      // таланта, и прибор этого не заметил бы, если бы не печатал их.
      break
    }
  }
  return ranks
}

/**
 * Ветка, залитая очками ПО ПЕРВОМУ ОБЪЯВЛЕННОМУ ПУТИ. Это и есть «сборка
 * ветки» для прогонов и тестов: одна на всю игру, названная в данных.
 */
// ---------------------------------------------------------------------------
// Взаимоисключающие группы
// ---------------------------------------------------------------------------

/** Соседи таланта по группе — без него самого. Пусто, если группы нет. */
export function groupMates(talent: TalentDef): TalentDef[] {
  const group = talent.exclusiveGroup
  if (!group) return []
  return TALENTS.filter((t) => t.exclusiveGroup === group && t.id !== talent.id)
}

/**
 * Кто из группы уже выбран — сосед с хотя бы одним рангом. `null` — группа
 * свободна (или её нет). Ровно одна функция на вопрос «заперт ли талант
 * выбором»: её зовут и статус вложения, и модель прогона, и экран.
 */
export function groupHolder(ranks: Readonly<Record<string, number>>, talent: TalentDef): TalentDef | null {
  return groupMates(talent).find((mate) => rankOf(ranks, mate.id) > 0) ?? null
}

export function fillBranchRanks(branchId: BranchId, points: number): Record<string, number> {
  return pathRanks(pathsOf(branchId)[0], points)
}

