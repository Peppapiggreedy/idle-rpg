// Тексты про умения, общие для панели действий и настроек автокаста.
// Логика отдаёт коды причин — человеческие формулировки живут здесь.
import type { AbilityBlockReason } from '../game'
import { Decimal, expectedAbilityDamage, formatNumber } from '../game'
import type { StatBlock } from '../game/stats'
import { ABILITY_BY_ID, type AbilityDef, type AbilityTune } from '../data/abilities'
import type { AbilityDropRefusal } from './abilityDrop'
import type { ResourceWords } from './resource'

// Причина «не хватает ресурса» называет его по имени класса, «заперто» —
// уровень разблокировки, остальные три ни от чего не зависят. Поэтому это
// функция, а не таблица: таблица заставила бы изувера читать, что ему не
// хватает маны.
export function abilityReasonText(
  reason: AbilityBlockReason,
  resource: ResourceWords,
  unlockLevel = 1,
): string {
  const fixed: Record<
    Exclude<AbilityBlockReason, 'no-mana' | 'locked' | 'resource-low' | 'resource-high'>,
    string
  > = {
    dead: 'Ты мёртв — умения недоступны',
    cooldown: 'Ещё не восстановилось',
    gcd: 'Общая задержка после прошлого умения',
    // ДЕТОНАТОРУ НЕЧЕГО СЪЕДАТЬ. Причина названа отдельным кодом, а не общим
    // «нельзя»: игрок обязан понять, что не хватает не ресурса, а связки.
    'no-combo': 'Нечего разрывать: на цели нет кровотечения',
    // ДОБИВАНИЕ ЖДЁТ СВОЕГО МОМЕНТА, а не «нельзя вообще»: игрок обязан
    // понять, что кнопка загорится сама, когда цель просядет.
    'target-healthy': 'Цель ещё слишком цела — добивание ждёт',
  }
  if (reason === 'locked') return `Откроется на ${unlockLevel} уровне`
  // ВОРОТА ПО ПОЛОСКЕ. Оба отказа НАЗЫВАЮТ РЕСУРС ПО ИМЕНИ КЛАССА и говорят,
  // в какую сторону идти: «мало» лечится боем, «много» — тратой. Слово «мало»
  // и слово «много» — единственная разница, и она обязана быть видна сразу.
  if (reason === 'resource-low') return `Слишком мало: нужно больше ${resource.genitive}`
  if (reason === 'resource-high') return `Слишком много ${resource.genitive} — сперва потрать`
  return reason === 'no-mana' ? `Не хватает ${resource.genitive}` : fixed[reason]
}

/**
 * РОЛЬ УМЕНИЯ СЛОВАМИ. Игрок выбирает четыре из одиннадцати, и «1.8 урона
 * оружия» для этого выбора бесполезно: сравнивать надо не числа, а ЗАЧЕМ
 * умение нужно. Числа книга показывает рядом — они не заменяют роль.
 *
 * Текст для игрока, поэтому здесь, а не в данных. Полнота проверяется
 * тестом: новое умение без роли — это кнопка без объяснения.
 */
export const ABILITY_ROLE: Record<string, string> = {
  'quick-strike': 'Дешёвый заполнитель: бьёт часто и почти ничего не стоит.',
  'rending-wound': 'Кровотечение: бьёт сразу и добавляет урон следом.',
  'mend-wounds': 'Лечение: возвращает долю запаса и спасает цикл от привала.',
  'shattering-blow': 'Козырь урона: дорогой и редкий удар, зато самый крупный.',
  'shield-shove': 'Дешёвая защита: бьёт слабо, но следующий удар врага мягче.',
  mercy: 'Добивание: доступно на израненной цели, зато бьёт втрое сильнее.',
  brand: 'Клеймо: цель двадцать секунд получает больше урона. Для боссов.',
  focus: 'Экономия: следующие три умения не стоят ресурса. Тем ценнее, чем дороже четвёрка.',
  stance: 'Обмен: свой урон ниже, входящий мягче. Держится сама и занимает слот.',
  rupture: 'Детонатор: съедает кровотечение и наносит его остаток разом.',
  bulwark: 'Щит: несколько секунд поглощает урон; запас растёт от брони и блока.',
  // --- Изувер ---
  'gut-rip': 'Дешёвый заполнитель: бьёт часто и почти ничего не стоит.',
  'blood-frenzy': 'Кровотечение: бьёт сразу и добавляет урон следом.',
  'skull-splitter': 'Козырь урона: дорогой и редкий удар, зато самый крупный.',
  'blood-letting': 'Разгон: ничего не стоит и сама даёт четверть ярости. Против пустого начала боя.',
  'blood-thirst': 'Вампиризм: возвращает здоровье долей нанесённого урона. Лечение, которое платит ударом.',
  'sinew-tear': 'Детонатор: съедает кровотечение, и тем сильнее, чем полнее полоска ярости.',
  'dug-in': 'Стойкость: входящее смягчается с каждым пропущенным ударом. Награда за долгий бой.',
  reckoning: 'Добивание: бьёт израненного и возвращает пятую часть ярости следующему бою.',
  'blood-price': 'Обмен: платит здоровьем за ярость. Когда бить нечем, а полоска пуста.',
  'blood-roar': 'Окно: восемь секунд умения не стоят ничего. Против ямы ресурса, а не отката.',
  berserk: 'Обмен наоборот: свой урон выше, входящий жёстче. Держится сама и занимает слот.',
}

