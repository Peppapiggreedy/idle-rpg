// ПРОГОН ПОЛНОГО ПУТИ: с первого уровня до сотого, одним героем, без пауз.
//
// Чем он отличается от таблицы темпа (balance.test.ts). Та мерит СРЕЗЫ:
// замороженный герой в эталонной экипировке против мобов своей полосы —
// прибор точный, но он не знает, как игрок доходит от среза к срезу. Этот
// прогон мерит ПУТЬ: одна непрерывная игра, где вещи приходят настоящим
// дропом, надеваются моделью игрока и остаются с героем дальше.
//
// Своей модели боя здесь нет и здесь: крутится тот же `tick`. Всё, что
// добавлено сверх него, — модель ИГРОКА: после каждой находки герой
// разбирает сумку и надевает то, что поднимает темп, а на новом уровне
// переезжает в полосу, которая ему по силам.
import { describe, expect, it } from 'vitest'
import { LEVEL_CAP, RUN_SEEDS } from '../../data/balance'
import { CLASSES, READY_CLASSES } from '../../data/classes'
import { classIt, contractClasses } from './class-set'
import { dump } from './dump'
import { RUN_BANDS, simulateRun, type RunResult } from '../simulate'

/** Сколько убийств стоит весь путь. Число выводится из KILLS_PER_LEVEL, и
 *  коридор широкий намеренно: он ловит грубую ошибку в таблице, а не шум. */
const KILLS_MIN = 4700
const KILLS_MAX = 5400
/**
 * Потолок доли времени на привалах: игра про бой, а не про отсидку.
 *
 * 0.40 вместо прежних 0.25 — прямая цена контракта цены боя, и она измерена,
 * а не назначена. Бой стоит 20-25% запаса, порог привала стоит выше ХУДШЕГО
 * боя зоны (0.6, иначе герой гибнет), а привал — фиксированной длины и лечит
 * досуха. Отсюда цикл: два-три боя, привал. Замер по всему пути — 32.9%
 * (Страж) и 35.9% (Изувер) против 0.3-1.0% до правки, когда бой не стоил
 * ничего и отдыхать было не от чего.
 *
 * ОПУСТИТЬ ЭТУ ДОЛЮ МОЖНО, но каждая ручка стоит своего: порог 0.5 даёт
 * 28.8/34.4% привала ценой 1.4-2.0 смертей в час, порог 0.4 — 28.7/25.3%
 * ценой 2.1-3.5 смертей в час. Обе цифры выше контракта «путь идёт без
 * смертей», поэтому по умолчанию оставлен безопасный порог. Третья ручка —
 * длина самого привала — намеренно не тронута: она фиксирована по замыслу.
 */
const REST_SHARE_MAX = 0.4
/** Сколько игровых часов даём прогону, прежде чем считать путь непроходимым. */
const RUN_HOURS_CAP = 30
/**
 * Во сколько раз доля ВРЕМЕНИ полосы может превышать её долю УРОВНЕЙ.
 * 1.7: замер даёт 1.50 на самой дорогой полосе (90-100 у Стража) против 1.29
 * до правки цены боя — привал добавил времени неравномерно, дороже всего там,
 * где мобы бьют сильнее всего. Запас оставлен под обычный разброс, а не под
 * провал. Провал — это когда полоса стоит вдвое дороже своей ширины, и он
 * этим порогом по-прежнему ловится.
 */
const BAND_SHARE_MAX = 1.7

/**
 * БЫСТРЫЙ РЕЖИМ: `BALANCE_SAMPLE=1` — тот же флаг, что у таблицы баланса.
 * Путь проходит ОДИН класс вместо двух. Ассерты те же самые: потолок, цена
 * пути, привал, смерти, доля полосы. Сравнение классов между собой при этом
 * проверить нечем — этот тест в выборке пропускается, а не ослабляется.
 */
const SAMPLE = process.env.BALANCE_SAMPLE === '1'
// Готовые классы первыми, превью следом; выборка — только основной класс.
// Контракты превью-класса некритичны: см. `class-set.ts`.
const CLASS_SET = contractClasses(SAMPLE)

