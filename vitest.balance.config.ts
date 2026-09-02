import { defineConfig } from 'vitest/config'
import { BaseSequencer, type TestSpecification } from 'vitest/node'

/**
 * ПОРЯДОК ФАЙЛОВ РЕШАЕТ БОЛЬШЕ, ЧЕМ ЧИСЛО ПОТОКОВ.
 *
 * Vitest по умолчанию ставит файлы в очередь ПО РАЗМЕРУ В БАЙТАХ, считая, что
 * файл побольше и работы даст побольше. После разрезания это обернулось против
 * нас ровно наоборот: самый дорогой тест матрицы (867 с, «три чистых билда»)
 * лежит в самом МАЛЕНЬКОМ файле (3.7 КБ) и уезжал в конец очереди. Четыре
 * потока честно занимались, но последние четверть часа три из них простаивали,
 * пока доигрывал единственный длинный файл: стена 1720 с при сумме работ
 * 3294 с, то есть параллелизм 1.9 из возможных 4.
 *
 * Стоимости взяты из профиля (docs/PERF-REPORT.md) и на ИТОГ НЕ ВЛИЯЮТ — это
 * подсказка очереди, а не число баланса. Разъедутся с правдой — прогон просто
 * станет чуть длиннее; неизвестный файл идёт первым, потому что о новом файле
 * безопаснее думать как о дорогом.
 */
const COST_SECONDS: Record<string, number> = {
  'balance-talents.test.ts': 867,
  'balance-progress.test.ts': 577,
  'balance-talents-style.test.ts': 486,
  'balance-zones.test.ts': 483,
  'run.test.ts': 204,
  'gold.test.ts': 197,
  'balance-pacing.test.ts': 182,
  'balance-model.test.ts': 160,
  'balance-style.test.ts': 113,
  'power-budget.test.ts': 24,
  'level-gap.test.ts': 1,
}

const costOf = (path: string): number => {
  const name = path.split('/').pop() ?? path
  return COST_SECONDS[name] ?? Number.MAX_SAFE_INTEGER
}

class LongestFirstSequencer extends BaseSequencer {
  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((a, b) => costOf(b.moduleId) - costOf(a.moduleId))
  }
}

/**
 * КОНФИГ ТОЛЬКО ДЛЯ БАЛАНСНОЙ МАТРИЦЫ. Отдельный от общего намеренно: здесь
 * стоят настройки, которые быстрому набору не нужны и даже вредны, — своя
 * раскладка по потокам и выключенная изоляция модулей.
 *
 * ПОЧЕМУ ЭТО ВООБЩЕ ПОНАДОБИЛОСЬ. Профиль показал, что раннер раскладывает
 * по ядрам ФАЙЛЫ, а не тесты, а 87 % времени матрицы лежало в одном файле
 * (balance.test.ts, 2588 с из 2968 с). Крутить maxThreads было бессмысленно:
 * параллелить нечего. Поэтому файл разрезан по областям контрактов, и вот
 * тогда настройки пула начинают что-то значить.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/lib/game/__tests__/power-budget.test.ts',
      'src/lib/game/__tests__/balance-*.test.ts',
      'src/lib/game/__tests__/run.test.ts',
      'src/lib/game/level-gap.test.ts',
      'src/lib/game/__tests__/gold.test.ts',
    ],
    // Прогон баланса печатает таблицы — они нужны в выводе как есть.
    disableConsoleIntercept: true,
    // Потоки, а не процессы: старт дешевле, а изоляция всё равно снята ниже.
    pool: 'threads',
    fileParallelism: true,
    // В vitest 4 число воркеров задаётся одним полем, без poolOptions.
    maxWorkers: 4,
    /**
     * ИЗОЛЯЦИЯ СНЯТА, и это главная настройка файла. `referenceBuild` кеширует
     * эталонное прохождение в модуле (pacingTable — 71 с на Стража и 101 с на
     * Изувера), а при isolate: true у каждого файла свой реестр модулей, и одна
     * и та же детерминированная таблица считалась заново в каждом. Со снятой
     * изоляцией файлы одного воркера делят кеш.
     *
     * Законно это потому, что делить тут нечего, кроме кешей чистых функций:
     * ни один модуль игры не хранит изменяемого состояния (проверено обходом
     * всех модулей на пути estimateCombatRate). Проверяется это не рассуждением,
     * а балансным отпечатком: он совпал побитово, все 1853 величины.
     */
    isolate: false,
    // Длинные файлы первыми — иначе очередь по размеру ставит самый дорогой
    // тест матрицы в конец и три потока простаивают (см. комментарий выше).
    sequence: { sequencer: LongestFirstSequencer },
  },
})
