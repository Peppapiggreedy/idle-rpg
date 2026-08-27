// Архетипы мобов и ФОРМУЛА МАСШТАБА от уровня. Формула живёт здесь, в данных:
// логика её только вызывает и не знает, как растут числа.
import { Decimal } from '../game/numbers'
import type { MonsterTemplate } from '../types'

// Роль моба в бою — множители относительно обычного моба своего уровня.
export interface MonsterRole {
  hpMult: Decimal
  damageMult: Decimal
  goldMult: Decimal
  xpMult: Decimal
  swingTime: number // секунд между ударами; у мобов оружия нет
}

// Три роли на зону: мелочь бьёт часто и слабо, здоровяк — редко и больно.
export const RUNT: MonsterRole = {
  hpMult: new Decimal(0.7),
  damageMult: new Decimal(0.8),
  goldMult: new Decimal(0.9),
  xpMult: new Decimal(0.9),
  swingTime: 1.2,
}

export const COMMON: MonsterRole = {
  hpMult: new Decimal(1),
  damageMult: new Decimal(1),
  goldMult: new Decimal(1),
  xpMult: new Decimal(1),
  swingTime: 1.6,
}

export const BRUTE: MonsterRole = {
  hpMult: new Decimal(1.7),
  damageMult: new Decimal(1.5),
  goldMult: new Decimal(1.4),
  xpMult: new Decimal(1.3),
  swingTime: 2.6,
}

export interface MonsterArchetype {
  id: string
  name: string
  role: MonsterRole
}

// Обычный моб ПЕРВОГО уровня — точка отсчёта всей шкалы.
export const MONSTER_BASE = {
  maxHp: new Decimal(30),
  damage: new Decimal(4),
  goldReward: new Decimal(5),
  xpReward: new Decimal(3),
}

// Рост за уровень. Три РАЗНЫЕ ставки, и это осознанно:
//   hp     растёт быстро — зона требует урона, а урон герой копит апгрейдами
//          и экипировкой, так что порог входа честный;
//   damage растёт медленно — запас HP героя почти не растёт (только с брони),
//          и при ставке урона наравне с hp дальние зоны были бы физически
//          непроходимы при любой прокачке, то есть мёртвым контентом;
//   reward между ними — дальняя зона выгоднее, но не настолько, чтобы
//          сидеть в ней было единственно верным решением.
export const MONSTER_GROWTH = {
  hp: new Decimal(1.35),
  damage: new Decimal(1.12),
  reward: new Decimal(1.25),
}

// Множители уровня: у моба 1 уровня все равны 1.
export function hpScale(level: number): Decimal {
  return MONSTER_GROWTH.hp.pow(level - 1)
}

export function damageScale(level: number): Decimal {
  return MONSTER_GROWTH.damage.pow(level - 1)
}

export function rewardScale(level: number): Decimal {
  return MONSTER_GROWTH.reward.pow(level - 1)
}

// Готовый шаблон моба: база * роль * уровень, награды ещё и на множитель зоны.
export function buildMonster(
  archetype: MonsterArchetype,
  level: number,
  rewardMultiplier: Decimal,
): MonsterTemplate {
  const reward = rewardScale(level).times(rewardMultiplier)
  const { role } = archetype
  const damage = MONSTER_BASE.damage.times(role.damageMult).times(damageScale(level))
  return {
    id: archetype.id,
    name: archetype.name,
    level,
    maxHp: MONSTER_BASE.maxHp.times(role.hpMult).times(hpScale(level)),
    goldReward: MONSTER_BASE.goldReward.times(role.goldMult).times(reward),
    xpReward: MONSTER_BASE.xpReward.times(role.xpMult).times(reward),
    // Диапазон урона: пока min = max — разброс придёт вместе со способностями.
    damageMin: damage,
    damageMax: damage,
    swingTime: role.swingTime,
  }
}
