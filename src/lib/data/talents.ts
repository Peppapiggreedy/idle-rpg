
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
import type { AbilityEffect } from './abilities'

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
 * Ранги по этажам. Сумма — ровно BRANCH_DEPTH; это проверяет content:check,
 * потому что число здесь держит всю арифметику дерева.
 *
 * Почему именно так. Этаж k требует 5·(k−1) очков, вложенных ВЫШЕ него,
 * значит каждый префикс сумм обязан быть не меньше 5·(k−1) — иначе до этажа
 * не добраться. Концептуальные этажи (5, 9, 13) дают всего по одному очку,
 * поэтому соседние с ними приходится делать «жирнее» пятёрки; один этаж
 * (восьмой) выходит на семь рангов — без него префикс перед вторым
 * концептуальным талантом не дотягивает до сорока.
 */
export const BRANCH_RANKS: readonly number[] = [6, 6, 6, 6, 1, 6, 6, 7, 1, 5, 5, 5, 1]

/** Сколько очков вмещает ветка целиком. */
export const BRANCH_DEPTH = BRANCH_RANKS.reduce((sum, rank) => sum + rank, 0) // 61

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
 * баланса понимает, чего от ветки ждать (урон бьёт сильнее, живучесть реже
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

export type TalentEffect =
  | { kind: 'modifiers'; mods: TalentModifier[] }
  | { kind: 'flag'; flag: 'ability-learns-effect'; abilityId: string; effect: AbilityEffect }
  | { kind: 'flag'; flag: 'ability-extra-charge'; abilityId: string; extraCharges: number }
  | { kind: 'flag'; flag: 'double-strike'; chance: number }
  | { kind: 'flag'; flag: 'block-reflects'; damageShare: number }
  | { kind: 'flag'; flag: 'block-restores-resource'; resourceShare: number }
  | { kind: 'flag'; flag: 'kill-refunds-cooldowns'; cooldownShare: number }
  | { kind: 'flag'; flag: 'rest-clears-cooldowns'; cooldownShare: number }
  | { kind: 'flag'; flag: 'shorter-rest'; durationMultiplier: number }
  | { kind: 'flag'; flag: 'faster-revive'; reviveMultiplier: number }

export interface TalentDef {
  id: string
  name: string
  /** Иконка. Тип выведен из реестра: опечатка — ошибка проверки типов. */
  icon: IconName
  branch: BranchId
  row: number // этаж в ветке, 1 — верхний
  maxRank: number
  requiredPointsInBranch: number // сколько очков нужно вложить в ветку до него
  effect: TalentEffect
}

// ---------------------------------------------------------------------------
// Сборка ветки
// ---------------------------------------------------------------------------

/** Что задаётся руками. Этаж, ранг и требование считаются из формы ветки. */
interface TalentSpec {
  id: string
  name: string
  icon: IconName
  effect: TalentEffect
}

const m = (stat: StatId, kind: ModifierKind, value: number): TalentModifier => ({
  stat,
  kind,
  value: new Decimal(value),
})

const mods = (...list: TalentModifier[]): TalentEffect => ({ kind: 'modifiers', mods: list })

/**
 * Ветка из тринадцати описаний. Этаж, ранг и требование берутся ИЗ ФОРМЫ,
 * а не пишутся руками у каждой записи: иначе арифметика 61 очка расползлась
 * бы по восьмидесяти литералам и разъехалась при первой же правке.
 */
function branch(id: BranchId, specs: TalentSpec[]): TalentDef[] {
  return specs.map((spec, index) => ({
    ...spec,
    branch: id,
    row: index + 1,
    maxRank: BRANCH_RANKS[index],
    requiredPointsInBranch: index * BRANCH_ROW_STEP,
  }))
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
  {
    id: 'wrath-honed-edge',
    name: 'Отточенный клинок',
    icon: 'talent-honed-edge',
    effect: mods(m('attackPower', 'percent', 0.02)),
  },
  {
    id: 'wrath-keen-eye',
    name: 'Острый глаз',
    icon: 'talent-keen-eye',
    effect: mods(m('critChance', 'flat', 0.012)),
  },
  {
    id: 'wrath-savage-blows',
    name: 'Свирепые удары',
    icon: 'talent-savage-blows',
    effect: mods(m('critMultiplier', 'flat', 0.08)),
  },
  {
    id: 'wrath-frenzy',
    name: 'Исступление',
    icon: 'talent-frenzy',
    // Ускорение ВСЕГДА flat по haste и никогда прибавкой к weaponSpeed:
    // процент от нуля даёт ноль, а плоская правка скорости оружия увела бы
    // её в минус. Правило записано в CLAUDE.md и закреплено тестом.
    effect: mods(m('haste', 'flat', 0.012)),
  },
  {
    // 21-е очко. Умение перестаёт быть просто сильным ударом.
    id: 'wrath-rupture',
    name: 'Рваный выпад',
    icon: 'talent-rupture',
    effect: {
      kind: 'flag',
      flag: 'ability-learns-effect',
      abilityId: 'quick-strike',
      effect: BLEED,
    },
  },
  {
    id: 'wrath-firm-grip',
    name: 'Крепкая хватка',
    icon: 'talent-strength',
    effect: mods(m('strength', 'flat', 3)),
  },
  {
    id: 'wrath-true-aim',
    name: 'Верный глазомер',
    icon: 'talent-keen-eye',
    effect: mods(m('critChance', 'flat', 0.008)),
  },
  {
    id: 'wrath-momentum',
    name: 'Разгон',
    icon: 'talent-relentless',
    effect: mods(m('haste', 'flat', 0.008)),
  },
  {
    // 41-е очко. Автоатака перестаёт быть ровным ручейком.
    id: 'wrath-double-flourish',
    name: 'Двойной росчерк',
    icon: 'talent-double-strike',
    effect: { kind: 'flag', flag: 'double-strike', chance: 0.2 },
  },
  {
    id: 'wrath-precision',
    name: 'Точность удара',
    icon: 'talent-savage-blows',
    effect: mods(m('critMultiplier', 'flat', 0.06)),
  },
  {
    id: 'wrath-heavy-swing',
    name: 'Мощь замаха',
    icon: 'talent-honed-edge',
    effect: mods(m('attackPower', 'percent', 0.02)),
  },
  {
    id: 'wrath-light-blade',
    name: 'Лёгкость клинка',
    icon: 'talent-frenzy',
    effect: mods(m('haste', 'flat', 0.008)),
  },
  {
    // 61-е очко, капстоун. Второй заряд самого дорогого умения: ротация
    // перестаёт упираться в один откат.
    id: 'wrath-second-swing',
    name: 'Второй замах',
    icon: 'talent-second-charge',
    effect: {
      kind: 'flag',
      flag: 'ability-extra-charge',
      abilityId: 'shattering-blow',
      extraCharges: 1,
    },
  },
])

