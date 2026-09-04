// ЭТОТ ФАЙЛ — ЧАСТЬ ДОРОГОГО НАБОРА (`npm run test:balance`), а не быстрого.
// Он гоняет настоящую симуляцию по всей лестнице уровней и обоим классам:
// три с половиной минуты, то есть в семь раз дороже, чем быстрый набор
// обязан занимать целиком. Быстрый набор ловит опечатки и поломки, дорогой —
// кривые; кран золота и лестница покупок — это кривые.
// КРАН ЗОЛОТА: форма кривой дохода и время до следующей покупки.
//
// ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ. Не «много ли золота» — вопрос без ответа, — а ФОРМА
// кривой. Решение по экономике: золото растёт, и цены растут вместе с ним;
// ровной обязана оставаться одна величина — ВРЕМЯ ДО СЛЕДУЮЩЕЙ ПОКУПКИ. Если
// доход загибается, а цены идут геометрически, ранние покупки берутся
// мгновенно, а поздние не берутся никогда, и лестница перестаёт быть
// лестницей.
//
// ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. Идеально ровного роста нет: он упирается в дыру
// отстающей зоны, и это доказано арифметикой в тесте ниже, а не оставлено
// на веру. Пока дыра открыта, тесты держат ФАКТИЧЕСКУЮ форму как порог
// регрессии — чтобы она не ухудшилась, — и называют цель, до которой не
// дотянулись.
import { describe, expect, it } from 'vitest'
import { referenceBuild, simulate } from '../simulate'
import { ZONES, zoneForMonsterLevel } from '../../data/zones'
import { DEFAULT_CLASS } from '../../data/classes'
import { classIt, contractClasses } from './class-set'
import { LEVEL_CAP } from '../../data/balance'
import { MONSTER_GROWTH } from '../../data/monsters'
import { RECIPES, craftToll, goldPerHourAt, recipeLevel } from '../../data/recipes'
import { GOLD_UPGRADES } from '../../data/upgrades'
import { upgradeCost } from '../upgrades'
import { dump } from './dump'

const SAMPLE = process.env.BALANCE_SAMPLE === '1'
/** Готовые классы — контракт, превью — предупреждение (см. class-set.ts). */
const CLASS_SET = contractClasses(SAMPLE)

const STEP = 10
const LEVELS = Array.from({ length: 1 + (LEVEL_CAP - STEP) / STEP }, (_, i) => STEP + i * STEP)

// ЛЕСТНИЦА ПОКУПОК ТЕПЕРЬ НАСТОЯЩАЯ. Здесь стояли ПЛЕЙСХОЛДЕРНЫЕ цены —
// «семь ступеней, последняя в 48 раз дороже первой», — и мерились они, пока
// самой лестницы не было. Лестница появилась (GOLD_UPGRADES), и мерить надо
// её: у настоящих ступеней и уровни другие (15..85, а не 10..100), и рост
// другой (26/2 часа вместо 48-кратной цены).

/**
 * КРАН ЗОЛОТА ЗА ЧАС — КОШЕЛЁК ПЛЮС ПОДОРОЖАНИЕ СУМКИ (`incomePerHour`).
 *
 * Так было не всегда, и менять пришлось вместе с переносом семидесяти
 * процентов дохода на продажу находок. Пока золото платил моб, кошелёк и был
 * доходом. Теперь основной ручей идёт через сумку, а сумка — БУФЕР на дюжину
 * мест: за первый час игры он ещё наполняется, и до кошелька доходит только
 * то, что из него вытеснили. Замер по кошельку показывал 43-81 % расхождения
 * с моделью — и это мерился не доход, а скорость наполнения буфера.
 *
 * Непроданная находка — отложенное золото, а не потерянное: в установившемся
 * режиме каждая новая вытесняет одну старую в продажу, а с покупкой «продавать
 * лишнее» (лестница покупок) — сразу.
 */
