// Единый конвейер статов — ЕДИНСТВЕННЫЙ источник правды для производных чисел.
// Никакой код за пределами этого модуля не меняет итоговые статы иначе, чем
// добавив или убрав модификатор (см. collectModifiers).
//
// Порядок применения СТРОГО фиксирован:
//   base -> + сумма всех flat -> * (1 + сумма всех percent) -> * произведение multiplier
// Ступень base: модификатор kind 'base' ЗАМЕНЯЕТ значение по умолчанию из
// data/balance.ts (не прибавляется к нему). Контракт — ровно один base-источник
// на стат (например, надетое оружие задаёт weaponSpeed); если base-модификаторов
// нет, берётся дефолт из BASE_STATS; если их несколько, выигрывает ПОСЛЕДНИЙ в
// порядке collectModifiers — поведение зафиксировано тестом, а не случайно.
// Проценты складываются аддитивно (+20% и +30% дают +50%, а не 1.2*1.3);
// множители перемножаются. Менять порядок нельзя — это баланс.
import { Decimal } from './numbers'
import type { GameState } from './state'
import { BASE_STATS, MAX_REST_THRESHOLD, MIN_REST_DURATION_S, PER_LEVEL } from '../data/balance'
import { UPGRADES } from '../data/upgrades'
import { SLOT_IDS } from '../data/slots'
import { talentModifiers } from '../data/talents'
import { classById } from '../data/classes'

// Модифицируемые статы. swingTime сюда НЕ входит намеренно: это производная
// величина, её нельзя модифицировать напрямую — только через weaponSpeed/haste.
export type StatId =
  | 'attackPower'
  | 'weaponDamageMin'
  | 'weaponDamageMax'
  // Левая рука — СВОЯ база боя: своя скорость и свой диапазон урона. Без
  // отдельных статов дуалвилд пришлось бы считать мимо конвейера, а правило
  // «итоговые статы меняются только модификатором» запрещает такие обходы.
  // Ноль в offhandDamageMax означает «левая рука пуста»: она не бьёт.
  | 'offhandSpeed'
  | 'offhandDamageMin'
  | 'offhandDamageMax'
  // Щит: шанс блока и сколько урона он снимает.
  | 'blockChance'
  | 'blockValue'
  // Доля урона, которую наносит ЛЕВАЯ рука. Стат, а не константа: талант на
  // дуалвилд обязан выражаться модификатором, как и всё остальное.
  | 'offhandPenalty'
  // Секунд паузы до старта восстановления маны после траты.
  | 'regenDelay'
  // Секунд привала и порог, ниже которого герой на него уходит.
  | 'restDuration'
  | 'restThreshold'
  | 'maxHp'
  | 'maxMana'
  | 'weaponSpeed'
  | 'haste'
  | 'critChance'
  | 'critMultiplier'
  | 'hpRegen'
  | 'hpRegenOutOfCombat'
  | 'manaRegen'
  | 'damageReduction'

export const STAT_IDS: StatId[] = [
  'attackPower',
  'weaponDamageMin',
  'weaponDamageMax',
  'offhandSpeed',
  'offhandDamageMin',
  'offhandDamageMax',
  'blockChance',
  'blockValue',
  'offhandPenalty',
  'regenDelay',
  'restDuration',
  'restThreshold',
  'maxHp',
  'maxMana',
  'weaponSpeed',
  'haste',
  'critChance',
  'critMultiplier',
  'hpRegen',
  'hpRegenOutOfCombat',
  'manaRegen',
  'damageReduction',
]

export type ModifierKind = 'base' | 'flat' | 'percent' | 'multiplier'

export interface StatModifier {
  stat: StatId
  kind: ModifierKind
  // base — замена базового значения; flat — абсолютная прибавка;
  // percent — доля (0.2 = +20%); multiplier — множитель.
  value: Decimal
  // Обязательный человекочитаемый источник: 'upgrade:weapon-sharpening',
  // 'equipment:mainHand', 'talent:heavy_blows', 'zone:ashen_wastes'. UI показывает
  // раскладку по source построчно.
  source: string
}

