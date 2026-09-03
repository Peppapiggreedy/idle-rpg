// Храм испытаний — данные. Бесконечный поток волн, и весь его рост задан
// ЗДЕСЬ ФОРМУЛОЙ, а не таблицей: волн бесконечно много, выписать их руками
// нельзя в принципе.
//
// Устроен он ровно как данж (data/dungeons.ts): руками заданы ПАРАМЕТРЫ —
// уровень входа, зона входа, пул бойцов, ставки роста и рубежи наград, — а
// числа конкретной волны выводит формула. Своего набора мобов на каждый
// уровень героя у храма НЕТ: подстройка под героя — это множитель от его
// уровня, тот самый, которым buildMonster масштабирует любого моба.
import type { IconName } from '../ui/icons/manifest'
import { Decimal } from '../game/numbers'
import { BRUTE, COMMON, RUNT, buildMonster, type MonsterArchetype } from './monsters'
import { LEVEL_CAP } from './balance'
import type { MonsterTemplate } from '../types'

/** Рубеж волн: прошёл волну `wave` — открылся рецепт `recipeId`. */
export interface TempleMilestone {
  wave: number
  recipeId: string
}

export interface TempleDef {
  id: string
  name: string
  /** Иконка. Тип выведен из реестра: опечатка — ошибка проверки типов. */
  icon: IconName
  /** Из какой зоны вход: храм — дверь в конкретном месте карты. */
  zoneId: string
  /** Уровень героя, с которого храм открыт. */
  unlockRequirement: number
  /**
   * СКОЛЬКО ЭТАЖЕЙ В ХРАМЕ. Храм конечен, и это условие всей системы наград:
   * без потолка «полная зачистка» недостижима, а значит недостижимы и
   * награда за неё, и честное «награды исчерпаны» на входе.
   */
  floors: number
  /** Пул бойцов потока. ОДИН на все уровни героя: разницу делает множитель. */
  ladder: readonly MonsterArchetype[]
  /** Множитель наград — то же, что rewardMultiplier у зоны. */
  rewardMultiplier: Decimal
  /** Рубежи наград, строго по возрастанию волн. */
  milestones: readonly TempleMilestone[]
  /**
   * Награда за ЭТАЖ: пыль и золото на первом, дальше по ставке роста.
   * Числа в данных, формула — floorReward ниже.
   */
  floorReward: { dust: number; gold: Decimal; growth: number }
  /**
   * Награда за ПОЛНУЮ зачистку — ровно один раз за игру. Токен уходит в
   * мешок и ждёт преквеста рейда, рецепт открывается насовсем.
   */
  clearReward: { materialId: string; recipeId: string }
}

/** Пауза между волнами, игровых мс. Волна должна читаться как волна. */
export const TEMPLE_WAVE_DELAY_MS = 1200

/**
 * Рост волны. ЕДИНСТВЕННАЯ ГЕОМЕТРИЯ В БОЕВЫХ ЧИСЛАХ, и это осознанно.
 *
 * Весь остальной баланс держится на «прямой против прямой» (см. MONSTER_GROWTH
 * в data/monsters.ts) именно потому, что бой обязан оставаться в коридоре
 * темпа СКОЛЬ УГОДНО ДОЛГО. У храма задача обратная: забег обязан КОНЧИТЬСЯ,
 * иначе «волны идут, пока герой не погибнет» никогда не наступит. Прямая рано
 * или поздно отстанет от растущего героя, степень — нет.
 *
 * HP растёт быстрее урона по той же причине, что и в цепочке боссов: длиннее
 * бой — дольше под ударами, пресс копится сам. Награда посередине: глубина
 * забега стоит дороже, но не настолько, чтобы всё остальное обесценилось.
 */
export const TEMPLE_WAVE_GROWTH = {
  // СЛОЖНОСТЬ НЕСЁТ УРОВЕНЬ ЭТАЖА (templeFloorLevel), а ставки волны остались
  // только на здоровье: этажи обязаны ещё и тяжелеть, а не просто больнее
  // бить. Урон волны множителя больше не имеет вовсе — его даёт уровень моба
  // и общий штраф за разрыв уровней; накладывать сверху ещё и степень значило
  // бы считать одно и то же дважды, и стена вставала бы на третьем этаже.
  hp: 1.05,
  damage: 1,
  reward: 1.1,
}

/** Множитель волны: на первой единица, дальше степень ставки. */
export function waveScale(rate: number, wave: number): number {
  return Math.pow(rate, Math.max(1, wave) - 1)
}

