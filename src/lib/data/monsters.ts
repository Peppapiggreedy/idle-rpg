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
//
// ПОЧЕМУ РАЗБРОС УЗКИЙ. Полоса зоны — пять уровней мобов, и один только уровень
// уже даёт внутри зоны двукратный разброс HP (рост линейный от единицы: моб с
// нижнего края полосы вдвое слабее моба с верхнего). Второй такой же разброс от
// ролей клал бы мелочь с нижнего края под пол темпа — она умирала бы раньше,
// чем игрок успевает прочитать её имя. Поэтому HP у мелочи и обычного равны, а
// здоровяк тяжелее в 1.7 раза: три роли читаются как три разных боя РИТМОМ —
// частотой удара и уроном, — а не третьей полоской здоровья.
export const RUNT: MonsterRole = {
  hpMult: new Decimal(1),
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
//
// maxHp подобран под контракт темпа (PACING в data/balance.ts): свежий герой в
// средней экипировке кладёт моба стартовой зоны в среднем за восемь с половиной
// секунд. Это НЕ «сколько не жалко» — это первое число коридора 8-15 секунд,
// от которого пляшет весь остальной масштаб.
export const MONSTER_BASE = {
  maxHp: new Decimal(284),
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
  // ВСЁ РАСТЁТ ЛИНЕЙНО ПО УРОВНЮ МОБА. Это главное решение баланса, и оно
  // не про вкус, а про арифметику.
  //
  // Сила героя растёт линейно и иначе расти не может: заточка дорожает
  // геометрически, поэтому их число — логарифм накопленного золота, а золото
  // растёт экспоненциально; логарифм экспоненты и есть прямая. Экспонента в
  // HP моба рано или поздно обгоняет прямую при ЛЮБЫХ числах: на лестнице из
  // четырёх зон это было незаметно, на одиннадцати бой к концу растягивался
  // впятеро. Прямая против прямой сходится по построению.
  //
  // Награда тоже линейна, и это второе следствие: расти она обязана НЕ БЫСТРЕЕ
  // HP, иначе «золота в час» в дальней зоне всегда больше, сколько бы герой
  // там ни лежал, и выбор зоны вырождается в «лезь так глубоко, как
  // переживёшь». Единственная экспонента в игре — rewardMultiplier зоны
  // (data/zones.ts): она и двигает экономику заточек, из которой растёт та
  // самая прямая силы героя.
  hpPerLevel: new Decimal(0.16),
  // Урон растёт КРУЧЕ HP: запас здоровья героя тоже растёт с уровнем, и без
  // этого дальняя зона переставала бы быть опасной.
  damagePerLevel: new Decimal(0.4),
  rewardPerLevel: new Decimal(0.26),
  // ОПЫТ РАСТЁТ ОТДЕЛЬНО И ГОРАЗДО МЕДЛЕННЕЕ ЗОЛОТА, и это не мелочь.
  //
  // Золото платит за силу и обязано успевать за геометрически дорожающей
  // заточкой. Опыт же — ЧАСЫ игрока: уровень должен означать «сколько ты
  // сыграл», а не «как глубоко залез». На лестнице из двадцати ступеней
  // герой уходит на восемь зон вперёд уже к десятому уровню, и при общей
  // ставке тот, кто переезжает, получал бы опыта в четырнадцать раз больше
  // с удара — то есть один и тот же десятый уровень брался бы за полчаса
  // или за полдня в зависимости от того, ездит игрок или нет.
  xpPerLevel: new Decimal(0.1),
}

// Множители уровня: у моба 1 уровня все равны 1.
export function hpScale(level: number): Decimal {
  return MONSTER_GROWTH.hpPerLevel.times(level - 1).plus(1)
}

/** Множитель опыта: своя, более пологая ставка — см. xpPerLevel. */
export function xpScale(level: number): Decimal {
  return MONSTER_GROWTH.xpPerLevel.times(level - 1).plus(1)
}

export function damageScale(level: number): Decimal {
  return MONSTER_GROWTH.damagePerLevel.times(level - 1).plus(1)
}

export function rewardScale(level: number): Decimal {
  return MONSTER_GROWTH.rewardPerLevel.times(level - 1).plus(1)
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
    xpReward: MONSTER_BASE.xpReward
      .times(role.xpMult)
      .times(xpScale(level))
      .times(rewardMultiplier),
    // Диапазон урона: пока min = max — разброс придёт вместе со способностями.
    damageMin: damage,
    damageMax: damage,
    swingTime: role.swingTime,
  }
}