// Оплот: всё про то, чтобы дожить до конца схватки. Привал теперь между
// боями, и цена ошибки — смерть, поэтому ветка окупается глубиной зоны.
const WARDEN_BULWARK = branch('warden-bulwark', [
  {
    id: 'bulwark-thick-hide',
    name: 'Толстая шкура',
    icon: 'talent-thick-hide',
    effect: mods(m('maxHp', 'percent', 0.05)),
  },
  {
    id: 'bulwark-shield-wall',
    name: 'Стена щитов',
    icon: 'talent-shield-wall',
    effect: mods(m('blockChance', 'flat', 0.02)),
  },
  {
    id: 'bulwark-training',
    name: 'Выучка заслона',
    icon: 'talent-bulwark-training',
    effect: mods(m('blockValue', 'percent', 0.2)),
  },
  {
    id: 'bulwark-iron-skin',
    name: 'Железная кожа',
    icon: 'talent-iron-skin',
    effect: mods(m('damageReduction', 'flat', 0.01)),
  },
  {
    // 21-е очко. Щит начинает кормить ротацию, а не только беречь HP.
    id: 'bulwark-shield-grip',
    name: 'Хватка щита',
    icon: 'talent-block-resource',
    effect: { kind: 'flag', flag: 'block-restores-resource', resourceShare: 0.05 },
  },
  {
    id: 'bulwark-sturdy-frame',
    name: 'Крепость тела',
    icon: 'talent-vitality',
    effect: mods(m('vitality', 'flat', 3)),
  },
  {
    id: 'bulwark-battle-breath',
    name: 'Дыхание в бою',
    icon: 'talent-second-wind',
    effect: mods(m('hpRegen', 'flat', 2)),
  },
  {
    id: 'bulwark-unyielding',
    name: 'Несгибаемость',
    icon: 'talent-thick-hide',
    effect: mods(m('maxHp', 'percent', 0.03)),
  },
  {
    // 41-е очко.
    id: 'bulwark-swift-return',
    name: 'Скорое возвращение',
    icon: 'talent-swift-return',
    effect: { kind: 'flag', flag: 'faster-revive', reviveMultiplier: 0.5 },
  },
  {
    id: 'bulwark-stone-skin',
    name: 'Каменная кожа',
    icon: 'talent-iron-skin',
    effect: mods(m('damageReduction', 'flat', 0.008)),
  },
  {
    id: 'bulwark-heavy-guard',
    name: 'Тяжёлый заслон',
    icon: 'talent-bulwark-training',
    effect: mods(m('blockValue', 'percent', 0.15)),
  },
  {
    id: 'bulwark-firm-stance',
    name: 'Твёрдая стойка',
    icon: 'talent-shield-wall',
    effect: mods(m('blockChance', 'flat', 0.015)),
  },
  {
    // 61-е очко, капстоун. Оборона становится источником урона: поглощённое
    // щитом целиком уходит обратно.
    id: 'bulwark-mirror-shield',
    name: 'Зеркальный щит',
    icon: 'talent-block-reflect',
    effect: { kind: 'flag', flag: 'block-reflects', damageShare: 1 },
  },
])

