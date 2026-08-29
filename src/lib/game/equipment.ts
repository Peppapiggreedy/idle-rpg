// Надеть / снять / оценить экипировку. Чистые операции над состоянием.
import { estimateCombatRate, swingDamageRange } from './combat'
import { INVENTORY_SIZE } from '../data/balance'
import { ensureStats } from './stats'
import type { Decimal } from './numbers'
import type { Equipment, GameState } from './state'
import type { SlotId } from '../data/slots'
import type { Item } from '../types'

/**
 * Правила связки рук. Живут ЗДЕСЬ, а не в данных слотов: слоты — это перечень
 * мест, а «двуручное занимает обе» — правило игры.
 *
 * Возвращает снаряжение после надевания и список предметов, которые пришлось
 * снять: двуручное вытесняет обе руки, а любое одноручное или щит в правой
 * руке вытесняет надетое двуручное.
 */
export function equipmentWith(
  equipment: Equipment,
  item: Item,
): { equipment: Equipment; removed: Item[] } {
  const next: Equipment = { ...equipment, [item.slot]: item }
  const removed: Item[] = []
  const push = (existing: Item | null) => {
    if (existing && existing.id !== item.id) removed.push(existing)
  }
  push(equipment[item.slot])
  if (item.slot === 'mainHand') {
    if (item.hands === 2) {
      // Двуручное занимает обе руки: левая обязана освободиться.
      push(equipment.offHand)
      next.offHand = null
    }
  } else if (item.slot === 'offHand') {
    // Занять левую руку можно, только если правая не держит двуручное.
    if (equipment.mainHand?.hands === 2) {
      push(equipment.mainHand)
      next.mainHand = null
    }
  }
  return { equipment: next, removed }
}

// Состояние с надетым предметом — без изменения инвентаря. Нужно для оценки
// «а если надеть?» и для реального надевания. Считает СВЯЗКУ целиком: смена
// одной руки может освободить или занять вторую, и урон в секунду сравнивают
// именно связки, а не отдельные предметы.
function withEquipped(state: GameState, item: Item): GameState {
  return ensureStats({
    ...state,
    equipment: equipmentWith(state.equipment, item).equipment,
    statsDirty: true,
  })
}

/** Темп фарма, каким он станет с предметом (сам предмет не надевается). */
export function farmRateWith(state: GameState, item: Item): Decimal {
  return farmRate(withEquipped(state, item))
}

/**
 * ЧЕМ МЕРИТСЯ «ЛУЧШЕ». Убийствами в секунду, а не голым уроном в секунду.
 *
 * Разница принципиальна, и прогон полного пути показал это дороже некуда.
 * `damagePerSecond` — это «как сильно бью», и живучесть в него не входит
 * вовсе: панцирь на живучесть не двигает его ни на единицу. Значит по нему
 * броня НИКОГДА не апгрейд — герой донашивает стартовый панцирь до
 * шестидесятого уровня, начинает умирать, и класс со щитом (у которого
 * половина силы как раз в том, чтобы стоять) вылетает из игры к середине
 * лестницы. В прогоне страж застревал на 64 уровне с четырнадцатью
 * смертями в час, пока изувер доходил до сотого.
 *
 * `killsPerSecond` — это «сколько мобов в секунду я кладу»: в нём и урон,
 * и аптайм, то есть и живучесть. Это ТА ЖЕ оценка из estimateCombatRate,
 * которой пользуются прогноз зоны и оффлайн, — второй меры «хорошести»
 * в игре по-прежнему нет.
 */
function farmRate(state: GameState): Decimal {
  return estimateCombatRate(state).killsPerSecond
}

/** Лучше ли предмет надетого — СТРОГО по оценочному темпу убийств. */
export function isUpgrade(state: GameState, item: Item): boolean {
  return farmRateWith(state, item).gt(farmRate(state))
}

