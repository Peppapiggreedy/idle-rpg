// Тексты про зелья, общие для ряда действий и панели ремёсел.
// Логика отдаёт коды причин и модификаторы — формулировки живут здесь.
import { formatNumber, type PotionBlockReason, type StatId } from '../game'
import { POTION_UNLOCK_LEVEL } from '../data/balance'
import type { PotionRecipe } from '../data/recipes'

/** Имена статов в родительном падеже — те же, что в дереве талантов. */
const STAT_NAMES: Partial<Record<StatId, string>> = {
  strength: 'силы',
  agility: 'ловкости',
  intellect: 'интеллекта',
  vitality: 'выносливости',
  attackPower: 'силы атаки',
  maxHp: 'здоровья',
  maxMana: 'запаса ресурса',
  haste: 'скорости',
  critChance: 'шанса крита',
  critMultiplier: 'множителя крита',
  hpRegen: 'восстановления здоровья',
  manaRegen: 'восстановления ресурса',
  damageReduction: 'снижения урона',
  blockChance: 'шанса блока',
  blockValue: 'силы блока',
}

// Статы, которые в игре живут долями: у них «+0.1» читается как «+10%».
const SHARE_STATS: StatId[] = [
  'haste',
  'critChance',
  'damageReduction',
  'blockChance',
  'restThreshold',
]

export function potionReasonText(reason: PotionBlockReason): string {
  const fixed: Record<PotionBlockReason, string> = {
    locked: `Травничество откроется на ${POTION_UNLOCK_LEVEL} уровне`,
    dead: 'Ты мёртв — пить некому',
    empty: 'Нет склянки — свари её в разделе «Сумка»',
    active: 'Уже действует — обновить можно под конец',
  }
  return fixed[reason]
}

/** Что склянка делает, одной строкой: «+30% силы атаки, +10% скорости». */
export function potionEffectText(recipe: PotionRecipe): string {
  return recipe.output.mods
    .map((mod) => {
      const name = STAT_NAMES[mod.stat] ?? mod.stat
      if (mod.kind === 'percent') return `+${Math.round(mod.value.toNumber() * 100)}% ${name}`
      if (SHARE_STATS.includes(mod.stat)) {
        return `+${Math.round(mod.value.toNumber() * 100)}% ${name}`
      }
      return `+${formatNumber(mod.value)} ${name}`
    })
    .join(', ')
}
