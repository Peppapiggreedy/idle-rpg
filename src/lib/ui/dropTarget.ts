// КУДА МОЖНО ПОЛОЖИТЬ ТО, ЧТО НЕСЁШЬ. Чистая функция, общая на все три пути.
//
// Путей надеть находку три — перетаскивание, «нажал вещь, нажал слот» и
// долгое нажатие, — и решать «можно ли сюда» каждый из них обязан ОДИНАКОВО.
// Поэтому решение считается здесь, один раз, а пути только зовут его.
//
// Слой представления НЕ ЗНАЕТ правил игры: подходит ли слот и почему нельзя,
// отвечают `equipStatus` и `unequipStatus` из `game/`. Здесь — только сведение
// их ответов в одну форму, которую умеет рисовать кукла.
import { equipStatus, unequipStatus } from '../game'
import type { EquipBlockReason, GameState, UnequipBlockReason } from '../game'
import type { SlotId } from '../data/slots'
import type { Carry } from '../stores/ui'
import type { Item } from '../types'

/** Все причины отказа, какие бывают у куклы. Текст к ним — в `itemText.ts`. */
export type DropRefusal = EquipBlockReason | UnequipBlockReason

export interface DropOutcome<R extends DropRefusal = DropRefusal> {
  /**
   * Слот ВООБЩЕ про эту вещь. Подходящие подсвечиваются, неподходящие
   * тушатся — и это разные вещи с «нельзя прямо сейчас»: щит в главную руку
   * подходит по слоту находки, но запрещён правилом хвата, и игрок обязан
   * увидеть ПРИЧИНУ, а не просто потушенную ячейку.
   */
  fits: boolean
  /** Можно положить прямо сейчас. */
  allowed: boolean
  /** Код отказа; текст рендерит UI. */
  reason: R | null
}

// ТИП ОТКАЗА РАЗНЫЙ У ДВУХ ЦЕЛЕЙ, и общий союз здесь был бы неправдой:
// в слот кладут (`EquipBlockReason`), в сумку снимают (`UnequipBlockReason`).
// Компонент рисует текст по своей карте, и лишний вариант в типе заставил бы
// его гадать, из какой карты брать слово.
const NOTHING = { fits: false, allowed: false, reason: null } as const

/** Что за вещь несут. `null` — её уже нет (продали, надели, загрузили сейв). */
export function carriedOf(state: GameState, carry: Carry | null): Item | null {
  if (carry === null) return null
  if (carry.from === 'bag') return state.inventory.find((i) => i.id === carry.itemId) ?? null
  return state.equipment[carry.slot]
}

/** Можно ли положить несомое в СЛОТ куклы. */
export function slotOutcome(
  state: GameState,
  carry: Carry | null,
  slot: SlotId,
): DropOutcome<EquipBlockReason> {
  if (carry === null) return NOTHING
  // Надетое перетаскивают только В СУМКУ: менять слоты местами игра не умеет,
  // и делать вид, что умеет, слой представления не вправе.
  if (carry.from === 'slot') return NOTHING
  const item = carriedOf(state, carry)
  if (item === null) return NOTHING
  // Слот у находки один — тот, в который её бросил лут. Подсвечиваем именно
  // его: «положи куда хочешь» было бы обещанием, которого игра не держит.
  if (item.slot !== slot) return NOTHING
  const status = equipStatus(state, item)
  return { fits: true, allowed: status.canEquip, reason: status.reason }
}

/** Можно ли бросить несомое В СУМКУ. Для надетого это «снять». */
export function bagOutcome(state: GameState, carry: Carry | null): DropOutcome<UnequipBlockReason> {
  if (carry === null) return NOTHING
  // Находка и так в сумке: бросать её туда же — не действие, а отмена.
  if (carry.from === 'bag') return NOTHING
  const status = unequipStatus(state, carry.slot)
  return { fits: true, allowed: status.canUnequip, reason: status.reason }
}
