// Апгрейды героя. Только данные, никакой логики.
import { Decimal } from '../game/numbers'
import type { UpgradeDef } from '../types'

export const WEAPON_SHARPENING: UpgradeDef = {
  id: 'weapon-sharpening',
  icon: 'upgrade-weapon-sharpening',
  name: 'Заточка оружия',
  // Цена и её рост — ЧАСТЬ КОНТРАКТА ТЕМПА, а не «сколько не жалко».
  // Число купленных заточек растёт как логарифм накопленного золота, делённый
  // на логарифм costGrowth, то есть почти линейно по уровням; этот наклон и
  // задаёт, насколько герой сильнее к концу зоны, чем в её начале. Он обязан
  // совпадать со ступенькой HP между зонами — иначе бой либо схлопывается к
  // концу зоны, либо растягивается в её начале.
  baseCost: new Decimal(34),
  costGrowth: new Decimal(1.06),
  // +14 силы атаки = +1 урона в секунду при любой скорости оружия
  // (14 * weaponSpeed / AP_NORMALIZATION за удар) — прежний эффект заточки.
  damageBonus: new Decimal(14),
}

export const UPGRADES: UpgradeDef[] = [WEAPON_SHARPENING]
