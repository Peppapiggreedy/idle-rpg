// КУДА МОЖНО ПОЛОЖИТЬ УМЕНИЕ, КОТОРОЕ НЕСЁШЬ. Чистая функция, общая на все
// пути переноса — как `dropTarget.ts` у предметов, и по той же причине.
//
// Путей четыре: перетаскивание мышью, «нажал умение → нажал слот», обратный
// перенос из слота в книгу и перестановка слот↔слот. Решать «можно ли сюда»
// каждый из них обязан ОДИНАКОВО, иначе они разъедутся на первой же правке
// правил — ровно так, как разъехались раньше: книга носила умение в своей
// локальной переменной, ряд действий в своей, и на тач-экране порядок слотов
// не менялся вовсе.
//
// ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ МОДУЛЬ, А НЕ ПРОВЕРКА ВНУТРИ ЭКШЕНА. `setAbilitySlot`
// правило знает и молча возвращает прежнее состояние — интерфейсу этого мало:
// он обязан ПОДСВЕТИТЬ цель и НАЗВАТЬ причину ДО попытки, а не после неё.
// Логика отдаёт факт (уровень героя, уровень открытия), слово подставляет UI.
import type { AbilityDef } from '../data/abilities'
import type { AbilityCarry } from '../stores/ui'

/** Куда бросают. Двух целей достаточно: ряд слотов и сама книга. */
export type AbilityTarget = { kind: 'slot'; index: number } | { kind: 'book' }

/**
 * ПОЧЕМУ НЕЛЬЗЯ — КОДОМ, А НЕ ТЕКСТОМ.
 *
 *   'locked'    — умение ещё не открыто по уровню героя;
 *   'same-spot' — бросили туда же, откуда взяли: не отказ, а пустое действие,
 *                 но путям надо отличать его от разрешённого переноса.
 */
export type AbilityDropRefusal = 'locked' | 'same-spot'

export interface AbilityDropOutcome {
  /**
   * Цель ВООБЩЕ про это умение — подсвечивается. Отдельно от `allowed` по
   * той же причине, что у куклы: цель, которая подходит, но сейчас занята
   * или запрещена, обязана остаться подсвеченной и получить строку с
   * причиной, а не молча потухнуть.
   */
  fits: boolean
  /** Можно положить прямо сейчас. */
  allowed: boolean
  /** Код отказа; слово подставляет `ui/abilityText.ts`. */
  reason: AbilityDropRefusal | null
}

const NOTHING: AbilityDropOutcome = { fits: false, allowed: false, reason: null }

export interface AbilityDropContext {
  /** Уровень героя — единственное, что решает доступность умения. */
  heroLevel: number
  /** Справочник умений класса: по id находим уровень открытия. */
  byId: Record<string, AbilityDef | undefined>
}

/**
 * Можно ли положить несомое умение в эту цель.
 *
 * ПУСТАЯ РУКА — НЕ ОТКАЗ, А ОТСУТСТВИЕ ВОПРОСА: цель не подсвечивается и
 * причины не показывает.
 */
export function abilityDropStatus(
  carry: AbilityCarry | null,
  target: AbilityTarget,
  ctx: AbilityDropContext,
): AbilityDropOutcome {
  if (carry === null) return NOTHING

  const ability = ctx.byId[carry.abilityId]
  if (!ability) return NOTHING

  // ЗАПЕРТОЕ УРОВНЕМ НЕ КЛАДЁТСЯ НИКУДА, и это единственный настоящий отказ.
  // Он проверяется ПЕРВЫМ и одинаково для всех целей: кнопка в ряду была бы,
  // а нажать её нечем.
  const locked = ctx.heroLevel < ability.unlockLevel

  if (target.kind === 'book') {
    // ИЗ РЯДА В КНИГУ — ОСВОБОЖДЕНИЕ СЛОТА. Из книги в книгу класть нечего:
    // умение и так там; это отмена переноса, а не действие.
    if (carry.from !== 'slot') return NOTHING
    return { fits: true, allowed: true, reason: null }
  }

  // СЛОТ САМ В СЕБЯ — пустое действие. Не отказ: подсветку цель заслуживает,
  // потому что бросок туда законен, просто ничего не меняет.
  if (carry.from === 'slot' && carry.index === target.index) {
    return { fits: true, allowed: false, reason: 'same-spot' }
  }

  // ПЕРЕСТАНОВКА ВНУТРИ РЯДА РАЗРЕШЕНА ВСЕГДА, даже если умение заперто
  // уровнем: оно уже лежит в ряду (положили раньше, или уровень с тех пор
  // упал в отладке), и запрещать ПЕРЕКЛАДЫВАТЬ уже лежащее незачем — от
  // перестановки доступность не меняется.
  if (carry.from === 'slot') return { fits: true, allowed: true, reason: null }

  return locked
    ? { fits: true, allowed: false, reason: 'locked' }
    : { fits: true, allowed: true, reason: null }
}