// Пул бойцов храма. Роли те же три, что у мобов зон: храм — не другая
// боевая система, а другая ПОСЛЕДОВАТЕЛЬНОСТЬ тех же схваток.
const TRIAL_LADDER: readonly MonsterArchetype[] = [
  { id: 'trial-acolyte', name: 'Послушник ступеней', role: RUNT },
  { id: 'trial-vower', name: 'Обетник', role: COMMON },
  { id: 'trial-echo', name: 'Отзвук клинка', role: COMMON },
  { id: 'trial-warden', name: 'Смотритель череды', role: BRUTE },
  { id: 'trial-idol', name: 'Обетный истукан', role: BRUTE },
]

// Храм пока один. Список, а не одиночка, — чтобы проверка целостности
// работала с ним как с обычным типом данных, а второй храм не потребовал
// переписывать ни схему, ни логику.
export const TEMPLES: TempleDef[] = [
  {
    id: 'trial-temple',
    name: 'Храм испытаний',
    icon: 'temple',
    // Вход СТОИТ В СВОЕЙ ПОЛОСЕ. Храм задуман контентом семидесятого уровня,
    // и вход обязан лежать там, куда герой приходит на этом уровне: полоса
    // 71-75. Прежняя зона (91-95) открывалась по своей лестнице раньше, чем
    // герой в ней выживал, и «храм с семидесятого» на деле означало «дойди
    // до девяносто первых мобов». Инвариант в content:check держит связь.
    zoneId: 'salt-pit',
    unlockRequirement: 70,
    // Двадцать этажей: столько же, сколько зон в мире. Число видно игроку
    // с первого захода, и «дошёл до 12 из 20» читается сразу.
    floors: 20,
    ladder: TRIAL_LADDER,
    // Наравне с самыми глубокими зонами: волна и без того множит награду.
    rewardMultiplier: new Decimal(2.9),
    milestones: [
      { wave: 5, recipeId: 'trial-bracer' },
      { wave: 10, recipeId: 'trial-helm' },
      { wave: 15, recipeId: 'trial-charm' },
    ],
    // Пыль и золото растут по этажам той же ставкой, что и награда волны:
    // глубина стоит дороже, но не настолько, чтобы обесценить всё остальное.
    floorReward: { dust: 12, gold: new Decimal(2500), growth: 1.18 },
    clearReward: { materialId: 'trial-token', recipeId: 'trial-crown' },
  },
]

export const TEMPLE_BY_ID: Record<string, TempleDef> = Object.fromEntries(
  TEMPLES.map((t) => [t.id, t]),
)

/** Храм в игре один: панель и вход спрашивают именно его. */
export const TEMPLE: TempleDef = TEMPLES[0]

/**
 * УРОВЕНЬ БОЙЦА ЗАДАЁТ ЭТАЖ, А НЕ ГЕРОЙ. Это и есть кривая сложности храма.
 *
 * Раньше боец брал уровень ГЕРОЯ, и храм получался ровным: на семидесятом
 * герой дрался с семидесятыми, на сотом — с сотыми, и глубина забега от
 * уровня почти не зависела. Замер это подтвердил: 70 → 5 этажей, 90 → 5,
 * 100 → 5-7. «Полная зачистка на сотом» при такой кривой недостижима в
 * принципе, а вместе с ней недостижима и награда за неё.
 *
 * Теперь этаж — АБСОЛЮТНАЯ ступень: `TEMPLE_FLOOR_BASE_LEVEL + STEP × этаж`,
 * от 68-го уровня на первом этаже до потолка на семнадцатом и выше.
 *
 * СТЕНОЙ РАБОТАЕТ ОБЩЕЕ ПРАВИЛО МИРА, а не своя механика храма:
 * `levelGapDamageMult` даёт мобам выше героя +30 % урона за уровень после
 * пятого. Замер показал, где эта стена встаёт: хорошо одетый герой (доля
 * снаряжения из контракта ворот данжей) держит разрыв примерно до +8 и
 * гибнет дальше. Отсюда и числа — они не подобраны, а решены:
 *
 *   стена на этаже 5 при герое 70   →  base + 6×step = 78;
 *   стена на этаже 15 при герое 90  →  base + 16×step = 98,
 *
 * то есть step = 2, base = 66. Замер по трём сидам на этих числах:
 * 70 → 5 этажей, 80 → 9-10, 90 → 14, 100 → 20 (полная зачистка).
 * Решение владельца было «примерно 5 / 15 / 20», и точки сходятся в ±1.
 *
 * Выше семнадцатого этажа уровень упирается в потолок мира, и дальше этажи
 * тяжелеют только запасом (TEMPLE_WAVE_GROWTH.hp): выше сотого уровня мобов
 * в игре нет и заводить их ради храма нельзя — это была бы своя лестница
 * рядом с общей.
 */
