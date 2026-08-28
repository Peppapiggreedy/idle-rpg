// Дерево талантов — данные. Ни одного «если талант такой-то» в логике:
// талант либо выдаёт модификаторы в конвейер статов, либо поднимает флаг,
// а поведение по флагу описано там же, в данных.
import type { IconName } from '../ui/icons/manifest'
import { Decimal } from '../game/numbers'
import type { StatModifier } from '../game/stats'
import type { AbilityEffect } from './abilities'


// Три ветки — три СТИЛЯ ИГРЫ, а не три способа поднять один и тот же урон.
// «Ярость» бьёт сильнее и умирает чаще; «Стойкость» переживает то, от чего
// ярость гибнет; «Самообладание» реже останавливается — короче паузы
// регенерации и привалы. Итог у всех трёх сопоставим (проверено прогоном
// баланса), но путь к нему разный, и в этом весь смысл выбора.
export type BranchId = 'fury' | 'endurance' | 'composure'

export interface BranchDef {
  id: BranchId
  name: string
}

export const BRANCHES: BranchDef[] = [
  { id: 'fury', name: 'Ярость' },
  { id: 'endurance', name: 'Стойкость' },
  { id: 'composure', name: 'Самообладание' },
]

// Модификатор таланта БЕЗ source: source проставляется как 'talent:<id>',
// а значение умножается на вложенный ранг.
export type TalentModifier = Omit<StatModifier, 'source'>

// Флаги включают поведение, которое модификатором не выразить.
export type TalentFlag =
  // Скорый выпад начинает накладывать урон по времени.
  | 'quick-strike-bleeds'
  // Воскрешение занимает вдвое меньше времени.
  | 'halved-revive'
  // Привал снимает кулдауны: герой возвращается в бой готовым.
  | 'rest-clears-cooldowns'

export type TalentEffect =
  | { kind: 'modifiers'; mods: TalentModifier[] }
  // Флаг включается с первого ранга; payload описывает, ЧТО он включает.
  | { kind: 'flag'; flag: 'quick-strike-bleeds'; abilityId: string; effect: AbilityEffect }
  | { kind: 'flag'; flag: 'halved-revive'; reviveMultiplier: number }
  // Доля, на которую множатся кулдауны после привала. Ноль — снимаются все;
  // число в данных, а не в коде, чтобы талант можно было ослабить правкой
  // одной строки.
  | { kind: 'flag'; flag: 'rest-clears-cooldowns'; cooldownShare: number }

export interface TalentDef {
  id: string
  name: string
  /** Иконка. Тип выведен из реестра: опечатка — ошибка проверки типов. */
  icon: IconName
  branch: BranchId
  row: number // ряд в ветке, 1 — верхний
  maxRank: number
  requiredPointsInBranch: number // сколько очков нужно вложить в ветку до него
  effect: TalentEffect
}