/**
 * СОСТОЯНИЕ СВЯЗКИ ДЛЯ ЭТОГО РЯДА. Чистая функция: и книга, и подсказка
 * кнопки обязаны отвечать на вопрос «связка работает?» одинаково.
 *   'none'    — умение самостоятельное;
 *   'ready'   — нужное умение стоит в ряду прямо сейчас;
 *   'missing' — не стоит, и умение работать не будет.
 */
export type ComboState = 'none' | 'ready' | 'missing'

export function comboState(
  ability: { combo?: { needsAbilityId: string } },
  slots: readonly (string | null)[],
): ComboState {
  if (!ability.combo) return 'none'
  return slots.includes(ability.combo.needsAbilityId) ? 'ready' : 'missing'
}

/** Что написать про связку. Имя нужного умения подставляет вызывающий. */
export function comboText(state: ComboState, needsName: string): string {
  if (state === 'ready') return `Работает в паре: «${needsName}» в ряду.`
  return `Без «${needsName}» в ряду не работает.`
}

/**
 * ОПИСАНИЕ УМЕНИЯ СОБИРАЕТСЯ ИЗ ПОЛЕЙ, А НЕ ПИШЕТСЯ РУКАМИ.
 *
 * До этого сборок было ТРИ — в книге умений, в ряду действий и в настройках
 * автокаста, — и каждая знала ровно четыре поля из шестнадцати: цену, откат,
 * урон и лечение. Семи флагов (`weaken`, `detonate`, `absorb`, `execute`,
 * `brand`, `freeCasts`, `stance`) в интерфейсе не было ВООБЩЕ. Отсюда сразу
 * две находки: в книге нет точных значений (выбирать четвёрку из одиннадцати
 * приходилось вслепую) и Милость не показывает порог добивания — его просто
 * некому было напечатать, хотя лежит он в данных с самого начала.
 *
 * Пока текст живёт отдельно от чисел, любое число разъезжается с текстом при
 * первой же правке, и подписывать их руками приходится вечно. Здесь ОДНА
 * функция и ОДИН источник: каждое поле умеет описать себя строкой, описание —
 * это собранные строки.
 *
 * Порядок строк фиксирован и идёт от общего к частному: цена и откат, что
 * умение делает, как срабатывает, потом эффекты по флагам, потом связка.
 *
 * ДОБАВИЛ ПОЛЕ В `AbilityDef` — ДОБАВЬ СЮДА СТРОКУ. Полнота проверяется
 * тестом по ключам интерфейса: поле без строки — это число, которого игрок
 * не увидит.
 */
export interface AbilityTextContext {
  /** Как зовётся ресурс у этого класса: мана, ярость. */
  resource: ResourceWords
  /** Статы героя — ради абсолютных «≈ N» рядом с долями. */
  stats: StatBlock
  /** Имя умения, без которого не работает связка. Пусто — связки нет. */
  comboName?: string
}

const pct = (value: Decimal | number): string =>
  `${Math.round((typeof value === 'number' ? value : value.toNumber()) * 100)}%`

const sec = (value: number): string => `${value}с`

/**
 * СКЛОНЕНИЕ ЧИСЛИТЕЛЬНОГО. «3 раз по 50%» читается как опечатка, а числа в
 * описании берутся из данных и заранее не известны: три формы обязательны.
 * Порядок форм — один / два / пять, как в русском языке.
 */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100
  const mod10 = mod100 % 10
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

/**
 * Строки описания умения — по одной на смысл. Вызывающий волен склеить их
 * переводом строки (подсказка) или показать частью (клетка сетки), но
 * ФОРМУЛИРОВАТЬ их заново не должен: второй копии текста в игре нет.
 */
