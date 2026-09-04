// Надеть / снять / оценить экипировку. Чистые операции над состоянием.
import { estimateCombatRate, mitigationAgainst, swingDamageRange, vitality } from './combat'
import { INVENTORY_SIZE } from '../data/balance'
import { inventorySize } from './upgrades'
import { SAFE_ZONE, ZONE_BY_ID, representativeMonster, type Zone } from '../data/zones'
import { referenceMonsterTemplate } from '../data/monsters'
import { ensureStats, type StatBlock, type StatModifier } from './stats'
import { monsterFromTemplate } from './state'
import { Decimal } from './numbers'
import type { Equipment, GameState } from './state'
import type { SlotId } from '../data/slots'
import type { Item } from '../types'
import {
  DEFAULT_UPGRADE_PRIORITY,
  UPGRADE_AXES,
  UPGRADE_RULES,
  type UpgradeAxis,
  type UpgradePriority,
} from '../data/upgrade'

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
  if (freed + removed.length > inventorySize(state)) return blocked('two-handed-needs-both')
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

/**
 * ДВЕ ОСИ ПРОТИВ ЭТАЛОННОГО ПРОТИВНИКА.
 *
 * ГРАНИЦА, КОТОРУЮ НЕЛЬЗЯ РАЗМЫВАТЬ. Две оси — это то, что видит ИГРОК и по
 * чему принимаются решения об экипировке. `estimateCombatRate` и цена боя —
 * МОДЕЛЬ и КОНТРАКТ: по ним считаются прогноз зоны, оффлайн, прогон баланса
 * и тесты. Первое обязано быть простым, устойчивым и объяснимым в двух
 * строках; второе — точным. Смешивать их нельзя: как только «лучше» начинает
 * зависеть от зоны, привалов и смертности, одна и та же вещь читается
 * по-разному в двух шагах пути.
 *
 *   damage   — урон в секунду по эталонному противнику, с учётом ПЕРЕБОЯ
 *              (добивающий удар пропадает тем больше, чем крупнее замах).
 *              Считает его та же `estimateCombatRate` — второй модели боя
 *              в игре нет, — но берётся из неё чистая пропускная способность
 *              урона, без аптайма, привалов и смертей.
 *   vitality — сколько урона герой держит за одну типичную схватку:
 *              `(запас + реген × TYPICAL_FIGHT_SEC) / (1 − смягчение)`.
 *              Формула — `vitality` в game/combat.ts, число абсолютное и в
 *              единицах здоровья. Больше — лучше, как и у урона.
 *
 * ОБЕ ОСИ НЕ ЗАВИСЯТ ОТ ЗОНЫ. Противник строится той же `buildMonster` на
 * эталонном архетипе УРОВНЯ ГЕРОЯ и без зонального множителя наград. Прежняя
 * пара («убийств в секунду» и «цена боя») бралась по трём ролям ТЕКУЩЕЙ зоны,
 * и это стоило дорого: в безопасной зоне аптайм равен единице, а цена боя
 * почти ноль — панцирь не двигал ни одну ось, и игре приходилось объяснять
 * игроку, почему находка «не апгрейд». Прибору же приходилось смотреть в
 * зону, КУДА герой собирается (`aimZoneId`), — костыль ровно про это.
 */
export function axesOf(state: GameState): Axes {
  const level = state.level.toNumber()
  const monster = monsterFromTemplate(referenceMonsterTemplate(level))
  return {
    damage: estimateCombatRate({ ...state, monster }).sustainedDamagePerSecond,
    vitality: vitality(state.stats, level, monster),
    mitigation: mitigationAgainst(monster, state.stats, level),
  }
}

/** Пара чисел, которую видит игрок и по которой решает автоматика. */
export interface Axes {
  damage: Decimal
  vitality: Decimal
  /** Доля удара, которую съедают броня, снижение урона и блок. Для подсказки. */
  mitigation: number
}

/**
 * ПУСТОЙ СЛОТ — ЭТО НОЛЬ ПО ОБЕИМ ОСЯМ, и порог для него другой.
 *
 * Ни одна ось не обязана от первой вещи на голое место вырасти. В зоне, где
 * герой не умирает, аптайм равен единице, и панцирь не двигает убийств в
 * секунду ВООБЩЕ; цену боя он снижает, но в безопасной зоне и она уже почти
 * ноль. Строгое «больше» не выполняется ни там, ни там — и игра говорила
 * «не апгрейд» о вещи, надеваемой в пустой слот. Раньше это было незаметно:
 * игра дарила полный комплект, и пустых слотов не существовало. Теперь их
 * шесть, и прогон полного пути показал цену: герой останавливался на 82
 * уровне из ста, потому что так и ходил в одном белом клинке.
 *
 * Правило для пустого слота одно: вещь не обязана оценку ПОДНЯТЬ, ей
 * достаточно её не уронить. Плюс требование хоть что-то менять, иначе
 * «апгрейдом» стал бы и предмет без модификаторов.
 */
