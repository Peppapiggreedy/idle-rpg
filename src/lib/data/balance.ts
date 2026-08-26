// Весь разбросанный игровой баланс в одном месте. Технические константы
// (STEP_MS, лимит шагов за кадр) живут в game/loop.ts — это не баланс.
// Баланс конкретных сущностей — в monsters.ts / upgrades.ts / rarity.ts / loot.ts.
import { Decimal } from '../game/numbers'

// Секунд между ударами Воина на старте.
export const START_ATTACK_SPEED_S = 2.0
// Стартовый урон Воина за один удар (эквивалент прежних 10 урона в секунду).
export const START_DAMAGE_PER_SWING = new Decimal(20)
// Шанс критического удара (вероятность, обычный number).
export const CRIT_CHANCE = 0.05
// Множитель урона критического удара.
export const CRIT_MULTIPLIER = new Decimal(2)
// Пауза между смертью моба и появлением следующего, мс.
export const RESPAWN_DELAY_MS = 300
// Число слотов инвентаря; при полном инвентаре лут не выпадает.
export const INVENTORY_SIZE = 12
// Потолок оплачиваемого оффлайн-прогресса, часов.
export const OFFLINE_CAP_HOURS = 8
// Период автосохранения по игровому времени, секунд.
export const AUTOSAVE_INTERVAL_S = 15