// Бдение: всё про паузы. Ветка ничего не добавляет к удару и почти ничего
// к запасу HP — её вклад в том, что герой реже останавливается.
const WARDEN_VIGIL = branch('warden-vigil', [
  {
    id: 'vigil-steady-breath',
    name: 'Ровное дыхание',
    icon: 'talent-steady-breath',
    effect: mods(m('manaRegen', 'flat', 1.5)),
  },
  {
    id: 'vigil-clear-mind',
    name: 'Ясный ум',
    icon: 'talent-clear-mind',
    // Пауза регенерации — стат: конвейер обрежет её по нулю, в минус не уйдёт.
    effect: mods(m('regenDelay', 'flat', -0.3)),
  },
  {
    id: 'vigil-deep-well',
    name: 'Глубокий колодец',
    icon: 'talent-deep-well',
    // Запас важнее регена: пауза платится один раз за всплеск, и чем глубже
    // запас, тем реже она приходит.
    effect: mods(m('maxMana', 'percent', 0.1)),
  },
  {
    id: 'vigil-quick-camp',
    name: 'Скорый привал',
    icon: 'talent-quick-camp',
    effect: mods(m('restDuration', 'flat', -0.5)),
  },
  {
    // 21-е очко. Убийство начинает возвращать откаты — темп держится сам.
    id: 'vigil-trophy-spirit',
    name: 'Трофейный дух',
    icon: 'talent-kill-refund',
    effect: { kind: 'flag', flag: 'kill-refunds-cooldowns', cooldownShare: 0.75 },
  },
  {
    id: 'vigil-learning',
    name: 'Учёность',
    icon: 'talent-intellect',
    effect: mods(m('intellect', 'flat', 3)),
  },
  {
    id: 'vigil-field-medicine',
    name: 'Походная перевязка',
    icon: 'talent-field-medicine',
    // Сдвигает ВЫБРАННЫЙ игроком порог вверх, а не спорит с ним: настройка
    // приходит в конвейер базой, талант — прибавкой поверх.
    effect: mods(m('restThreshold', 'flat', 0.02)),
  },
  {
    id: 'vigil-slow-bleeding',
    name: 'Скорое заживление',
    icon: 'talent-second-wind',
    effect: mods(m('hpRegen', 'flat', 1.5)),
  },
  {
    // 41-е очко.
    id: 'vigil-unbroken-focus',
    name: 'Несбитый настрой',
    icon: 'talent-unbroken-focus',
    effect: { kind: 'flag', flag: 'rest-clears-cooldowns', cooldownShare: 0 },
  },
  {
    id: 'vigil-thrift',
    name: 'Бережливость',
    icon: 'talent-deep-well',
    effect: mods(m('maxMana', 'percent', 0.08)),
  },
  {
    id: 'vigil-composure',
    name: 'Собранность',
    icon: 'talent-clear-mind',
    effect: mods(m('regenDelay', 'flat', -0.2)),
  },
  {
    id: 'vigil-light-sleep',
    name: 'Чуткий сон',
    icon: 'talent-quick-camp',
    effect: mods(m('restDuration', 'flat', -0.3)),
  },
  {
    // 61-е очко, капстоун. Привал перестаёт быть налогом: треть времени.
    id: 'vigil-campfire-on-the-move',
    name: 'Костёр на ходу',
    icon: 'talent-shorter-rest',
    effect: { kind: 'flag', flag: 'shorter-rest', durationMultiplier: 1 / 3 },
  },
])

