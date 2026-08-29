// Как называется ресурс героя. Это ТЕКСТ, поэтому живёт в ui, а не в данных
// класса: данные говорят, что ресурс копится от ударов и тает вне боя, — а
// «ярость» это или «мана», вопрос языка, и решать его логике нечем.
//
// Без этого весь интерфейс называл маной ярость изувера: «18 маны» на кнопке
// умения, «Восст. маны» в статах, «Мана» на полоске. Число при этом было
// верное — врало только слово.
import { classById } from '../data/classes'

export interface ResourceWords {
  /** Именительный: заголовок полоски, название стата. */
  name: string
  /** Родительный: «18 ярости», «восст. ярости». */
  genitive: string
  /** Винительный: «беречь ману», «беречь ярость». */
  accusative: string
  /** Копится ли ресурс от ударов. У ярости да, у маны нет. */
  fromCombat: boolean
}

const WORDS: Record<string, Pick<ResourceWords, 'name' | 'genitive' | 'accusative'>> = {
  mana: { name: 'Мана', genitive: 'маны', accusative: 'ману' },
  rage: { name: 'Ярость', genitive: 'ярости', accusative: 'ярость' },
}

export function resourceWords(classId: string | undefined | null): ResourceWords {
  const resource = classById(classId).resource
  const words = WORDS[resource.kind] ?? WORDS.mana
  return {
    ...words,
    fromCombat: resource.perSwingDealt.gt(0) || resource.perHitTaken.gt(0),
  }
}

/** Имя ресурса по его виду — для выбора класса, где героя ещё нет. */
export function resourceKindName(kind: string): string {
  return WORDS[kind]?.name ?? kind
}
