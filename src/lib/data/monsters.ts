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
//
// Разброс hpMult задаёт КРАЯ темпа зоны: мелочь — самый быстрый бой, здоровяк —
// самый долгий, и оба обязаны уложиться между TTK_HARD_FLOOR и TTK_HARD_CEILING.
// Поэтому мелочь подтянута ближе к обычному мобу (иначе она умирала бы за
// секунды), а здоровяк, наоборот, отодвинут: три роли должны читаться как три
// разных боя, а не как один и тот же с чуть разной полоской.
export const RUNT: MonsterRole = {
  hpMult: new Decimal(0.93),
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
  hpMult: new Decimal(2),
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
//
// maxHp подобран под контракт темпа (PACING в data/balance.ts): свежий герой в
// средней экипировке кладёт моба стартовой зоны в среднем за восемь с половиной
// секунд. Это НЕ «сколько не жалко» — это первое число коридора 8-15 секунд,
// от которого пляшет весь остальной масштаб.
export const MONSTER_BASE = {
  maxHp: new Decimal(488),
  damage: new Decimal(2.6),
  goldReward: new Decimal(26),
  xpReward: new Decimal(44),
}

// Рост за уровень. Три РАЗНЫЕ ставки, и это осознанно:
//   hp     догоняет прокачку героя, и не быстрее. Сила атаки героя копится
//          заточками, а их число растёт от ЛОГАРИФМА накопленного золота —
//          то есть почти линейно по уровням. Экспонента круче этой линии
//          означала бы, что бой с каждой зоной растягивается, а положе —
//          что схлопывается; и то и другое ломает коридор темпа. Отсюда
//          скромные 7.2% за уровень моба вместо прежних 35%.
//   damage растёт быстрее hp — иначе дальняя зона перестаёт быть опасной:
//          регенерация героя в бою растёт с уровнем, и урон обязан её
//          обгонять, чтобы «сунуться раньше времени» по-прежнему убивало.
//   reward между ними — дальняя зона выгоднее, но не настолько, чтобы
//          сидеть в ней было единственно верным решением.
export const MONSTER_GROWTH = {
  hp: new Decimal(1.072),
  damage: new Decimal(1.14),
  reward: new Decimal(1.074),
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