export const TEMPLE_FLOOR_BASE_LEVEL = 66
export const TEMPLE_FLOOR_LEVEL_STEP = 2

export function templeFloorLevel(floor: number): number {
  const level = TEMPLE_FLOOR_BASE_LEVEL + TEMPLE_FLOOR_LEVEL_STEP * Math.max(1, floor)
  return Math.min(LEVEL_CAP, Math.max(1, Math.round(level)))
}

/**
 * Боец волны: ОБЫЧНЫЙ моб уровня героя, домноженный ставками волны.
 * Своей формулы боя у храма нет — числа считает та же buildMonster.
 */
export function buildTempleMonster(
  temple: TempleDef,
  archetype: MonsterArchetype,
  heroLevel: number,
  wave: number,
): MonsterTemplate {
  // heroLevel больше не участвует в числах бойца: сложность несёт ЭТАЖ.
  // Параметр остаётся в подписи, потому что его передают все зовущие, и
  // убирать его — отдельная правка на пять файлов ради одной строки.
  void heroLevel
  const base = buildMonster(archetype, templeFloorLevel(wave), temple.rewardMultiplier)
  const hp = waveScale(TEMPLE_WAVE_GROWTH.hp, wave)
  const damage = waveScale(TEMPLE_WAVE_GROWTH.damage, wave)
  return {
    ...base,
    // id уникален по волне: ни сцена, ни лог не должны принимать двух подряд
    // идущих бойцов за одного и того же.
    id: `${archetype.id}-w${wave}`,
    maxHp: base.maxHp.times(hp),
    damageMin: base.damageMin.times(damage),
    damageMax: base.damageMax.times(damage),
    // НАГРАДА ЗА ХРАМ — ЭТО ЭТАЖИ, А НЕ МОБЫ. Бойцы храма не дают ни золота,
    // ни опыта, и это не забывчивость, а замер.
    //
    // Пока они платили как обычные мобы, храм на семидесятом уровне давал
    // 386 578 опыта в час против 249 266 в подходящей зоне — в полтора раза
    // больше, — и убийств в час тоже больше (383 против 334), то есть и
    // бросков лута. Кулдауна больше нет, значит заходить можно бесконечно, и
    // храм мгновенно стал бы лучшей фермой в игре. Лут внутри отключён по той
    // же причине (см. applyLootDrop в game/tick.ts).
    //
    // Множитель волны при этом остаётся в hp и уроне: этажи обязаны тяжелеть.
    goldReward: new Decimal(0),
    xpReward: new Decimal(0),
  }
}

/**
 * НАГРАДА ЗА ЭТАЖ: пыль и золото. Растёт степенью от номера этажа — той же
 * формой, что и числа самого этажа (waveScale), поэтому награда не отстаёт
 * от того, насколько тяжелее стал бой.
 */
export function floorReward(temple: TempleDef, floor: number): { dust: number; gold: Decimal } {
  const scale = waveScale(temple.floorReward.growth, floor)
  return {
    dust: Math.max(1, Math.round(temple.floorReward.dust * scale)),
    gold: temple.floorReward.gold.times(scale).floor(),
  }
}

/** Рубеж, который берётся РОВНО этой волной; null — обычная волна. */
export function milestoneAt(temple: TempleDef, wave: number): TempleMilestone | null {
  return temple.milestones.find((m) => m.wave === wave) ?? null
}

/** На какой волне открывается рецепт; null — рецепт известен и так. */
export function recipeUnlockWave(recipeId: string): number | null {
  for (const temple of TEMPLES) {
    for (const milestone of temple.milestones) {
      if (milestone.recipeId === recipeId) return milestone.wave
    }
  }
  return null
}

/**
 * Открыт ли рецепт при таком рекорде по волнам.
 *
 * Правило живёт ЗДЕСЬ и только здесь: им пользуются и крафт, и панель
 * ремёсел. Отдельного списка «выданных наград» в состоянии нет — награда
 * открывается рекордом, а рекорд по определению берётся один раз.
 */
export function recipeUnlocked(recipeId: string, bestWave: number, cleared = false): boolean {
  // Рецепт полной зачистки открывает ФЛАГ, а не рекорд: рекорд можно
  // повторить, зачистку — нет, и награда за неё выдаётся однажды.
  if (TEMPLES.some((t) => t.clearReward.recipeId === recipeId)) return cleared
  const wave = recipeUnlockWave(recipeId)
  return wave === null || bestWave >= wave
}


