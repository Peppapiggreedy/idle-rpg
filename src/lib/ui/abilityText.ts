// Тексты про умения, общие для панели действий и настроек автокаста.
// Логика отдаёт коды причин — человеческие формулировки живут здесь.
import type { AbilityBlockReason } from '../game'
import { Decimal, expectedAbilityDamage, formatNumber } from '../game'
import type { StatBlock } from '../game/stats'
import type { AbilityDef } from '../data/abilities'
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
  const fixed: Record<Exclude<AbilityBlockReason, 'no-mana' | 'locked'>, string> = {
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
  lines.push(
    ability.type === 'onNextSwing'
      ? `Заменяет следующую автоатаку; ${ctx.resource.genitive} спишется в момент удара`
      : 'Бьёт сразу, тратит общую задержку',
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
    lines.push(
      `Съедает кровотечение с цели и наносит его остаток разом, ` +
        `×${ability.detonate.multiplier}`,
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
    lines.push(`Только по цели ниже ${pct(ability.execute.belowHpShare)} здоровья`)
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
    lines.push(
      `Свой урон ниже на ${pct(ability.stance.damageShare)}, входящий мягче на ` +
        `${pct(ability.stance.mitigationShare)}, ${sec(ability.stance.durationSec)}`,
    )
  }

  // 5. СВЯЗКА — последней: это не свойство умения, а условие ряда.
  if (ability.combo && ctx.comboName) {
    lines.push(`Без «${ctx.comboName}» в ряду не работает`)
  }

  return lines
}