// ---------------------------------------------------------------------------
// ИЗУВЕР
// ---------------------------------------------------------------------------

// Резня: тот же стиль, что и Гнев, но растёт в две руки — вместо ускорения
// на четвёртом этаже стоит сила левой руки, и оба заряда-капстоуна другие.
const REAVER_CARNAGE = branch('reaver-carnage', [
  {
    id: 'carnage-bloodlust',
    name: 'Жажда крови',
    icon: 'talent-honed-edge',
    effect: mods(m('attackPower', 'percent', 0.02)),
  },
  {
    id: 'carnage-predator-eye',
    name: 'Хищный взгляд',
    icon: 'talent-keen-eye',
    effect: mods(m('critChance', 'flat', 0.012)),
  },
  {
    id: 'carnage-ferocity',
    name: 'Свирепость',
    icon: 'talent-savage-blows',
    effect: mods(m('critMultiplier', 'flat', 0.08)),
  },
  {
    id: 'carnage-offhand',
    name: 'Левая рука',
    icon: 'talent-offhand-mastery',
    // Штраф левой руки — СТАТ, поэтому талант правит его модификатором.
    // Со щитом или двуручным он не даёт ничего, и это честно.
    effect: mods(m('offhandPenalty', 'flat', 0.03)),
  },
  {
    // 21-е очко.
    id: 'carnage-bleeding-wound',
    name: 'Кровавая рана',
    icon: 'talent-bleed-deep',
    effect: {
      kind: 'flag',
      flag: 'ability-learns-effect',
      abilityId: 'gut-rip',
      effect: BLEED,
    },
  },
  {
    id: 'carnage-wild-strength',
    name: 'Дикая сила',
    icon: 'talent-strength',
    effect: mods(m('strength', 'flat', 3)),
  },
  {
    id: 'carnage-beast-aim',
    name: 'Звериная точность',
    icon: 'talent-keen-eye',
    effect: mods(m('critChance', 'flat', 0.008)),
  },
  {
    id: 'carnage-drive',
    name: 'Разгон резни',
    icon: 'talent-frenzy',
    effect: mods(m('haste', 'flat', 0.008)),
  },
  {
    // 41-е очко. Шанс ниже, чем у стража: изувер бьёт вдвое чаще, и на
    // равном шансе двойной удар весил бы у него вдвое больше.
    id: 'carnage-blade-storm',
    name: 'Вихрь клинков',
    icon: 'talent-relentless',
    effect: { kind: 'flag', flag: 'double-strike', chance: 0.12 },
  },
  {
    id: 'carnage-discord',
    name: 'Раздор',
    icon: 'talent-savage-blows',
    effect: mods(m('critMultiplier', 'flat', 0.06)),
  },
  {
    id: 'carnage-second-hand',
    name: 'Вторая рука',
    icon: 'talent-offhand-mastery',
    effect: mods(m('offhandPenalty', 'flat', 0.02)),
  },
  {
    id: 'carnage-onslaught',
    name: 'Напор',
    icon: 'talent-honed-edge',
    effect: mods(m('attackPower', 'percent', 0.02)),
  },
  {
    // 61-е очко, капстоун.
    id: 'carnage-blood-charge',
    name: 'Кровавый запал',
    icon: 'talent-blood-charge',
    effect: {
      kind: 'flag',
      flag: 'ability-extra-charge',
      abilityId: 'skull-splitter',
      extraCharges: 1,
    },
  },
])

