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
import { LEVEL_CAP } from '../../data/balance'
import { CLASSES } from '../../data/classes'
import { RUN_BANDS, simulateRun, type RunResult } from '../simulate'

/** Сколько убийств стоит весь путь. Число выводится из KILLS_PER_LEVEL, и
 *  коридор широкий намеренно: он ловит грубую ошибку в таблице, а не шум. */
const KILLS_MIN = 4700
const KILLS_MAX = 5400
/** Потолок доли времени на привалах: игра про бой, а не про отсидку. */
const REST_SHARE_MAX = 0.25
/** Сколько игровых часов даём прогону, прежде чем считать путь непроходимым. */
const RUN_HOURS_CAP = 30

const runs = new Map<string, RunResult>()
function run(classId: string): RunResult {
  const cached = runs.get(classId)
  if (cached) return cached
  const result = simulateRun({ classId, maxHours: RUN_HOURS_CAP, seed: 4242 })
  runs.set(classId, result)
  return result
}

describe('полный путь 1..100', () => {
  it('таблица пути', () => {
    for (const cls of CLASSES) {
      const r = run(cls.id)
      const rows = RUN_BANDS.map((band) => {
        const levels = r.levels.filter((x) => x.level >= band.from && x.level <= band.to)
        const kills = levels.reduce((n, x) => n + x.kills, 0)
        const seconds = levels.reduce((n, x) => n + x.seconds, 0)
        return {
          полоса: band.label,
          убийств: kills,
          часов: Number((seconds / 3600).toFixed(2)),
          'с/убийство': Number((seconds / Math.max(1, kills)).toFixed(1)),
        }
      })
      // eslint-disable-next-line no-console
      console.log(
        `${cls.name}: уровень ${r.finalLevel}, убийств ${r.totalKills}, ` +
          `часов ${r.totalHours.toFixed(2)}, привал ${(r.restShare * 100).toFixed(1)}%, ` +
          `смертей/ч ${r.deathsPerHour.toFixed(2)}, ` +
          `решение раз в ${r.decisionIntervalSec?.toFixed(0) ?? '—'} с`,
      )
      // eslint-disable-next-line no-console
      console.table(rows)
      expect(rows).toHaveLength(RUN_BANDS.length)
    }
  }, 1_800_000)

  it.each(CLASSES.map((c) => [c.name, c.id] as const))(
    '%s доходит до потолка',
    (_name, classId) => {
      // Главное свойство конечной игры: конец достижим. И достижим он ОБОИМ
      // классам — путь один, а не «страж как-нибудь, а изувер по-настоящему».
      const r = run(classId)
      expect(r.reachedCap, `${classId} застрял на ${r.finalLevel} уровне`).toBe(true)
      expect(r.finalLevel).toBe(LEVEL_CAP)
    },
    1_800_000,
  )

  it.each(CLASSES.map((c) => [c.name, c.id] as const))(
    '%s: путь стоит 4700-5400 убийств',
    (_name, classId) => {
      // Цена пути задана ТАБЛИЦЕЙ (KILLS_PER_LEVEL), и прогон обязан её
      // подтверждать: разойдутся — значит опыт считается не по таблице.
      const r = run(classId)
      expect(r.totalKills).toBeGreaterThanOrEqual(KILLS_MIN)
      expect(r.totalKills).toBeLessThanOrEqual(KILLS_MAX)
    },
    1_800_000,
  )

  it.each(CLASSES.map((c) => [c.name, c.id] as const))(
    '%s: привал не съедает игру, и путь идёт без смертей',
    (_name, classId) => {
      // Привал — плата за глубину, а не занятие. Смерти на СВОЕЙ полосе быть
      // не должно вовсе: игрок, который идёт по лестнице и надевает найденное,
      // не обязан умирать ни разу.
      const r = run(classId)
      expect(r.restShare).toBeLessThanOrEqual(REST_SHARE_MAX)
      expect(r.deathsPerHour).toBeLessThan(1)
    },
    1_800_000,
  )

  it.each(CLASSES.map((c) => [c.name, c.id] as const))(
    '%s: ни одна полоса не съедает больше половины пути',
    (_name, classId) => {
      // Провал в лестнице виден именно так: одна полоса вдруг стоит дороже
      // всех остальных вместе. Так выглядела бы дыра в кривой опыта или
      // ступень, на которой герой перестал находить вещи.
      const r = run(classId)
      const total = Object.values(r.bandHours).reduce((sum, h) => sum + h, 0)
      for (const [label, hours] of Object.entries(r.bandHours)) {
        expect(hours, `${classId}, полоса ${label}`).toBeLessThan(total * 0.5)
      }
    },
    1_800_000,
  )

  it('оба класса проходят путь за сопоставимое время', () => {
    // Не «одинаково», а сопоставимо: разница в четверть — это выбор стиля,
    // разница в разы — это сломанный класс. Ровно так и выглядел страж до
    // того, как сравнение предметов стало считать темп, а не голый урон:
    // он застревал на шестьдесят четвёртом уровне.
    const hours = CLASSES.map((c) => run(c.id).totalHours)
    const min = Math.min(...hours)
    const max = Math.max(...hours)
    expect((max - min) / min).toBeLessThan(0.4)
  }, 1_800_000)
})
