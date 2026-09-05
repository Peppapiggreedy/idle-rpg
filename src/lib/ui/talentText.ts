// ТЕКСТ ДЕРЕВА ТАЛАНТОВ — ОДИН МОДУЛЬ НА ВСЁ, ЧТО ЧИТАЕТ ИГРОК В ДЕРЕВЕ.
//
// Подпись эффекта за ранг, флаг с числами из payload, причина отказа,
// подсказка снятия. Пока дерево было списком, всё это лежало внутри
// `TalentPanel.svelte» и читалось одной панелью. С сеткой значков читателей
// стало два — узел и окно-подсказка у курсора, — и две копии одной фразы
// разошлись бы на первой правке. Правило то же, что у `itemText` и
// `axisText`: логика отдаёт КОД и структуру, слово подставляется здесь.
import { Decimal, type StatId, type TalentBlockReason } from '../game'
import type { TakeBackReason } from '../game/talents'
import {
  TALENT_BY_ID,
  groupMates,
  type TalentDef,
  type TalentFlag,
  type TalentModifier,
} from '../data/talents'
import { ABILITY_BY_ID } from '../data/abilities'
import { flatText } from './statText'
import { abilityTuneText } from './abilityText'
import type { ResourceWords } from './resource'

/** «раз / раза / раз» и прочие тройки: число подставляется снаружи. */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}

/**
 * Названия статов в родительном падеже — «+3 силы», «+2% шанса крита».
 * Ресурс называется по классу: ветки у классов разные, но общие статы
 * описываются одними и теми же строками.
 */
export function statNames(resource: ResourceWords): Record<StatId, string> {
  return {
    strength: 'силы',
    agility: 'ловкости',
    intellect: 'интеллекта',
    vitality: 'выносливости',
    attackPower: 'силы атаки',
    weaponDamageMin: 'урона оружия (мин)',
    weaponDamageMax: 'урона оружия (макс)',
    armor: 'брони',
    maxHp: 'здоровья',
    maxMana: resource.genitive,
    weaponSpeed: 'скорости оружия',
    offhandSpeed: 'скорости левой руки',
    offhandDamageMin: 'урона левой руки (мин)',
    offhandDamageMax: 'урона левой руки (макс)',
    blockChance: 'шанса блока',
    blockValue: 'силы блока',
    offhandPenalty: 'силы левой руки',
    regenDelay: `паузы восстановления ${resource.genitive}`,
    restDuration: 'длины привала',
    restThreshold: 'порога привала',
    haste: 'ускорения',
    critChance: 'шанса крита',
    critMultiplier: 'множителя крита',
    hpRegen: 'восстановления здоровья',
    hpRegenOutOfCombat: 'восстановления здоровья вне боя',
    manaRegen: `восстановления ${resource.genitive}`,
    damageReduction: 'снижения урона',
  }
}

/** Статы, которые сами по себе доля: плоская прибавка к ним пишется процентом. */
const PERCENT_STATS: readonly StatId[] = [
  'critChance',
  'damageReduction',
  'haste',
  'blockChance',
  'offhandPenalty',
  'restThreshold',
]

/** Текст одного модификатора за ОДИН ранг: игрок видит цену следующего очка. */
export function modText(mod: TalentModifier, resource: ResourceWords): string {
  const name = statNames(resource)[mod.stat]
  if (mod.kind === 'percent') return `+${mod.value.times(100).toFixed(0)}% ${name}`
  if (mod.kind === 'multiplier') return `×${mod.value.toFixed(2)} ${name}`
  if (PERCENT_STATS.includes(mod.stat)) {
    return `+${mod.value.times(100).toFixed(mod.value.times(100).lt(10) ? 1 : 0)}% ${name}`
  }
  return `${flatText(mod.value)} ${name}`
}

type FlagEffect = Extract<TalentDef['effect'], { kind: 'flag' }>

const pct = (share: number) => `${(share * 100).toFixed(0)}%`

/**
 * Текст флага собирается из ПЕЙЛОАДА таланта: число живёт в данных, а не в
 * подписи. Ветвления по id таланта здесь нет и быть не должно — таблица
 * закрыта по `TalentFlag`, и новый флаг не пройдёт проверку типов без строки.
 */