/**
 * ЧЕТЫРЕ ЧАСА, А НЕ ОДИН, И ЭТО ТОЖЕ ПРО ПЕРЕНОС ДОХОДА НА НАХОДКИ. Награда
 * моба детерминирована — часа хватало с запасом. Цена находки разыгрывается
 * рулеткой тиров, а рулетка тяжелохвостая: легендарка стоит тридцать обычных
 * при вероятности 0.6 %, и три верхних тира несут четверть матожидания на
 * трёх процентах находок. Разброс ОДНОЙ находки — 143 % от среднего, то есть
 * за час (60-70 находок) доход гуляет на ±17 %, а отношение двух соседних
 * ступеней — на ±25. Замер это и показал: ступень 20 → 30 прочиталась как
 * ×3.02, следующая как ×0.96, и обе — шум, а не кривая.
 *
 * Четыре часа дают 240-280 находок и ±9 %. Дешевле было бы мерить модель
 * (`goldPerHourAt`) — но тогда контракт формы кривой перестал бы смотреть на
 * игру вообще, а он именно за этим и заведён.
 */
const INCOME_HOURS = 4

function goldPerHour(level: number, classId: string, zoneId?: string): number {
  const zone = zoneForMonsterLevel(level) ?? ZONES[0]
  return simulate({
    hours: INCOME_HOURS,
    zoneId: zoneId ?? zone.id,
    freezeLevel: true,
    build: referenceBuild(level, classId),
    seed: 4242,
  }).incomePerHour.toNumber()
}