export const TALENTS: TalentDef[] = [
  {
    id: 'honed-edge',
    icon: 'talent-honed-edge',
    name: 'Отточенный клинок',
    branch: 'fury',
    row: 1,
    maxRank: 5,
    requiredPointsInBranch: 0,
    effect: {
      kind: 'modifiers',
      mods: [{ stat: 'attackPower', kind: 'percent', value: new Decimal(0.04) }],
    },
  },
  {
    id: 'keen-eye',
    icon: 'talent-keen-eye',
    name: 'Острый глаз',
    branch: 'fury',
    row: 2,
    maxRank: 3,
    requiredPointsInBranch: 5,
    effect: {
      kind: 'modifiers',
      mods: [{ stat: 'critChance', kind: 'flat', value: new Decimal(0.03) }],
    },
  },
  {
    id: 'savage-blows',
    icon: 'talent-savage-blows',
    name: 'Свирепые удары',
    branch: 'fury',
    row: 3,
    maxRank: 3,
    requiredPointsInBranch: 8,
    effect: {
      kind: 'modifiers',
      mods: [{ stat: 'critMultiplier', kind: 'flat', value: new Decimal(0.25) }],
    },
  },
  {
    id: 'frenzy',
    icon: 'talent-frenzy',
    name: 'Исступление',
    branch: 'fury',
    row: 4,
    maxRank: 3,
    requiredPointsInBranch: 11,
    effect: {
      kind: 'modifiers',
      // Ускорение ВСЕГДА flat по haste и никогда прибавкой к weaponSpeed:
      // процент от нуля даёт ноль, а плоская правка скорости оружия увела бы
      // её в минус. Правило записано в CLAUDE.md и закреплено тестом.
      mods: [{ stat: 'haste', kind: 'flat', value: new Decimal(0.035) }],
    },
  },
  {
    id: 'offhand-mastery',
    icon: 'talent-offhand-mastery',
    name: 'Левая рука',
    branch: 'fury',
    row: 5,
    maxRank: 3,
    requiredPointsInBranch: 14,
    effect: {
      kind: 'modifiers',
      // Штраф левой руки — СТАТ, поэтому талант правит его модификатором.
      // Ветке ярости он даёт тем больше, чем ближе стиль к двум клинкам:
      // со щитом или двуручным этот талант не даёт ничего, и это честно.
      mods: [{ stat: 'offhandPenalty', kind: 'flat', value: new Decimal(0.05) }],
    },
  },
  {
    id: 'rupture',
    icon: 'talent-rupture',
    name: 'Рваный выпад',
    branch: 'fury',
    row: 6,
    maxRank: 1,
    requiredPointsInBranch: 17,
    // Пример «флага»: умение начинает вести себя иначе, а не просто бьёт сильнее.
    effect: {
      kind: 'flag',
      flag: 'quick-strike-bleeds',
      abilityId: 'quick-strike',
      effect: {
        kind: 'damageOverTime',
        weaponDamagePercent: new Decimal(0.35),
        ticks: 3,
        tickIntervalSec: 1.5,
      },
    },
  },
  {
    id: 'thick-hide',
    icon: 'talent-thick-hide',
    name: 'Толстая шкура',
    branch: 'endurance',
    row: 1,
    maxRank: 5,
    requiredPointsInBranch: 0,
    effect: {
      kind: 'modifiers',
      mods: [{ stat: 'maxHp', kind: 'percent', value: new Decimal(0.1) }],
    },
  },
  {
    id: 'second-wind',
    icon: 'talent-second-wind',
    name: 'Второе дыхание',
    branch: 'endurance',
    row: 2,
    maxRank: 3,
    requiredPointsInBranch: 5,
    effect: {
      kind: 'modifiers',
      mods: [{ stat: 'hpRegen', kind: 'flat', value: new Decimal(4) }],
    },
  },
  {
    id: 'shield-wall',
    icon: 'talent-shield-wall',
    name: 'Стена щитов',
    branch: 'endurance',
    row: 3,
    maxRank: 3,
    requiredPointsInBranch: 8,
    effect: {
      kind: 'modifiers',
      mods: [{ stat: 'blockChance', kind: 'flat', value: new Decimal(0.06) }],
    },
  },
  {
    id: 'bulwark-training',
    icon: 'talent-bulwark-training',
    name: 'Выучка заслона',
    branch: 'endurance',
    row: 4,
    maxRank: 3,
    requiredPointsInBranch: 11,
    effect: {
      kind: 'modifiers',
      mods: [{ stat: 'blockValue', kind: 'percent', value: new Decimal(0.35) }],
    },
  },
  {
    id: 'iron-skin',
    icon: 'talent-iron-skin',
    name: 'Железная кожа',
    branch: 'endurance',
    row: 5,
    maxRank: 3,
    requiredPointsInBranch: 14,
    effect: {
      kind: 'modifiers',
      mods: [{ stat: 'damageReduction', kind: 'flat', value: new Decimal(0.045) }],
    },
  },
  {
    id: 'swift-return',
    icon: 'talent-swift-return',
    name: 'Скорое возвращение',
    branch: 'endurance',
    row: 6,
    maxRank: 1,
    requiredPointsInBranch: 17,
    effect: { kind: 'flag', flag: 'halved-revive', reviveMultiplier: 0.5 },
  },

  // --- Самообладание: реже останавливаться ---
  // Ветка ничего не добавляет к удару и ничего к запасу HP. Её вклад — в
  // ПАУЗАХ: короче задержка регенерации, глубже запас маны, быстрее привал.
  // На бумаге это самая скучная ветка; в прогоне она догоняет две другие
  // за счёт того, что герой просто дольше находится в бою.
  {
    id: 'steady-breath',
    icon: 'talent-steady-breath',
    name: 'Ровное дыхание',
    branch: 'composure',
    row: 1,
    maxRank: 5,
    requiredPointsInBranch: 0,
    effect: {
      kind: 'modifiers',
      mods: [{ stat: 'manaRegen', kind: 'flat', value: new Decimal(2) }],
    },
  },
  {
    id: 'clear-mind',
    icon: 'talent-clear-mind',
    name: 'Ясный ум',
    branch: 'composure',
    row: 2,
    maxRank: 3,
    requiredPointsInBranch: 5,
    effect: {
      kind: 'modifiers',
      // Пауза регенерации — стат: талант сокращает её через конвейер, как и
      // всё остальное. Отрицательной она не станет — конвейер обрезает по нулю.
      mods: [{ stat: 'regenDelay', kind: 'flat', value: new Decimal(-0.8) }],
    },
  },
  {
    id: 'deep-well',
    icon: 'talent-deep-well',
    name: 'Глубокий колодец',
    branch: 'composure',
    row: 3,
    maxRank: 3,
    requiredPointsInBranch: 8,
    effect: {
      kind: 'modifiers',
      // Запас маны важнее регена: пауза платится один раз за всплеск, и чем
      // глубже запас, тем реже она приходит (см. dutyCycle в rotation.ts).
      mods: [{ stat: 'maxMana', kind: 'percent', value: new Decimal(0.18) }],
    },
  },
  {
    id: 'quick-camp',
    icon: 'talent-quick-camp',
    name: 'Скорый привал',
    branch: 'composure',
    row: 4,
    maxRank: 3,
    requiredPointsInBranch: 11,
    effect: {
      kind: 'modifiers',
      mods: [{ stat: 'restDuration', kind: 'flat', value: new Decimal(-2) }],
    },
  },
  {
    id: 'field-medicine',
    icon: 'talent-field-medicine',
    name: 'Походная перевязка',
    branch: 'composure',
    row: 5,
    maxRank: 3,
    requiredPointsInBranch: 14,
    effect: {
      kind: 'modifiers',
      // Сдвигает ВЫБРАННЫЙ игроком порог вверх, а не спорит с ним: настройка
      // приходит в конвейер базой, талант — прибавкой поверх.
      mods: [{ stat: 'restThreshold', kind: 'flat', value: new Decimal(0.06) }],
    },
  },
  {
    id: 'unbroken-focus',
    icon: 'talent-unbroken-focus',
    name: 'Несбитый настрой',
    branch: 'composure',
    row: 6,
    maxRank: 1,
    requiredPointsInBranch: 17,
    // Привал перестаёт быть чистой потерей темпа: из него герой выходит с
    // готовыми умениями. Число в данных — талант можно ослабить, не трогая код.
    effect: { kind: 'flag', flag: 'rest-clears-cooldowns', cooldownShare: 0 },
  },
]