export function abilityLines(ability: AbilityDef, ctx: AbilityTextContext): string[] {
  const lines: string[] = []

  // 1. ЦЕНА И ОТКАТ — всегда первыми: по ним умение и выбирают в ротацию.
  const cost = ability.manaCost.lte(0)
    ? 'Ничего не стоит'
    : `${formatNumber(ability.manaCost)} ${ctx.resource.genitive}`
  lines.push(`${cost} · откат ${sec(ability.cooldownSec)}`)

  // 2. ЧТО ДЕЛАЕТ. Лечащее умение бьёт нулём — про урон ему писать нечего.
  if (ability.heal) {
    lines.push(
      `Лечит ${pct(ability.heal.maxHpShare)} запаса ≈ ` +
        `${formatNumber(ctx.stats.maxHp.times(ability.heal.maxHpShare))} здоровья`,
    )
    lines.push(`Автокаст лечит при здоровье ниже ${pct(ability.heal.autocastBelowHpShare)}`)
  } else if (ability.weaponDamagePercent.gt(0)) {
    lines.push(
      `Урон ${pct(ability.weaponDamagePercent)} удара оружия ≈ ` +
        `${formatNumber(expectedAbilityDamage(ctx.stats, ability.weaponDamagePercent))}`,
    )
  }

  // 3. КАК СРАБАТЫВАЕТ. Разница между типами видна только в бою, и знать её
  //    надо ДО того, как умение положено в ряд.
  //    Общую задержку тратит не «мгновенное», а `triggersGcd`: у базовых
  //    умений это одно и то же, но талант, сделавший умение мгновенным,
  //    задержку ему не вешает — и книга не должна обещать цену, которой нет.
  lines.push(
    ability.type === 'onNextSwing'
      ? `Заменяет следующую автоатаку; ${ctx.resource.genitive} спишется в момент удара`
      : ability.triggersGcd
        ? 'Бьёт сразу, тратит общую задержку'
        : 'Бьёт сразу, общей задержки не тратит',
  )

  // 4. ЭФФЕКТЫ ПО ФЛАГАМ. Каждый флаг описывает СВОЙ payload — ни одно число
  //    не вписано в текст руками.
  if (ability.effect) {
    lines.push(
      `Затем ${ability.effect.ticks} ${plural(ability.effect.ticks, 'раз', 'раза', 'раз')} ` +
        `по ${pct(ability.effect.weaponDamagePercent)} каждые ${sec(ability.effect.tickIntervalSec)}`,
    )
  }
  if (ability.weaken) {
    const n = ability.weaken.hits
    const hits =
      n === 1
        ? 'Следующий удар цели'
        : `Следующие ${n} ${plural(n, 'удар', 'удара', 'ударов')} цели`
    lines.push(`${hits} слабее на ${pct(ability.weaken.damageShare)}`)
  }
  if (ability.detonate) {
    const growth = ability.detonate.resourceMultiplier ?? 0
    lines.push(
      `Съедает кровотечение с цели и наносит его остаток разом, ` +
        `×${ability.detonate.multiplier}` +
        (growth > 0
          ? ` и до ×${Math.round((ability.detonate.multiplier + growth) * 10) / 10} на полной полоске`
          : ''),
    )
  }
  if (ability.absorb) {
    lines.push(
      `Щит на ${sec(ability.absorb.durationSec)}: ${pct(ability.absorb.armorShare)} брони ` +
        `и ${pct(ability.absorb.blockShare)} силы блока ≈ ` +
        `${formatNumber(
          ctx.stats.armor
            .times(ability.absorb.armorShare)
            .plus(ctx.stats.blockValue.times(ability.absorb.blockShare)),
        )} урона`,
    )
  }
  if (ability.execute) {
    // ТОТ САМЫЙ ПОРОГ. Он лежал в данных с первого дня и не показывался
    // нигде: игрок видел кнопку, которая «иногда нельзя», и не знал, когда.
    const grows = ability.execute.belowHpShareFromResource ?? 0
    lines.push(
      `Только по цели ниже ${pct(ability.execute.belowHpShare)} здоровья` +
        (grows > 0
          ? ` и до ${pct(ability.execute.belowHpShare + grows)} на полной полоске`
          : ''),
    )
  }
  // ВОРОТА ПО ПОЛОСКЕ — отдельной строкой и ДО эффектов: это условие, при
  // котором кнопка вообще работает, а не то, что она делает.
  if (ability.requires) {
    if (ability.requires.resourceAbove !== undefined) {
      lines.push(
        `Нужно ${pct(ability.requires.resourceAbove)} ${ctx.resource.genitive} — ниже не применить`,
      )
    }
    if (ability.requires.resourceBelow !== undefined) {
      lines.push(
        `Только пока ${ctx.resource.genitive} меньше ${pct(ability.requires.resourceBelow)}`,
      )
    }
  }
  if (ability.spendAll) {
    lines.push(`Тратит ВСЮ ${ctx.resource.accusative} — и тем сильнее, чем её больше`)
  }
  if (ability.weaponDamageFromResource) {
    lines.push(
      `На полной полоске бьёт ${pct(ability.weaponDamagePercent.plus(ability.weaponDamageFromResource))} удара оружия`,
    )
  }
  if (ability.ramp) {
    lines.push(
      `Разгон ${sec(ability.ramp.durationSec)}: каждый свой удар добавляет ` +
        `${pct(ability.ramp.perSwing)} урона, до ${pct(ability.ramp.maxShare)}`,
    )
  }
  if (ability.edge) {
    lines.push(
      `Грань ${sec(ability.edge.durationSec)}: урон выше на ${pct(ability.edge.damagePerShare)} ` +
        `при полной полоске, ниже ${pct(ability.edge.resourceAbove)} прибавки нет`,
    )
  }
  if (ability.brand) {
    lines.push(
      `Цель получает на ${pct(ability.brand.damageShare)} больше урона ` +
        `${sec(ability.brand.durationSec)}`,
    )
    lines.push(`Автокаст клеймит цель выше ${pct(ability.brand.autocastAboveHpShare)} здоровья`)
  }
  if (ability.freeCasts) {
    const n = ability.freeCasts.casts
    lines.push(
      n === 1
        ? 'Следующее умение ничего не стоит'
        : `Следующие ${n} ${plural(n, 'умение', 'умения', 'умений')} ничего не стоят`,
    )
  }
  if (ability.stance) {
    // ОБМЕН ЧИТАЕТСЯ В ОБЕ СТОРОНЫ. Обратная стойка — тот же флаг с обратным
    // знаком, и «урон ниже на −25 %» было бы не описанием, а опечаткой.
    const up = ability.stance.damageShare < 0
    lines.push(
      up
        ? `Свой урон выше на ${pct(-ability.stance.damageShare)}, входящий жёстче на ` +
            `${pct(-ability.stance.mitigationShare)}, ${sec(ability.stance.durationSec)}`
        : `Свой урон ниже на ${pct(ability.stance.damageShare)}, входящий мягче на ` +
            `${pct(ability.stance.mitigationShare)}, ${sec(ability.stance.durationSec)}`,
    )
  }
  if (ability.generate) {
    lines.push(
      `Даёт ${pct(ability.generate.resourceShare)} запаса ≈ ` +
        `${formatNumber(ctx.stats.maxMana.times(ability.generate.resourceShare))} ${ctx.resource.genitive}`,
    )
  }
  if (ability.leech) {
    const grows = ability.leech.healShareFromResource ?? 0
    lines.push(
      `Возвращает здоровьем ${pct(ability.leech.healShare)} нанесённого урона` +
        (grows > 0 ? ` и до ${pct(ability.leech.healShare + grows)} на полной полоске` : ''),
    )
  }
  if (ability.resolve) {
    lines.push(
      `Входящее мягче на ${pct(ability.resolve.perHitTaken)} с каждого пропущенного удара, ` +
        `до ${pct(ability.resolve.maxShare)}, ${sec(ability.resolve.durationSec)}`,
    )
  }
  if (ability.refund) {
    lines.push(`Возвращает ${pct(ability.refund.resourceShare)} запаса ${ctx.resource.genitive}`)
  }
  if (ability.bloodPrice) {
    lines.push(
      `Платит ${pct(ability.bloodPrice.hpShare)} здоровья за ` +
        `${pct(ability.bloodPrice.resourceShare)} запаса ${ctx.resource.genitive}`,
    )
  }
  if (ability.window) {
    lines.push(`${sec(ability.window.durationSec)}: умения ничего не стоят`)
  }
  if (ability.autocast?.heroHpAbove !== undefined) {
    lines.push(`Автокаст жмёт при здоровье выше ${pct(ability.autocast.heroHpAbove)}`)
  }
  if (ability.autocast?.targetHpAbove !== undefined) {
    lines.push(`Автокаст жмёт по цели выше ${pct(ability.autocast.targetHpAbove)} здоровья`)
  }
  if (ability.autocast?.resourceBelow !== undefined) {
    lines.push(
      `Автокаст жмёт, пока ${ctx.resource.genitive} меньше ${pct(ability.autocast.resourceBelow)}`,
    )
  }

  // 5. СВЯЗКА — последней: это не свойство умения, а условие ряда.
  if (ability.combo && ctx.comboName) {
    lines.push(`Без «${ctx.comboName}» в ряду не работает`)
  }

  return lines
}

