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
import { DUNGEON_SCENES, type DungeonSceneKey, type SceneConfig } from './scenery'
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
  /** Ключ интерьера — держится рядом с конфигом ради проверки данных. */
  scenery: DungeonSceneKey
  scene: SceneConfig
  /** Пул бойцов потока. ОДИН на все уровни героя: разницу делает множитель. */
  ladder: readonly MonsterArchetype[]
  /** Множитель наград — то же, что rewardMultiplier у зоны. */
  rewardMultiplier: Decimal
  /** Рубежи наград, строго по возрастанию волн. */
  milestones: readonly TempleMilestone[]
}

/** Сутки реального времени: ровно одна попытка на них. */
export const TEMPLE_DAY_MS = 24 * 60 * 60 * 1000

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
  hp: 1.13,
  damage: 1.07,
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
    zoneId: 'hollow-dell',
    unlockRequirement: 70,
    scenery: 'vault',
    scene: DUNGEON_SCENES.vault,
    ladder: TRIAL_LADDER,
    // Наравне с самыми глубокими зонами: волна и без того множит награду.
    rewardMultiplier: new Decimal(2.9),
    milestones: [
      { wave: 5, recipeId: 'trial-bracer' },
      { wave: 10, recipeId: 'trial-helm' },
      { wave: 15, recipeId: 'trial-charm' },
    ],
  },
]

export const TEMPLE_BY_ID: Record<string, TempleDef> = Object.fromEntries(
  TEMPLES.map((t) => [t.id, t]),
)

/** Храм в игре один: панель и вход спрашивают именно его. */
export const TEMPLE: TempleDef = TEMPLES[0]

/** Уровень бойцов храма: уровень героя, обрезанный потолком. */
export function templeMonsterLevel(heroLevel: number): number {
  return Math.min(LEVEL_CAP, Math.max(1, Math.round(heroLevel)))
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
  const base = buildMonster(archetype, templeMonsterLevel(heroLevel), temple.rewardMultiplier)
  const hp = waveScale(TEMPLE_WAVE_GROWTH.hp, wave)
  const damage = waveScale(TEMPLE_WAVE_GROWTH.damage, wave)
  const reward = waveScale(TEMPLE_WAVE_GROWTH.reward, wave)
  return {
    ...base,
    // id уникален по волне: ни сцена, ни лог не должны принимать двух подряд
    // идущих бойцов за одного и того же.
    id: `${archetype.id}-w${wave}`,
    maxHp: base.maxHp.times(hp),
    damageMin: base.damageMin.times(damage),
    damageMax: base.damageMax.times(damage),
    goldReward: base.goldReward.times(reward),
    xpReward: base.xpReward.times(reward),
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
export function recipeUnlocked(recipeId: string, bestWave: number): boolean {
  const wave = recipeUnlockWave(recipeId)
  return wave === null || bestWave >= wave
}