/**
 * СИДЫ — ВСЕ ТРИ, ВСЕГДА. Раньше три гонялись только ночью
 * (`RUN_ALL_SEEDS=1`), а везде ещё — первый, «потому что путь стоит минуты».
 * Два довода сняли это разделение.
 *
 * ПЕРВЫЙ: С ОДНИМ СИДОМ МЕДИАНА — НЕ МЕДИАНА. Ассерты ниже написаны по
 * медиане намеренно: путь зависит от ранней рулетки находок, и один
 * неудачный сид — это невезение, а не сломанный баланс. При одном сиде
 * медиана равна ему самому, то есть защита, ради которой её и завели, в
 * пробе не работает вовсе. Ловится это ровно тогда, когда мешает: правка,
 * двигающая числа на доли процента, перекидывает решение модели игрока с
 * одной связки на другую, и один сид уходит в полтора раза, пока два
 * других стоят на месте.
 *
 * ВТОРОЙ: ЦЕНА ИЗМЕРЕНА И ОНА БОЛЬШЕ НЕ «МИНУТЫ». Замер на четырёх ядрах
 * после оптимизации матрицы: один сид — 36 с, три — 108 с. Семьдесят
 * секунд на пробу, которая идёт три с половиной минуты, — это не та
 * экономия, ради которой стоит держать в проверке медиану из одного числа.
 *
 * Список сидов и объяснение выбора — в `data/balance.ts`.
 */
const SEEDS = [...RUN_SEEDS]

const runs = new Map<string, RunResult[]>()
/** Прогоны класса по всем сидам запуска; считаются один раз и кешируются. */
function runsOf(classId: string): RunResult[] {
  const cached = runs.get(classId)
  if (cached) return cached
  const result = SEEDS.map((seed) => simulateRun({ classId, maxHours: RUN_HOURS_CAP, seed }))
  runs.set(classId, result)
  return result
}

/**
 * МЕДИАНА, А НЕ СРЕДНЕЕ. Путь зависит от ранней рулетки находок, и один
 * неудачный сид уводит среднее туда, где игры нет; медиана его переживает.
 * При одном сиде медиана — он сам.
 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Медиана метрики по сидам класса. */
function medianOf(classId: string, pick: (r: RunResult) => number): number {
  return median(runsOf(classId).map(pick))
}

/** Строка «4242: 10.74 | 7: 11.02 | 1234: 10.94» — чтобы выпавший сид было видно. */
function bySeed(classId: string, pick: (r: RunResult) => number, digits = 2): string {
  return runsOf(classId)
    .map((r, i) => `${SEEDS[i]}: ${pick(r).toFixed(digits)}`)
    .join(' | ')
}

/** Первый сид: по нему печатаются таблицы полос — они про форму, не про итог. */
function run(classId: string): RunResult {
  return runsOf(classId)[0]
}

// КЛЮЧИ ОТПЕЧАТКА СТРОЯТСЯ ИЗ КООРДИНАТ ЗАМЕРА — сид, класс, полоса, — а не из
// имени теста: разбиение циклов на it.each переименует тесты, но не данные.
/** Сид в ключе: с ведущими нулями, чтобы `seed-0007` сортировался рядом с `seed-4242`. */
function seedTag(seed: number): string {
  return `seed-${String(seed).padStart(4, '0')}`
}

/** Приставка ключа для конкретного прогона: сид RunResult не несёт, берём его по месту в SEEDS. */
function seedKey(classId: string, r: RunResult): string {
  return `run/${seedTag(SEEDS[runsOf(classId).indexOf(r)])}/${classId}`
}

/** Полоса — по границам, а не по подписи: `band-001-009` сортируется сам. */
function bandKey(band: { from: number; to: number }): string {
  return `band-${String(band.from).padStart(3, '0')}-${String(band.to).padStart(3, '0')}`
}