/**
 * ПОЧЕМУ УМЕНИЕ НЕ КЛАДЁТСЯ СЮДА — словами. Логика (`ui/abilityDrop.ts`)
 * отдаёт код, слово живёт здесь: тот же порядок, что у отказов применения
 * и у отказов куклы.
 */
export function abilityDropRefusalText(reason: AbilityDropRefusal, unlockLevel = 1): string {
  const fixed: Record<AbilityDropRefusal, string> = {
    locked: `Умение откроется на ${unlockLevel} уровне`,
    'same-spot': 'Это тот же слот — переносить некуда',
  }
  return fixed[reason]
}

/**
 * ЧТО ТАЛАНТ ДЕЛАЕТ С УМЕНИЕМ — словами и числом.
 *
 * Талант третьего рода правит поля умения данными, и описание собирается из
 * тех же полей: второй формулировки на игру быть не должно. Названия полей
 * живут здесь, потому что это текст для игрока, а не имя в коде.
 */
const TUNE_LABEL: Record<string, string> = {
  cooldownSec: 'откат',
  manaCost: 'цена',
  weaponDamagePercent: 'урон',
  effectWeaponDamagePercent: 'урон эффекта',
  effectTicks: 'тиков эффекта',
  healMaxHpShare: 'лечение',
  weakenDamageShare: 'ослабление',
  weakenHits: 'ослабленных ударов',
  detonateMultiplier: 'множитель детонации',
  absorbArmorShare: 'щит от брони',
  absorbBlockShare: 'щит от блока',
  absorbDurationSec: 'длительность щита',
  brandDamageShare: 'уязвимость',
  brandDurationSec: 'длительность клейма',
  freeCastsCasts: 'бесплатных применений',
  stanceDamageShare: 'потеря урона',
  stanceMitigationShare: 'смягчение стойки',
  stanceDurationSec: 'длительность стойки',
  executeBelowHpShare: 'порог добивания',
  brandAutocastAboveHpShare: 'порог автокаста клейма',
  healAutocastBelowHpShare: 'порог автокаста лечения',
  generateResourceShare: 'прибавка ресурса',
  leechHealShare: 'вампиризм',
  resolveMaxShare: 'потолок упора',
  resolvePerHitTaken: 'прирост упора за удар',
  resolveDurationSec: 'длительность упора',
  refundResourceShare: 'возврат ресурса',
  bloodPriceResourceShare: 'ярость за здоровье',
  windowDurationSec: 'длительность окна',
  detonateResourceMultiplier: 'детонация от ресурса',
  autocastHeroHpAbove: 'порог автокаста по здоровью',
  type: 'тип',
}

