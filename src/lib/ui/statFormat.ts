// РЕЕСТР ХАРАКТЕРИСТИК ДЛЯ ИГРОКА: название и способ прочтения каждой.
//
// Один на всю игру. До этого таблицы имён и форматов жили внутри StatsPanel,
// и любой второй экран, которому понадобились бы характеристики, обязан был
// завести свою копию — а копия разъезжается с оригиналом молча. Сравнение
// предметов было бы как раз таким вторым экраном.
//
// Список характеристик здесь НЕ ПЕРЕЧИСЛЯЕТСЯ: он один и лежит в STAT_IDS
// (game/stats.ts). Здесь только то, как показать каждую, и `Record<StatId, …>`
// заставляет компилятор потребовать строку для новой характеристики сразу.
import { Decimal, STAT_IDS, type StatId } from '../game'
import { classById } from '../data/classes'
import { resourceWords } from './resource'

/**
 * ХАРАКТЕРИСТИКИ, КОТОРЫЕ ИГРОКУ В СПИСКЕ СТАТОВ НЕ ПОКАЗЫВАЮТСЯ.
 *
 * Порог привала — это НАСТРОЙКА, а не свойство героя: игрок сам ставит его
 * кнопкой в разделе «Мир», и там же видит действующее значение вместе с
 * прибавкой талантов. В общем списке статов он читался как что-то, что
 * находится и надевается, а в сравнении предметов появлялся строкой, которую
 * ни одна вещь изменить не может.
 *
 * В конвейере (STAT_IDS) он остаётся: таланты его двигают, и считается он
 * там же, где всё остальное. Скрыт он только от двух экранов.
 */
export const SETTING_STATS: StatId[] = ['restThreshold']

/**
 * ХАРАКТЕРИСТИКИ СПУТНИКА ПОКАЗЫВАЮТСЯ ТОЛЬКО ТОМУ, У КОГО СПУТНИК ЕСТЬ.
 *
 * «Запас пса» в карточке Стража — не мелочь: восемь строк про то, чего у
 * героя нет и быть не может, читаются как поломка, а список статов и так
 * длиннее двенадцати. Признак берётся из ДАННЫХ класса (`companion`), а не
 * по id: класс со спутником, которого заведут потом, получит их сам.
 */
const COMPANION_STATS: StatId[] = [
  'houndMaxHp',
  'houndHpRegen',
  'houndAttackPower',
  'houndCritChance',
  'houndArmor',
  'houndDodge',
  'houndReviveSpeed',
  'redirectShare',
]

/** Характеристики, которые показывают игроку списком. */
export function shownStatIds(classId: string | undefined | null): StatId[] {
  const hasCompanion = Boolean(classId && classById(classId).companion)
  return STAT_IDS.filter(
    (id) => !SETTING_STATS.includes(id) && (hasCompanion || !COMPANION_STATS.includes(id)),
  )
}

/** Весь список без оглядки на класс — для проверок и обходов реестра. */
export const SHOWN_STAT_IDS: StatId[] = STAT_IDS.filter((id) => !SETTING_STATS.includes(id))

/** Проценты и секунды читаются иначе, чем растущие величины. */
export const PERCENT_STATS: StatId[] = [
  'critChance',
  'damageReduction',
  'haste',
  'blockChance',
  'offhandPenalty',
  'restThreshold',
  // Одиннадцать долей с базой ноль: все читаются процентом и никак иначе.
  'doubleStrike',
  'dodge',
  'reviveSpeed',
  'houndMaxHp',
  'houndHpRegen',
  'houndAttackPower',
  'houndCritChance',
  'houndArmor',
  'houndDodge',
  'houndReviveSpeed',
  'redirectShare',
]
export const SECONDS_STATS: StatId[] = [
  'weaponSpeed',
  'offhandSpeed',
  'regenDelay',
  'restDuration',
]

/**
 * Названия характеристик. Зависят от КЛАССА: у изувера ресурс — ярость,
 * и «Восст. маны» в его характеристиках было бы просто неправдой.
 */
export function statNames(classId: string | undefined | null): Record<StatId, string> {
  const resource = resourceWords(classId)
  return {
    strength: 'Сила',
    agility: 'Ловкость',
    intellect: 'Интеллект',
    vitality: 'Выносливость',
    attackPower: 'Сила атаки',
    weaponDamageMin: 'Урон оружия (мин)',
    weaponDamageMax: 'Урон оружия (макс)',
    maxHp: 'Здоровье',
    maxMana: resource.name,
    weaponSpeed: 'Скорость оружия',
    offhandSpeed: 'Скорость левой руки',
    offhandDamageMin: 'Урон левой руки (мин)',
    offhandDamageMax: 'Урон левой руки (макс)',
    blockChance: 'Шанс блока',
    blockValue: 'Сила блока',
    offhandPenalty: 'Сила левой руки',
    regenDelay: `Пауза восст. ${resource.genitive}`,
    restDuration: 'Длина привала',
    restThreshold: 'Порог привала',
    haste: 'Ускорение',
    critChance: 'Шанс крита',
    critMultiplier: 'Множитель крита',
    hpRegen: 'Восст. здоровья (бой)',
    hpRegenOutOfCombat: 'Восст. здоровья (отдых)',
    manaRegen: `Восст. ${resource.genitive}`,
    armor: 'Броня',
    damageReduction: 'Снижение урона',
    doubleStrike: 'Двойной удар',
    dodge: 'Уворот',
    reviveSpeed: 'Скорость подъёма',
    houndMaxHp: 'Запас пса',
    houndHpRegen: 'Восст. пса',
    houndAttackPower: 'Сила укуса',
    houndCritChance: 'Крит пса',
    houndArmor: 'Броня пса',
    houndDodge: 'Уворот пса',
    houndReviveSpeed: 'Возврат пса',
    redirectShare: 'Доля пса во входящем',
  }
}

const asDecimal = (v: Decimal | number): Decimal => (v instanceof Decimal ? v : new Decimal(v))


/**
 * ИЗМЕНЕНИЕ характеристики со знаком. Для секунд знак переворачивать НЕ надо:
 * «−0.20с» и так читается как «быстрее», а придуманный плюс врал бы.
 */
export function formatStatDelta(stat: StatId, before: Decimal | number, after: Decimal | number): string {
  const diff = asDecimal(after).minus(asDecimal(before))
  const sign = diff.gt(0) ? '+' : diff.lt(0) ? '−' : ''
  const magnitude = diff.abs()
  if (SECONDS_STATS.includes(stat)) return `${sign}${magnitude.toNumber().toFixed(2)}с`
  if (PERCENT_STATS.includes(stat)) return `${sign}${magnitude.times(100).toFixed(1)}%`
  if (stat === 'critMultiplier') return `${sign}${magnitude.toFixed(2)}`
  return `${sign}${magnitude.gte(10) ? magnitude.toFixed(0) : magnitude.toFixed(1)}`
}

/** Лучше ли стало. У скорости оружия и паузы регена меньше — это лучше. */
export function isImprovement(stat: StatId, before: Decimal | number, after: Decimal | number): boolean {
  const diff = asDecimal(after).minus(asDecimal(before))
  const lowerIsBetter = stat === 'weaponSpeed' || stat === 'offhandSpeed' || stat === 'regenDelay'
  return lowerIsBetter ? diff.lt(0) : diff.gt(0)
}
