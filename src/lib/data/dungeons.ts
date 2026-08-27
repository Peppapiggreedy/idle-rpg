// Данж — данные. Цепочка боссов в фиксированном порядке, вход из зоны,
// требование по уровню. Числа боссов считаются от мобов зоны той же формулой
// масштаба, что и обычные мобы: своей у боссов нет.
import type { IconName } from '../ui/icons/manifest'
import { Decimal } from '../game/numbers'
import { buildMonster, COMMON, type MonsterRole } from './monsters'
import type { SlotId } from './slots'
import type { MonsterTemplate, Rarity } from '../types'

// Лут-пул босса: какие слоты падают и какого качества НЕ НИЖЕ.
export interface BossLoot {
  slots: SlotId[]
  minRarity: Rarity
}

export interface BossDef {
  id: string
  name: string
  level: number
  // Во сколько раз босс крепче и злее обычного моба своего уровня.
  hpMult: Decimal
  damageMult: Decimal
  swingTime: number
  goldMult: Decimal
  xpMult: Decimal
  // Через сколько игровых секунд боя начинается ярость.
  enrageAfterSec: number
  loot: BossLoot
}

export interface DungeonDef {
  id: string
  name: string
  /** Иконка. Тип выведен из реестра: опечатка — ошибка проверки типов. */
  icon: IconName
  zoneId: string // из какой зоны вход
  unlockRequirement: number // уровень персонажа
  bosses: BossDef[] // порядок фиксирован: цепочка идёт сверху вниз
}

// Ярость: каждые enrageStepSec урон растёт на enrageGrowth от исходного.
// Это проверка на урон в секунду — не успеваешь, босс дожимает.
export const ENRAGE_STEP_SEC = 10
export const ENRAGE_GROWTH = 0.5

export const DUNGEONS: DungeonDef[] = [
  {
    id: 'sunken-barrow',
    icon: 'dungeon-sunken-barrow',
    name: 'Затонувший курган',
    zoneId: 'mirefen-hollows',
    unlockRequirement: 12,
    bosses: [
      {
        id: 'barrow-warden',
        name: 'Страж кургана',
        level: 12,
        hpMult: new Decimal(9),
        damageMult: new Decimal(1.25),
        swingTime: 2.4,
        goldMult: new Decimal(12),
        xpMult: new Decimal(10),
        enrageAfterSec: 45,
        loot: { slots: ['chest', 'hands'], minRarity: 'uncommon' },
      },
      {
        id: 'silt-matron',
        name: 'Тинная матрона',
        level: 14,
        hpMult: new Decimal(14),
        damageMult: new Decimal(1.55),
        swingTime: 2.0,
        goldMult: new Decimal(20),
        xpMult: new Decimal(16),
        enrageAfterSec: 40,
        loot: { slots: ['head', 'legs'], minRarity: 'rare' },
      },
      {
        id: 'drowned-king',
        name: 'Утопший король',
        level: 16,
        hpMult: new Decimal(22),
        damageMult: new Decimal(1.9),
        swingTime: 1.8,
        goldMult: new Decimal(35),
        xpMult: new Decimal(28),
        enrageAfterSec: 35,
        loot: { slots: ['weapon', 'trinket'], minRarity: 'epic' },
      },
    ],
  },
]

export const DUNGEON_BY_ID: Record<string, DungeonDef> = Object.fromEntries(
  DUNGEONS.map((d) => [d.id, d]),
)

// Награда за первое полное прохождение — постоянный бонус к опыту.
export const DUNGEON_CLEAR_XP_BONUS = new Decimal(0.05)

/** Шаблон босса: та же buildMonster, что и у обычных мобов, но с ролью босса. */
export function buildBoss(boss: BossDef): MonsterTemplate {
  const role: MonsterRole = {
    hpMult: COMMON.hpMult.times(boss.hpMult),
    damageMult: COMMON.damageMult.times(boss.damageMult),
    goldMult: COMMON.goldMult.times(boss.goldMult),
    xpMult: COMMON.xpMult.times(boss.xpMult),
    swingTime: boss.swingTime,
  }
  return buildMonster({ id: boss.id, name: boss.name, role }, boss.level, new Decimal(1))
}