function fillsEmptySlot(state: GameState, item: Item): boolean {
  return state.equipment[item.slot] === null && item.mods.some(changesAnything)
}

/**
 * Меняет ли модификатор хоть что-нибудь. Сравнение идёт с НЕЙТРАЛЬНЫМ
 * элементом своего вида в конвейере: у прибавок это ноль, у множителя —
 * единица. Это не «сумма статов», а проверка на пустышку: без неё вещь
 * с модификатором в ноль считалась бы апгрейдом на голое место.
 */
export function changesAnything(mod: { kind: StatModifier['kind']; value: Decimal }): boolean {
  return mod.kind === 'multiplier' ? !mod.value.eq(1) : !mod.value.eq(0)
}

/** Зона, по которой считается оценка предмета. */
function referenceZone(state: GameState): Zone {
  return ZONE_BY_ID[state.currentZoneId] ?? SAFE_ZONE
}

/** Состояние против медианного моба зоны — для показа урона удара. */
function facingReference(state: GameState): GameState {
  return { ...state, monster: monsterFromTemplate(representativeMonster(referenceZone(state))) }
}

/**
 * ИЗМЕНЕНИЕ ПО КАЖДОЙ ОСИ, долей: положительное — лучше, отрицательное —
 * хуже, null — считать не от чего (сейчас ось равна нулю).
 *
 * ОБЕ ОСИ ТЕПЕРЬ «БОЛЬШЕ — ЛУЧШЕ», и переворачивать знак внутри больше не
 * надо: живучесть — абсолютное число, а не цена, которую хотелось снизить.
 * Пока осью выживания была ЦЕНА боя, здесь стояла отдельная ветка со своим
 * направлением, и она была вечным источником вопроса «а в какую сторону тут
 * плюс».
 *
 * Считается ровно одна пара состояний — «как есть» и «если надеть», — и обе
 * оси берутся из неё. Отдельного прохода на каждую ось нет.
 */
export interface AxisDeltas {
  damage: number | null
  survival: number | null
}

function relative(before: Decimal, after: Decimal): number | null {
  if (before.lte(0)) return after.gt(0) ? Number.POSITIVE_INFINITY : null
  return after.minus(before).div(before).toNumber()
}

type AxisValues = Pick<Axes, 'damage' | 'vitality'>

function axisDeltas(before: AxisValues, after: AxisValues): AxisDeltas {
  return {
    damage: relative(before.damage, after.damage),
    survival: relative(before.vitality, after.vitality),
  }
}

/** Лучше ли предмет хотя бы по одной оси из перечисленных. */
function betterOnAny(
  deltas: AxisDeltas,
  axes: readonly UpgradeAxis[],
  emptySlot: boolean,
): boolean {
  return axes.some((axis) => {
    const d = deltas[axis]
    if (d === null) return false
    // Пустой слот: не уронить достаточно (см. fillsEmptySlot).
    return emptySlot ? d >= 0 : d > 0
  })
}

/**
 * Лучше ли предмет надетого по ДЕЙСТВУЮЩЕМУ приоритету игрока.
 *
 * Приоритет приходит из состояния, а какие оси он смотрит — из данных
 * (`UPGRADE_RULES`). Ветки по конкретному положению переключателя здесь нет:
 * появится четвёртое — оно добавится строкой в данные.
 */
export function isUpgrade(state: GameState, item: Item, priority?: UpgradePriority): boolean {
  return betterOnAny(
    compareAxes(state, item),
    UPGRADE_RULES[priority ?? priorityOf(state)].axes,
    fillsEmptySlot(state, item),
  )
}

/**
 * ЖЕЛЕЗНОЕ ПРАВИЛО СУМКИ: предмет, который лучше ХОТЬ ПО ОДНОЙ оси, при
 * полной сумке не продаётся и не распыляется — он вытесняет худшее.
 *
 * Приоритет сюда НЕ передаётся, и это не упущение. Приоритет говорит, что
 * подсветить и что считать лишним при разборе; терять же находку молча
 * нельзя ни при каком положении переключателя. Игрок, поставивший «урон»,
 * не просил выбрасывать защитные вещи — он просил не звать их апгрейдом.
 */
export function betterOnAnyAxis(state: GameState, item: Item): boolean {
  return betterOnAny(compareAxes(state, item), UPGRADE_AXES, fillsEmptySlot(state, item))
}

/** Действующий приоритет игрока; старый сейв без поля — «баланс». */
export function priorityOf(state: GameState): UpgradePriority {
  return state.upgradePriority ?? DEFAULT_UPGRADE_PRIORITY
}

/** Изменение по обеим осям, если надеть предмет. */
export function compareAxes(state: GameState, item: Item): AxisDeltas {
  return axisDeltas(axesOf(state), axesOf(withEquipped(state, item)))
}

