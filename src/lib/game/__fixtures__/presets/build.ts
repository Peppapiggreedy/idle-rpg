// Сборка пресетов для съёмки скриншотов. Состояния строятся ТЕМИ ЖЕ функциями,
// что и живая игра — покупкой апгрейдов, вложением очков, надеванием лута, —
// поэтому пресет не может «застыть» в форме, которой в игре не бывает.
//
// Модуль в бандл игры не попадает: его импортирует только тест, который
// перегенерирует json. Сама игра читает уже готовые json из этой же папки.
import { Decimal } from '../../numbers'
import { createRng } from '../../rng'
import { createInitialState, type GameState } from '../../state'
import { ensureStats } from '../../stats'
import { xpToNextLevel } from '../../formulas'
import { equipItem } from '../../equipment'
import { rollBossLoot, rollLoot } from '../../loot'
import { investTalent } from '../../talents'
import { travelToZone } from '../../zones'
import { payloadFromState, type SavePayloadV17 } from '../../save'
import { DUNGEONS } from '../../../data/dungeons'
import { TALENTS } from '../../../data/talents'
import { SLOT_IDS } from '../../../data/slots'
import type { Item } from '../../../types'

export type PresetName = 'fresh' | 'mid' | 'rich'

export const PRESET_NAMES: PresetName[] = ['fresh', 'mid', 'rich']

// Время сейва фиксировано: иначе json менялся бы при каждой перегенерации,
// а оффлайн-расчёт в режиме съёмки всё равно не запускается.
const FROZEN_TIMESTAMP = 1_700_000_000_000

// Поднять героя до уровня: уровень — источник статов, поэтому пересчитываем.
function atLevel(state: GameState, level: number): GameState {
  const value = new Decimal(level)
  return ensureStats({
    ...state,
    level: value,
    // Опыт на трети полосы: видно, что полоска не пустая и не полная.
    currentXp: xpToNextLevel(value).times(0.34).floor(),
    xpToNext: xpToNextLevel(value),
    statsDirty: true,
  })
}

function withUpgrade(state: GameState, count: number): GameState {
  return ensureStats({
    ...state,
    upgrades: { 'weapon-sharpening': new Decimal(count) },
    statsDirty: true,
  })
}

function addToInventory(state: GameState, items: Item[]): GameState {
  return { ...state, inventory: [...state.inventory, ...items], itemSeq: state.itemSeq + items.length }
}

// Набрать предметов честным броском лута; пустые броски пропускаем.
function rollItems(state: GameState, seed: number, count: number): Item[] {
  const rng = createRng(seed)
  const items: Item[] = []
  let seq = state.itemSeq
  for (let attempt = 0; attempt < count * 40 && items.length < count; attempt++) {
    const item = rollLoot(rng, seq)
    if (!item) continue
    items.push(item)
    seq += 1
  }
  return items
}

/** Новый игрок: всё по нулям, стартовая зона. */
function fresh(): GameState {
  return createInitialState(101)
}

/** Середина игры: десятый уровень, экипировка, умения на кулдауне. */
function mid(): GameState {
  let state = createInitialState(202)
  state = atLevel(state, 10)
  state = withUpgrade(state, 24)
  // Оружие и пара вещей — надеваем через обычный equipItem. Оружие берём
  // ЯВНО, а не первым по порядку: без него герой на снимке дерётся кулаками,
  // и «урон оружия 8–12» в статах читается как поломка, а не как пустая рука.
  const loot = rollItems(state, 2024, 9)
  state = addToInventory(state, loot)
  const weapon = loot.find((i) => i.slot === 'mainHand')
  const rest = loot.filter((i) => i !== weapon).slice(0, 4)
  for (const item of [weapon, ...rest]) {
    if (item) state = equipItem(state, item.id)
  }
  state = travelToZone(state, 'hollow-quarry', createRng(303))
  // Первое очко таланта приходит как раз на десятом уровне.
  state = investTalent(state, 'honed-edge')
  return {
    ...state,
    gold: new Decimal(4820),
    // Умения в разных фазах: одно готово, одно тикает, одно только ушло в кд.
    abilityCooldownsMs: { 'rending-wound': 2400, 'shattering-blow': 9100 },
    gcdMsLeft: 600,
    currentHp: state.stats.maxHp.times(0.62).floor(),
    currentMana: state.stats.maxMana.times(0.45).floor(),
  }
}

/** Поздняя игра: полный инвентарь, все зоны, вложенные таланты, данж пройден. */
function rich(): GameState {
  let state = createInitialState(404)
  state = atLevel(state, 22)
  state = withUpgrade(state, 180)
  // Лут босса даёт высокие тиры — в инвентаре видно все цвета редкости.
  const bossLoot = DUNGEONS[0].bosses.flatMap((boss, index) =>
    rollBossLoot(boss.loot, createRng(500 + index), 100 + index * 10),
  )
  state = addToInventory(state, [...rollItems(state, 606, 5), ...bossLoot])
  // Надеваем по одному предмету на слот: берём первый подходящий. Левую руку
  // пропускаем, если в правой двуручное: по правилам игры вещь в левой руке
  // выбивает двуручное обратно в сумку, и слепой обход слотов оставил бы
  // героя с пустой правой рукой — то есть с голыми кулаками на 22 уровне.
  for (const slot of SLOT_IDS) {
    if (slot === 'offHand' && state.equipment.mainHand?.hands === 2) continue
    const item = state.inventory.find((i) => i.slot === slot)
    if (item) state = equipItem(state, item.id)
  }
  state = travelToZone(state, 'ashen-ridge', createRng(707))
  // Тринадцать очков на 22 уровне: хватает на всю ветку ярости и на начало второй.
  for (const talent of TALENTS) {
    for (let rank = 0; rank < talent.maxRank; rank++) state = investTalent(state, talent.id)
  }
  return {
    ...state,
    gold: new Decimal('1.34e7'),
    dungeonsCleared: { [DUNGEONS[0].id]: true },
    talentResets: 2,
    currentHp: state.stats.maxHp.times(0.88).floor(),
    currentMana: state.stats.maxMana,
  }
}

const BUILDERS: Record<PresetName, () => GameState> = { fresh, mid, rich }

export function buildPreset(name: PresetName): GameState {
  return BUILDERS[name]()
}

export function presetPayload(name: PresetName): SavePayloadV17 {
  return payloadFromState(buildPreset(name), FROZEN_TIMESTAMP)
}
