// Апгрейды героя. Только данные, никакой логики.
import { Decimal } from '../game/numbers'
import type { UpgradeDef } from '../types'

export const WEAPON_SHARPENING: UpgradeDef = {
  id: 'weapon-sharpening',
  icon: 'upgrade-weapon-sharpening',
  name: 'Заточка оружия',
  baseCost: new Decimal(10),
  costGrowth: new Decimal(1.15),
  // +14 силы атаки = +1 урона в секунду при любой скорости оружия
  // (14 * weaponSpeed / AP_NORMALIZATION за удар) — прежний эффект заточки.
  damageBonus: new Decimal(14),
}

export const UPGRADES: UpgradeDef[] = [WEAPON_SHARPENING]