// Производные числа для сравнения предметов в UI: не «+4 к силе атаки»,
// а что игрок реально увидит в бою. Текст рендерит UI, логика отдаёт цифры.
export interface EquipPreview {
  damageMin: Decimal // нижняя граница урона удара (оружие + вклад силы атаки)
  damageMax: Decimal
  swingTime: number // секунд между ударами с учётом haste
  /** Урон в секунду по МОБУ ТЕКУЩЕЙ ЗОНЫ — справочная строка карточки. */
  damagePerSecond: Decimal
  /** ОСЬ УРОНА: урон в секунду по эталонному противнику, с перебоем. */
  axisDamage: Decimal
  /** ОСЬ ЖИВУЧЕСТИ: сколько урона герой держит за схватку. Больше — лучше. */
  vitality: Decimal
}

function previewOf(state: GameState): EquipPreview {
  const { min, max } = swingDamageRange(state.stats)
  const facing = facingReference(state)
  const axes = axesOf(state)
  return {
    damageMin: min,
    damageMax: max,
    swingTime: state.stats.swingTime,
    damagePerSecond: estimateCombatRate(facing).damagePerSecond,
    axisDamage: axes.damage,
    vitality: axes.vitality,
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
  /**
   * ОБЕ ОСИ, ВСЕГДА. Подсказка показывает и урон, и выживание независимо от
   * того, какое положение переключателя выбрано: приоритет решает, что
   * ПОДСВЕТИТЬ, а не что показать. Иначе игрок, поставивший «урон», не узнал
   * бы, что находка вдвое дешевле по цене боя, — а это как раз то, ради чего
   * ось выживания и заведена.
   */
  axes: AxisDeltas
  /** Оси, по которым предмет считается апгрейдом при текущем приоритете. */
  markedAxes: readonly UpgradeAxis[]
}

/** Сравнение «а если надеть?» по производным числам, а не по сумме статов. */
export function compareItem(state: GameState, item: Item): EquipComparison {
  const equipped = withEquipped(state, item)
  const withItem = previewOf(equipped)
  const current = previewOf(state)
  const base = current.axisDamage
  const empty = fillsEmptySlot(state, item)
  const axes = axisDeltas(
    { damage: current.axisDamage, vitality: current.vitality },
    { damage: withItem.axisDamage, vitality: withItem.vitality },
  )
  const markedAxes = UPGRADE_RULES[priorityOf(state)].axes
  return {
    slot: item.slot,
    withItem,
    current,
    currentItem: state.equipment[item.slot],
    damagePerSecondDelta: withItem.damagePerSecond.minus(current.damagePerSecond),
    // Метка ставится по ДЕЙСТВУЮЩЕМУ приоритету; порог для пустого слота
    // ниже — см. fillsEmptySlot.
    isUpgrade: betterOnAny(axes, markedAxes, empty),
    before: state.stats,
    after: equipped.stats,
    combatDelta: base.lte(0)
      ? null
      : withItem.axisDamage.minus(base).div(base).toNumber(),
    axes,
    markedAxes,
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

// Почему предмет не снять. Каждый случай — свой код, текст рендерит UI.
export type UnequipBlockReason = 'empty-slot' | 'inventory-full'

export interface UnequipStatus {
  canUnequip: boolean
  reason: UnequipBlockReason | null
}

/** Можно ли снять предмет из слота ПРЯМО СЕЙЧАС — ему нужно место в сумке. */
export function unequipStatus(state: GameState, slot: SlotId): UnequipStatus {
  if (!state.equipment[slot]) return { canUnequip: false, reason: 'empty-slot' }
  if (state.inventory.length >= inventorySize(state)) {
    return { canUnequip: false, reason: 'inventory-full' }
  }
  return { canUnequip: true, reason: null }
}

/** Снимает предмет в инвентарь; отказ `unequipStatus` — состояние как было. */
export function unequipItem(state: GameState, slot: SlotId): GameState {
  const item = state.equipment[slot]
  if (!item || !unequipStatus(state, slot).canUnequip) return state
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
export function upgradeShare(
  state: GameState,
  item: Item,
  priority?: UpgradePriority,
): number | null {
  const axes = compareAxes(state, item)
  const rule = UPGRADE_RULES[priority ?? priorityOf(state)]
  if (!betterOnAny(axes, rule.axes, fillsEmptySlot(state, item))) return null
  // ЦЕННОСТЬ — ЛУЧШАЯ ИЗ ОСЕЙ ПРИОРИТЕТА, а не их сумма. Складывать доли
  // разных осей нельзя: «+10 % урона» и «+10 % выживания» — не двадцать
  // процентов чего бы то ни было, и вещь, слегка улучшающая обе оси,
  // обгоняла бы вещь, вдвое поднимающую одну. Лучшая ось отвечает на тот
  // вопрос, который игрок и задаёт: насколько эта находка лучше в том,
  // в чём она лучше.
  let best = 0
  for (const axis of rule.axes) {
    const d = axes[axis]
    if (d !== null && d > best) best = d
  }
  return best
}