export function flagText(effect: FlagEffect, resource: ResourceWords): string {
  const table: Record<TalentFlag, (e: FlagEffect) => string> = {
    'ability-learns-effect': (e) =>
      'abilityId' in e && 'effect' in e
        ? `«${ABILITY_BY_ID[e.abilityId]?.name ?? e.abilityId}» начинает кровить: ` +
          `${e.effect.ticks} ${pluralRu(e.effect.ticks, 'раз', 'раза', 'раз')} ` +
          `по ${Math.round(e.effect.weaponDamagePercent.toNumber() * 100)} % удара оружия ` +
          `каждые ${e.effect.tickIntervalSec} с`
        : 'Умение начинает накладывать урон по времени',
    'ability-extra-charge': (e) =>
      `+${'extraCharges' in e ? e.extraCharges : 1} заряд умения: второе нажатие проходит, пока идёт откат`,
    'double-strike': (e) => `${'chance' in e ? pct(e.chance) : '0%'} шанс, что замах бьёт дважды`,
    'block-reflects': (e) =>
      `Блок возвращает ${'damageShare' in e ? pct(e.damageShare) : '0%'} поглощённого урона в моба`,
    'block-restores-resource': (e) =>
      `Блок возвращает ${'resourceShare' in e ? pct(e.resourceShare) : '0%'} запаса ${resource.genitive}`,
    'kill-refunds-cooldowns': (e) =>
      `Убийство срезает откаты на ${'cooldownShare' in e ? pct(1 - e.cooldownShare) : '0%'}`,
    'rest-clears-cooldowns': () => 'После привала умения готовы: откаты снимаются',
    'shorter-rest': (e) =>
      `Привал короче на ${'durationMultiplier' in e ? pct(1 - e.durationMultiplier) : '0%'}`,
    'faster-revive': (e) =>
      `Воскрешение быстрее на ${'reviveMultiplier' in e ? pct(1 - e.reviveMultiplier) : '0%'}`,
  }
  return table[effect.flag](effect)
}

/** Что делает талант — за один ранг. */
export function effectText(talent: TalentDef, resource: ResourceWords): string {
  const effect = talent.effect
  if (effect.kind === 'flag') return flagText(effect, resource)
  // ТАЛАНТ, ПРАВЯЩИЙ УМЕНИЕ, ПОКАЗЫВАЕТ, ЧЕМ УМЕНИЕ СТАНЕТ. Строка собирается
  // из тех же полей, что и описание самого умения: второй формулировки на
  // игру быть не должно.
  if (effect.kind === 'ability') return abilityTuneText(effect)
  return `${effect.mods.map((m) => modText(m, resource)).join(', ')} за ранг`
}

/**
 * Почему очко не ложится. `holder` — кто из группы уже выбран; его называет
 * логика (`TalentStatus.groupTakenBy`), здесь только слово.
 */
export function blockReasonText(
  reason: TalentBlockReason,
  talent: TalentDef,
  holder: TalentDef | null,
): string {
  switch (reason) {
    case 'other-class':
      return 'Ветка другого класса'
    case 'branch-locked':
      return `Нужно ${talent.requiredPointsInBranch} очков в ветке`
    case 'max-rank':
      return 'Уже максимальный ранг'
    case 'no-points':
      return 'Нет свободных очков'
    // СТРЕЛКА НАЗЫВАЕТ ОПОРНЫЙ ТАЛАНТ ПО ИМЕНИ. «Не открыто» ничего не
    // говорит игроку, который смотрит на дерево впервые.
    case 'needs-talent': {
      const need = talent.requires
      if (!need) return 'Нужен талант выше'
      const anchor = TALENT_BY_ID[need.talentId]?.name ?? need.talentId
      const rank = need.minRank ?? 1
      return rank > 1 ? `Нужно ${rank} ранга в «${anchor}»` : `Нужен талант «${anchor}»`
    }
    // ГРУППА НАЗЫВАЕТ ВЫБРАННОГО СОСЕДА ПО ИМЕНИ: «заперто» не объясняет, чем.
    case 'group-taken':
      return holder ? `Выбран «${holder.name}» — вместе не берутся` : 'Заперт выбором на этаже'
  }
}

/** Что мешает снять очко бесплатно. */
export function takeBackReasonText(reason: TakeBackReason): string {
  switch (reason) {
    case 'nothing-invested':
      return 'Снимать нечего'
    case 'not-this-visit':
      return 'Вложено в прошлый заход — снимается только сбросом'
    case 'blocks-dependent':
      return 'Ниже стоит талант, которому нужен этот ранг'
  }
}

/** Строка о выборе на этаже, пока выбор ещё не сделан: «либо этот, либо тот». */
export function choiceText(talent: TalentDef): string | null {
  const mates = groupMates(talent)
  if (mates.length === 0) return null
  return `Либо этот, либо ${mates.map((m) => `«${m.name}»`).join(' / ')}`
}
