// ГРАНИЦЫ. Четыре случая, названные мутационным спот-чеком аудита.
//
// Пятнадцать правдоподобных правок в живой код: одиннадцать поймали, четыре
// выжили — И ВСЕ ЧЕТЫРЕ СИДЕЛИ НА ГРАНИЦЕ. Строгое сравнение вместо
// нестрогого либо сдвиг на единицу. Пойманы были те, что меняют поведение
// В СЕРЕДИНЕ диапазона: перевёрнутый знак, сложение вместо умножения,
// переставленный порядок конвейера статов.
//
// Вывод не «покрытие плохое», а точнее: набор проверяет, ЧТО функция делает,
// и почти не проверяет, ГДЕ она переключается. Ошибка `<=` вместо `<`
// пишется сама и читается как правильная — поймать её может только случай
// «ровно на границе».
//
// Две из четырёх мутаций пережили и ДОРОГОЙ набор — против тестов, заведённых
// ровно под эти механики: `level-gap.test.ts` не спрашивал про пятый уровень
// разрыва, а `balance-temple.test.ts` съедал сдвиг кривой допуском в ±1 этаж.
// Дело было не в ярусе, поэтому все четыре случая живут здесь, в быстром
// наборе: они мгновенные и не требуют ни прогона, ни симуляции.
//
// КАЖДЫЙ ТЕСТ НИЖЕ ПРОВЕРЕН МУТАЦИЕЙ: та самая ошибка внесена в код, тест
// покраснел, код возвращён. Тест на границу, который не ловит сдвиг границы,
// хуже отсутствующего — он ещё и успокаивает.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { LEVEL_GAP_FREE, LEVEL_GAP_DAMAGE_PER_LEVEL, levelGapDamageMult } from '../data/balance'
import { TEMPLE_FLOOR_BASE_LEVEL, TEMPLE_FLOOR_LEVEL_STEP, templeFloorLevel } from '../data/temple'
import { LEVEL_CAP } from '../data/balance'
import { ZONES } from '../data/zones'
import { abilityStatus } from './abilities'
import { needsRest } from './rest'
import { createInitialState, type GameState } from './tick'
import { ensureStats } from './stats'
import { heroAbilities } from './abilities'

describe('граница: разрыв уровней', () => {
  // Правило: «пять уровней бесплатно, дальше +30 % за уровень». Пятый —
  // ровно тот, о котором правило и написано, и ровно его никто не проверял:
  // мутация `<=` → `<` делала пятый уровень платным и переживала оба яруса.
  it(`разрыв РОВНО в ${LEVEL_GAP_FREE} уровней ещё бесплатен`, () => {
    expect(levelGapDamageMult(10, 10 + LEVEL_GAP_FREE)).toBe(1)
  })

  it(`разрыв в ${LEVEL_GAP_FREE + 1} уровень уже стоит один шаг`, () => {
    // Соседняя точка: без неё «бесплатно всегда» тоже прошло бы тест выше.
    expect(levelGapDamageMult(10, 10 + LEVEL_GAP_FREE + 1)).toBeCloseTo(
      1 + LEVEL_GAP_DAMAGE_PER_LEVEL,
      12,
    )
  })

  it('разрыв в другую сторону и вровень бесплатны', () => {
    expect(levelGapDamageMult(10, 10)).toBe(1)
    expect(levelGapDamageMult(10, 1)).toBe(1)
  })

  it('бесплатная полоса РАВНА ширине полосы зоны — оттуда она и взялась', () => {
    // Тесты выше написаны ОТ КОНСТАНТЫ (`10 + LEVEL_GAP_FREE`), поэтому её
    // сдвиг они переживают: двигается число — двигается и ожидание. Это не
    // недосмотр, а разделение обязанностей — но тогда само число обязан
    // держать кто-то другой.
    //
    // Держит его смысл: «пять уровней бесплатно» это НЕ круглое число, а
    // ширина полосы мобов зоны. Пока они равны, герой внутри своей зоны не
    // получает штрафа ни от одного её моба; разъедутся — штраф появится в
    // зоне, которая для героя своя, и правило перестанет означать написанное.
    const widths = new Set(ZONES.map((z) => z.monsterLevelRange.max - z.monsterLevelRange.min + 1))
    expect([...widths], 'полосы зон разной ширины — правило о разрыве потеряло опору').toEqual([
      LEVEL_GAP_FREE,
    ])
  })
})