export const TALENT_BY_ID: Record<string, TalentDef> = Object.fromEntries(
  TALENTS.map((t) => [t.id, t]),
)

export function talentsInBranch(branch: BranchId): TalentDef[] {
  return TALENTS.filter((t) => t.branch === branch).sort((a, b) => a.row - b.row)
}

/** Вложенный ранг с обрезкой по maxRank: мусор из сейва не даст лишнего. */
export function rankOf(ranks: Record<string, number>, talentId: string): number {
  const rank = ranks[talentId]
  const max = TALENT_BY_ID[talentId]?.maxRank ?? 0
  if (typeof rank !== 'number' || !Number.isFinite(rank) || rank <= 0) return 0
  return Math.min(Math.floor(rank), max)
}

/**
 * Ранги -> модификаторы конвейера статов. Чистая производная от данных, как
 * buildMonster: значение множится на ранг, source — 'talent:<id>', поэтому
 * раскладка на панели статов показывает таланты построчно.
 */
export function talentModifiers(ranks: Record<string, number>): StatModifier[] {
  const mods: StatModifier[] = []
  for (const talent of TALENTS) {
    const rank = rankOf(ranks, talent.id)
    if (rank <= 0 || talent.effect.kind !== 'modifiers') continue
    for (const mod of talent.effect.mods) {
      mods.push({ ...mod, value: mod.value.times(rank), source: `talent:${talent.id}` })
    }
  }
  return mods
}