const signed = (value: number): string => `${value > 0 ? '+' : '−'}${Math.abs(value)}`

export function abilityTuneText(effect: {
  abilityId: string
  tune: readonly AbilityTune[]
}): string {
  const name = ABILITY_BY_ID[effect.abilityId]?.name ?? effect.abilityId
  const parts = effect.tune.map((tune) => {
    const label = TUNE_LABEL[tune.field] ?? tune.field
    if (tune.kind === 'set') {
      // Смена типа — не величина: ни «тип: …», ни «за ранг» ей не идут.
      return tune.value === 'instant' ? 'бьёт сразу' : 'заменяет автоатаку'
    }
    if (tune.kind === 'points') {
      // ПОРОГ — В ПУНКТАХ, а не в процентах от себя: игрок читает пороги
      // именно так, и «на 20 % выше» от 0.2 значило бы 0.24.
      return `${label} ${signed(Math.round(tune.value * 100))} пунктов`
    }
    const share = tune.kind === 'percent' ? tune.value : tune.value - 1
    return `${label} ${signed(Math.round(share * 100))} %`
  })
  // «За ранг» — только там, где есть что копить: у правки одним `set` ранг один.
  const perRank = effect.tune.some((tune) => tune.kind !== 'set') ? ' за ранг' : ''
  return `${name}: ${parts.join(', ')}${perRank}`
}