// Готовые статы. Вероятности/доли/секунды — number (правило CLAUDE.md),
// неограниченно растущие величины — Decimal.
export interface StatBlock {
  attackPower: Decimal // сила атаки: вклад в удар через AP_NORMALIZATION
  weaponDamageMin: Decimal // нижняя граница урона оружия
  weaponDamageMax: Decimal // верхняя граница урона оружия
  maxHp: Decimal
  maxMana: Decimal
  weaponSpeed: number // секунд между ударами оружия (меньше = быстрее)
  haste: number // ускорение в долях: 0.2 = +20% скорости (больше = быстрее)
  swingTime: number // ПРОИЗВОДНАЯ: weaponSpeed / (1 + haste), секунд на замах
  // Левая рука. offhandDamageMax === 0 означает «рука пуста»: замаха нет.
  offhandSpeed: number
  offhandDamageMin: Decimal
  offhandDamageMax: Decimal
  offhandSwingTime: number // ПРОИЗВОДНАЯ, тот же haste на обе руки
  blockChance: number // вероятность 0..1
  blockValue: Decimal // сколько урона снимает удачный блок
  offhandPenalty: number // доля 0..1: во столько раз слабее удар левой руки
  regenDelay: number // секунд паузы регенерации маны после траты
  restDuration: number // секунд полного привала
  restThreshold: number // доля HP, ниже которой герой уходит на привал
  critChance: number // вероятность 0..1
  critMultiplier: Decimal
  hpRegen: Decimal // в бою
  hpRegenOutOfCombat: Decimal // вне боя (пауза респауна)
  manaRegen: Decimal
  damageReduction: number // доля 0..1
}

// Все источники модификаторов персонажа. Новые системы (экипировка, таланты,
// зоны) добавляют свои модификаторы СЮДА — и автоматически попадают и в
// пересчёт, и в раскладку на панели статов.
export function collectModifiers(state: GameState): StatModifier[] {
  const mods: StatModifier[] = []
  // Класс: стартовые статы приходят ПЕРВЫМИ, чтобы его base-модификаторы
  // (у ярости — свой запас и нулевой реген) могли быть перекрыты предметом,
  // а не наоборот. Порядок здесь — часть контракта ступени base.
  const hero = classById(state.classId)
  for (const mod of hero.baseMods) mods.push({ ...mod, source: `class:${hero.id}` })
  // Уровень персонажа: живучесть и мана. Урон уровень НЕ даёт — его копят
  // апгрейдами и экипировкой; уровень открывает зоны и позволяет в них выжить.
  const levelsGained = Decimal.max(state.level.minus(1), new Decimal(0))
  if (levelsGained.gt(0)) {
    const source = 'level'
    mods.push(
      { stat: 'maxHp', kind: 'flat', value: PER_LEVEL.maxHp.times(levelsGained), source },
      { stat: 'hpRegen', kind: 'flat', value: PER_LEVEL.hpRegen.times(levelsGained), source },
      { stat: 'maxMana', kind: 'flat', value: PER_LEVEL.maxMana.times(levelsGained), source },
      { stat: 'manaRegen', kind: 'flat', value: PER_LEVEL.manaRegen.times(levelsGained), source },
    )
  }
  // Экипировка: модификаторы лежат прямо в предмете, source уже проставлен
  // генератором ('equipment:mainHand' и т.д.). Оружие среди них задаёт БАЗУ
  // weaponSpeed / weaponDamageMin / weaponDamageMax через kind 'base' —
  // сняли оружие, и значения вернулись к UNARMED из data/balance.ts.
  for (const slot of SLOT_IDS) {
    const item = state.equipment?.[slot]
    if (item) mods.push(...item.mods)
  }
  // Порог привала — НАСТРОЙКА игрока, и в конвейер она входит базой: талант
  // тогда сдвигает выбранный порог, а не спорит с ним. Ровно один base-источник
  // на стат, как и у оружия.
  mods.push({
    stat: 'restThreshold',
    kind: 'base',
    value: new Decimal(state.restHpThreshold ?? 0),
    source: 'settings:rest',
  })
  // Таланты: значение модификатора множится на вложенный ранг, source —
  // 'talent:<id>', поэтому раскладка на панели статов показывает их построчно.
  mods.push(...talentModifiers(state.talents))
  // Апгрейды: урон пересчитывается из СЧЁТЧИКА покупок, а не хранится суммой.
  for (const def of UPGRADES) {
    const owned = state.upgrades[def.id]
    if (!owned || owned.lte(0)) continue
    mods.push({
      stat: 'attackPower',
      kind: 'flat',
      value: def.damageBonus.times(owned),
      source: `upgrade:${def.id}`,
    })
  }
  return mods
}

// Эффективное базовое значение: последний base-модификатор либо дефолт баланса.
function effectiveBase(stat: StatId, mods: StatModifier[]): Decimal {
  let base = BASE_STATS[stat]
  for (const mod of mods) {
    if (mod.stat === stat && mod.kind === 'base') base = mod.value
  }
  return base
}