describe('кран золота', () => {
  const income = new Map(
    CLASS_SET.map((cls) => [cls.id, LEVELS.map((level) => goldPerHour(level, cls.id))] as const),
  )

  it('печатает кривую дохода', () => {
    for (const cls of CLASS_SET) {
      const values = income.get(cls.id)!
      // eslint-disable-next-line no-console
      console.log(`\n${cls.name}`)
      // eslint-disable-next-line no-console
      console.table(
        LEVELS.map((level, i) => ({
          уровень: level,
          'золота/ч': Math.round(values[i]),
          'к предыдущему': i === 0 ? '—' : (values[i] / values[i - 1]).toFixed(2),
        })),
      )
    }
    expect(income.size).toBe(CLASS_SET.length)
  }, 900_000)

  for (const cls of CLASS_SET) {
    const cit = classIt(cls)
    const classId = cls.id

    cit(`${cls.name}: доход растёт на каждой ступени — плато нет нигде`, () => {
      const values = income.get(classId)!
      for (let i = 1; i < values.length; i += 1) {
        // Ключ — координаты замера: класс, своя зона уровня, сам уровень.
        expect(
          dump(
            `gold/income/${classId}/zone-own/level-${String(LEVELS[i]).padStart(3, '0')}`,
            values[i],
          ),
          `ур. ${LEVELS[i]}`,
        ).toBeGreaterThan(
          dump(
            `gold/income/${classId}/zone-own/level-${String(LEVELS[i - 1]).padStart(3, '0')}`,
            values[i - 1],
          ),
        )
      }
    })

    cit(`${cls.name}: рост не проваливается и не выстреливает`, () => {
      // ПОРОГ РЕГРЕССИИ, а не цель. Цель — ровный рост (разброс около 1.2),
      // и она недостижима, пока открыта дыра отстающей зоны: см. отдельный
      // тест-арифметику ниже. Здесь заперта нынешняя форма, чтобы она не
      // поехала дальше.
      const values = income.get(classId)!
      const ratios = values.slice(1).map((v, i) => v / values[i])
      expect(
        dump(`gold/income-step/${classId}/ratio-min`, Math.min(...ratios)),
        'самая пологая ступень',
      ).toBeGreaterThan(1.1)
      expect(
        dump(`gold/income-step/${classId}/ratio-max`, Math.max(...ratios)),
        'самая крутая ступень',
      ).toBeLessThan(2.35)
      expect(
        dump(
          `gold/income-step/${classId}/ratio-spread`,
          Math.max(...ratios) / Math.min(...ratios),
        ),
        'разброс',
      ).toBeLessThan(2)
    })

    cit(
      `${cls.name}: лестница покупок растёт ровно, без прыжков между ступенями`,
      () => {
        // КОНТРАКТ ЗДЕСЬ НЕ ТОТ, ЧТО БЫЛ, И ЭТО ЗАМЕР, А НЕ ПОСЛАБЛЕНИЕ.
        //
        // Стояло «время до следующей покупки не гуляет больше чем втрое», и
        // мерилось оно на плейсхолдерных ценах. Настоящая лестница такого
        // свойства НЕ ИМЕЕТ и иметь не должна: в data/upgrades.ts прямо
        // записано «цена растёт быстрее дохода (2 → 26 часов), и это
        // намеренно — последняя ступень должна оставаться целью, а не
        // покупаться попутно». Замер по настоящим ценам: копить на первую
        // покупку 2.0 часа, на последнюю 26.7 — разброс тринадцатикратный, и
        // он есть форма лестницы, а не её поломка.
        //
        // Мерить надо ДРУГОЕ: чтобы лестница РОСЛА РОВНО. Ступень, дороже
        // соседней вдвое, читается как стена; дешевле — как ступень, которую
        // покупают не глядя. Замер: каждая следующая покупка стоит 1.48-1.66
        // предыдущей.
        const rungs = GOLD_UPGRADES.map((def) => ({
          def,
          hours: upgradeCost(def)
            .div(
              dump(
                `gold/income/${classId}/zone-own/level-${String(def.level).padStart(3, '0')}`,
                goldPerHour(def.level, classId),
              ),
            )
            .toNumber(),
        }))
        // eslint-disable-next-line no-console
        console.log(
          `${classId}: копить на покупку — ` +
            rungs.map((r) => `ур.${r.def.level}:${r.hours.toFixed(1)}ч`).join(' '),
        )
        const steps = rungs.slice(1).map((r, i) => r.hours / rungs[i].hours)
        expect(
          dump(`gold/ladder/${classId}/step-min`, Math.min(...steps)),
          'самая пологая ступень лестницы покупок',
        ).toBeGreaterThan(1.2)
        expect(
          dump(`gold/ladder/${classId}/step-max`, Math.max(...steps)),
          'самая крутая ступень лестницы покупок',
        ).toBeLessThan(2)
        // И ПЕРВАЯ ПОКУПКА ДОСТУПНА НЕ ПОЗЖЕ ЧАСА-ДВУХ: до неё игрок доходит
        // на первом же вечере, иначе лестницы для него не существует.
        expect(dump(`gold/ladder/${classId}/first-hours`, rungs[0].hours)).toBeLessThan(3)
      },
      900_000,
    )
  }

  it('НАКЛОН НАГРАДЫ РОВНУЮ КРИВУЮ НЕ ДАЁТ — ни при каком числе', () => {
    // ГЛАВНЫЙ ВЫВОД ШАГА, и он арифметический, а не измеренный.
    //
    // Награда за убийство = ЛИНЕЙНАЯ прибавка за уровень моба (rewardPerLevel)
    // × ЭКСПОНЕНТА зоны (rewardMultiplier). Ровность кривой дохода хочет,
    // чтобы линейная часть была маленькой, а экспонента большой: тогда рост
    // одинаков на каждой ступени. Но ровно та же правка делает НИЗКИЕ зоны
    // относительно богаче — а герой в них бьёт с одного удара, и убийств в
    // час у него втрое больше. То есть выравнивание кривой РАСШИРЯЕТ дыру
    // отстающей зоны.
    //
    // Здесь перебираются наклоны при ЗАКРЕПЛЁННОМ общем росте награды с 10 по
    // 100 уровень: иначе «ровно» достигается простым раздуванием дохода, а не
    // формой. И на каждом шаге видно одно и то же — ровнее становится только
    // вместе с расширением дыры. Значит наклон не тот рычаг, и ровная кривая
    // ждёт штрафа золота за отставание (предложение — в data/balance.ts).
    const TOTAL_GROWTH = 22.9 // во столько раз растёт награда за убийство, 10 -> 100
    const current = MONSTER_GROWTH.rewardPerLevel.toNumber()
    const evenness = (a: number) => {
      const zoneStep = Math.pow((TOTAL_GROWTH * (1 + 9 * a)) / (1 + 99 * a), 1 / 18)
      const first = ((1 + 19 * a) / (1 + 9 * a)) * zoneStep ** 2
      const last = ((1 + 99 * a) / (1 + 89 * a)) * zoneStep ** 2
      // Доля награды стартовой зоны к награде своей на двадцатом уровне.
      const share = (1 + 2 * a) / ((1 + 17 * a) * zoneStep ** 3)
      return { spread: first / last, share }
    }
    // ОДНО И ТО ЖЕ НА ВСЕХ НАКЛОНАХ: ровнее — значит доля стартовой зоны
    // выше. Проверяется парами, а не абсолютным порогом: пороги здесь
    // округлены с замера, а вот НАПРАВЛЕНИЕ зависимости точное.
    const points = [0.05, 0.1, 0.15, 0.2, current]
    for (let i = 1; i < points.length; i += 1) {
      const flatter = evenness(points[i - 1])
      const steeper = evenness(points[i])
      // Координата замера — сам наклон, а не номер пары: 0.05 -> slope-0-05.
      expect(
        dump(
          `gold/reward-slope/slope-${points[i - 1].toFixed(2).replace('.', '-')}/spread`,
          flatter.spread,
        ),
        `наклон ${points[i - 1]} против ${points[i]}`,
      ).toBeLessThan(
        dump(
          `gold/reward-slope/slope-${points[i].toFixed(2).replace('.', '-')}/spread`,
          steeper.spread,
        ),
      )
      expect(
        dump(
          `gold/reward-slope/slope-${points[i - 1].toFixed(2).replace('.', '-')}/start-zone-share`,
          flatter.share,
        ),
        `доля стартовой зоны при наклоне ${points[i - 1]}`,
      ).toBeGreaterThan(
        dump(
          `gold/reward-slope/slope-${points[i].toFixed(2).replace('.', '-')}/start-zone-share`,
          steeper.share,
        ),
      )
    }
  })
})

