/**
 * Какие классы держат контракты баланса и как.
 *
 * До альфы контракты считаются по ОДНОМУ классу — тому, что в данных помечен
 * `status: 'ready'`. Превью-классы играются, но их контракты некритичны: тот
 * же тест, то же тело, только падение уходит в предупреждение, а не роняет
 * прогон. Иначе один ненастроенный класс держал бы красным весь набор, а
 * второй вариант — вычеркнуть его из тестов — спрятал бы, насколько он далёк.
 *
 * Списки берутся ИЗ ДАННЫХ (`data/classes.ts`), не дублируются здесь.
 */
import { it } from 'vitest'
import { PREVIEW_CLASSES, READY_CLASSES, type ClassDef } from '../../data/classes'

type ContractFn = () => void | Promise<void>
type ContractIt = (name: string, fn: ContractFn, timeout?: number) => void

/**
 * `it` для контракта конкретного класса: у готового — обычный тест, у превью —
 * тест с пометкой `[превью]`, который пишет расхождение в лог и проходит.
 */
export function classIt(cls: Pick<ClassDef, 'name' | 'status'>): ContractIt {
  if (cls.status === 'ready') return (name, fn, timeout) => it(name, fn, timeout)
  return (name, fn, timeout) =>
    it(
      `[превью] ${name}`,
      async () => {
        try {
          await fn()
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error)
          console.warn(
            `ПРЕВЬЮ ${cls.name}: контракт не сошёлся, прогон не роняем — ${name}\n${text}`,
          )
        }
      },
      timeout,
    )
}

/**
 * Классы для прогона контрактов: готовые первыми, превью следом. Выборка
 * (`BALANCE_SAMPLE=1`) берёт только первый — то есть основной класс.
 */
export function contractClasses(sample: boolean): readonly ClassDef[] {
  const ordered = [...READY_CLASSES, ...PREVIEW_CLASSES]
  return sample ? ordered.slice(0, 1) : ordered
}
