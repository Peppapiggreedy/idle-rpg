// Надеть / снять / оценить экипировку. Чистые операции над состоянием.
import { estimateCombatRate, swingDamageRange } from './combat'
import { INVENTORY_SIZE } from '../data/balance'
import { ensureStats, type StatBlock } from './stats'
import type { Decimal } from './numbers'
import type { Equipment, GameState } from './state'
import type { SlotId } from '../data/slots'
import type { Item } from '../types'

/**
 * ПРАВИЛА ХВАТА. Живут ЗДЕСЬ, а не в данных слотов: слот — это перечень мест,
 * а «двуручное занимает обе» — правило игры.
 *
 * Причина отказа — КОД, а не строка: текст рендерит UI, ровно как у умений,
 * талантов и распыления. Три кода покрывают все запреты, потому что хватов
 * ровно три и запретов ровно три.
 */
export type EquipBlockReason =
  /** Двуручное надеть некуда: вторую руку нужно освободить, а сумка полна. */
  | 'two-handed-needs-both'
  /** Щит просят в главную руку. Щит не оружие и живёт только во второй. */
  | 'shield-offhand-only'
  /** Во вторую руку что-либо при надетом двуручном: она занята им целиком. */
  | 'occupied-by-two-handed'

export interface EquipStatus {
  canEquip: boolean
  reason: EquipBlockReason | null
  /** Что уйдёт в сумку, если надеть. Пусто — руки и так свободны. */
  removed: Item[]
}

/**
 * КАК ЛЕГЛА БЫ СВЯЗКА, если предмет надеть. Это ПРЕДПОЛОЖЕНИЕ, а не разрешение:
 * законность спрашивают у `equipStatus`, а здесь считают числа.
 *
 * Разница нужна для сумки. Щит при надетом двуручном надеть НЕЛЬЗЯ — но метку
 * «апгрейд» он получить обязан, иначе игрок в двуручном не узнает, что щит
 * ему выгоднее, и находка молча уйдёт в продажу. Поэтому предпросмотр
 * отвечает «если освободить руку», а кнопка «Надеть» — «прямо сейчас нельзя,
 * вот почему».
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
    if (item.grip === 'two') {
      // Двуручное занимает обе руки: левая обязана освободиться.
      push(equipment.offHand)
      next.offHand = null
    }
  } else if (item.slot === 'offHand') {
    // Занять левую руку можно, только если правая не держит двуручное.
    if (equipment.mainHand?.grip === 'two') {
      push(equipment.mainHand)
      next.mainHand = null
    }
  }
  return { equipment: next, removed }
}

/**
 * Можно ли надеть предмет ПРЯМО СЕЙЧАС и что при этом уйдёт в сумку.
 *
 * Порядок проверок — от того, что игрок не исправит одним движением.
 * Чистая функция: её зовёт и `equipItem`, и кнопка в сумке, чтобы причина
 * отказа была одна и та же, а не считалась дважды по-разному.
 */
export function equipStatus(state: GameState, item: Item): EquipStatus {
  const { removed } = equipmentWith(state.equipment, item)
  const blocked = (reason: EquipBlockReason): EquipStatus => ({
    canEquip: false,
    reason,
    removed: [],
  })
  // Щит — не оружие: в главной руке ему нечего делать ни при каких условиях.
  if (item.grip === 'shield' && item.slot === 'mainHand') return blocked('shield-offhand-only')
  // Двуручное занимает обе руки. Освободить вторую — не то же самое, что
  // выбросить из неё предмет: некуда положить — значит нельзя надеть.
  if (item.slot === 'offHand' && state.equipment.mainHand?.grip === 'two') {
    return blocked('occupied-by-two-handed')
  }
  // Место под сам предмет есть всегда: он покидает сумку. А вот СНЯТОЕ может
  // и не поместиться — тогда надевать нельзя, иначе предмет пропал бы молча.
  const freed = state.inventory.filter((i) => i.id !== item.id).length
  if (freed + removed.length > INVENTORY_SIZE) return blocked('two-handed-needs-both')
  return { canEquip: true, reason: null, removed }
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
  /**
   * ПОЛНЫЕ блоки статов до и после. Оба посчитаны ОДНОЙ И ТОЙ ЖЕ функцией
   * конвейера (`ensureStats` внутри `withEquipped`) — отдельной ветки расчёта
   * «для сравнения» нет и быть не должно, иначе подсказка начала бы обещать
   * не то, что даст надевание.
   *
   * Наружу отдаются блоки ЦЕЛИКОМ, а не заранее выбранные строки: какие
   * характеристики показать, решает UI, обходя общий реестр STAT_IDS. Так
   * новая характеристика попадает в сравнение сама, без правок здесь.
   */
  before: StatBlock
  after: StatBlock
  /**
   * Изменение боевой эффективности ДОЛЕЙ (0.074 — «+7,4 %»); null — считать
   * не от чего (сейчас герой не убивает вовсе).
   *
   * Мера — та же, что решает «апгрейд ли это»: убийств в секунду из
   * estimateCombatRate. Не голый урон в секунду: в нём нет ни аптайма, ни
   * проков, и броня по нему никогда не апгрейд (см. farmRate ниже). Двух мер
   * «лучше» в игре нет — иначе значок «Апгрейд» и процент в подсказке
   * спорили бы друг с другом на одной и той же карточке.
   */
  combatDelta: number | null
}

/** Сравнение «а если надеть?» по производным числам, а не по сумме статов. */
export function compareItem(state: GameState, item: Item): EquipComparison {
  const equipped = withEquipped(state, item)
  const withItem = previewOf(equipped)
  const current = previewOf(state)
  const base = current.killsPerSecond
  return {
    slot: item.slot,
    withItem,
    current,
    currentItem: state.equipment[item.slot],
    damagePerSecondDelta: withItem.damagePerSecond.minus(current.damagePerSecond),
    isUpgrade: withItem.killsPerSecond.gt(current.killsPerSecond),
    before: state.stats,
    after: equipped.stats,
    combatDelta: base.lte(0)
      ? null
      : withItem.killsPerSecond.minus(base).div(base).toNumber(),
  }
}

/**
 * Надевает предмет из инвентаря. Снятое (в том числе вторая рука, которую
 * освобождает двуручное) уходит В СУМКУ, а не пропадает.
 *
 * Отказ — это НИЧЕГО НЕ ДЕЛАТЬ: причину игроку показывает кнопка, спросив
 * `equipStatus` тем же вызовом. Второй копии правил здесь нет.
 */
export function equipItem(state: GameState, itemId: string): GameState {
  const item = state.inventory.find((i) => i.id === itemId)
  if (!item) return state
  const status = equipStatus(state, item)
  if (!status.canEquip) return state
  const { equipment } = equipmentWith(state.equipment, item)
  const inventory = state.inventory.filter((i) => i.id !== itemId)
  return ensureStats({
    ...state,
    inventory: [...inventory, ...status.removed],
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
