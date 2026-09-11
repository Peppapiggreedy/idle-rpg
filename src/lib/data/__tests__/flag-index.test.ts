// ИНДЕКС ТАЛАНТОВ ПО ФЛАГУ — ЭТО КЕШ, А У КЕША ОБЯЗАН БЫТЬ СТОРОЖ.
//
// Он заведён ради скорости: вопрос «у кого флаг X» задаётся в горячем пути —
// замена умения решается на каждое умение каждого тика, проки и перенос метки
// на каждый тик, — и обход всех двухсот пятидесяти талантов там стоил тику
// сорока процентов времени. Но кеш, отдающий не то же самое, что обход, —
// это тихо неверная игра, а не быстрая. Поэтому здесь проверяется РАВЕНСТВО
// ОБХОДУ, а не просто «что-то возвращается».
import { describe, expect, it } from 'vitest'
import { TALENTS, flagsInTree, talentsWithFlag, type TalentFlag } from '../talents'

/** Честный обход — то, чем индекс был до оптимизации. */
function byScan(flag: TalentFlag) {
  return TALENTS.filter((t) => t.effect.kind === 'flag' && t.effect.flag === flag)
}

describe('индекс талантов по флагу', () => {
  it('совпадает с обходом дерева — и по составу, И ПО ПОРЯДКУ', () => {
    const flags = [...flagsInTree()]
    expect(flags.length).toBeGreaterThan(0)
    for (const flag of flags) {
      // ПОРЯДОК ВАЖЕН НЕ МЕНЬШЕ СОСТАВА: `flagPayload` отдаёт ПЕРВЫЙ взятый
      // талант с этим флагом, и переставь индекс два таланта местами — игрок
      // молча получил бы числа другого узла.
      expect(talentsWithFlag(flag).map((t) => t.id), flag).toEqual(byScan(flag).map((t) => t.id))
    }
  })

  it('флаги дерева — ровно те, что стоят на талантах', () => {
    const scanned = new Set(
      TALENTS.flatMap((t) => (t.effect.kind === 'flag' ? [t.effect.flag] : [])),
    )
    expect(new Set(flagsInTree())).toEqual(scanned)
  })

  it('пустой ответ у флага, которого в дереве нет', () => {
    expect(talentsWithFlag('нет-такого-флага' as TalentFlag)).toEqual([])
  })

  /**
   * БИТЫЙ ОБРАЗЕЦ — ПРОТУХШИЙ КЕШ. Наборы поломанных данных дописывают свои
   * таланты в дерево прямо в прогоне (`talents.test.ts`, `abilityTune.test.ts`),
   * и индекс, построенный один раз навсегда, отдавал бы им дерево без их же
   * таланта. Проверяется это ровно так же: дописали — обязан увидеть.
   */
  it('видит талант, дописанный в дерево на ходу', () => {
    const flag: TalentFlag = 'proc'
    const before = talentsWithFlag(flag).length
    const fake = { ...byScan(flag)[0], id: 'сторож-протухшего-кеша' }
    TALENTS.push(fake)
    try {
      expect(talentsWithFlag(flag).length, 'индекс не заметил нового таланта').toBe(before + 1)
      expect(talentsWithFlag(flag).some((t) => t.id === fake.id)).toBe(true)
    } finally {
      TALENTS.splice(TALENTS.indexOf(fake), 1)
    }
    expect(talentsWithFlag(flag).length, 'индекс не вернулся к прежнему дереву').toBe(before)
  })
})
