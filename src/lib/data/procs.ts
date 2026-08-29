// =============================================================================
// Проки — ЧИСЛА, а механика живёт в game/combat.ts. Здесь ровно три вещи:
// вероятность на удар, внутренний кулдаун и эффект. Ни одного «если прок
// такой-то» ни здесь, ни в логике: эффект — размеченное объединение, и его
// payload лежит рядом с ним.
//
// ЗАЧЕМ ВНУТРЕННИЙ КУЛДАУН ОБЯЗАТЕЛЕН. Без него темп срабатываний равен
// шанс × ударов_в_секунду и растёт вместе с ускорением — то есть быстрое
// оружие получало бы двойную выгоду (чаще бьёт И чаще прокает), а оценка
// урона в секунду поехала бы вслед за ним. Кулдаун ставит потолок, и тот же
// потолок стоит в оценке (см. procRatePerSecond в game/combat.ts).
//
// Таблица реликвий — ПО ТИРАМ: данжей станет восемь, и каждая новая ступень
// приносит свою реликвию с прокoм сама, без правки этого файла.
import { Decimal } from '../game/numbers'
import type { IconName } from '../ui/icons/manifest'
import { DUNGEONS, MAX_DUNGEON_TIER } from './dungeons'

/**
 * Что делает прок. Ровно два вида и оба с payload'ом рядом:
 *   damage — лишний удар долей удара ОРУЖИЯ (та же rollSwing, своей формулы
 *            у прока нет — иначе он перестал бы масштабироваться от оружия);
 *   ward   — восстанавливает долю запаса здоровья.
 */
export type ProcEffect =
  | { kind: 'damage'; weaponDamagePercent: Decimal }
  | { kind: 'ward'; healShare: number }

export interface ProcDef {
  id: string
  /** Имя для игрока: совпадает с именем реликвии — в логе так и читается. */
  name: string
  icon: IconName
  /** Вероятность на ОДИН удар героя, доля 0..1. Не Decimal: это вероятность. */
  chance: number
  /** Внутренний кулдаун, мс. Чаще прок не срабатывает никогда. */
  internalCooldownMs: number
  effect: ProcEffect
}

/** Шанс на удар — общий у всех проков: тир меняет силу, а не частоту.
 *  Иначе высокий тир выигрывал бы дважды и в оценке, и в ощущении. */
export const PROC_CHANCE = 0.12

/** Внутренний кулдаун по семье эффекта, мс. Оберег «лечит» реже: его выгода
 *  не тает в перебое, и одинаковый кулдаун сделал бы его строго лучше. */
export const PROC_ICD_MS: Record<ProcEffect['kind'], number> = {
  damage: 8000,
  ward: 12000,
}

// Сила прока от тира — прямая, как и всё остальное в игре (см. MONSTER_GROWTH).
// Урон: 120% удара оружия на первом тире, +20% за ступень.
export const PROC_DAMAGE_BASE = new Decimal(1.2)
export const PROC_DAMAGE_STEP = new Decimal(0.2)
// Оберег: 3% запаса здоровья за срабатывание, +0.5% за ступень.
export const PROC_WARD_BASE = 0.03
export const PROC_WARD_STEP = 0.005

/** Эффект тира: нечётные ступени бьют, чётные лечат. Чередование — это
 *  чтобы обе ветки оценки (урон в секунду и потеря HP) жили на живых данных,
 *  а не на одной проверенной и одной написанной впрок. */
function effectOfTier(tier: number): ProcEffect {
  const step = Math.max(0, tier - 1)
  return tier % 2 === 1
    ? { kind: 'damage', weaponDamagePercent: PROC_DAMAGE_BASE.plus(PROC_DAMAGE_STEP.times(step)) }
    : { kind: 'ward', healShare: PROC_WARD_BASE + PROC_WARD_STEP * step }
}

/** Реликвия тира: имя, иконка вещи, иконка прока и сам эффект. */
export interface RelicTier {
  tier: number
  name: string
  icon: IconName
  procIcon: IconName
  effect: ProcEffect
}

const RELIC_LORE: ReadonlyArray<{ name: string; icon: IconName }> = [
  { name: 'Отзвук клинка', icon: 'relic-echo' },
  { name: 'Терновый венец', icon: 'relic-thorn' },
  { name: 'Грозовой сколок', icon: 'relic-storm' },
  { name: 'Витая раковина', icon: 'relic-shell' },
  { name: 'Гранёное сердце', icon: 'relic-facet' },
  { name: 'Немой знак', icon: 'relic-sign' },
  { name: 'Искровая жила', icon: 'relic-spark' },
  { name: 'Златая створка', icon: 'relic-gilded' },
]

export const RELIC_TIERS: RelicTier[] = RELIC_LORE.map((lore, index) => {
  const tier = index + 1
  const effect = effectOfTier(tier)
  return {
    tier,
    ...lore,
    procIcon: effect.kind === 'damage' ? 'proc-strike' : 'proc-ward',
    effect,
  }
})

/** Реликвия по тиру. Кривой тир приводится к таблице: про него скажет
 *  content:check, а игра не должна падать в undefined. */
export function relicTier(tier: number): RelicTier {
  const clamped = Math.min(MAX_DUNGEON_TIER, Math.max(1, Math.floor(tier || 1)))
  return RELIC_TIERS[clamped - 1]
}

/** Id прока данжа — одна функция на всю игру, как и у реагента. */
export function procIdOf(dungeonId: string): string {
  return `proc-${dungeonId}`
}

export const PROCS: ProcDef[] = DUNGEONS.map((dungeon) => {
  const relic = relicTier(dungeon.tier)
  return {
    id: procIdOf(dungeon.id),
    name: relic.name,
    icon: relic.procIcon,
    chance: PROC_CHANCE,
    internalCooldownMs: PROC_ICD_MS[relic.effect.kind],
    effect: relic.effect,
  }
})

export const PROC_BY_ID: Record<string, ProcDef> = Object.fromEntries(
  PROCS.map((p) => [p.id, p]),
)