// Жилы: живучесть изувера. Числа те же, что у Оплота, а капстоун злее —
// отражается ПОЛТОРА поглощённого: изувер защищается нападая.
const REAVER_SINEW = branch('reaver-sinew', [
  {
    id: 'sinew-beast-hide',
    name: 'Шкура зверя',
    icon: 'talent-thick-hide',
    effect: mods(m('maxHp', 'percent', 0.05)),
  },
  {
    id: 'sinew-forearm-guard',
    name: 'Заслон предплечьем',
    icon: 'talent-shield-wall',
    effect: mods(m('blockChance', 'flat', 0.02)),
  },
  {
    id: 'sinew-heavy-riposte',
    name: 'Тяжёлый отпор',
    icon: 'talent-bulwark-training',
    effect: mods(m('blockValue', 'percent', 0.2)),
  },
  {
    id: 'sinew-tanned-hide',
    name: 'Дублёная кожа',
    icon: 'talent-iron-skin',
    effect: mods(m('damageReduction', 'flat', 0.01)),
  },
  {
    // 21-е очко. Ярость приходит из боя — и теперь ещё и из чужих ударов
    // по щиту.
    id: 'sinew-blood-for-blood',
    name: 'Кровь за кровь',
    icon: 'talent-guard-echo',
    effect: { kind: 'flag', flag: 'block-restores-resource', resourceShare: 0.07 },
  },
  {
    id: 'sinew-hardened',
    name: 'Матёрость',
    icon: 'talent-vitality',
    effect: mods(m('vitality', 'flat', 3)),
  },
  {
    id: 'sinew-knitting',
    name: 'Затягивание ран',
    icon: 'talent-second-wind',
    effect: mods(m('hpRegen', 'flat', 2)),
  },
  {
    id: 'sinew-frame',
    name: 'Костяк',
    icon: 'talent-thick-hide',
    effect: mods(m('maxHp', 'percent', 0.03)),
  },
  {
    // 41-е очко.
    id: 'sinew-not-finished',
    name: 'Не добит',
    icon: 'talent-hard-to-kill',
    effect: { kind: 'flag', flag: 'faster-revive', reviveMultiplier: 0.4 },
  },
  {
    id: 'sinew-carapace',
    name: 'Панцирь',
    icon: 'talent-iron-skin',
    effect: mods(m('damageReduction', 'flat', 0.008)),
  },
  {
    id: 'sinew-counterblow',
    name: 'Встречный удар',
    icon: 'talent-bulwark-training',
    effect: mods(m('blockValue', 'percent', 0.15)),
  },
  {
    id: 'sinew-brace',
    name: 'Упор',
    icon: 'talent-shield-wall',
    effect: mods(m('blockChance', 'flat', 0.015)),
  },
  {
    // 61-е очко, капстоун.
    id: 'sinew-spiked-guard',
    name: 'Шипастый заслон',
    icon: 'talent-spiked-guard',
    effect: { kind: 'flag', flag: 'block-reflects', damageShare: 1 },
  },
])

