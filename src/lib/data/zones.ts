// Зоны — данные. Никакой логики выбора или проверок здесь нет: логика читает
// эти поля и сама решает, что игроку доступно и насколько это опасно.
import type { IconName } from '../ui/icons/manifest'
import { Decimal } from '../game/numbers'
import {
  BRUTE,
  COMMON,
  RUNT,
  buildMonster,
  type MonsterArchetype,
  type MonsterRole,
} from './monsters'
import type { MonsterTemplate } from '../types'

export interface Zone {
  id: string
  name: string
  /** Иконка. Тип выведен из реестра: опечатка — ошибка проверки типов. */
  icon: IconName
  // Уровни мобов зоны: конкретный моб получает случайный уровень из диапазона.
  monsterLevelRange: { min: number; max: number }
  monsterPool: MonsterArchetype[]
  rewardMultiplier: Decimal // множитель золота и опыта поверх уровня моба
  unlockRequirement: number // уровень персонажа, с которого зона открыта
  isSafe: boolean // стартовая зона: сюда возвращают, когда возвращаться некуда
}

export const ZONES: Zone[] = [
  {
    id: 'shepherds-meadow',
    icon: 'zone-shepherds-meadow',
    name: 'Пастуший луг',
    monsterLevelRange: { min: 1, max: 2 },
    monsterPool: [
      { id: 'meadow-squelcher', name: 'Луговой хлюпень', role: COMMON },
      { id: 'pasture-tick', name: 'Пастуший клещ', role: RUNT },
      { id: 'straw-lumberer', name: 'Соломенный шатун', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(1),
    unlockRequirement: 1,
    isSafe: true,
  },
  {
    id: 'hollow-quarry',
    icon: 'zone-hollow-quarry',
    name: 'Полая каменоломня',
    monsterLevelRange: { min: 4, max: 6 },
    monsterPool: [
      { id: 'stone-gnawer', name: 'Каменный грызун', role: RUNT },
      { id: 'dust-digger', name: 'Пылевой копач', role: COMMON },
      { id: 'rumbling-caver', name: 'Гулкий обвальщик', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(1.6),
    unlockRequirement: 4,
    isSafe: false,
  },
  {
    id: 'mirefen-hollows',
    icon: 'zone-mirefen-hollows',
    name: 'Топкие лощины',
    monsterLevelRange: { min: 9, max: 12 },
    monsterPool: [
      { id: 'silt-crawler', name: 'Тинный ползун', role: RUNT },
      { id: 'rotfang', name: 'Гнилозуб', role: COMMON },
      { id: 'bog-drifter', name: 'Топляк', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(2.6),
    unlockRequirement: 9,
    isSafe: false,
  },
  {
    id: 'ashen-ridge',
    icon: 'zone-ashen-ridge',
    name: 'Пепельный гребень',
    monsterLevelRange: { min: 16, max: 20 },
    monsterPool: [
      { id: 'ember-stinger', name: 'Уголёк-жалун', role: RUNT },
      { id: 'ash-walker', name: 'Пепельный ходок', role: COMMON },
      { id: 'flint-colossus', name: 'Кремнёвый исполин', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(4.5),
    unlockRequirement: 16,
    isSafe: false,
  },
]

export const ZONE_BY_ID: Record<string, Zone> = Object.fromEntries(
  ZONES.map((z) => [z.id, z]),
)

// Зона, куда возвращают, когда возвращаться больше некуда. Первая безопасная
// в списке — контракт данных: хотя бы одна зона обязана быть isSafe.
export const SAFE_ZONE: Zone = ZONES.find((z) => z.isSafe) ?? ZONES[0]

// Середина диапазона уровней — по ней считается прогноз опасности зоны.
export function averageMonsterLevel(zone: Zone): number {
  return (zone.monsterLevelRange.min + zone.monsterLevelRange.max) / 2
}

// Усреднённая роль пула — нужна ровно для одной вещи: показать игроку,
// сколько ударов «типичного» моба зоны он держит.
function averageRole(zone: Zone): MonsterRole {
  const n = zone.monsterPool.length
  const sum = (pick: (r: MonsterRole) => Decimal) =>
    zone.monsterPool.reduce((acc, a) => acc.plus(pick(a.role)), new Decimal(0)).div(n)
  return {
    hpMult: sum((r) => r.hpMult),
    damageMult: sum((r) => r.damageMult),
    goldMult: sum((r) => r.goldMult),
    xpMult: sum((r) => r.xpMult),
    swingTime: zone.monsterPool.reduce((acc, a) => acc + a.role.swingTime, 0) / n,
  }
}

/** «Типичный моб зоны»: детерминированный, без rng — для показа в UI. */
export function representativeMonster(zone: Zone): MonsterTemplate {
  const archetype: MonsterArchetype = {
    id: `${zone.id}-average`,
    name: zone.name,
    role: averageRole(zone),
  }
  return buildMonster(archetype, averageMonsterLevel(zone), zone.rewardMultiplier)
}

// ВСЕ мобы, которых спавн может выдать в зоне: пул × диапазон уровней.
// spawnMonster берёт из этого множества равновероятно, поэтому усреднение по
// нему — точная оценка темпа зоны, а не «средний моб» (hp входит в темп
// нелинейно, через округление числа ударов вверх).
export function zoneMonsterVariants(zone: Zone): MonsterTemplate[] {
  const variants: MonsterTemplate[] = []
  const { min, max } = zone.monsterLevelRange
  for (let level = min; level <= max; level++) {
    for (const archetype of zone.monsterPool) {
      variants.push(buildMonster(archetype, level, zone.rewardMultiplier))
    }
  }
  return variants
}
