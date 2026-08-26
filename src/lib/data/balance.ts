// Весь разбросанный игровой баланс в одном месте. Технические константы
// (STEP_MS, лимит шагов за кадр) живут в game/loop.ts — это не баланс.
// Баланс конкретных сущностей — в monsters.ts / upgrades.ts / rarity.ts / loot.ts.
import { Decimal } from '../game/numbers'

// Секунд между ударами на старте (используется и миграцией сейва v2 -> v3).
export const START_ATTACK_SPEED_S = 2.0

// Базовые значения всех стат Воина — ступень «base» конвейера статов.
// Всё в Decimal: конвейер считает единообразно, конверсию в number для
// вероятностей/секунд делает stats.ts на выходе.
export const BASE_STATS = {
  attackPower: new Decimal(20), // урон одного удара (эквивалент прежних 10 dps)
  maxHp: new Decimal(100),
  maxMana: new Decimal(50),
  attackSpeed: new Decimal(START_ATTACK_SPEED_S), // секунд между ударами
  critChance: new Decimal(0.05), // вероятность крита
  critMultiplier: new Decimal(2), // множитель урона крита
  hpRegen: new Decimal(0), // hp в секунду
  manaRegen: new Decimal(0), // маны в секунду
  damageReduction: new Decimal(0), // доля срезаемого входящего урона, 0..1
}
// Пауза между смертью моба и появлением следующего, мс.
export const RESPAWN_DELAY_MS = 300
// Число слотов инвентаря; при полном инвентаре лут не выпадает.
export const INVENTORY_SIZE = 12
// Потолок оплачиваемого оффлайн-прогресса, часов.
export const OFFLINE_CAP_HOURS = 8
// Период автосохранения по игровому времени, секунд.
export const AUTOSAVE_INTERVAL_S = 15
