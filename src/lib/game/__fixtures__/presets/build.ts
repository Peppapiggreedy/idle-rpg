// Сборка пресетов для съёмки скриншотов. Состояния строятся ТЕМИ ЖЕ функциями,
// что и живая игра — вложением очков, надеванием лута, честными бросками, —
// поэтому пресет не может «застыть» в форме, которой в игре не бывает.
//
// Модуль в бандл игры не попадает: его импортирует только тест, который
// перегенерирует json. Сама игра читает уже готовые json из этой же папки.
import { Decimal } from '../../numbers'
import { createRng } from '../../rng'
import { createInitialState, type GameState } from '../../state'
// saveId у пресета ФИКСИРОВАН вместе с сидом: он входит в сейв, а снимок
// обязан быть воспроизводим до байта.
import { DEFAULT_CLASS } from '../../../data/classes'
import { CRAFT_UNLOCK_LEVEL } from '../../../data/balance'
import { ensureStats } from '../../stats'
import { xpToNextLevel } from '../../formulas'
import { equipItem } from '../../equipment'
import { equipUpgrades } from '../../simulate'
import { rollBossLoot, rollLoot } from '../../loot'
import { investTalent } from '../../talents'
import { travelToZone } from '../../zones'
import { payloadFromState, type SavePayloadV21 } from '../../save'
import { DUNGEONS } from '../../../data/dungeons'
import { TALENTS } from '../../../data/talents'
import { SLOT_IDS } from '../../../data/slots'
import type { Item } from '../../../types'

export type PresetName = 'fresh' | 'mid' | 'rich' | 'tree'

export const PRESET_NAMES: PresetName[] = ['fresh', 'mid', 'rich', 'tree']

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

function addToInventory(state: GameState, items: Item[]): GameState {
  return { ...state, inventory: [...state.inventory, ...items], itemSeq: state.itemSeq + items.length }
}

// Набрать предметов честным броском лута; пустые броски пропускаем.
function rollItems(state: GameState, seed: number, count: number, level = 1): Item[] {
  const rng = createRng(seed)
  const items: Item[] = []
  let seq = state.itemSeq
  for (let attempt = 0; attempt < count * 40 && items.length < count; attempt++) {
    const item = rollLoot(rng, seq, level)
    if (!item) continue
    items.push(item)
    seq += 1
  }
  return items
}

/** Новый игрок: всё по нулям, стартовая зона. */
function fresh(): GameState {
  return createInitialState(101, DEFAULT_CLASS.id, 101)
}

/** Середина игры: десятый уровень, экипировка, умения на кулдауне. */
function mid(): GameState {
  let state = createInitialState(202, DEFAULT_CLASS.id, 202)
  state = atLevel(state, 10)
  // Оружие и пара вещей — надеваем через обычный equipItem. Оружие берём
  // ЯВНО, а не первым по порядку: без него герой на снимке дерётся кулаками,
  // и «урон оружия 8–12» в статах читается как поломка, а не как пустая рука.
  const loot = rollItems(state, 2024, 14, 8)
  state = addToInventory(state, loot)
  // Оружие берём ЯВНО: без него герой на снимке дерётся кулаками, и «урон
  // оружия 8-12» в статах читается как поломка, а не как пустая рука.
  const weapon = loot.find((i) => i.slot === 'mainHand')
  if (weapon) state = equipItem(state, weapon.id)
  // ОСТАЛЬНОЕ НАДЕВАЕТ МОДЕЛЬ ИГРОКА, а не слепой обход слотов. Прежний отбор
  // брал «первые четыре из сумки»: два слота оставались пустыми, а из надетого
  // почти ничего не давало живучести — герой десятого уровня выходил с 345
  // запаса вместо восьмисот с лишним у эталона своей полосы. Пока мобы почти
  // не били, это было незаметно; с ценой боя в четверть запаса такой герой
  // погибал прямо на снимке. equipUpgrades — та же оценка «лучше или нет»,
  // которой игра зажигает значок апгрейда, и она сама берёт живучесть, когда
  // та начинает решать.
  state = equipUpgrades(state)
  // Остаток сумки подрезаем до четырёх находок. Бросков стало больше — иначе
  // на иной слот не выпадало ни одного кандидата, — но лишнее в сумке делало
  // бы «середину» богаче «поздней игры», а пресеты обязаны отличаться друг от
  // друга именно этим (см. presets.test.ts).
  state = { ...state, inventory: state.inventory.slice(0, 4) }
  state = travelToZone(state, 'hollow-quarry', createRng(303))
  // ПЕРВОЕ ОЧКО ТАЛАНТА ПРИХОДИТ КАК РАЗ НА ДЕСЯТОМ УРОВНЕ И ОСТАЁТСЯ
  // НЕВЛОЖЕННЫМ. Это самый интересный момент экрана талантов — тот, ради
  // которого его и открывают, — и пресет обязан его показывать.
  //
  // Раньше здесь стояло вложение в 'honed-edge'. Таланта с таким id в данных
  // нет (он зовётся 'wrath-honed-edge'), `investTalent` молча возвращал то же
  // состояние, и «середина игры» уже давно строилась без него. Вызов, который
  // ничего не делает, — хуже отсутствующего: он обещает то, чего нет.
  return {
    ...state,
    gold: new Decimal(4820),
    // Умения в разных фазах: одно готово, одно тикает, одно только ушло в кд.
    abilityCooldownsMs: { 'rending-wound': 2400, 'shattering-blow': 9100 },
    gcdMsLeft: 600,
    // Запас ВЫШЕ порога привала (0.6), и это не косметика: с ценой боя в
    // четверть запаса герой на 62% уходит отдыхать после первого же убийства,
    // а до него успевает погибнуть — снимок «середины игры» показывал труп.
    currentHp: state.stats.maxHp.times(0.85).floor(),
    currentMana: state.stats.maxMana.times(0.45).floor(),
  }
}