describe('дыра отстающей зоны', () => {
  // ЗАМЕР, КОТОРЫЙ ПРОСИЛИ. Что герой зарабатывает в СТАРТОВОЙ зоне против
  // того, что он заработал бы в своей. Опыта в стартовой он не получает
  // вовсе (штраф за отставание), а вот золото не тронуто ничем — и на
  // двадцатом уровне стартовый луг платит БОЛЬШЕ своей зоны.
  //
  // Почему так: герой кладёт луговых мобов с одного удара, и убийств в час
  // у него втрое больше, чем в своей полосе. Мелкая награда, помноженная на
  // утроенный темп, обгоняет крупную награду на обычном темпе.
  it('печатает обе цифры по уровням', () => {
    const rows = [20, 40, 60, 80, 100].map((level) => {
      const own = zoneForMonsterLevel(level) ?? ZONES[0]
      const start = dump(
        `gold/income/${DEFAULT_CLASS.id}/zone-${ZONES[0].id}/level-${String(level).padStart(3, '0')}`,
        goldPerHour(level, DEFAULT_CLASS.id, ZONES[0].id),
      )
      const mine = dump(
        `gold/income/${DEFAULT_CLASS.id}/zone-own/level-${String(level).padStart(3, '0')}`,
        goldPerHour(level, DEFAULT_CLASS.id, own.id),
      )
      return {
        уровень: level,
        'стартовая 1-5, зол/ч': Math.round(start),
        'своя зона': `${own.monsterLevelRange.min}-${own.monsterLevelRange.max}`,
        'своя, зол/ч': Math.round(mine),
        'доля старта': `${((start / mine) * 100).toFixed(0)}%`,
      }
    })
    // eslint-disable-next-line no-console
    console.table(rows)
    expect(rows).toHaveLength(5)
  }, 900_000)

  it('дыра не расширяется: на двадцатом уровне старт не платит вдвое', () => {
    // Порог регрессии на саму дыру. Это ИЗВЕСТНО плохо, и правка формы кривой
    // не имеет права сделать хуже НЕЗАМЕТНО — заметно и с записанной причиной
    // имеет.
    //
    // ДОЛЯ ВЫРОСЛА 106% -> 132% С ПОЯВЛЕНИЕМ БРОНИ, и вот почему. Урон мобов
    // поднят вдвое с лишним ПОД броню, но полоса 1-5 из этого подъёма
    // исключена: её множитель привязан к произведению, чтобы новобранец без
    // брони получал ровно тот же удар, что и раньше (см. EARLY_HP_DISCOUNT).
    // Значит герой ДВАДЦАТОГО уровня приходит на стартовый луг в броне,
    // которая режет половину и без того не поднятого удара, — и мобы там
    // перестают задевать его вовсе. Свою зону он проходит с обычной ценой боя,
    // луг — вообще без простоя, и разрыв темпа растёт.
    //
    // Порог поднят 1.25 -> 1.40 ОДИН РАЗ и с этим объяснением. Дыра осталась
    // той же дырой: золото не знает штрафа за отставание, и решение о
    // частичном штрафе (предложение лежит в data/balance.ts рядом со штрафом
    // опыта) по-прежнему за владельцем.
    const own = zoneForMonsterLevel(20) ?? ZONES[0]
    const share =
      dump(
        `gold/income/${DEFAULT_CLASS.id}/zone-${ZONES[0].id}/level-020`,
        goldPerHour(20, DEFAULT_CLASS.id, ZONES[0].id),
      ) /
      dump(
        `gold/income/${DEFAULT_CLASS.id}/zone-own/level-020`,
        goldPerHour(20, DEFAULT_CLASS.id, own.id),
      )
    expect(dump(`gold/lagging-zone/${DEFAULT_CLASS.id}/level-020/start-share`, share)).toBeLessThan(
      1.4,
    )
  }, 900_000)
})


