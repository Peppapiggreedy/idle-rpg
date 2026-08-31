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
import { CLASSES } from '../../data/classes'
import { LEVEL_CAP } from '../../data/balance'
import { MONSTER_GROWTH } from '../../data/monsters'

const STEP = 10
const LEVELS = Array.from({ length: 1 + (LEVEL_CAP - STEP) / STEP }, (_, i) => STEP + i * STEP)

/**
 * ПЛЕЙСХОЛДЕРНЫЕ ЦЕНЫ ЛЕСТНИЦЫ ПОКУПОК.
 *
 * Самой лестницы ещё нет, но её форма известна из решения по экономике: семь
 * ступеней, цена последней в 48 раз выше первой. Этого хватает, чтобы мерить
 * главное свойство — время до покупки, — не дожидаясь настоящих цен.
 */
const LADDER_RUNGS = 7
const LADDER_PRICE_GROWTH = 48
const RUNG_LEVELS = Array.from({ length: LADDER_RUNGS }, (_, i) =>
  Math.round(STEP + ((LEVEL_CAP - STEP) * i) / (LADDER_RUNGS - 1)),
)

function goldPerHour(level: number, classId: string, zoneId?: string): number {
  const zone = zoneForMonsterLevel(level) ?? ZONES[0]
  return simulate({
    hours: 1,
    zoneId: zoneId ?? zone.id,
    freezeLevel: true,
    build: referenceBuild(level, classId),
    seed: 4242,
  }).goldPerHour.toNumber()
}

describe('кран золота', () => {
  const income = new Map(
    CLASSES.map((cls) => [cls.id, LEVELS.map((level) => goldPerHour(level, cls.id))] as const),
  )

  it('печатает кривую дохода', () => {
    for (const cls of CLASSES) {
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
    expect(income.size).toBe(CLASSES.length)
  }, 900_000)

  it.each(CLASSES.map((c) => [c.name, c.id] as const))(
    '%s: доход растёт на каждой ступени — плато нет нигде',
    (_name, classId) => {
      const values = income.get(classId)!
      for (let i = 1; i < values.length; i += 1) {
        expect(values[i], `ур. ${LEVELS[i]}`).toBeGreaterThan(values[i - 1])
      }
    },
  )

  it.each(CLASSES.map((c) => [c.name, c.id] as const))(
    '%s: рост не проваливается и не выстреливает',
    (_name, classId) => {
      // ПОРОГ РЕГРЕССИИ, а не цель. Цель — ровный рост (разброс около 1.2),
      // и она недостижима, пока открыта дыра отстающей зоны: см. отдельный
      // тест-арифметику ниже. Здесь заперта нынешняя форма, чтобы она не
      // поехала дальше.
      const values = income.get(classId)!
      const ratios = values.slice(1).map((v, i) => v / values[i])
      expect(Math.min(...ratios), 'самая пологая ступень').toBeGreaterThan(1.1)
      expect(Math.max(...ratios), 'самая крутая ступень').toBeLessThan(2.35)
      expect(Math.max(...ratios) / Math.min(...ratios), 'разброс').toBeLessThan(2)
    },
  )

  it.each(CLASSES.map((c) => [c.name, c.id] as const))(
    '%s: время до следующей покупки не гуляет больше чем втрое',
    (_name, classId) => {
      const perRung = Math.pow(LADDER_PRICE_GROWTH, 1 / (LADDER_RUNGS - 1))
      const hours = RUNG_LEVELS.map(
        (level, i) => Math.pow(perRung, i) / goldPerHour(level, classId),
      )
      const relative = hours.map((h) => h / hours[0])
      // eslint-disable-next-line no-console
      console.log(
        `${classId}: время до покупки по ступеням — ` +
          relative.map((r, i) => `ур.${RUNG_LEVELS[i]}:${r.toFixed(2)}`).join(' '),
      )
      expect(Math.max(...relative) / Math.min(...relative)).toBeLessThan(3)
    },
    900_000,
  )

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
      expect(flatter.spread, `наклон ${points[i - 1]} против ${points[i]}`).toBeLessThan(
        steeper.spread,
      )
      expect(flatter.share, `доля стартовой зоны при наклоне ${points[i - 1]}`).toBeGreaterThan(
        steeper.share,
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
      const start = goldPerHour(level, 'warden', ZONES[0].id)
      const mine = goldPerHour(level, 'warden', own.id)
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
    // Порог регрессии на саму дыру. Сейчас доля около 106%: стартовая зона
    // примерно равна своей. Это уже плохо — но это ИЗВЕСТНО плохо, и правка
    // формы кривой не имеет права сделать хуже незаметно.
    const own = zoneForMonsterLevel(20) ?? ZONES[0]
    const share = goldPerHour(20, 'warden', ZONES[0].id) / goldPerHour(20, 'warden', own.id)
    expect(share).toBeLessThan(1.25)
  }, 900_000)
})
