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
  type HoundTuneField,
  type CarryMark,
  type ProcCondition,
  type ProcTrigger,
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
    doubleStrike: 'шанса двойного удара',
    dodge: 'уворота',
    reviveSpeed: 'скорости подъёма',
    houndMaxHp: 'запаса пса',
    houndHpRegen: 'восстановления пса',
    houndAttackPower: 'силы укуса',
    houndCritChance: 'шанса крита пса',
    houndArmor: 'брони пса',
    houndDodge: 'уворота пса',
    houndReviveSpeed: 'скорости возврата пса',
    redirectShare: 'доли пса во входящем',
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

/** Поля спутника словами: закрыто по `HoundTuneField`. */
const HOUND_FIELD_NAME: Record<HoundTuneField, string> = {
  hitShare: 'укус пса',
  swingTime: 'замах пса',
  redirectShare: 'доля ударов на псе',
  maxHpShare: 'запас пса',
  returnSec: 'время возврата пса',
  regenInCombat: 'восстановление пса в бою',
  regenOutOfCombat: 'восстановление пса вне боя',
}

const pct = (share: number) => `${(share * 100).toFixed(0)}%`

/**
 * СОБЫТИЯ ПРОКОВ СЛОВАМИ. Запись закрыта по `ProcTrigger`: новое событие не
 * пройдёт проверку типов, пока про него не решат, как оно читается игроку.
 */
const PROC_TRIGGER_TEXT: Record<ProcTrigger, string> = {
  crit: 'крит',
  hit: 'попадание',
}

/**
 * УСЛОВИЯ ПРОКОВ СЛОВАМИ. Запись закрыта по роду условия — и по тому же
 * доводу, что и события: новое условие обязано получить свою строку, иначе
 * игрок прочитает прок как безусловный.
 */
const PROC_WHEN_TEXT: Record<ProcCondition['kind'], (c: ProcCondition) => string> = {
  'target-below': (c) => `по цели ниже ${pct(c.share)} здоровья`,
}

/** МЕТКИ СЛОВАМИ — для таланта переноса. Запись закрыта по `CarryMark`. */
const CARRY_MARK_TEXT: Record<CarryMark, string> = {
  monsterBrand: 'Клеймо',
}


/**
 * Текст флага собирается из ПЕЙЛОАДА таланта: число живёт в данных, а не в
 * подписи. Ветвления по id таланта здесь нет и быть не должно — таблица
 * закрыта по `TalentFlag`, и новый флаг не пройдёт проверку типов без строки.
 */