describe('полный путь 1..100', () => {
  it('таблица пути', () => {
    for (const cls of CLASS_SET) {
      const r = run(cls.id)
      const rows = RUN_BANDS.map((band) => {
        const levels = r.levels.filter((x) => x.level >= band.from && x.level <= band.to)
        const kills = levels.reduce((n, x) => n + x.kills, 0)
        const seconds = levels.reduce((n, x) => n + x.seconds, 0)
        return {
          полоса: band.label,
          убийств: dump(`${seedKey(cls.id, r)}/${bandKey(band)}/kills`, kills),
          часов: Number((seconds / 3600).toFixed(2)),
          'с/убийство': Number((seconds / Math.max(1, kills)).toFixed(1)),
        }
      })
      // eslint-disable-next-line no-console
      console.log(
        `${cls.name}: уровень ${r.finalLevel}, убийств ${r.totalKills}, ` +
          `часов ${dump(`${seedKey(cls.id, r)}/total-hours`, r.totalHours).toFixed(2)}, ` +
          `привал ${(r.restShare * 100).toFixed(1)}%, ` +
          `смертей/ч ${r.deathsPerHour.toFixed(2)}, ` +
          `решение раз в ${r.decisionIntervalSec?.toFixed(0) ?? '—'} с`,
      )
      // ВСЕ СИДЫ И МЕДИАНА — чтобы выпавший сид было видно, а не только итог.
      // eslint-disable-next-line no-console
      console.log(
        `${cls.name}: часов по сидам — ${bySeed(cls.id, (x) => x.totalHours)} ` +
          `(медиана ${medianOf(cls.id, (x) => x.totalHours).toFixed(2)}); ` +
          `убийств — ${bySeed(cls.id, (x) => x.totalKills, 0)} ` +
          `(медиана ${medianOf(cls.id, (x) => x.totalKills).toFixed(0)}); ` +
          `смертей/ч — ${bySeed(cls.id, (x) => x.deathsPerHour)} ` +
          `(медиана ${medianOf(cls.id, (x) => x.deathsPerHour).toFixed(2)})`,
      )
      // eslint-disable-next-line no-console
      console.table(rows)
      expect(rows).toHaveLength(RUN_BANDS.length)
    }
  }, 1_800_000)

  for (const cls of CLASS_SET) {
    classIt(cls)(
      `${cls.name} доходит до потолка`,
      () => {
        const classId = cls.id
        // Главное свойство конечной игры: конец достижим. И достижим он ОБОИМ
        // классам — путь один, а не «страж как-нибудь, а изувер по-настоящему».
        // Потолок обязан браться на КАЖДОМ сиде: «дойти до конца» — не то
        // свойство, которое можно усреднять.
        for (const r of runsOf(classId)) {
          expect(r.reachedCap, `${classId} застрял на ${r.finalLevel} уровне`).toBe(true)
          expect(dump(`${seedKey(classId, r)}/final-level`, r.finalLevel)).toBe(LEVEL_CAP)
        }
      },
      1_800_000,
    )
  }

  for (const cls of CLASS_SET) {
    classIt(cls)(
      `${cls.name}: путь стоит 4700-5400 убийств`,
      () => {
        const classId = cls.id
        // Цена пути задана ТАБЛИЦЕЙ (KILLS_PER_LEVEL), и прогон обязан её
        // подтверждать: разойдутся — значит опыт считается не по таблице.
        const kills = medianOf(classId, (x) => dump(`${seedKey(classId, x)}/total-kills`, x.totalKills))
        // eslint-disable-next-line no-console
        console.log(`${classId}: убийств по сидам ${bySeed(classId, (x) => x.totalKills, 0)}`)
        expect(dump(`run/median/${classId}/total-kills`, kills)).toBeGreaterThanOrEqual(KILLS_MIN)
        expect(dump(`run/median/${classId}/total-kills`, kills)).toBeLessThanOrEqual(KILLS_MAX)
      },
      1_800_000,
    )
  }

  for (const cls of CLASS_SET) {
    classIt(cls)(
      `${cls.name}: привал не съедает игру, и путь идёт без смертей`,
      () => {
        const classId = cls.id
        // Привал — плата за глубину, а не занятие. Смерти на СВОЕЙ полосе быть
        // не должно вовсе: игрок, который идёт по лестнице и надевает найденное,
        // не обязан умирать ни разу.
        // По МЕДИАНЕ: один неудачный сид — это невезение рулетки находок, а
        // не сломанный баланс (см. RUN_SEEDS в data/balance.ts).
        expect(
          dump(
            `run/median/${classId}/rest-share`,
            medianOf(classId, (x) => dump(`${seedKey(classId, x)}/rest-share`, x.restShare)),
          ),
        ).toBeLessThanOrEqual(REST_SHARE_MAX)
        expect(
          dump(
            `run/median/${classId}/deaths-per-hour`,
            medianOf(classId, (x) => dump(`${seedKey(classId, x)}/deaths-per-hour`, x.deathsPerHour)),
          ),
        ).toBeLessThan(1)
      },
      1_800_000,
    )
  }

  for (const cls of CLASS_SET) {
    classIt(cls)(
      `${cls.name}: ни одна полоса не съедает времени НЕ ПО СВОЕЙ ШИРИНЕ`,
      () => {
        const classId = cls.id
        // Провал в лестнице виден именно так: одна полоса вдруг стоит дороже,
        // чем ей отведено уровней. Так выглядела бы дыра в кривой опыта или
        // ступень, на которой герой перестал находить вещи.
        //
        // МЕРА — ДОЛЯ УРОВНЕЙ, А НЕ ПОЛОВИНА ПУТИ. Здесь стояло «меньше
        // половины всего времени», и для полосы 10-59 это было почти
        // тавтологией: она сама занимает 50 уровней из 99, то есть половину
        // лестницы по построению. Порог держался только за счёт того, что
        // полоса 1-9 шла медленно, — а она шла медленно потому, что игра
        // дарила герою полный комплект и он тратил первые уровни впустую.
        // Убрали подарок — и «половина» стала срабатывать на ровном месте,
        // хотя время на уровень по полосам идёт как надо: 0.097 часа на
        // уровень в 10-59, 0.110 в 60-89, 0.123 в 90-100.
        //
        // Новая мера строже старой там, где это важно: узкая полоса, съевшая
        // втрое больше своей ширины, раньше проходила незамеченной.
        const r = run(classId)
        const total = Object.values(r.bandHours).reduce((sum, h) => sum + h, 0)
        const ladder = LEVEL_CAP - 1
        for (const band of RUN_BANDS) {
          const hours = dump(`${seedKey(classId, r)}/${bandKey(band)}/hours`, r.bandHours[band.label] ?? 0)
          const levelShare = (Math.min(band.to, LEVEL_CAP) - band.from + 1) / ladder
          const timeShare = hours / total
          expect(
            dump(`${seedKey(classId, r)}/${bandKey(band)}/share-ratio`, timeShare / levelShare),
            `${classId}, полоса ${band.label}: ${(timeShare * 100).toFixed(1)}% времени ` +
              `на ${(levelShare * 100).toFixed(1)}% уровней`,
          ).toBeLessThan(BAND_SHARE_MAX)
        }
      },
      1_800_000,
    )
  }

  // Сравнение классов между собой требует ОБОИХ: в выборке класс один,
  // и проверять нечего — тест пропускается целиком, а не смягчается.
  // Пока готов один класс, сравнение — контракт превью-класса: оно печатает
  // разрыв и роняет прогон только тогда, когда готовы оба.
  const comparison = READY_CLASSES.length === CLASSES.length ? it : classIt(CLASSES[CLASSES.length - 1])
  comparison.call(null, 'классы проходят путь за сопоставимое время', () => {
    if (SAMPLE) return
    // Не «одинаково», а сопоставимо: разница в четверть — это выбор стиля,
    // разница в разы — это сломанный класс. Ровно так и выглядел страж до
    // того, как сравнение предметов стало считать темп, а не голый урон:
    // он застревал на шестьдесят четвёртом уровне.
    const hours = CLASSES.map((c) =>
      dump(`run/${seedTag(SEEDS[0])}/${c.id}/total-hours`, run(c.id).totalHours),
    )
    const min = Math.min(...hours)
    const max = Math.max(...hours)
    console.log(`Разрыв по времени пути между классами: ${((max - min) / min * 100).toFixed(0)}%`)
    expect(dump(`run/${seedTag(SEEDS[0])}/classes/total-hours-gap`, (max - min) / min)).toBeLessThan(0.4)
  }, 1_800_000)
})