// Производные числа для сравнения предметов в UI: не «+4 к силе атаки»,
// а что игрок реально увидит в бою. Текст рендерит UI, логика отдаёт цифры.
export interface EquipPreview {
  damageMin: Decimal // нижняя граница урона удара (оружие + вклад силы атаки)
  damageMax: Decimal
  swingTime: number // секунд между ударами с учётом haste
  damagePerSecond: Decimal
  /** Убийств в секунду с учётом аптайма — мера, по которой считается апгрейд. */
  killsPerSecond: Decimal
}

function previewOf(state: GameState): EquipPreview {
  const { min, max } = swingDamageRange(state.stats)
  return {
    damageMin: min,
    damageMax: max,
    swingTime: state.stats.swingTime,
    damagePerSecond: estimateCombatRate(state).damagePerSecond,
    // Темп фарма — то, чем СРАВНИВАЮТСЯ предметы: в нём и урон, и аптайм.
    killsPerSecond: farmRate(state),
  }
}

export interface EquipComparison {
  slot: SlotId
  withItem: EquipPreview
  current: EquipPreview // как есть сейчас: с надетым в этом слоте или без него
  currentItem: Item | null
  damagePerSecondDelta: Decimal // withItem - current; отрицательная = хуже
  isUpgrade: boolean
}

/** Сравнение «а если надеть?» по производным числам, а не по сумме статов. */
export function compareItem(state: GameState, item: Item): EquipComparison {
  const withItem = previewOf(withEquipped(state, item))
  const current = previewOf(state)
  return {
    slot: item.slot,
    withItem,
    current,
    currentItem: state.equipment[item.slot],
    damagePerSecondDelta: withItem.damagePerSecond.minus(current.damagePerSecond),
    isUpgrade: withItem.killsPerSecond.gt(current.killsPerSecond),
  }
}

/** Надевает предмет из инвентаря; снятое возвращается в освободившийся слот. */
export function equipItem(state: GameState, itemId: string): GameState {
  const item = state.inventory.find((i) => i.id === itemId)
  if (!item) return state
  const { equipment, removed } = equipmentWith(state.equipment, item)
  // Место всегда есть под сам предмет: он покидает инвентарь. Снятая вторая
  // рука может и не поместиться — тогда надеть не выйдет, иначе предмет
  // пропал бы молча.
  const inventory = state.inventory.filter((i) => i.id !== itemId)
  if (inventory.length + removed.length > INVENTORY_SIZE) return state
  return ensureStats({
    ...state,
    inventory: [...inventory, ...removed],
    equipment,
    statsDirty: true,
  })
}

/** Снимает предмет в инвентарь; при полном инвентаре ничего не делает. */
export function unequipItem(state: GameState, slot: SlotId): GameState {
  const item = state.equipment[slot]
  if (!item) return state
  if (state.inventory.length >= INVENTORY_SIZE) return state
  return ensureStats({
    ...state,
    inventory: [...state.inventory, item],
    equipment: { ...state.equipment, [slot]: null },
    statsDirty: true,
  })
}

export function isEquipped(state: GameState, itemId: string): boolean {
  return Object.values(state.equipment).some((i) => i?.id === itemId)
}

/**
 * Насколько предмет лучше надетого — ДОЛЯ прироста темпа убийств.
 *
 * Именно доля, а не разница: «+340 урона» на двадцатом уровне и на
 * восьмидесятом значат совершенно разное, а «+12%» значит одно и то же
 * везде. Это то число, ради которого игрок вообще смотрит на находку.
 * Пустой слот — прирост от нуля, поэтому доля не считается вовсе
 * (делить не на что): такой предмет лучше по определению.
 */
export function upgradeShare(state: GameState, item: Item): number | null {
  const cmp = compareItem(state, item)
  if (!cmp.isUpgrade) return null
  const base = cmp.current.killsPerSecond
  if (base.lte(0)) return Number.POSITIVE_INFINITY
  return cmp.withItem.killsPerSecond.minus(base).div(base).toNumber()
}
