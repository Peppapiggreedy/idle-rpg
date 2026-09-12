/**
 * СВЕРЯЕМЫЕ ЧИСЛА ДОКУМЕНТАЦИИ — ЗАКРЫТЫЙ СПИСОК В ОДНОМ МЕСТЕ.
 *
 * Документацию нельзя проверить целиком, и пробовать не надо: проза не
 * сверяется ничем. Но ЧИСЛО, обязанное совпадать с кодом, — сверяется, и
 * именно числа врут чаще всего. К началу этой ночи ARCHITECTURE.md обещал
 * ШЕСТЬ веток талантов (их девять) и сейв ВЕРСИИ 19 (он 36): оба числа
 * пережили по нескольку ночей, потому что их никто не сверял.
 *
 * УСТРОЕНО ТАК ЖЕ, КАК `ABILITY_TUNABLE`: список закрыт, лежит в одном месте,
 * и добавить в документ число, не заведя его здесь, нельзя — вернее, можно, но
 * тогда оно снова никем не сторожится, и правило CLAUDE.md это запрещает.
 *
 * ЧИСЛА СВЕРЯЮТСЯ В ТАБЛИЦЕ, А НЕ В ПРОЗЕ. «Шесть веток» в тексте регулярным
 * выражением не поймать: число написано словом, склоняется и стоит в пяти
 * падежах. Поэтому у документа есть РАЗДЕЛ СВЕРЯЕМЫХ ЧИСЕЛ таблицей, он и
 * проверяется; проза правится руками и остаётся на совести автора.
 */
import { SAVE_VERSION, MIGRATIONS } from '../../game/save'
import { CLASSES } from '../classes'
import { ZONES } from '../zones'
import { BRANCHES, branchDepth } from '../talents'
import { ABILITIES } from '../abilities'
import { ABILITY_SLOTS } from '../balance'

export interface DocFact {
  /** Как строка названа в таблице документа — по ней и ищется. */
  readonly label: string
  /** Откуда берётся правда. Попадает в сообщение об ошибке. */
  readonly constant: string
  readonly actual: () => number
}

/** Документ, чья таблица сверяется. */
export const DOC_FACTS_FILE = 'ARCHITECTURE.md'
/** Заголовок раздела с таблицей. */
export const DOC_FACTS_HEADING = '## Сверяемые числа'

/**
 * ФОРМА ВЕТКИ ВНЕСЕНА В СПИСОК СТАДИЕЙ 11, и до неё её тут не было намеренно:
 * число этажей и шаг менялись той же ночью, и внеси их сразу — проверка
 * краснела бы со второй стадии по одиннадцатую, то есть всю ночь. Теперь все
 * девять веток на одной форме, тексты её описывают, и число можно сторожить.
 *
 * ВРЕМЁН ПРОВЕРОК ЗДЕСЬ НЕТ И НЕ БУДЕТ: они зависят от машины и числа ядер,
 * сверять их не с чем. Для них правило другое — замер первой стадией каждой
 * ночи, где они упоминаются, и число ядер рядом с числом секунд.
 */
export const DOC_FACTS: readonly DocFact[] = [
  { label: 'версия сейва', constant: 'SAVE_VERSION', actual: () => SAVE_VERSION },
  {
    label: 'миграций сейва',
    constant: 'Object.keys(MIGRATIONS).length',
    actual: () => Object.keys(MIGRATIONS).length,
  },
  { label: 'классов', constant: 'CLASSES.length', actual: () => CLASSES.length },
  {
    label: 'из них готовых',
    constant: "CLASSES.filter(c => c.status === 'ready').length",
    actual: () => CLASSES.filter((c) => c.status === 'ready').length,
  },
  {
    label: 'умений у класса',
    constant: 'ClassDef.abilityIds.length',
    // Одинаково у всех трёх — это контракт «наполнение равное», и разойдись
    // они, честного одного числа тут бы не было. Проверку на равенство держит
    // сам тест: иначе таблица врала бы про два класса из трёх.
    actual: () => CLASSES[0].abilityIds.length,
  },
  { label: 'слотов действий', constant: 'ABILITY_SLOTS', actual: () => ABILITY_SLOTS },
  { label: 'веток талантов', constant: 'BRANCHES.length', actual: () => BRANCHES.length },
  { label: 'зон', constant: 'ZONES.length', actual: () => ZONES.length },
  // Форма ветки. Этажей и шаг — у каждой ветки своя запись, но числа у всех
  // девяти совпадают, и тест это отдельно проверяет: разойдись они, честного
  // одного числа в таблице не было бы.
  { label: 'этажей в ветке', constant: 'BranchDef.rows', actual: () => BRANCHES[0].rows },
  { label: 'шаг порога этажа', constant: 'BranchDef.step', actual: () => BRANCHES[0].step },
  {
    label: 'очков до венца',
    constant: 'branchDepth(id)',
    actual: () => branchDepth(BRANCHES[0].id),
  },
  {
    // Умения, которых нет ни в одной книге класса: их открывает ОЧКО, а не
    // уровень. Считаются по данным, а не перечисляются руками.
    label: 'умений от талантов',
    constant: 'ABILITIES вне всех ClassDef.abilityIds',
    actual: () =>
      ABILITIES.filter((a) => !CLASSES.some((c) => c.abilityIds.includes(a.id))).length,
  },
]
