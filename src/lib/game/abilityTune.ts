// =============================================================================
// ЭФФЕКТИВНОЕ УМЕНИЕ: база из данных плюс всё, что подкрутили таланты.
//
// Талант правит умение ДАННЫМИ — он называет ПОЛЕ и ОПЕРАЦИЮ, а применяет их
// эта функция. Ни одного `if (талант === ...)` и ни одного `if (умение ===
// ...)`: список настраиваемых полей закрыт и лежит в `data/abilities.ts`,
// талант не может тронуть то, чего в нём нет.
//
// ПОРЯДОК ТОТ ЖЕ, ЧТО У СТАТОВ, и это не совпадение — иначе игроку пришлось
// бы держать в голове две разные арифметики:
//
//     база → +Σ(points × ранг) → ×(1 + Σ(percent × ранг)) → ×Π(multiplier^ранг)
//
// отдельно по каждому полю.
//
// ГЛАВНОЕ ПРАВИЛО, БЕЗ КОТОРОГО ВСЁ ОСТАЛЬНОЕ ВЫГЛЯДИТ СЛОМАННЫМ: ЭФФЕКТИВНОЕ
// УМЕНИЕ ЧИТАЮТ ВСЕ. Автокаст (порог Милости, сдвинутый талантом, обязан
// сдвинуть и гейт автокаста), модель боя, оффлайн, контракты и СБОРКА
// ОПИСАНИЯ. Описание уже собирается из полей — теперь оно собирается из
// эффективных полей, и игрок читает в книге, чем умение СТАЛО, а не чем оно
// было до талантов.
import { Decimal } from './numbers'
import {
  ABILITY_BY_ID,
  ABILITY_TUNABLE,
  type AbilityDef,
  type AbilityTune,
  type AbilityTuneField,
} from '../data/abilities'
import { TALENTS, rankOf } from '../data/talents'
import { talentAbilityEffect, type TalentRanks } from './talents'

/** Накопитель по одному полю: сдвиг, доля и произведение множителей. */
interface Accum {
  points: number
  percent: number
  multiplier: number
  set: string | null
}

const EMPTY: Accum = { points: 0, percent: 0, multiplier: 1, set: null }

/**
 * Собрать правки всех взятых талантов по одному умению.
 *
 * Поиск идёт по `abilityId` в эффекте таланта, а не по имени таланта: два
 * класса могут править одно и то же умение разными талантами, и логике всё
 * равно, каким именно.
 */
export function tunesFor(ranks: TalentRanks, abilityId: string): Map<string, Accum> {
  const acc = new Map<string, Accum>()
  const take = (field: string): Accum => {
    const found = acc.get(field)
    if (found) return found
    const fresh = { ...EMPTY }
    acc.set(field, fresh)
    return fresh
  }
  for (const talent of TALENTS) {
    const effect = talent.effect
    if (effect.kind !== 'ability' || effect.abilityId !== abilityId) continue
    const rank = rankOf(ranks, talent.id)
    if (rank <= 0) continue
    for (const tune of effect.tune) {
      const slot = take(tune.field)
      if (tune.kind === 'points') slot.points += tune.value * rank
      else if (tune.kind === 'percent') slot.percent += tune.value * rank
      else if (tune.kind === 'multiplier') slot.multiplier *= Math.pow(tune.value, rank)
      else if (tune.kind === 'set') slot.set = tune.value
    }
  }
  return acc
}

/** Применить накопленное к одному числу. Порядок — как в конвейере статов. */
function apply(base: number, slot: Accum | undefined): number {
  if (!slot) return base
  return (base + slot.points) * (1 + slot.percent) * slot.multiplier
}

const applyD = (base: Decimal, slot: Accum | undefined): Decimal =>
  slot ? new Decimal(apply(base.toNumber(), slot)) : base

/**
 * Умение, каким его видит игра прямо сейчас: с учётом всех взятых талантов.
 *
 * Талантов нет — возвращается ТОТ ЖЕ ОБЪЕКТ, а не копия. Это не экономия
 * памяти, а признак честности: пока дерево пустое, эффективное умение обязано
 * быть базовым БИТ В БИТ, иначе golden поедет от одной только правки формы.
 */