// Применяет конвейер к одной стате: base -> +flat -> *(1+percent) -> *multiplier.
function computeStat(stat: StatId, mods: StatModifier[]): Decimal {
  let flat = new Decimal(0)
  let percent = new Decimal(0)
  let multiplier = new Decimal(1)
  for (const mod of mods) {
    if (mod.stat !== stat) continue
    if (mod.kind === 'flat') flat = flat.plus(mod.value)
    else if (mod.kind === 'percent') percent = percent.plus(mod.value)
    else if (mod.kind === 'multiplier') multiplier = multiplier.times(mod.value)
  }
  return effectiveBase(stat, mods).plus(flat).times(percent.plus(1)).times(multiplier)
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

// Время замаха: скорость оружия, ускоренная haste. Меньше = чаще бьём.
export function computeSwingTime(weaponSpeed: number, haste: number): number {
  return weaponSpeed / (1 + haste)
}

// Чистое ядро конвейера: набор модификаторов -> готовый StatBlock.
export function applyModifiers(mods: StatModifier[]): StatBlock {
  const weaponSpeed = computeStat('weaponSpeed', mods).toNumber()
  const haste = computeStat('haste', mods).toNumber()
  // Ускорение одно на героя, а не на предмет: haste ускоряет обе руки.
  const offhandSpeed = computeStat('offhandSpeed', mods).toNumber()
  return {
    attackPower: computeStat('attackPower', mods),
    weaponDamageMin: computeStat('weaponDamageMin', mods),
    weaponDamageMax: computeStat('weaponDamageMax', mods),
    offhandSpeed,
    offhandDamageMin: computeStat('offhandDamageMin', mods),
    offhandDamageMax: computeStat('offhandDamageMax', mods),
    offhandSwingTime: computeSwingTime(offhandSpeed, haste),
    blockChance: computeStat('blockChance', mods).toNumber(),
    blockValue: computeStat('blockValue', mods),
    // Границы у этих четырёх — не вкусовщина, а защита от вырожденных
    // значений: левая рука сильнее правой, мгновенный привал вместо привала,
    // отрицательная пауза регенерации и порог, с которого не выйти.
    offhandPenalty: clamp(computeStat('offhandPenalty', mods).toNumber(), 0, 1),
    regenDelay: Math.max(0, computeStat('regenDelay', mods).toNumber()),
    restDuration: Math.max(MIN_REST_DURATION_S, computeStat('restDuration', mods).toNumber()),
    restThreshold: clamp(computeStat('restThreshold', mods).toNumber(), 0, MAX_REST_THRESHOLD),
    maxHp: computeStat('maxHp', mods),
    maxMana: computeStat('maxMana', mods),
    weaponSpeed,
    haste,
    swingTime: computeSwingTime(weaponSpeed, haste),
    critChance: computeStat('critChance', mods).toNumber(),
    critMultiplier: computeStat('critMultiplier', mods),
    hpRegen: computeStat('hpRegen', mods),
    hpRegenOutOfCombat: computeStat('hpRegenOutOfCombat', mods),
    manaRegen: computeStat('manaRegen', mods),
    damageReduction: computeStat('damageReduction', mods).toNumber(),
  }
}

export function recomputeStats(state: GameState): StatBlock {
  return applyModifiers(collectModifiers(state))
}

// Кеш: пересчёт только при statsDirty — флаг взводят операции, меняющие набор
// источников (покупка апгрейда, смена экипировки, загрузка сейва); чистое
// чтение бесплатно. Прогресс замаха трогать не нужно: он хранится ДОЛЕЙ 0..1,
// поэтому при смене swingTime сохраняется сам.
export function ensureStats(state: GameState): GameState {
  if (!state.statsDirty) return state
  return { ...state, stats: recomputeStats(state), statsDirty: false }
}

// Раскладка одной статы для панели «Статы»: откуда взялась итоговая цифра.
export interface StatBreakdown {
  stat: StatId
  base: Decimal // эффективная база (с учётом base-модификатора)
  baseSource: string | null // источник базы; null — дефолт из баланса
  entries: StatModifier[] // flat/percent/multiplier, влияющие на стат
  total: Decimal
}

export function explainStat(state: GameState, stat: StatId): StatBreakdown {
  const mods = collectModifiers(state).filter((m) => m.stat === stat)
  const baseMods = mods.filter((m) => m.kind === 'base')
  return {
    stat,
    base: effectiveBase(stat, mods),
    baseSource: baseMods.length > 0 ? baseMods[baseMods.length - 1].source : null,
    entries: mods.filter((m) => m.kind !== 'base'),
    total: computeStat(stat, mods),
  }
}

// Раскладка производного swingTime: логика отдаёт числа, текст рендерит UI.
export interface SwingTimeBreakdown {
  weaponSpeed: number
  haste: number
  swingTime: number
}

export function explainSwingTime(state: GameState): SwingTimeBreakdown {
  const { weaponSpeed, haste, swingTime } = state.stats
  return { weaponSpeed, haste, swingTime }
}
