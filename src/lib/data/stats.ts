// Иконки статов. Record требует ВСЕ ключи StatId: забыть стат нельзя —
// это ошибка проверки типов, а не пустой квадрат на экране.
import type { StatId } from '../game/stats'
import type { IconName } from '../ui/icons/manifest'

export const STAT_ICONS: Record<StatId | 'swingTime', IconName> = {
  attackPower: 'stat-attackPower',
  weaponDamageMin: 'stat-weaponDamageMin',
  weaponDamageMax: 'stat-weaponDamageMax',
  maxHp: 'stat-maxHp',
  maxMana: 'stat-maxMana',
  weaponSpeed: 'stat-weaponSpeed',
  haste: 'stat-haste',
  critChance: 'stat-critChance',
  critMultiplier: 'stat-critMultiplier',
  hpRegen: 'stat-hpRegen',
  hpRegenOutOfCombat: 'stat-hpRegenOutOfCombat',
  manaRegen: 'stat-manaRegen',
  damageReduction: 'stat-damageReduction',
  swingTime: 'stat-swingTime',
}
