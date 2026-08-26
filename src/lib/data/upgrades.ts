// Апгрейды героя. Только данные, никакой логики.
import { Decimal } from '../game/numbers'
import type { UpgradeDef } from '../types'

export const WEAPON_SHARPENING: UpgradeDef = {
  id: 'weapon-sharpening',
  name: 'Заточка оружия',
  baseCost: new Decimal(10),
  costGrowth: new Decimal(1.15),
  damageBonus: new Decimal(1),
}

export const UPGRADES: UpgradeDef[] = [WEAPON_SHARPENING]
