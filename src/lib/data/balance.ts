// Весь разбросанный игровой баланс в одном месте. Технические константы
// (STEP_MS, лимит шагов за кадр) живут в game/loop.ts — это не баланс.
// Баланс конкретных сущностей — в monsters.ts / upgrades.ts / rarity.ts / loot.ts.
import { Decimal } from '../game/numbers'

// Безоружный герой: пока экипировки нет, скорость оружия берётся отсюда.
// weaponSpeed — секунд между ударами, МЕНЬШЕ = быстрее.
export const UNARMED = {
  weaponSpeed: new Decimal(2.0),
}

// Замороженная константа миграции сейва v2 -> v3: тогдашняя скорость удара,
// по которой урон в секунду переводился в урон за удар. НЕ следует за балансом —
// иначе старые сейвы начали бы мигрировать по-разному.
export const LEGACY_V3_SWING_TIME_S = 2.0

// Базовые значения всех стат Воина — ступень «base» конвейера статов.
// Всё в Decimal: конвейер считает единообразно, конверсию в number для
// вероятностей/секунд делает stats.ts на выходе.
export const BASE_STATS = {
  attackPower: new Decimal(20), // урон одного удара (эквивалент прежних 10 dps)
  maxHp: new Decimal(100),
  maxMana: new Decimal(50),
  weaponSpeed: UNARMED.weaponSpeed, // секунд между ударами оружия (меньше = быстрее)
  haste: new Decimal(0), // ускорение в долях: 0.2 = +20% скорости (больше = быстрее)
  critChance: new Decimal(0.05), // вероятность крита
  critMultiplier: new Decimal(2), // множитель урона крита
  hpRegen: new Decimal(1), // hp в секунду В БОЮ (медленный)
  hpRegenOutOfCombat: new Decimal(10), // hp в секунду ВНЕ боя (быстрый)
  manaRegen: new Decimal(2), // маны в секунду (постоянный)
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
// Таймер воскрешения после смерти героя, игровых миллисекунд.
export const REVIVE_DELAY_MS = 30_000
