// Лестница открытий — данные.
//
// ЗАЧЕМ ОНА ЕСТЬ. В конечной игре бесконечно растущие числа перестают быть
// поводом играть дальше: «стало на три процента больше» не держит никого.
// Держит другое — «через десять уровней будет то, чего я ещё не видел».
// Каждые десять уровней открывается новый данж и новая механика, и лестница
// показывает это ЗАРАНЕЕ.
//
// РАБОТАЕТ ОНА ПРИ ДВУХ УСЛОВИЯХ, и оба held кодом, а не обещанием:
//   1. лестница видна с самого начала — иначе сюрприз не про что ждать;
//   2. названия будущих ступеней СКРЫТЫ. Не приглушены стилями — их вообще
//      нет в разметке (см. ProgressionPanel.svelte). Спрятанное стилями
//      живёт до первого открытия инспектора, и интрига кончается там же.
//
// Ступень может ссылаться на механику, которой в коде ещё НЕТ: тогда её
// `unlocks` пуст. Лестница живёт раньше содержимого — это нормально и
// намеренно, иначе её пришлось бы дописывать по кусочку вместе с каждой
// фичей и игрок никогда не видел бы весь путь целиком.
import type { IconName } from '../ui/icons/manifest'

/** На что ссылается ступень. */
export type ProgressionUnlock =
  | { kind: 'dungeon'; id: string }
  | { kind: 'mechanic'; id: MechanicId }

/**
 * Механики, которые открываются по лестнице. Перечислимы намеренно:
 * `content:check` сверяет ссылки ступеней с этим списком, а не с текстом.
 */
export type MechanicId =
  | 'talents'
  | 'crafting'
  | 'herbalism'
  | 'enchanting'
  | 'unique-recipes'
  | 'temple'
  | 'prequests'
  | 'heroic'
  | 'raid'

export interface ProgressionStep {
  /** Уровень героя, на котором ступень открывается. */
  level: number
  id: string
  /** Название — ТОЛЬКО для открытой ступени. Закрытая его не показывает. */
  name: string
  /** Одна строка о том, что именно появится. */
  description: string
  icon: IconName
  unlocks: ProgressionUnlock[]
  /**
   * Ступень описана, но содержимого за ней ещё нет. Показывается как
   * «будет добавлено», а не как рабочий вход: обещать открытым то, чего
   * нет, — худший вид пустого экрана.
   */
  placeholder?: boolean
}

// Порядок — порядок игры. Уровни строго возрастают, дыр между десятками нет.
export const PROGRESSION: ProgressionStep[] = [
  {
    level: 10,
    id: 'step-talents',
    name: 'Дерево талантов',
    description: 'Очко за уровень. Веток три, а очков хватит на одну целиком и половину второй.',
    icon: 'talent-honed-edge',
    unlocks: [{ kind: 'mechanic', id: 'talents' }],
  },
  {
    level: 20,
    id: 'step-first-dungeon',
    name: 'Первый данж',
    // БЫЛО «Привала внутри нет» — И ЭТО БЫЛА НЕПРАВДА. Привал между боссами
    // есть, и на нём держится вся цена схватки: три боя по 80 % запаса на
    // одной полоске не проходятся никак (см. CLAUDE.md, «Данжи»). Нет его
    // ровно в одном месте — после ПОСЛЕДНЕГО босса, и там отдыхать не от чего.
    description: 'Три босса подряд. Между ними привал, после последнего — выход.',
    icon: 'dungeon',
    unlocks: [{ kind: 'dungeon', id: 'sunken-barrow' }],
  },
  {
    level: 30,
    id: 'step-crafting',
    name: 'Ремёсла и второй данж',
    description: 'Кузнечное дело и кулинария: снаряжение и еда своими руками.',
    icon: 'profession-smithing',
    unlocks: [
      { kind: 'mechanic', id: 'crafting' },
      { kind: 'dungeon', id: 'ninth-drift' },
    ],
  },
  {
    level: 40,
    id: 'step-herbalism',
    name: 'Травничество и третий данж',
    description: 'Травы собираются сами, зелья пьются руками.',
    icon: 'material-herb',
    unlocks: [
      { kind: 'mechanic', id: 'herbalism' },
      { kind: 'dungeon', id: 'tier-cisterns' },
    ],
  },
  {
    level: 50,
    id: 'step-enchanting',
    name: 'Зачарование и четвёртый данж',
    description: 'Лишний лут превращается в пыль, пыль — в постоянную прибавку.',
    icon: 'material-shard',
    unlocks: [
      { kind: 'mechanic', id: 'enchanting' },
      { kind: 'dungeon', id: 'boiling-adits' },
    ],
  },
  {
    level: 60,
    id: 'step-unique-recipes',
    name: 'Уникальные рецепты и пятый данж',
    description: 'Реагенты боссов: вещь можно спланировать, а не выпрашивать у рулетки.',
    icon: 'reagent-silt-clot',
    unlocks: [
      { kind: 'mechanic', id: 'unique-recipes' },
      { kind: 'dungeon', id: 'wind-galleries' },
    ],
  },
  {
    level: 70,
    id: 'step-temple',
    name: 'Храм испытаний и шестой данж',
    // БЫЛО «Бесконечная волна раз в сутки» — ДВЕ НЕПРАВДЫ В ОДНОЙ СТРОКЕ.
    // Храм КОНЕЧЕН (двадцать этажей: без потолка полная зачистка недостижима,
    // а с ней и награда за неё), и кулдауна у него НЕТ вовсе — фарм закрыт не
    // запретом, а построением: платят только этажи выше рекорда.
    description: 'Двадцать этажей вверх. Заходить можно сколько угодно, но платят только этажи выше рекорда.',
    icon: 'dungeon',
    unlocks: [
      { kind: 'mechanic', id: 'temple' },
      { kind: 'dungeon', id: 'salt-womb' },
    ],
  },
  {
    level: 80,
    id: 'step-prequests',
    name: 'Преквесты и седьмой данж',
    description: 'Цепочка заданий, за которой открываются врата рейда.',
    icon: 'log',
    unlocks: [
      { kind: 'mechanic', id: 'prequests' },
      { kind: 'dungeon', id: 'rime-catacombs' },
    ],
  },
  {
    level: 90,
    id: 'step-heroic',
    name: 'Героический режим и восьмой данж',
    description: 'Те же данжи, другие числа и по одной новой способности боссам.',
    icon: 'dungeon',
    unlocks: [
      { kind: 'mechanic', id: 'heroic' },
      { kind: 'dungeon', id: 'bluff-hollow' },
    ],
  },
  {
    level: 100,
    id: 'step-raid',
    name: 'Рейд',
    description: 'Финал игры. Врата открываются — сам рейд появится следующим обновлением.',
    icon: 'class-warden',
    unlocks: [],
    placeholder: true,
  },
]


/** Все механики, перечисленные в лестнице, — для проверки целостности. */
export const MECHANIC_IDS: readonly MechanicId[] = [
  'talents',
  'crafting',
  'herbalism',
  'enchanting',
  'unique-recipes',
  'temple',
  'prequests',
  'heroic',
  'raid',
]