describe('пошлина крафта на настоящих ценах', () => {
  // Пересчёт контракта шага 7 на ЦЕНАХ, А НЕ НА ПЛЕЙСХОЛДЕРАХ. Пошлина
  // считается долей часового дохода по модели из данных, и «сорок процентов
  // часа» значит ровно это лишь до тех пор, пока модель совпадает с игрой.
  // Разъедется — и цены поедут молча, оставшись формально правильными.
  it('модель дохода из данных совпадает с прогоном', () => {
    const rows = [10, 20, 40, 60, 80, 100].map((level) => {
      const real = goldPerHour(level, DEFAULT_CLASS.id)
      const model = goldPerHourAt(level).toNumber()
      return { уровень: level, прогон: Math.round(real), модель: Math.round(model),
        расхождение: `${(((model - real) / real) * 100).toFixed(0)}%` }
    })
    // eslint-disable-next-line no-console
    console.table(rows)
    for (const level of [10, 20, 40, 60, 80, 100]) {
      const real = dump(
        `gold/income/${DEFAULT_CLASS.id}/zone-own/level-${String(level).padStart(3, '0')}`,
        goldPerHour(level, DEFAULT_CLASS.id),
      )
      // Модель дохода от класса не зависит — класса в ключе нет.
      const model = dump(
        `gold/income-model/level-${String(level).padStart(3, '0')}`,
        goldPerHourAt(level).toNumber(),
      )
      expect(
        dump(
          `gold/income-model/${DEFAULT_CLASS.id}/level-${String(level).padStart(3, '0')}/rel-error`,
          Math.abs(model - real) / real,
        ),
        `ур. ${level}`,
      ).toBeLessThan(0.3)
    }
  }, 900_000)

  it('печатает лестницу пошлин', () => {
    const rows = [...RECIPES]
      .sort((a, b) => recipeLevel(a) - recipeLevel(b))
      .map((r) => ({
        рецепт: r.name,
        'ур.': recipeLevel(r),
        пошлина: dump(`gold/craft-toll/${r.id}/gold`, craftToll(r).toNumber()),
        'часов дохода': (
          craftToll(r).div(goldPerHourAt(recipeLevel(r))).toNumber()
        ).toFixed(2),
      }))
    // eslint-disable-next-line no-console
    console.table(rows)
    expect(rows.length).toBe(RECIPES.length)
  })

  it('пошлина в ЧАСАХ одна и та же на всей лестнице', () => {
    // Это и есть «время до покупки не гуляет», только на настоящих ценах:
    // расходник стоит те же сорок процентов часа и на пятом уровне, и на
    // сотом. Растёт цена, а не срок.
    const hours = (kind: 'food' | 'potion' | 'item' | 'unique') =>
      RECIPES.filter((r) =>
        r.output.kind === 'item'
          ? (r.output.procId ? 'unique' : 'item') === kind
          : r.output.kind === kind,
      ).map((r) =>
        dump(
          `gold/craft-toll/${r.id}/hours`,
          craftToll(r).div(goldPerHourAt(recipeLevel(r))).toNumber(),
        ),
      )
    for (const kind of ['food', 'potion', 'item', 'unique'] as const) {
      const values = hours(kind)
      if (values.length === 0) continue
      expect(
        dump(`gold/craft-toll/kind-${kind}/hours-spread`, Math.max(...values) - Math.min(...values)),
        kind,
      ).toBeLessThan(0.01)
    }
  })
})