// Чутьё: автономность изувера. Мана и пауза восстановления ему чужды
// (класс гасит их множителем-нулём), поэтому ветка растит не реген, а
// ЁМКОСТЬ ярости, порог привала и заживление в бою.
const REAVER_INSTINCT = branch('reaver-instinct', [
  {
    id: 'instinct-beast-breath',
    name: 'Дыхание зверя',
    icon: 'talent-second-wind',
    effect: mods(m('hpRegen', 'flat', 1.5)),
  },
  {
    id: 'instinct-short-rest',
    name: 'Короткий роздых',
    icon: 'talent-quick-camp',
    effect: mods(m('restDuration', 'flat', -0.5)),
  },
  {
    id: 'instinct-rage-capacity',
    name: 'Ёмкость ярости',
    icon: 'talent-deep-well',
    // СТАВКА НАМЕРЕННО НИЖЕ, чем у «Глубокого колодца» стража, и вот почему.
    // Доход ярости — ДОЛЯ запаса (resourceIncome), а цены умений — числа:
    // у изувера ёмкость это ещё и урон, а у стража только глубина. С равной
    // ставкой ветка автономности изувера обгоняла бы по урону его же ветку
    // урона — то есть выбор стиля переставал бы существовать.
    effect: mods(m('maxMana', 'percent', 0.04)),
  },
  {
    id: 'instinct-beast-sense',
    name: 'Звериное чутьё',
    icon: 'talent-field-medicine',
    effect: mods(m('restThreshold', 'flat', 0.02)),
  },
  {
    // 21-е очко.
    id: 'instinct-taste-of-victory',
    name: 'Вкус победы',
    icon: 'talent-kill-refund',
    effect: { kind: 'flag', flag: 'kill-refunds-cooldowns', cooldownShare: 0.7 },
  },
  {
    id: 'instinct-hardy-stock',
    name: 'Живучая порода',
    icon: 'talent-vitality',
    effect: mods(m('vitality', 'flat', 3)),
  },
  {
    id: 'instinct-hunger',
    name: 'Голод',
    icon: 'talent-deep-well',
    // Та же поправка, что и у «Ёмкости ярости» этажом выше.
    effect: mods(m('maxMana', 'percent', 0.03)),
  },
  {
    id: 'instinct-second-breath',
    name: 'Второе дыхание',
    icon: 'talent-second-wind',
    effect: mods(m('hpRegen', 'flat', 1.5)),
  },
  {
    // 41-е очко.
    id: 'instinct-never-cooling',
    name: 'Не остывая',
    icon: 'talent-unbroken-focus',
    effect: { kind: 'flag', flag: 'rest-clears-cooldowns', cooldownShare: 0 },
  },
  {
    id: 'instinct-deep-sleep',
    name: 'Крепкий сон',
    icon: 'talent-quick-camp',
    effect: mods(m('restDuration', 'flat', -0.3)),
  },
  {
    id: 'instinct-alertness',
    name: 'Чуткость',
    icon: 'talent-field-medicine',
    effect: mods(m('restThreshold', 'flat', 0.015)),
  },
  {
    id: 'instinct-patience',
    name: 'Терпение',
    icon: 'talent-second-wind',
    effect: mods(m('hpRegen', 'flat', 1)),
  },
  {
    // 61-е очко, капстоун.
    id: 'instinct-wolf-camp',
    name: 'Волчий привал',
    icon: 'talent-shorter-rest',
    effect: { kind: 'flag', flag: 'shorter-rest', durationMultiplier: 1 / 3 },
  },
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