export function flagText(effect: FlagEffect, resource: ResourceWords, perRank = true): string {
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
    // ПРОК читается ОДНОЙ строкой: событие, заряды, прибавка и чем меряется
    // окно. Числа — из payload, названия характеристик — из общего реестра.
    proc: (e) => {
      if (!('trigger' in e) || !('effect' in e)) return 'Событие боя даёт прибавку'
      const every = e.everyNth && e.everyNth > 1 ? `Каждый ${e.everyNth}-й ` : ''
      const when = PROC_TRIGGER_TEXT[e.trigger]
      const what = statNames(resource)[e.effect.stat]
      const window =
        e.effect.kind === 'stat'
          ? `на ${e.effect.durationSec} с`
          : `на ${e.effect.swings} ${pluralRu(e.effect.swings, 'замах', 'замаха', 'замахов')}`
      const cond = e.when ? ` ${PROC_WHEN_TEXT[e.when.kind](e.when)}` : ''
      return (
        `${every}${when}${cond}: +${pct(e.effect.value)} ${what} ${window}` +
        `${perRank ? ' за ранг' : ''}`
      )
    },
    // ЗАМЕНА УМЕНИЯ: оба имени берутся из реестра, а не пишутся здесь.
    'replace-ability': (e) =>
      'from' in e && 'to' in e
        ? `«${ABILITY_BY_ID[e.from]?.name ?? e.from}» заменяется на ` +
          `«${ABILITY_BY_ID[e.to]?.name ?? e.to}»`
        : 'Умение заменяется другим',
    // УМЕНИЕ ОТ ТАЛАНТА: имя берётся из реестра, а не пишется здесь.
    'grant-ability': (e) =>
      'abilityId' in e
        ? `Открывает умение «${ABILITY_BY_ID[e.abilityId]?.name ?? e.abilityId}»: ` +
          'его нет в книге класса, и слот оно занимает как любое другое'
        : 'Открывает новое умение',
    // УМЕНИЕ ИГРАЕТ САМО: слот освобождается, и это главное в строке —
    // ради освободившегося места талант и берут.
    'auto-ability': (e) =>
      'abilityId' in e
        ? `«${ABILITY_BY_ID[e.abilityId]?.name ?? e.abilityId}» применяется само и ` +
          'больше не занимает слот — место в ряду освобождается'
        : 'Умение применяется само и освобождает слот',
    // ПЕРЕНОС МЕТКИ: доля оставшегося времени, переживающая смерть цели.
    'carry-over': (e) => {
      if (!('mark' in e) || !('share' in e)) return 'Метка переходит на следующую цель'
      const what = CARRY_MARK_TEXT[e.mark]
      return (
        `${what} переходит на следующего противника, сохраняя ${pct(e.share)} ` +
        `оставшегося времени${perRank ? ' за ранг' : ''}`
      )
    },
    // Команды псу талантом: поле спутника названо словом, число — из payload.
    'hound-tune': (e) => {
      if (!('field' in e) || !('op' in e)) return 'Пёс становится сильнее'
      const what = HOUND_FIELD_NAME[e.field] ?? e.field
      const sign = e.value > 0 ? '+' : '−'
      const amount = e.op === 'percent' ? pct(Math.abs(e.value)) : `${(Math.abs(e.value) * 100).toFixed(0)} п.`
      return `${what}: ${sign}${amount}${perRank ? ' за ранг' : ''}`
    },
    'pack-tactics': (e) =>
      `Пока пёс на ногах, урон героя выше на ${'bonusShare' in e ? pct(e.bonusShare) : '0%'}`,
    'hound-avenge': (e) =>
      'bonusShare' in e && 'durationSec' in e
        ? `Пал пёс — ${e.durationSec} с урон героя выше на ${pct(e.bonusShare)}`
        : 'Пал пёс — герой бьёт сильнее',
  }
  return table[effect.flag](effect)
}

/**
 * Что делает талант — за один ранг.
 *
 * «ЗА РАНГ» ПИШЕТСЯ ТОЛЬКО ТАМ, ГДЕ РАНГ БОЛЬШЕ ОДНОГО. У одноранговых
 * талантов — а это все венцы и все ключевые — копить нечего, и приписка
 * обещала лестницу, которой нет: «+8 % урона за ранг» у таланта с
 * `maxRank: 1` читается как «дальше будет ещё», и игрок ищет, куда вложить
 * второе очко. Условие стоит ЗДЕСЬ, в одном месте на все три вида эффекта,
 * а не тремя копиями по веткам ниже.
 */
export function effectText(talent: TalentDef, resource: ResourceWords): string {
  const effect = talent.effect
  const perRank = talent.maxRank > 1
  if (effect.kind === 'flag') return flagText(effect, resource, perRank)
  // ТАЛАНТ, ПРАВЯЩИЙ УМЕНИЕ, ПОКАЗЫВАЕТ, ЧЕМ УМЕНИЕ СТАНЕТ. Строка собирается
  // из тех же полей, что и описание самого умения: второй формулировки на
  // игру быть не должно.
  if (effect.kind === 'ability') return abilityTuneText(effect, perRank)
  const mods = effect.mods.map((m) => modText(m, resource)).join(', ')
  return perRank ? `${mods} за ранг` : mods
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