describe('граница: кривая этажа храма', () => {
  // `balance-temple.test.ts` проверяет глубину захода с допуском ±1 этаж —
  // и это законно, там шум прогона. Но тот же допуск съедал сдвиг САМОЙ
  // кривой ровно на этаж: обе стороны двустороннего теста продолжали
  // сходиться. Кривая — чистая функция, шума в ней нет, и проверять её надо
  // БЕЗ допуска, отдельно от захода.
  it('уровень этажа считается точно, без допуска', () => {
    for (const floor of [1, 2, 5, 10]) {
      expect(templeFloorLevel(floor), `этаж ${floor}`).toBe(
        TEMPLE_FLOOR_BASE_LEVEL + TEMPLE_FLOOR_LEVEL_STEP * floor,
      )
    }
  })

  it('первый этаж не совпадает со вторым: сдвиг кривой виден сразу', () => {
    // Прямая проверка на ту самую мутацию (`floor` → `floor - 1`): без неё
    // сдвиг всей лестницы на этаж не ловится ничем.
    expect(templeFloorLevel(1)).toBe(TEMPLE_FLOOR_BASE_LEVEL + TEMPLE_FLOOR_LEVEL_STEP)
    expect(templeFloorLevel(2) - templeFloorLevel(1)).toBe(TEMPLE_FLOOR_LEVEL_STEP)
  })

  it('выше потолка игры кривая упирается в него, а не растёт', () => {
    expect(templeFloorLevel(1000)).toBe(LEVEL_CAP)
  })
})

/**
 * Герой с ЧЕСТНО пересчитанными статами.
 *
 * `statsDirty: true` здесь обязателен и стоил мне одного красного теста:
 * `ensureStats` — не «посчитай», а «посчитай, если помечено», и без флага
 * порог привала оставался дефолтным при любом `restHpThreshold`. Тест на
 * границу, построенный на непересчитанных статах, проверял бы не то число.
 */
function hero(patch: Partial<GameState> = {}): GameState {
  return ensureStats({ ...createInitialState(1), ...patch, statsDirty: true })
}

describe('граница: мана ровно в цену умения', () => {
  // `lt` против `lte`: с мутацией умение отказывало при РОВНО достаточной
  // мане. С Decimal и целыми ценами это попадание не редкое, а постоянное —
  // ровно столько маны остаётся после предыдущего каста.
  // ТОЛЬКО МГНОВЕННОЕ. У `onNextSwing` мана списывается В МОМЕНТ УДАРА, и
  // отказа «нет маны» при постановке в очередь у него нет по построению —
  // проверять на нём границу маны значило бы проверять другое правило.
  const paid = () => {
    const base = hero()
    return heroAbilities(base).find((a) => a.type === 'instant' && a.manaCost.gt(1))
  }

  it('маны ровно в цену — умение доступно', () => {
    const ability = paid()
    expect(ability, 'у класса нет мгновенного платного умения').toBeTruthy()
    if (!ability) return
    const exact = hero({ currentMana: ability.manaCost })
    expect(abilityStatus(exact, ability).reason).not.toBe('no-mana')
  })

  it('маны на единицу меньше цены — отказ «нет маны»', () => {
    const ability = paid()
    expect(ability).toBeTruthy()
    if (!ability) return
    const short = hero({ currentMana: ability.manaCost.minus(1) })
    expect(abilityStatus(short, ability).reason).toBe('no-mana')
  })
})

describe('граница: здоровье ровно на пороге привала', () => {
  // Порог — НАСТРОЙКА ИГРОКА с ползунком, и целые числа урона попадают в
  // него постоянно. `lt` против `lte` меняет поведение ровно там, куда бой
  // приходит регулярно; `rest.test.ts` спрашивал про «ниже» и «выше», но не
  // про «ровно».
  const threshold = 0.6

  it('РОВНО на пороге герой ещё дерётся', () => {
    const s = hero({ restHpThreshold: threshold })
    const exact = ensureStats({ ...s, currentHp: s.stats.maxHp.times(threshold) })
    expect(exact.stats.restThreshold).toBeCloseTo(threshold, 12)
    expect(needsRest(exact)).toBe(false)
  })

  it('на волосок ниже порога — уходит', () => {
    const s = hero({ restHpThreshold: threshold })
    const below = ensureStats({
      ...s,
      currentHp: s.stats.maxHp.times(threshold).minus(new Decimal('0.001')),
    })
    expect(needsRest(below)).toBe(true)
  })

  it('порог в ноль — привала нет ни при каком здоровье', () => {
    // Вторая граница того же ползунка: «никогда» обязано означать никогда.
    const s = hero({ restHpThreshold: 0 })
    const dying = ensureStats({ ...s, currentHp: new Decimal(1) })
    expect(needsRest(dying)).toBe(false)
  })
})