/** Поздняя игра: полный инвентарь, все зоны, вложенные таланты, данж пройден. */
function rich(): GameState {
  let state = createInitialState(404, DEFAULT_CLASS.id, 404)
  // УРОВЕНЬ БЕРЁТСЯ ОТ ПОРОГА РЕМЁСЕЛ, А НЕ ВПИСАН ЧИСЛОМ. Пресет «поздний»
  // существует ради того, чтобы на нём было видно открытое содержимое; с
  // лестницей открытий (панель закрытой механики не отображается ВОВСЕ)
  // прежние 22 уровня перестали показывать ремёсла — а значит и пошлину
  // крафта, и рецепты. Двойка сверху — чтобы порог был взят с запасом, а не
  // ровно в край.
  state = atLevel(state, CRAFT_UNLOCK_LEVEL + 2)
  // Лут босса даёт высокие тиры — в инвентаре видно все цвета редкости.
  const bossLoot = DUNGEONS[0].bosses.flatMap((boss, index) =>
    rollBossLoot(boss.loot, createRng(500 + index), 100 + index * 10, boss.level),
  )
  // Семь бросков: после надевания по слотам сумка обязана остаться заметно
  // полнее, чем у среднего героя, — это и отличает поздний пресет.
  state = addToInventory(state, [...rollItems(state, 606, 7, 28), ...bossLoot])
  // Надеваем по одному предмету на слот: берём первый подходящий. Левую руку
  // пропускаем, если в правой двуручное: по правилам игры вещь в левой руке
  // выбивает двуручное обратно в сумку, и слепой обход слотов оставил бы
  // героя с пустой правой рукой — то есть с голыми кулаками на 22 уровне.
  for (const slot of SLOT_IDS) {
    if (slot === 'offHand' && state.equipment.mainHand?.grip === 'two') continue
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

/**
 * ДЕРЕВО С СДЕЛАННЫМ ВЫБОРОМ: тот же уровень, что у «позднего», но очки
 * положены так, чтобы на экране талантов было видно всё, ради чего сетка
 * существует, — взятый ключевой узел, запертый выбором сосед, набранная
 * стрелка рядом с ненабранной. Заливка «сверху вниз» у `rich` до ключевого
 * этажа не доходит, а подменять её значило бы сдвинуть все снимки позднего
 * пресета разом.
 */
function tree(): GameState {
  let state = createInitialState(505, DEFAULT_CLASS.id, 505)
  state = atLevel(state, CRAFT_UNLOCK_LEVEL + 2)
  // Двадцать очков в четыре верхних этажа Гнева, «Глубокий надрез» до
  // третьего ранга — опоры «Кровоточащей кромки»; затем ключевой пятого
  // этажа и остаток в третий.
  const order: [string, number][] = [
    ['wrath-honed-edge', 6],
    ['wrath-firm-hand', 5],
    ['wrath-keen-eye', 6],
    ['wrath-deep-cut', 3],
    ['wrath-rupture', 1],
    ['wrath-savage-blows', 6],
  ]
  for (const [id, ranks] of order) {
    for (let rank = 0; rank < ranks; rank++) state = investTalent(state, id)
  }
  return { ...state, currentHp: state.stats.maxHp, currentMana: state.stats.maxMana }
}

const BUILDERS: Record<PresetName, () => GameState> = { fresh, mid, rich, tree }

export function buildPreset(name: PresetName): GameState {
  return BUILDERS[name]()
}

export function presetPayload(name: PresetName): SavePayloadV21 {
  return payloadFromState(buildPreset(name), FROZEN_TIMESTAMP)
}
