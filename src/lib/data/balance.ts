// Весь разбросанный игровой баланс в одном месте. Технические константы
// (STEP_MS, лимит шагов за кадр) живут в game/loop.ts — это не баланс.
// Баланс конкретных сущностей — в monsters.ts / upgrades.ts / rarity.ts / loot.ts.
import { Decimal } from '../game/numbers'

// Стартовый урон Воина в секунду; апгрейды и (позже) экипировка добавляют к нему.
export const START_BASE_DAMAGE = new Decimal(10)
// Пауза между смертью моба и появлением следующего, мс.
export const RESPAWN_DELAY_MS = 300
// Число слотов инвентаря; при полном инвентаре лут не выпадает.
export const INVENTORY_SIZE = 12
// Потолок оплачиваемого оффлайн-прогресса, часов.
export const OFFLINE_CAP_HOURS = 8
// Период автосохранения по игровому времени, секунд.
export const AUTOSAVE_INTERVAL_S = 15
