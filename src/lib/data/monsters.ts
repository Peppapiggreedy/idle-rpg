// Мобы Пастушьего луга — первой зоны. Только данные, никакой логики.
import { Decimal } from '../game/numbers'
import type { MonsterTemplate } from '../types'

export const MEADOW_SQUELCHER: MonsterTemplate = {
  id: 'meadow-squelcher',
  name: 'Луговой хлюпень',
  maxHp: new Decimal(30),
  goldReward: new Decimal(5),
  xpReward: new Decimal(3),
}

// Моб, с которого начинается игра.
export const FIRST_MONSTER = MEADOW_SQUELCHER