export function tuneAbility(def: AbilityDef, ranks: TalentRanks): AbilityDef {
  const acc = tunesFor(ranks, def.id)
  // ВЫУЧЕННЫЙ ЭФФЕКТ — ЧАСТЬ ЭФФЕКТИВНОГО УМЕНИЯ. Флаг `ability-learns-effect`
  // («Рваный выпад» учит Скорый выпад кровить) подшивается ЗДЕСЬ, а не только
  // в тике: пока его читал один `effectFrom`, модель боя, перебор четвёрок,
  // оффлайн, оси героя и книга умений видели у Скорого выпада пустой эффект
  // и мерили талант нулём — прибор сравнивал «ноль» с «+5 %» и называл выбор
  // односторонним. Свой эффект умения сильнее выученного: учить кровить то,
  // что уже кровит, талант не может.
  const learned = def.effect ? null : talentAbilityEffect(ranks, def.id)
  if (acc.size === 0 && !learned) return def

  const get = (field: AbilityTuneField | 'type') => acc.get(field)
  const out: AbilityDef = {
    ...def,
    cooldownSec: apply(def.cooldownSec, get('cooldownSec')),
    manaCost: applyD(def.manaCost, get('manaCost')),
    weaponDamagePercent: applyD(def.weaponDamagePercent, get('weaponDamagePercent')),
  }

  const type = get('type')?.set
  if (type === 'instant' || type === 'onNextSwing') out.type = type

  const baseEffect = def.effect ?? learned
  if (baseEffect) {
    out.effect = {
      ...baseEffect,
      weaponDamagePercent: applyD(
        baseEffect.weaponDamagePercent,
        get('effectWeaponDamagePercent'),
      ),
      // Тиков не бывает полтора: округляем к ближайшему, как и всё штучное.
      ticks: Math.max(1, Math.round(apply(baseEffect.ticks, get('effectTicks')))),
    }
  }
  if (def.heal) {
    out.heal = {
      maxHpShare: applyD(def.heal.maxHpShare, get('healMaxHpShare')),
      autocastBelowHpShare: apply(def.heal.autocastBelowHpShare, get('healAutocastBelowHpShare')),
    }
  }
  if (def.weaken) {
    out.weaken = {
      damageShare: apply(def.weaken.damageShare, get('weakenDamageShare')),
      hits: Math.max(1, Math.round(apply(def.weaken.hits, get('weakenHits')))),
    }
  }
  if (def.detonate) {
    out.detonate = { multiplier: apply(def.detonate.multiplier, get('detonateMultiplier')) }
  }
  if (def.absorb) {
    out.absorb = {
      armorShare: apply(def.absorb.armorShare, get('absorbArmorShare')),
      blockShare: apply(def.absorb.blockShare, get('absorbBlockShare')),
      durationSec: apply(def.absorb.durationSec, get('absorbDurationSec')),
    }
  }
  if (def.execute) {
    out.execute = {
      belowHpShare: apply(def.execute.belowHpShare, get('executeBelowHpShare')),
    }
  }
  if (def.brand) {
    out.brand = {
      damageShare: apply(def.brand.damageShare, get('brandDamageShare')),
      durationSec: apply(def.brand.durationSec, get('brandDurationSec')),
      autocastAboveHpShare: apply(
        def.brand.autocastAboveHpShare,
        get('brandAutocastAboveHpShare'),
      ),
    }
  }
  if (def.freeCasts) {
    out.freeCasts = {
      casts: Math.max(1, Math.round(apply(def.freeCasts.casts, get('freeCastsCasts')))),
    }
  }
  if (def.stance) {
    out.stance = {
      damageShare: apply(def.stance.damageShare, get('stanceDamageShare')),
      mitigationShare: apply(def.stance.mitigationShare, get('stanceMitigationShare')),
      durationSec: apply(def.stance.durationSec, get('stanceDurationSec')),
    }
  }
  return out
}

/** Эффективное умение по id. `undefined` — такого умения нет вовсе. */
export function tunedById(abilityId: string, ranks: TalentRanks): AbilityDef | undefined {
  const def = ABILITY_BY_ID[abilityId]
  return def ? tuneAbility(def, ranks) : undefined
}

/** Все объявленные настраиваемыми поля — для проверок контента. */
export const TUNABLE_FIELDS = Object.keys(ABILITY_TUNABLE) as AbilityTuneField[]

/** Годится ли операция для этого поля. Проверяется схемой, а не типом: в
 *  данных талант может прийти из правленого руками файла. */
export function tuneAllowed(tune: AbilityTune): boolean {
  if (tune.field === 'type') return tune.kind === 'set'
  const family = ABILITY_TUNABLE[tune.field as AbilityTuneField]
  if (family === undefined) return false
  if (family === 'shift') return tune.kind === 'points'
  return tune.kind === 'percent' || tune.kind === 'multiplier'
}
