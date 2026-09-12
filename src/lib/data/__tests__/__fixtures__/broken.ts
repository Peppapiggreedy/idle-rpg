// Заведомо битые данные: каждая запись ломает контент ровно одним способом.
//
// ЗАЧЕМ ЭТО НУЖНО. Проверка целостности — сторож, а у сторожа своя беда: он
// может тихо перестать работать, и зелёный тест будет означать «я ничего не
// проверил», а не «всё хорошо». Поэтому на каждый вид поломки здесь лежит
// образец, и тест требует, чтобы проверка на нём падала — да ещё и понятным
// текстом, в котором названы и сущность, и файл.
//
// Ломаем НЕ копию данных руками, а живой контент точечной подменой: так
// фикстура не устаревает вместе с игрой, и в диффе видно ровно поломку.
import { Decimal } from '../../../game/numbers'
import type { IconName } from '../../../ui/icons/manifest'
import type { StatId } from '../../../game/stats'
import type { SlotId } from '../../slots'
import { CLASS_BY_ID, type ClassDef } from '../../classes'
import type { AbilityDef } from '../../abilities'
import type { ShieldTemplate, WeaponTemplate } from '../../items'
import { masteryToKnow, type RecipeDef } from '../../recipes'
import { realContent } from '../content'
import type { TalentDef } from '../../talents'
import type { Content } from '../schema'

/** Подмена одного поля у сущности с заданным id. */
function patch<T extends { id: string }>(list: readonly T[], id: string, fields: Partial<T>): T[] {
  return list.map((item) => (item.id === id ? { ...item, ...fields } : item))
}

/** Первый элемент списка — на нём удобно показывать поломку. */
function first<T>(list: readonly T[]): T {
  return list[0]
}

/** Талант, который правит умение, и умение ЧУЖОГО класса для подмены. */
function foreignTunedTalent(real: Content) {
  const talent = real.talents.find((t) => t.effect.kind === 'ability')!
  const branch = real.branches.find((b) => b.id === talent.branch)!
  const foreign = real.classes.find((c) => c.id !== branch.classId)!
  return { talent, foreignAbilityId: foreign.abilityIds[0] }
}

/**
 * Дерево без венца ПЕРВОЙ ветки: талант последнего этажа убран целиком.
 * Ломать надо данные, а не путь: путь называет порядок, и талант, которого
 * нет, заливка просто пропустит — ровно как если бы его забыли вписать.
 */
function withoutCapstone(real: Content) {
  const branchId = real.branches[0].id
  const rows = real.talents.filter((t) => t.branch === branchId).map((t) => t.row)
  const last = Math.max(...rows)
  return real.talents.filter((t) => !(t.branch === branchId && t.row === last))
}

/**
 * Пути ПЕРВОЙ ветки без венца в порядке покупки: сам талант на месте, но
 * очередь до него не доходит. Ломается ровно то, что проверка и стережёт.
 */
/** Талант выдачи умения. */
function grantTalent(real: Content) {
  const found = real.talents.find(
    (t) => t.effect.kind === 'flag' && t.effect.flag === 'grant-ability',
  )
  if (!found) throw new Error('в дереве нет выдачи умения — образец мерить не на чем')
  return found
}

function grantTalentId(real: Content) {
  return grantTalent(real).id
}

function grantTalentWith(real: Content, abilityId: string): TalentDef[] {
  const talent = grantTalent(real)
  return patch(real.talents, talent.id, {
    effect: { ...(talent.effect as object), abilityId },
  } as unknown as Partial<TalentDef>)
}

/** Выданное умение с уровнем открытия выше первого. */
function grantedWithUnlock(real: Content, unlockLevel: number): AbilityDef[] {
  const id = (grantTalent(real).effect as { abilityId: string }).abilityId
  return real.abilities.map((a) => (a.id === id ? { ...a, unlockLevel } : a))
}

/** Талант замены умения. */
function swapTalent(real: Content) {
  const found = real.talents.find(
    (t) => t.effect.kind === 'flag' && t.effect.flag === 'replace-ability',
  )
  if (!found) throw new Error('в дереве нет замены умения — образец мерить не на чем')
  return found
}

function swapTalentId(real: Content) {
  return swapTalent(real).id
}

function swapFrom(real: Content) {
  return (swapTalent(real).effect as { from: string }).from
}

/** Любое умение, которое У КЛАССА ЭТОЙ ВЕТКИ есть и которое не заменяется. */
function ownedAbilityId(real: Content) {
  const talent = swapTalent(real)
  const branch = real.branches.find((b) => b.id === talent.branch)!
  const owner = real.classes.find((c) => c.id === branch.classId)!
  const from = swapFrom(real)
  const found = owner.abilityIds.find((id) => id !== from)
  if (!found) throw new Error('у класса одно умение — подменить нечем')
  return found
}

function swapTalentWith(real: Content, fields: { to?: string }): TalentDef[] {
  const talent = swapTalent(real)
  return patch(real.talents, talent.id, {
    effect: { ...(talent.effect as object), ...fields },
  } as unknown as Partial<TalentDef>)
}

/**
 * Дерево БЕЗ таланта замены: подставляемое умение остаётся в реестре и
 * становится недостижимым — до него не добраться ни книгой, ни талантом.
 */
function withoutSwapTalent(real: Content): TalentDef[] {
  const id = swapTalentId(real)
  return real.talents.filter((t) => t.id !== id)
}

/** Прок С УСЛОВИЕМ — на нём проверяются правила условий. */
function conditionalProc(real: Content) {
  const found = real.talents.find(
    (t) => t.effect.kind === 'flag' && t.effect.flag === 'proc' && t.effect.when,
  )
  if (!found) throw new Error('в дереве нет условного прока — образец мерить не на чем')
  return found
}

function conditionalProcId(real: Content) {
  return conditionalProc(real).id
}

/** Тот же условный прок с подменённой долей условия. */
function procTalentWhen(real: Content, share: number): TalentDef[] {
  const talent = conditionalProc(real)
  const effect = talent.effect as { when: { kind: string; share: number } }
  return patch(real.talents, talent.id, {
    effect: { ...effect, when: { ...effect.when, share } },
  } as unknown as Partial<TalentDef>)
}

/** Талант переноса метки. */
function carryTalent(real: Content) {
  const found = real.talents.find((t) => t.effect.kind === 'flag' && t.effect.flag === 'carry-over')
  if (!found) throw new Error('в дереве нет переноса метки — образец мерить не на чем')
  return found
}

function carryTalentId(real: Content) {
  return carryTalent(real).id
}

function carryTalentWith(real: Content, fields: { share?: number }): TalentDef[] {
  const talent = carryTalent(real)
  return patch(real.talents, talent.id, {
    effect: { ...(talent.effect as object), ...fields },
  } as unknown as Partial<TalentDef>)
}

/**
 * Тот же перенос, переехавший в ветку ЧУЖОГО класса: у того класса умения,
 * вешающего эту метку, нет, и талант мёртв.
 */
function carryTalentInForeignBranch(real: Content): TalentDef[] {
  const talent = carryTalent(real)
  const own = real.branches.find((b) => b.id === talent.branch)!
  const foreign = real.branches.find((b) => b.classId !== own.classId)!
  return patch(real.talents, talent.id, { branch: foreign.id } as Partial<TalentDef>)
}

/** Первый талант-прок дерева: на нём и проверяются правила проков. */
function procTalent(real: Content) {
  const found = real.talents.find((t) => t.effect.kind === 'flag' && t.effect.flag === 'proc')
  if (!found) throw new Error('в дереве нет ни одного прока — образцы поломок мерить не на чем')
  return found
}

function procTalentId(real: Content) {
  return procTalent(real).id
}

/**
 * Тот же прок с подменёнными полями прибавки. Подменяются ИМЕНОВАННО, а не
 * целым объектом: образец обязан отличаться от настоящего дерева ровно одним
 * полем, иначе непонятно, на что сработала проверка.
 */
function procTalentWith(
  real: Content,
  fields: { stat?: string; value?: number; durationSec?: number; swings?: number },
): TalentDef[] {
  const talent = procTalent(real)
  const effect = talent.effect as { kind: 'flag'; flag: 'proc'; effect: Record<string, unknown> }
  return patch(real.talents, talent.id, {
    effect: {
      ...effect,
      effect: { ...effect.effect, ...fields },
    },
  } as unknown as Partial<TalentDef>)
}

function pathsWithoutCapstone(real: Content) {
  const branchId = real.branches[0].id
  const rows = real.talents.filter((t) => t.branch === branchId).map((t) => t.row)
  const last = Math.max(...rows)
  const capstones = new Set(
    real.talents.filter((t) => t.branch === branchId && t.row === last).map((t) => t.id),
  )
  return (id: string) =>
    real
      .pathsOf(id)
      .map((path) =>
        id === branchId ? { ...path, order: path.order.filter((o) => !capstones.has(o)) } : path,
      )
}

/** Реагент последнего подземелья: у него источник — данж, а не храм. */
function lastDungeonReagent(real: Content) {
  const fromDungeons = real.reagents.filter((r) => r.source?.kind === 'dungeon')
  return fromDungeons[fromDungeons.length - 1] ?? first(real.reagents)
}

/** Первый ОБЫЧНЫЙ реагент: у боссового и промежуточного свои правила. */
function commonReagent(real: Content) {
  return real.reagents.find((r) => r.role === 'common') ?? first(real.reagents)
}

/** Первый БОССОВЫЙ реагент подземелья: на нём видно разъезд роли и источника. */
function bossReagent(real: Content) {
  return (
    real.reagents.find((r) => r.role === 'boss' && r.source?.kind === 'dungeon') ??
    first(real.reagents)
  )
}

/** Самый глубокий обычный реагент — им ломается правило «не глубже своей полосы». */
function deepestCommon(real: Content) {
  const commons = real.reagents.filter((r) => r.role === 'common')
  return commons[commons.length - 1] ?? first(real.reagents)
}

/** Рецепт, который роняет последний босс первого подземелья. */
function bossRecipeId(real: Content): string {
  const last = first(real.dungeons).bosses[first(real.dungeons).bosses.length - 1]
  const found = real.recipes.find(
    (r) => r.source.kind === 'boss' && r.source.bossId === last.id,
  )
  return (found ?? first(real.recipes)).id
}

/** Первая ступень лестницы мастерства: та, что открыта с нулевого мастерства. */
function firstMasteryId(real: Content): string {
  const found = real.recipes.find(
    (r) => r.source.kind === 'mastery' && masteryToKnow(r as RecipeDef) === 0,
  )
  return (found ?? first(real.recipes)).id
}

/**
 * Самый мелкий рецепт ВЕЩИ: в него и подставляется слишком глубокий вход.
 *
 * Именно вещи, а не еды: у расходника уровень СЧИТАЕТСЯ ПО ВХОДАМ, поэтому
 * глубокий вход утащил бы за собой и уровень рецепта — нарушения не вышло бы
 * вовсе. У вещи уровень записан прямо (`output.level`) и от входов не
 * зависит; ровно на такой паре правило и ломается в живой игре.
 */
function shallowRecipe(real: Content) {
  const items = real.recipes.filter((r) => r.output.kind === 'item')
  return (
    [...items].sort(
      (a, b) =>
        (a.output.kind === 'item' ? a.output.level : 0) -
        (b.output.kind === 'item' ? b.output.level : 0),
    )[0] ?? first(real.recipes)
  )
}

/** Зона с самой высокой полосой мобов: в неё удобно «ошибочно» ставить вход. */
function highBandZone(real: Content) {
  return [...real.zones].sort(
    (a, b) => b.monsterLevelRange.min - a.monsterLevelRange.min,
  )[0]
}

/** Первый рецепт оружия в главную руку: на нём ломается вывод категории. */
function handRecipeId(real: Content): string {
  const found = real.recipes.find((r) => r.output.kind === 'item' && r.output.slot === 'mainHand')
  return (found ?? first(real.recipes)).id
}

export interface BrokenCase {
  /** Что именно сломано — попадает в название теста. */
  title: string
  content: Content
  /** Текст замечания обязан содержать всё это: id сущности, файл, суть. */
  expect: (string | RegExp)[]
}

/**
 * Все виды поломок, которые проверка обязана ловить.
 *
 * Приведения типов ниже — намеренные. В живых данных такую опечатку не
 * написать: имя иконки и id стата это union-типы, и промах ловится ПРОВЕРКОЙ
 * ТИПОВ ещё до тестов. Но данные приезжают и мимо компилятора (правка в
 * чужой ветке, склейка при merge, генератор), поэтому проверка обязана
 * поймать их и во время выполнения.
 */
export function brokenCases(): BrokenCase[] {
  const real = realContent()
  const SHIELD_IDS = new Set(real.shields.map((sh) => sh.id))

  return [
    {
      title: 'данж ссылается на несуществующую зону',
      content: {
        ...real,
        dungeons: patch(real.dungeons, first(real.dungeons).id, {
          zoneId: 'whispering-woods',
        }),
      },
      expect: [first(real.dungeons).id, 'whispering-woods', 'data/zones.ts'],
    },
    {
      title: 'талант-флаг ссылается на несуществующее умение',
      content: {
        ...real,
        talents: real.talents.map((talent) =>
          talent.effect.kind === 'flag' && 'abilityId' in talent.effect
            ? { ...talent, effect: { ...talent.effect, abilityId: 'shadow-step' } }
            : talent,
        ),
      },
      expect: ['shadow-step', 'data/abilities.ts'],
    },
    {
      title: 'талант ссылается на несуществующий стат',
      content: {
        ...real,
        talents: real.talents.map((talent) =>
          talent.effect.kind === 'modifiers'
            ? {
                ...talent,
                effect: {
                  kind: 'modifiers' as const,
                  mods: [{ stat: 'luck' as StatId, kind: 'flat' as const, value: new Decimal(1) }],
                },
              }
            : talent,
        ),
      },
      expect: ['luck', 'game/stats.ts'],
    },
    {
      title: 'талант пытается менять weaponSpeed вместо haste',
      content: {
        ...real,
        talents: real.talents.map((talent) =>
          talent.effect.kind === 'modifiers'
            ? {
                ...talent,
                effect: {
                  kind: 'modifiers' as const,
                  mods: [{ stat: 'weaponSpeed' as StatId, kind: 'flat' as const, value: new Decimal(-0.2) }],
                },
              }
            : talent,
        ),
      },
      expect: ['weaponSpeed', 'haste'],
    },
    {
      title: 'иконки нет в реестре',
      content: {
        ...real,
        zones: patch(real.zones, first(real.zones).id, {
          icon: 'zone-whispering-woods' as IconName,
        }),
      },
      expect: [first(real.zones).id, 'zone-whispering-woods', 'manifest.ts'],
    },
    {
      title: 'иконка есть в реестре, но её symbol не собран в спрайт',
      content: {
        ...real,
        spriteIconNames: real.spriteIconNames.filter((n) => n !== first(real.zones).icon),
      },
      expect: [first(real.zones).id, 'sprite.svg', 'icons:build'],
    },
    {
      title: 'два умения с одним id',
      content: {
        ...real,
        abilities: [...real.abilities, { ...first(real.abilities) }],
      },
      expect: [first(real.abilities).id, 'дважды', 'уникальными'],
    },
    {
      title: 'лечение больше полного запаса',
      content: {
        ...real,
        abilities: patch(real.abilities, 'mend-wounds', {
          heal: { maxHpShare: new Decimal(1.5), autocastBelowHpShare: 0.5 },
        }),
      },
      expect: ['mend-wounds', 'heal.maxHpShare'],
    },
    {
      title: 'лечение «на следующий удар»',
      content: {
        ...real,
        abilities: patch(real.abilities, 'mend-wounds', { type: 'onNextSwing' }),
      },
      expect: ['mend-wounds', 'мгновенным'],
    },
    // ПАССИВНОЕ — ЧЕТЫРЕ НУЛЯ ВМЕСТЕ, и каждый из них проверен своим
    // образцом: правило, у которого проверена только одна половина, молча
    // пропускает вторую.
    {
      title: 'пассивное умение стоит ресурса',
      content: {
        ...real,
        abilities: patch(real.abilities, 'pack', { manaCost: new Decimal(50) }),
      },
      expect: ['pack', 'manaCost'],
    },
    {
      title: 'пассивное умение с откатом',
      content: { ...real, abilities: patch(real.abilities, 'pack', { cooldownSec: 30 }) },
      expect: ['pack', 'cooldownSec'],
    },
    {
      title: 'пассивное умение бьёт',
      content: {
        ...real,
        abilities: patch(real.abilities, 'pack', { weaponDamagePercent: new Decimal(1.2) }),
      },
      expect: ['pack', 'weaponDamagePercent'],
    },
    {
      title: 'пассивное умение тратит общую задержку',
      content: { ...real, abilities: patch(real.abilities, 'pack', { triggersGcd: true }) },
      expect: ['pack', 'triggersGcd'],
    },
    {
      // ПУСТАЯ КНОПКА: четыре нуля есть, а делать нечего.
      title: 'пассивное умение без пассивного флага',
      content: { ...real, abilities: patch(real.abilities, 'pack', { pack: undefined }) },
      expect: ['pack', 'флагом'],
    },
    {
      // СТОЙКА НАОБОРОТ — законна, а стойка «в обе стороны хорошо» — нет.
      title: 'стойка усиливает и урон, и защиту разом',
      content: {
        ...real,
        abilities: patch(real.abilities, 'berserk', {
          stance: { damageShare: -0.25, mitigationShare: 0.15, durationSec: 30 },
        }),
      },
      expect: ['berserk', 'ОБМЕН'],
    },
    {
      title: 'генератор ресурса сам платит ресурсом',
      content: {
        ...real,
        abilities: patch(real.abilities, 'blood-letting', { manaCost: new Decimal(9) }),
      },
      expect: ['blood-letting', 'ДАЁТ'],
    },
    {
      title: 'возврат ресурса не на добивании',
      content: {
        ...real,
        abilities: patch(real.abilities, 'reckoning', { execute: undefined }),
      },
      expect: ['reckoning', 'добивание'],
    },
    {
      title: 'плата здоровьем без порога автокаста',
      content: {
        ...real,
        abilities: patch(real.abilities, 'blood-price', { autocast: undefined }),
      },
      expect: ['blood-price', 'autocast.heroHpAbove'],
    },
    {
      title: 'упор берёт потолок с первого удара',
      content: {
        ...real,
        abilities: patch(real.abilities, 'dug-in', {
          resolve: { perHitTaken: 0.24, maxShare: 0.24, durationSec: 14 },
        }),
      },
      expect: ['dug-in', 'нарастает'],
    },
    {
      title: 'боевое умение с нулевым уроном',
      content: {
        ...real,
        abilities: patch(real.abilities, 'quick-strike', { weaponDamagePercent: new Decimal(0) }),
      },
      expect: ['quick-strike', 'weaponDamagePercent'],
    },
    {
      title: 'у зоны нет имени для игрока',
      content: {
        ...real,
        zones: patch(real.zones, first(real.zones).id, { name: '' }),
      },
      expect: [first(real.zones).id, 'name', 'data/zones.ts'],
    },
    {
      title: 'у моба в пуле зоны нет имени',
      content: {
        ...real,
        zones: patch(real.zones, first(real.zones).id, {
          monsterPool: first(real.zones).monsterPool.map((a, i) =>
            i === 0 ? { ...a, name: '' } : a,
          ),
        }),
      },
      expect: [first(first(real.zones).monsterPool).id, 'name'],
    },
    {
      title: 'между полосами зон дыра: этих уровней мобов нет ни у кого',
      content: {
        ...real,
        zones: patch(real.zones, real.zones[1].id, {
          monsterLevelRange: {
            min: real.zones[1].monsterLevelRange.min + 5,
            max: real.zones[1].monsterLevelRange.max + 5,
          },
        }),
      },
      expect: [real.zones[1].id, 'не покрыты', 'data/zones.ts'],
    },
    {
      title: 'полосы зон налезают друг на друга: две зоны об одном и том же',
      content: {
        ...real,
        zones: patch(real.zones, real.zones[1].id, {
          monsterLevelRange: real.zones[0].monsterLevelRange,
        }),
      },
      expect: [real.zones[1].id, 'налезает', 'data/zones.ts'],
    },
    {
      title: 'скорость оружия ушла в ноль',
      content: {
        ...real,
        weapons: patch(real.weapons, first(real.weapons).id, { weaponSpeed: new Decimal(0) }),
      },
      expect: [first(real.weapons).id, 'weaponSpeed', 'больше 0'],
    },
    {
      title: 'диапазон урона оружия задом наперёд',
      content: {
        ...real,
        weapons: patch(real.weapons, first(real.weapons).id, {
          damageMin: new Decimal(50),
          damageMax: new Decimal(10),
        }),
      },
      expect: [first(real.weapons).id, 'damageMax', 'damageMin'],
    },
    {
      title: 'в ветку талантов невозможно войти: первый ряд требует очков',
      content: {
        ...real,
        talents: real.talents.map((t) =>
          t.row === 1 && t.branch === first(real.branches).id
            ? { ...t, requiredPointsInBranch: 3 }
            : t,
        ),
      },
      expect: [first(real.branches).id, 'невозможно войти'],
    },
    {
      // ДВЕ СТРЕЛКИ ИЗ ОДНОГО УЗЛА — ДВЕ ЛИНИИ В ОДНОМ СТОЛБЦЕ, НАЛОЖЕННЫЕ
      // ДРУГ НА ДРУГА. Именно это и читалось как «стрелка тянется не от
      // предыдущего таланта», и именно на этом образце проверено, что
      // проверка срабатывает.
      title: 'из одного таланта выходят две стрелки',
      content: {
        ...real,
        talents: (() => {
          const branch = first(real.branches).id
          const inBranch = real.talents
            .filter((t) => t.branch === branch)
            .sort((a, b) => a.row - b.row)
          const anchor = inBranch[0]
          const dependents = inBranch.filter((t) => t.row > anchor.row).slice(0, 2)
          return real.talents.map((t) =>
            dependents.some((x) => x.id === t.id)
              ? { ...t, col: anchor.col, requires: { talentId: anchor.id, minRank: 1 } }
              : t,
          )
        })(),
      },
      expect: ['выходит 2', 'стрелки'],
    },
    {
      title: 'этажи ветки идут с дыркой — на панели останется пустая строка',
      content: {
        ...real,
        talents: real.talents.map((t) =>
          t.branch === first(real.branches).id && t.row === 2 ? { ...t, row: 9 } : t,
        ),
      },
      expect: [first(real.branches).id, 'этажи идут'],
    },
    {
      // ЭТАЖ ОТКРЫВАЕТСЯ ЦЕЛИКОМ. Две альтернативы с разными порогами — это
      // уже не выбор, а порядок покупок: одна открылась бы раньше другой.
      title: 'таланты одного этажа требуют разное число очков',
      content: {
        ...real,
        // Второй талант НА ТОТ ЖЕ ЭТАЖ, но со своим порогом. Одной правкой
        // существующего таланта это не воспроизвести: пока на этаже он один,
        // его порог и есть порог этажа.
        talents: [
          ...real.talents,
          ...real.talents
            .filter((t) => t.branch === first(real.branches).id && t.row === 3)
            .map((t) => ({
              ...t,
              id: `${t.id}-двойник`,
              requiredPointsInBranch: t.requiredPointsInBranch + 5,
            })),
        ],
      },
      expect: ['этаж 3', 'разное число очков'],
    },
    {
      // ЧЕТВЁРТАЯ КЛЕТКА В РЯД НЕ ЛЕЗЕТ. Раньше правило было обратным —
      // «два таланта в одном ряду запрещены», — и именно оно держало дерево
      // тремя лестницами. Осталась верхняя граница, и она про экран.
      title: 'на этаже четыре таланта — ряд не помещается на экран',
      content: {
        ...real,
        talents: [
          ...real.talents,
          ...[1, 2, 3].map((n) => ({
            ...first(real.talents.filter((t) => t.branch === first(real.branches).id && t.row === 2)),
            id: `лишний-${n}`,
          })),
        ],
      },
      expect: ['на этаже 2', 'не помещается'],
    },
    {
      // ПЛОСКАЯ ПРИБАВКА К ХАРАКТЕРИСТИКЕ — МЁРТВЫЙ УЗЕЛ: +3 силы это 12.5 %
      // силы атаки на 25-м уровне и 4.2 % на сотом, а очко стоит одинаково.
      title: 'талант даёт плоскую прибавку к базовой характеристике',
      content: {
        ...real,
        talents: real.talents.map((t, index) =>
          index === 0
            ? {
                ...t,
                effect: {
                  kind: 'modifiers' as const,
                  mods: [{ stat: 'strength' as const, kind: 'flat' as const, value: new Decimal(3) }],
                },
              }
            : t,
        ),
      },
      expect: ['strength', 'БАЗОВЫХ'],
    },
    {
      // Тот же довод про растущий стат: плоское число к сотому уровню
      // становится шумом. У ДОЛЕЙ этой болезни нет, и запрет их не трогает.
      title: 'талант даёт плоскую прибавку к растущему стату',
      content: {
        ...real,
        talents: real.talents.map((t, index) =>
          index === 0
            ? {
                ...t,
                effect: {
                  kind: 'modifiers' as const,
                  mods: [{ stat: 'maxHp' as const, kind: 'flat' as const, value: new Decimal(50) }],
                },
              }
            : t,
        ),
      },
      expect: ['maxHp', 'ПЛОСКУЮ'],
    },
    {
      // Талант, которого нет ни в одном пути, не покупает модель прогона:
      // он не «слабый», он невидимый.
      title: 'талант не входит ни в один путь своей ветки',
      content: {
        ...real,
        talents: [
          ...real.talents,
          {
            ...first(real.talents.filter((t) => t.branch === 'warden-wrath' && t.row === 2)),
            id: 'вне-путей',
          },
        ],
      },
      expect: ['вне-путей', 'НИ В ОДИН путь'],
    },
    {
      // Два узла в одном столбце лягут друг на друга.
      title: 'два таланта этажа делят столбец',
      content: {
        ...real,
        talents: real.talents.map((t) =>
          t.id === 'wrath-headlong'
            ? { ...t, col: first(real.talents.filter((x) => x.id === 'wrath-rupture')).col }
            : t,
        ),
      },
      expect: ['wrath-headlong', 'делит столбец'],
    },
    {
      // Стрелка — прямая линия: опора и зависимый в одном столбце.
      title: 'стрелка гнётся между столбцами',
      content: {
        ...real,
        talents: real.talents.map((t) =>
          t.id === 'wrath-open-vein'
            ? { ...t, col: t.col === 1 ? (2 as const) : (1 as const) }
            : t,
        ),
      },
      expect: ['wrath-open-vein', 'гнётся'],
    },
    {
      // ДВА ТАЛАНТА НА ОДНО ПОЛЕ ОДНОГО УМЕНИЯ — это один талант, разрезанный
      // надвое: имена разные, действие одно, и заметить это можно только сверив
      // данные.
      title: 'два таланта ветки правят одно и то же поле умения',
      content: {
        ...real,
        talents: real.talents.map((t) =>
          t.id === 'wrath-open-vein'
            ? {
                ...t,
                effect: {
                  kind: 'ability' as const,
                  abilityId: 'rending-wound',
                  tune: [
                    {
                      field: 'effectWeaponDamagePercent' as const,
                      kind: 'percent' as const,
                      value: 0.1,
                    },
                  ],
                },
              }
            : t,
        ),
      },
      expect: ['wrath-open-vein', 'разрезанный надвое'],
    },
    {
      // Этаж с выбором обязан быть расставлен весь.
      title: 'талант на этаже с выбором без столбца',
      content: {
        ...real,
        talents: real.talents.map((t) => (t.id === 'wrath-firm-hand' ? { ...t, col: undefined } : t)),
      },
      expect: ['wrath-firm-hand', 'столбец у таланта не задан'],
    },
    {
      // Группа из одного члена — не выбор, а опечатка в имени соседа.
      title: 'взаимоисключающая группа из одного члена',
      content: {
        ...real,
        talents: real.talents.map((t) =>
          t.id === 'wrath-echo' ? { ...t, exclusiveGroup: 'одинокая' } : t,
        ),
      },
      expect: ['одинокая', 'из одного члена'],
    },
    {
      // Группа через этажи запирает талант тем, до чего ещё не дошли.
      title: 'взаимоисключающая группа тянется через этажи',
      content: {
        ...real,
        talents: real.talents.map((t) =>
          t.id === 'wrath-echo' || t.id === 'wrath-rupture'
            ? { ...t, exclusiveGroup: 'через-этажи' }
            : t,
        ),
      },
      expect: ['через-этажи', 'через этажи'],
    },
    {
      // Группа через ветки — выбор, которого игрок не увидит целиком.
      title: 'взаимоисключающая группа тянется через ветки',
      content: {
        ...real,
        talents: real.talents.map((t) =>
          t.id === 'wrath-echo' || t.id === 'bulwark-mirror-shield'
            ? { ...t, exclusiveGroup: 'через-ветки' }
            : t,
        ),
      },
      expect: ['через-ветки', 'через ветки'],
    },
    {
      // Процент к криту — не майлстоун: на ключевом этаже меняют поведение.
      title: 'на ключевом этаже стоит модификатор конвейера',
      content: {
        ...real,
        talents: real.talents.map((t) =>
          t.id === 'wrath-headlong'
            ? {
                ...t,
                effect: {
                  kind: 'modifiers' as const,
                  mods: [{ stat: 'critChance' as const, kind: 'flat' as const, value: new Decimal(0.05) }],
                },
              }
            : t,
        ),
      },
      expect: ['взаимоисключающей группе', 'модификаторы конвейера'],
    },
    {
      // ФОРМА ВЕТКИ — ДАННЫЕ, И ДАННЫЕ ОБЯЗАНЫ ЕЙ ОТВЕЧАТЬ. Этаж без единого
      // таланта — это порог, за которым ничего нет: очки вложены, а брать
      // нечего. Заметить это чтением нельзя, а на экране получается дырка.
      title: 'в ветке пустой этаж посреди формы',
      content: {
        ...real,
        talents: real.talents.filter(
          (t) => !(t.branch === 'warden-wrath' && t.row === 2),
        ),
      },
      expect: ['этаж 2 пуст'],
    },
    {
      // ПОРОГ СЧИТАЕТСЯ ИЗ ФОРМЫ. Написанный руками порог разъезжается с
      // сеткой молча: узел стоит на третьем этаже, а открывается по пятому.
      title: 'порог таланта не отвечает форме ветки',
      content: {
        ...real,
        talents: real.talents.map((t) =>
          t.id === 'wrath-deep-brand' ? { ...t, requiredPointsInBranch: 33 } : t,
        ),
      },
      expect: ['не отвечает форме ветки'],
    },
    {
      // РЯД ШИРИНОЙ В СВОЮ ВЕТКУ. Лишняя клетка в ряду не помещается на
      // экран, и ширина у каждой ветки своя — общего потолка тут нет.
      title: 'в ряду больше талантов, чем ветка широка',
      content: {
        ...real,
        branches: real.branches.map((b) =>
          b.id === 'warden-wrath' ? { ...b, cols: 3 as const } : b,
        ),
      },
      expect: ['при ширине ветки 3'],
    },
    {
      // Стрелка вверх: до таланта не добраться никогда — очки в опорный
      // талант вкладываются ПОСЛЕ него.
      title: 'стрелка-предпосылка ведёт снизу вверх',
      content: {
        ...real,
        talents: real.talents.map((t) =>
          t.row === 2 && t.branch === first(real.branches).id
            ? {
                ...t,
                requires: {
                  talentId: real.talents.find(
                    (x) => x.branch === t.branch && x.row === 5,
                  )!.id,
                },
              }
            : t,
        ),
      },
      expect: ['стрелка обязана вести', 'СВЕРХУ ВНИЗ'],
    },
    {
      title: 'стрелка-предпосылка ведёт в чужую ветку',
      content: {
        ...real,
        talents: real.talents.map((t) =>
          t.row === 3 && t.branch === first(real.branches).id
            ? {
                ...t,
                requires: {
                  talentId: real.talents.find((x) => x.branch !== t.branch && x.row === 1)!.id,
                },
              }
            : t,
        ),
      },
      expect: ['стрелка через ветки невозможна'],
    },
    {
      title: 'стрелка требует ранг выше потолка опорного таланта',
      content: {
        ...real,
        talents: real.talents.map((t) =>
          t.row === 4 && t.branch === first(real.branches).id
            ? {
                ...t,
                requires: {
                  talentId: real.talents.find(
                    (x) => x.branch === t.branch && x.row === 1,
                  )!.id,
                  minRank: 99,
                },
              }
            : t,
        ),
      },
      expect: ['условие невыполнимо'],
    },
    {
      title: 'рецепт требует материал, которого нет в игре',
      content: {
        ...real,
        recipes: patch(real.recipes, first(real.recipes).id, {
          inputs: [{ materialId: 'нет-такого', count: 1 }],
        }),
      },
      expect: [first(real.recipes).id, 'нет-такого', 'data/reagents.ts'],
    },
    {
      // ПЯТЬ ПОЛОМОК ПРО РОЛИ И ПОЛОСЫ РЕАГЕНТОВ. Каждая — одно из правил
      // стадии «реагенты встают на полосы»: без битого образца правило
      // остаётся обещанием, а не проверкой.
      title: 'реагент стоит на полосе, которой нет',
      content: {
        ...real,
        reagents: patch(real.reagents, commonReagent(real).id, {
          band: 'нет-полосы' as never,
        }),
      },
      expect: [commonReagent(real).id, 'нет-полосы'],
    },
    {
      title: 'обычный реагент без веса рулетки — не выпадет никогда',
      content: {
        ...real,
        reagents: patch(real.reagents, commonReagent(real).id, { weight: undefined }),
      },
      expect: [commonReagent(real).id, 'без веса рулетки'],
    },
    {
      title: 'обычный реагент роняет босс подземелья — роль и источник разошлись',
      content: {
        ...real,
        reagents: patch(real.reagents, bossReagent(real).id, {
          role: 'common',
          weight: 5,
          source: undefined,
        }),
      },
      expect: [bossReagent(real).id, 'роняет босс подземелья'],
    },
    {
      title: 'боссовый реагент без источника: непонятно, кто его роняет',
      content: {
        ...real,
        reagents: patch(real.reagents, bossReagent(real).id, { source: undefined }),
      },
      expect: [bossReagent(real).id, 'без источника'],
    },
    {
      title: 'промежуточный реагент выпадает — второй передел стал необязательным',
      content: {
        ...real,
        reagents: patch(real.reagents, commonReagent(real).id, { role: 'crafted' }),
      },
      expect: [commonReagent(real).id, 'не выпадает'],
    },
    {
      title: 'полоса без обычного реагента — ремёсла на этой глубине мертвы',
      content: {
        ...real,
        reagents: real.reagents.filter((r) => r.band !== commonReagent(real).band),
      },
      expect: [commonReagent(real).band, 'ни один обычный реагент'],
    },
    {
      title: 'рецепт просит реагент полосы глубже своей — собрать его нельзя',
      content: {
        ...real,
        recipes: patch(real.recipes, shallowRecipe(real).id, {
          inputs: [{ materialId: deepestCommon(real).id, count: 1 }],
        }),
      },
      expect: [shallowRecipe(real).id, 'лежит глубже'],
    },
    {
      title: 'трава не растёт ни в одной зоне — зелья с ней недостижимы',
      content: {
        ...real,
        herbs: patch(real.herbs, first(real.herbs).id, { zoneIds: [] }),
      },
      expect: [first(real.herbs).id, 'не растёт ни в одной зоне'],
    },
    {
      title: 'трава растёт в зоне, которой нет',
      content: {
        ...real,
        herbs: patch(real.herbs, first(real.herbs).id, { zoneIds: ['нет-зоны'] }),
      },
      expect: [first(real.herbs).id, 'нет-зоны'],
    },
    {
      // ОБРАЗЕЦ ПОД ПРАВИЛО «настройка игрока — не характеристика». Ровно тот
      // талант, который удалён в четвёртую ночь: он молча сдвигал выставленный
      // игроком порог привала вверх.
      title: 'талант двигает порог привала — настройку игрока, а не характеристику',
      content: {
        ...real,
        talents: real.talents.map((t, i) =>
          i === 0
            ? {
                ...t,
                effect: {
                  kind: 'modifiers' as const,
                  mods: [
                    { stat: 'restThreshold' as const, kind: 'flat' as const, value: new Decimal(0.02) },
                  ],
                },
              }
            : t,
        ),
      },
      expect: [first(real.talents).id, 'restThreshold', 'НАСТРОЙКА игрока'],
    },
    {
      // ОБРАЗЕЦ ПОД ПРАВИЛО «запертая механика не собирает ресурс раньше
      // своего уровня». Ровно тот случай, ради которого правило и заведено:
      // трава на стартовом лугу при травничестве с сорокового уровня.
      // Двадцать уровней игрок смотрел бы, как копится то, к чему у него
      // нет ни рецепта, ни кнопки.
      title: 'трава растёт в стартовой зоне, а травничество открывается на сороковом',
      content: {
        ...real,
        herbs: patch(real.herbs, first(real.herbs).id, {
          zoneIds: [...first(real.herbs).zoneIds, real.zones[0].id],
        }),
      },
      expect: [first(real.herbs).id, real.zones[0].id, 'открывается только на'],
    },
    {
      title: 'трава срезается ноль раз в минуту — её не собрать никогда',
      content: {
        ...real,
        herbs: patch(real.herbs, first(real.herbs).id, { perMinute: 0 }),
      },
      expect: [first(real.herbs).id, 'perMinute'],
    },
    {
      title: 'зелье лечит наоборот: отрицательный модификатор — это наказание',
      content: {
        ...real,
        recipes: real.recipes.map((r) =>
          r.output.kind === 'potion'
            ? {
                ...r,
                output: {
                  ...r.output,
                  mods: r.output.mods.map((m) => ({ ...m, value: m.value.neg() })),
                },
              }
            : r,
        ),
      },
      expect: ['не положителен'],
    },
    {
      title: 'id склянки не совпадает с id рецепта — мешок её не найдёт',
      content: {
        ...real,
        recipes: real.recipes.map((r) =>
          r.output.kind === 'potion' ? { ...r, output: { ...r.output, id: 'potion:чужой' } } : r,
        ),
      },
      expect: ['potion:чужой'],
    },
    {
      title: 'зачарование подменяет базу боя: kind base',
      content: {
        ...real,
        enchants: patch(real.enchants, first(real.enchants).id, {
          mods: [
            { stat: 'weaponDamageMin' as StatId, kind: 'base' as const, value: new Decimal(50) },
          ],
        }),
      },
      expect: [first(real.enchants).id, 'base', 'data/enchants.ts'],
    },
    {
      title: 'зачарование ускоряет прибавкой к weaponSpeed вместо haste',
      content: {
        ...real,
        enchants: patch(real.enchants, first(real.enchants).id, {
          mods: [
            { stat: 'weaponSpeed' as StatId, kind: 'flat' as const, value: new Decimal(-0.5) },
          ],
        }),
      },
      expect: [first(real.enchants).id, 'weaponSpeed', 'haste'],
    },
    {
      title: 'зачарование не подходит ни одному слоту — наложить его некуда',
      content: {
        ...real,
        enchants: patch(real.enchants, first(real.enchants).id, { slots: [] }),
      },
      expect: [first(real.enchants).id, 'не подходит ни одному слоту'],
    },
    {
      title: 'прок без внутреннего кулдауна — темп рос бы вместе с ускорением',
      content: {
        ...real,
        procs: patch(real.procs, first(real.procs).id, { internalCooldownMs: 0 }),
      },
      expect: [first(real.procs).id, 'internalCooldownMs'],
    },
    {
      title: 'прок срабатывает с нулевым шансом — он не сработает никогда',
      content: {
        ...real,
        procs: patch(real.procs, first(real.procs).id, { chance: 0 }),
      },
      expect: [first(real.procs).id, 'chance'],
    },
    {
      title: 'героический босс ускоряется прибавкой ниже нуля',
      content: {
        ...real,
        bossAbilities: real.bossAbilities.map((a) =>
          a.effect.kind === 'frenzy-below-hp'
            ? { ...a, effect: { ...a.effect, hasteBonus: 0 } }
            : a,
        ),
      },
      expect: ['hasteBonus'],
    },
    {
      title: 'рубежи храма идут не по возрастанию',
      content: {
        ...real,
        temples: real.temples.map((t) => ({
          ...t,
          milestones: [...t.milestones].reverse(),
        })),
      },
      expect: ['рубежи обязаны'],
    },
    {
      title: 'храм открывает рецепт, которого нет',
      content: {
        ...real,
        temples: real.temples.map((t) => ({
          ...t,
          milestones: t.milestones.map((m) => ({ ...m, recipeId: 'нет-такого' })),
        })),
      },
      expect: ['нет-такого', 'data/recipes.ts'],
    },
    {
      title: 'задание требует убить того, кого нет в зоне',
      content: {
        ...real,
        quests: real.quests.map((q) =>
          q.goal.kind === 'kill' ? { ...q, goal: { ...q.goal, monsterId: 'нет-такого' } } : q,
        ),
      },
      expect: ['нет-такого', 'невыполнимо'],
    },
    {
      title: 'задание требует уровень выше потолка',
      content: {
        ...real,
        quests: real.quests.map((q) =>
          q.goal.kind === 'level' ? { ...q, goal: { ...q.goal, level: 1000 } } : q,
        ),
      },
      expect: ['выше потолка'],
    },
    {
      // Сторож сетки: у готового класса ступени идут без дыр. Убираем одно
      // умение из середины — и ступень пропадает.
      title: 'дыра в сетке разблокировок готового класса',
      content: {
        ...real,
        classes: real.classes.map((hero) =>
          hero.status === 'ready'
            ? { ...hero, abilityIds: hero.abilityIds.slice(0, -1) }
            : hero,
        ),
      },
      expect: ['сетка разблокировок', 'data/abilities.ts'],
    },
    {
      title: 'класс ссылается на несуществующее умение',
      content: {
        ...real,
        classes: patch(real.classes, first(real.classes).id, { abilityIds: ['нет-такого'] }),
      },
      expect: [first(real.classes).id, 'нет-такого', 'data/abilities.ts'],
    },
    {
      title: 'все классы в превью: не по кому считать контракты',
      content: {
        ...real,
        classes: real.classes.map((c) => ({ ...c, status: 'preview' as const })),
      },
      expect: ['ни одного готового класса'],
    },
    {
      title: 'готовность класса не из ready/preview',
      content: {
        ...real,
        classes: patch(real.classes, first(real.classes).id, {
          status: 'done' as unknown as ClassDef['status'],
        }),
      },
      expect: [first(real.classes).id, 'не из ready/preview'],
    },
    {
      title: 'класс без веток талантов: очки некуда вкладывать',
      content: {
        ...real,
        classes: patch(real.classes, first(real.classes).id, { branchIds: [] }),
      },
      expect: [first(real.classes).id, 'ни одной ветки'],
    },
    {
      title: 'ступень лестницы ссылается на несуществующий данж',
      content: {
        ...real,
        progression: real.progression.map((step) =>
          step.unlocks.some((u) => u.kind === 'dungeon')
            ? { ...step, unlocks: [{ kind: 'dungeon' as const, id: 'нет-такого-данжа' }] }
            : step,
        ),
      },
      expect: ['нет-такого-данжа', 'data/dungeons.ts'],
    },
    {
      title: 'ступень лестницы ссылается на несуществующую механику',
      content: {
        ...real,
        progression: real.progression.map((step) =>
          step.unlocks.some((u) => u.kind === 'mechanic')
            ? { ...step, unlocks: [{ kind: 'mechanic' as const, id: 'телепортация' as never }] }
            : step,
        ),
      },
      expect: ['телепортация', 'MECHANIC_IDS'],
    },
    {
      title: 'ступень-заглушка при этом что-то открывает',
      content: {
        ...real,
        progression: real.progression.map((step) =>
          step.placeholder
            ? { ...step, unlocks: [{ kind: 'dungeon' as const, id: real.dungeons[0].id }] }
            : step,
        ),
      },
      expect: ['заглушкой', 'data/progression.ts'],
    },
    {
      title: 'кованая броня не называет главный атрибут',
      content: {
        ...real,
        recipes: real.recipes.map((r) =>
          r.id === 'forged-helm' && r.output.kind === 'item'
            ? { ...r, output: { ...r.output, attribute: undefined } }
            : r,
        ),
      },
      expect: ['forged-helm', 'главный атрибут', 'data/recipes.ts'],
    },
    {
      title: 'умение с нулевым уровнем разблокировки',
      content: {
        ...real,
        abilities: patch(real.abilities, 'quick-strike', { unlockLevel: 0 }),
      },
      expect: ['quick-strike', 'unlockLevel', 'data/abilities.ts'],
    },
    {
      title: 'у класса все умения заперты уровнями — на старте пустая панель',
      content: {
        ...real,
        abilities: patch(real.abilities, 'quick-strike', { unlockLevel: 4 }),
      },
      expect: ['warden', 'первого уровня', 'data/abilities.ts'],
    },
    {
      title: 'у оружия побочный стат процентом — он не растёт ни от уровня, ни от тира',
      content: {
        ...real,
        weapons: patch(real.weapons, first(real.weapons).id, {
          extra: [{ stat: 'strength' as StatId, kind: 'percent', value: new Decimal(0.1) }],
        }),
      },
      expect: [first(real.weapons).id, "kind: 'percent'", 'data/items.ts'],
    },
    {
      title: 'у щита побочный стат множителем — та же беда, что и с процентом',
      content: {
        ...real,
        shields: patch(real.shields, first(real.shields).id, {
          extra: [{ stat: 'vitality' as StatId, kind: 'multiplier', value: new Decimal(1.2) }],
        }),
      },
      expect: [first(real.shields).id, "kind: 'multiplier'", 'data/items.ts'],
    },
    {
      title: 'стартовый комплект закрывает все слоты — находке некуда лечь',
      content: {
        ...real,
        classes: patch(real.classes, 'warden', {
          startingEquipment: [
            ...CLASS_BY_ID.warden.startingEquipment,
            { slot: 'chest' as SlotId, kind: 'armor', attribute: 'vitality', rarity: 'common' },
          ],
        }),
      },
      expect: ['warden', 'вместо одного', 'data/classes.ts'],
    },
    {
      title: 'стартовое оружие редкое — первые находки будут хуже подарка',
      content: {
        ...real,
        classes: patch(real.classes, 'warden', {
          startingEquipment: CLASS_BY_ID.warden.startingEquipment.map((i) => ({
            ...i,
            rarity: 'rare' as const,
          })),
        }),
      },
      expect: ['warden', 'обязан быть белым', 'data/classes.ts'],
    },
    {
      title: 'ресурс копится боем, но не тает — это копилка, а не ярость',
      content: {
        ...real,
        classes: patch(real.classes, 'reaver', {
          resource: {
            ...CLASS_BY_ID.reaver.resource,
            decayShare: new Decimal(0),
          },
        }),
      },
      expect: ['reaver', 'не тает вне боя'],
    },
    {
      title: 'спрайт ссылается на файл, которого нет в public/sprites',
      content: {
        ...real,
        sprites: patch(real.sprites, first(real.sprites).id, { path: 'sprites/нету.svg' }),
      },
      expect: [first(real.sprites).id, 'нету.svg', 'data/sprites.ts'],
    },
    {
      title: 'у фона не указан автор — это нарушение лицензии',
      content: {
        ...real,
        backgrounds: patch(real.backgrounds, first(real.backgrounds).id, { author: '' }),
      },
      expect: [first(real.backgrounds).id, 'author', 'data/sprites.ts'],
    },
    {
      title: 'у архетипа моба нет спрайта',
      content: {
        ...real,
        spriteByArchetype: Object.fromEntries(
          Object.entries(real.spriteByArchetype).filter(
            ([id]) => id !== first(first(real.zones).monsterPool).id,
          ),
        ),
      },
      expect: [first(first(real.zones).monsterPool).id, 'нет спрайта', 'data/sprites.ts'],
    },
    {
      title: 'в маппинге спрайтов мёртвый архетип',
      content: {
        ...real,
        spriteByArchetype: { ...real.spriteByArchetype, 'nobody-here': 'common' },
      },
      expect: ['nobody-here', 'мёртвая', 'data/sprites.ts'],
    },
    {
      title: 'между полосами фонов дыра',
      content: {
        ...real,
        backgrounds: patch(real.backgrounds, real.backgrounds[1].id, {
          minLevel: real.backgrounds[1].minLevel + 1,
        }),
      },
      expect: [real.backgrounds[1].id, 'без фона', 'data/sprites.ts'],
    },
    {
      title: 'звук ссылается на файл, которого нет в public/',
      content: {
        ...real,
        sounds: patch(real.sounds, first(real.sounds).id, { files: ['audio/ui/нету.ogg'] }),
      },
      expect: [first(real.sounds).id, 'нету.ogg', 'не найден'],
    },
    {
      title: 'один сэмпл без разброса: через час игры это дрель',
      content: {
        ...real,
        sounds: patch(real.sounds, first(real.sounds).id, {
          files: [first(real.sounds).files[0]],
          pitchSemitones: 0,
          gainDb: 0,
        }),
      },
      expect: [first(real.sounds).id, 'разброс'],
    },
    {
      title: 'разброс высоты вывернут за границы слышимой вариации',
      content: {
        ...real,
        sounds: patch(real.sounds, first(real.sounds).id, { pitchSemitones: 12 }),
      },
      expect: [first(real.sounds).id, 'pitchSemitones'],
    },
    {
      title: 'щит не блокирует: вероятность блока ушла в ноль',
      content: {
        ...real,
        shields: patch(real.shields, first(real.shields).id, { blockChance: new Decimal(0) }),
      },
      expect: [first(real.shields).id, 'blockChance', 'больше 0'],
    },
    {
      title: 'щит блокирует чаще, чем всегда',
      content: {
        ...real,
        shields: patch(real.shields, first(real.shields).id, { blockChance: new Decimal(1.4) }),
      },
      expect: [first(real.shields).id, 'blockChance', 'не больше 1'],
    },
    {
      title: 'щит выдаёт себя за оружие и даёт урон',
      content: {
        ...real,
        shields: patch(real.shields, first(real.shields).id, {
          extra: [{ stat: 'offhandDamageMax', kind: 'flat', value: new Decimal(9) }],
        }),
      },
      expect: [first(real.shields).id, 'offhandDamageMax', 'не оружие'],
    },
    {
      title: 'лут босса ссылается на несуществующий слот',
      content: {
        ...real,
        dungeons: patch(real.dungeons, first(real.dungeons).id, {
          bosses: first(real.dungeons).bosses.map((boss, i) =>
            i === 0 ? { ...boss, loot: { ...boss.loot, slots: ['cloak' as SlotId] } } : boss,
          ),
        }),
      },
      expect: ['cloak', 'data/slots.ts'],
    },
    {
      title: 'лут босса ссылается на несуществующую редкость',
      content: {
        ...real,
        dungeons: patch(real.dungeons, first(real.dungeons).id, {
          bosses: first(real.dungeons).bosses.map((boss, i) =>
            i === 0
              ? { ...boss, loot: { ...boss.loot, minRarity: 'mythic' as never } }
              : boss,
          ),
        }),
      },
      expect: ['mythic', 'data/rarity.ts'],
    },
    {
      title: 'два моба в разных зонах с одним id',
      content: {
        ...real,
        zones: real.zones.map((zone, i) =>
          i === 1
            ? { ...zone, monsterPool: [...zone.monsterPool, first(first(real.zones).monsterPool)] }
            : zone,
        ),
      },
      expect: [first(first(real.zones).monsterPool).id, 'двух зон', 'data/zones.ts'],
    },
    {
      title: 'до таланта не добраться: очков в ветке столько не набрать',
      content: {
        ...real,
        talents: real.talents.map((talent, i) =>
          i === real.talents.length - 1 ? { ...talent, requiredPointsInBranch: 999 } : talent,
        ),
      },
      expect: [real.talents[real.talents.length - 1].id, '999', 'не добраться'],
    },
    {
      title: 'предметы слота не выпадают: нулевой вес в рулетке',
      content: {
        ...real,
        slotDropWeights: { ...real.slotDropWeights, trinket: 0 },
      },
      expect: ['trinket', 'никогда', 'data/slots.ts'],
    },
    {
      title: 'каждую зону открывает данж — игроку негде начать',
      content: {
        ...real,
        dungeons: real.dungeons.map((d, i) =>
          i === 0 ? { ...d, opensZoneIds: real.zones.map((z) => z.id) } : d,
        ),
      },
      expect: ['негде начать', 'data/dungeons.ts'],
    },
    {
      title: 'одну зону открывают сразу два данжа — это развилка, а не лестница',
      content: {
        ...real,
        dungeons: real.dungeons.map((d) =>
          d.difficulty === 'heroic'
            ? d
            : { ...d, opensZoneIds: [...d.opensZoneIds, 'glasswaste'] },
        ),
      },
      expect: ['glasswaste', 'развилкой', 'data/dungeons.ts'],
    },
    {
      title: 'данж открывает не две зоны — раскладка двадцати зон не сойдётся',
      content: {
        ...real,
        dungeons: real.dungeons.map((d) =>
          d.difficulty === 'heroic' || d.tier !== 1 ? d : { ...d, opensZoneIds: [d.opensZoneIds[0]] },
        ),
      },
      expect: ['вместо двух', 'data/dungeons.ts'],
    },
    {
      title: 'вход в данж лежит в зоне, которую он же и открывает — кольцо',
      content: {
        ...real,
        dungeons: real.dungeons.map((d) =>
          d.difficulty === 'heroic' || d.tier !== 1 ? d : { ...d, zoneId: d.opensZoneIds[0] },
        ),
      },
      expect: ['до входа не добраться', 'data/dungeons.ts'],
    },
    {
      title: 'кованая вещь уровня выше потолка — пошлину считать не от чего',
      content: {
        ...real,
        recipes: real.recipes.map((r) =>
          r.output.kind === 'item'
            ? { ...r, output: { ...r.output, level: real.balance.levelCap + 20 } }
            : r,
        ),
      },
      expect: ['вне лестницы', 'data/recipes.ts'],
    },
    {
      title: 'данж ссылается на реагент, которого нет в игре',
      content: {
        ...real,
        dungeons: patch(real.dungeons, first(real.dungeons).id, {
          reagentId: 'reagent-нет-такого',
        }),
      },
      expect: [first(real.dungeons).id, 'reagent-нет-такого', 'data/reagents.ts'],
    },
    {
      title: 'реагент данжа не своего тира: две ступени перепутаны',
      content: {
        ...real,
        dungeons: patch(real.dungeons, first(real.dungeons).id, {
          reagentId: real.dungeons[1].reagentId,
          bosses: first(real.dungeons).bosses.map((boss, i, all) =>
            i === all.length - 1 ? { ...boss, reagentId: real.dungeons[1].reagentId } : boss,
          ),
        }),
      },
      expect: [first(real.dungeons).id, 'своего тира', 'data/reagents.ts'],
    },
    {
      title: 'лестница данжей с дыркой: тира нет ни у кого',
      content: {
        ...real,
        dungeons: patch(real.dungeons, real.dungeons[1].id, { tier: real.dungeons[1].tier + 1 }),
      },
      expect: [real.dungeons[1].id, 'подряд', 'data/dungeons.ts'],
    },
    {
      title: 'уровень входа не вырос вместе с тиром',
      content: {
        ...real,
        dungeons: patch(real.dungeons, real.dungeons[1].id, {
          unlockRequirement: first(real.dungeons).unlockRequirement,
        }),
      },
      expect: [real.dungeons[1].id, 'уровни входа обязаны расти', 'data/dungeons.ts'],
    },
    {
      title: 'реагент, которого не роняет ни один данж',
      content: {
        ...real,
        // Убираем ПОСЛЕДНИЙ данж — его реагент остаётся без источника.
        // Берём именно подземельный реагент: у храмового источник другой,
        // и поломка на нём показала бы не то правило.
        dungeons: real.dungeons.filter((d) => d.reagentId !== lastDungeonReagent(real).id),
      },
      expect: [
        lastDungeonReagent(real).id,
        'не роняет ни один данж',
        'data/dungeons.ts',
      ],
    },
    {
      title: 'реагент падает с первого босса, а не за пройденную цепочку',
      content: {
        ...real,
        dungeons: patch(real.dungeons, first(real.dungeons).id, {
          bosses: first(real.dungeons).bosses.map((boss, i) =>
            i === 0 ? { ...boss, reagentId: first(real.dungeons).reagentId } : boss,
          ),
        }),
      },
      expect: [first(first(real.dungeons).bosses).id, 'не будучи последним', 'data/dungeons.ts'],
    },
    {
      title: 'коридор темпа вывернут наизнанку',
      content: {
        ...real,
        balance: { ...real.balance, ttkTargetMin: 30 },
      },
      expect: ['TTK_TARGET_MIN', 'TTK_TARGET_MAX', 'data/balance.ts'],
    },
    {
      title: 'храм открывается с 70, а вход стоит в зоне 91-95',
      content: {
        ...real,
        temples: real.temples.map((t) => ({
          ...t,
          unlockRequirement: 70,
          zoneId: highBandZone(real).id,
        })),
      },
      expect: ['храм', 'раньше, чем начнёт там выживать', 'data/temple.ts'],
    },
    {
      title: 'данж открывается на 90, а вход стоит в стартовой полосе',
      content: {
        ...real,
        dungeons: real.dungeons.map((d) =>
          d.difficulty === 'normal' && d.id === first(real.dungeons).id
            ? { ...d, unlockRequirement: 90 }
            : d,
        ),
      },
      expect: [first(real.dungeons).id, 'зона отстала от открытия', 'data/dungeons.ts'],
    },
    {
      title: 'вероятность дропа больше единицы',
      content: {
        ...real,
        balance: { ...real.balance, dropChance: 1.5 },
      },
      expect: ['DROP_CHANCE', 'вероятность'],
    },
    {
      // Число переехало из game/loot.ts в data/loot.ts (правило «весь баланс
      // живёт в data»), и вместе с ним появился диапазон: доля не бывает
      // больше единицы.
      title: 'доля щитов среди находок больше единицы',
      content: {
        ...real,
        balance: { ...real.balance, shieldShare: 1.4 },
      },
      expect: ['SHIELD_SHARE', 'доля'],
    },
    {
      // Кран золота делят два числа, и делят они ОДНО И ТО ЖЕ. Правка одной
      // доли без второй выглядит как невинная подстройка «сколько платят
      // находки», а на деле двигает весь доход игры разом — вместе с ценой
      // крафта и лестницей покупок, которые считаются от него.
      title: 'доли крана золота не дают единицу',
      content: {
        ...real,
        balance: { ...real.balance, goldFromLoot: 0.9 },
      },
      expect: ['GOLD_SOURCE_SHARE', 'единицу'],
    },

    // --- Ничто не открывается выше потолка уровней ---
    //
    // Довод был написан для трёх констант баланса, а уровни входа зон,
    // данжей, храмов, умений, ступеней и цепочки заданий с потолком не
    // сверялись вовсе. Запас нулевой уже сегодня: ступень рейда стоит РОВНО
    // на сотом уровне, и опечатка в одну цифру закрыла бы её навсегда.
    {
      title: 'данж открывается выше потолка уровней',
      content: {
        ...real,
        dungeons: real.dungeons.map((d, i) =>
          i === 0 ? { ...d, unlockRequirement: real.balance.levelCap + 5 } : d,
        ),
      },
      expect: ['unlockRequirement', 'LEVEL_CAP'],
    },
    {
      title: 'храм открывается выше потолка уровней',
      content: {
        ...real,
        temples: real.temples.map((t) => ({ ...t, unlockRequirement: real.balance.levelCap + 1 })),
      },
      expect: ['unlockRequirement', 'LEVEL_CAP'],
    },
    {
      title: 'умение открывается выше потолка уровней',
      content: {
        ...real,
        abilities: real.abilities.map((a, i) =>
          i === 0 ? { ...a, unlockLevel: real.balance.levelCap + 1 } : a,
        ),
      },
      expect: ['unlockLevel', 'LEVEL_CAP'],
    },
    {
      title: 'ступень лестницы открывается выше потолка уровней',
      content: {
        ...real,
        progression: real.progression.map((p, i) =>
          i === 0 ? { ...p, level: real.balance.levelCap + 1 } : p,
        ),
      },
      expect: ['level', 'LEVEL_CAP'],
    },
    {
      title: 'цепочка заданий открывается выше потолка уровней',
      content: { ...real, questChainUnlockLevel: real.balance.levelCap + 1 },
      expect: ['unlockLevel', 'LEVEL_CAP'],
    },
    {
      title: 'верх полос мобов не достаёт до потолка уровней',
      content: {
        ...real,
        zones: real.zones.map((z) =>
          z.monsterLevelRange.max === real.balance.levelCap
            ? { ...z, monsterLevelRange: { ...z.monsterLevelRange, max: z.monsterLevelRange.max - 1 } }
            : z,
        ),
      },
      expect: ['полоса', 'LEVEL_CAP'],
    },
    {
      title: 'ступени штрафа опыта идут не по возрастанию разрыва',
      content: {
        ...real,
        balance: {
          ...real.balance,
          xpGapPenalty: [
            { maxGap: 10, share: 1 },
            { maxGap: 5, share: 0.5 },
            { maxGap: Number.POSITIVE_INFINITY, share: 0 },
          ],
        },
      },
      expect: ['XP_GAP_PENALTY', 'недостижима', 'data/balance.ts'],
    },
    {
      title: 'штраф опыта за больший разрыв мягче, чем за меньший',
      content: {
        ...real,
        balance: {
          ...real.balance,
          xpGapPenalty: [
            { maxGap: 5, share: 0.5 },
            { maxGap: 10, share: 1 },
            { maxGap: Number.POSITIVE_INFINITY, share: 0 },
          ],
        },
      },
      expect: ['XP_GAP_PENALTY', 'не мягче', 'data/balance.ts'],
    },
    {
      title: 'доля опыта больше единицы',
      content: {
        ...real,
        balance: {
          ...real.balance,
          xpGapPenalty: [{ maxGap: Number.POSITIVE_INFINITY, share: 1.5 }],
        },
      },
      expect: ['XP_GAP_PENALTY', 'доля награды', 'data/balance.ts'],
    },
    {
      title: 'последняя ступень штрафа опыта не накрывает больший разрыв',
      content: {
        ...real,
        balance: {
          ...real.balance,
          xpGapPenalty: [
            { maxGap: 5, share: 1 },
            { maxGap: 10, share: 0.5 },
          ],
        },
      },
      expect: ['XP_GAP_PENALTY', 'без доли', 'data/balance.ts'],
    },
    {
      title: 'у оружия хват щита',
      content: {
        ...real,
        weapons: patch(real.weapons, first(real.weapons).id, {
          grip: 'shield' as WeaponTemplate['grip'],
        }),
      },
      expect: [first(real.weapons).id, 'хват', 'data/items.ts'],
    },
    {
      title: 'у щита хват оружия',
      content: {
        ...real,
        shields: patch(real.shields, first(real.shields).id, {
          grip: 'one' as ShieldTemplate['grip'],
        }),
      },
      expect: [first(real.shields).id, 'вторую руку', 'data/items.ts'],
    },
    {
      title: 'рецепт кует щит в главную руку',
      content: {
        ...real,
        recipes: real.recipes.map((recipe) =>
          recipe.output.kind === 'item' && SHIELD_IDS.has(String(recipe.output.templateId))
            ? { ...recipe, output: { ...recipe.output, slot: 'mainHand' as SlotId } }
            : recipe,
        ),
      },
      expect: ['щит', 'вторую руку', 'data/recipes.ts'],
    },
    // КАТЕГОРИИ КРАФТА. Категория ВЫВОДИТСЯ из выхода, поэтому ломается она
    // не подменой поля (поля нет), а выходом, который вывести нельзя.
    {
      title: 'рецепт кует оружие без шаблона — категорию вывести не из чего',
      content: {
        ...real,
        recipes: real.recipes.map((recipe) =>
          recipe.output.kind === 'item' && recipe.output.slot === 'mainHand'
            ? { ...recipe, output: { ...recipe.output, templateId: undefined } }
            : recipe,
        ),
      },
      expect: [handRecipeId(real), 'категори', 'data/items.ts'],
    },
    {
      // МЁРТВАЯ ПРАВКА УМЕНИЯ. Самая тихая из поломок дерева: имя поля
      // настоящее, операция подходит полю, умение существует — и талант не
      // делает ничего. Ровно так шесть талантов Изувера пережили переделку
      // его умений, и заметить это чтением было нельзя.
      title: 'талант правит поле, которого у умения нет',
      content: {
        ...real,
        talents: real.talents.map((t) =>
          t.effect.kind === 'ability'
            ? {
                ...t,
                // «Урон эффекта» у умения, у которого эффекта нет: подсовываем
                // ПЕРВОЕ умение — оно точно без урона по времени.
                effect: {
                  kind: 'ability' as const,
                  abilityId: first(real.abilities).id,
                  tune: [
                    {
                      field: 'effectWeaponDamagePercent' as const,
                      kind: 'percent' as const,
                      value: 0.1,
                    },
                  ],
                },
              }
            : t,
        ),
      },
      expect: ['effectWeaponDamagePercent', 'НИЧЕГО', 'data/talents.ts'],
    },
    {
      title: 'категория крафта осталась без единого рецепта',
      content: {
        ...real,
        // Уносим ВЕСЬ передел: категория «промежуточные материалы» остаётся
        // строкой списка, за которой ничего нет.
        recipes: real.recipes.filter((r) => r.output.kind !== 'reagent'),
      },
      expect: ['material', 'мёртвая строка', 'data/recipes.ts'],
    },
    // БРОНЯ. Ломается не шаблон, а РЕЗУЛЬТАТ генератора: в шаблоне брони нет
    // вовсе, её кладёт game/loot.ts общей константой — значит и пропасть она
    // может только там, и ловить её надо по сгенерированной вещи.
    {
      title: 'у части брони пропала броня',
      content: {
        ...real,
        generatedMods: real.generatedMods.map((entry) =>
          entry.wear === 'armor'
            ? { ...entry, mods: entry.mods.filter((m) => m.stat !== 'armor') }
            : entry,
        ),
      },
      expect: ['броня', 'ровно одна', 'game/loot.ts'],
    },
    {
      title: 'у щита пропала броня',
      content: {
        ...real,
        generatedMods: real.generatedMods.map((entry) =>
          entry.wear === 'shield'
            ? { ...entry, mods: entry.mods.filter((m) => m.stat !== 'armor') }
            : entry,
        ),
      },
      expect: ['щит', 'ровно одна', 'game/loot.ts'],
    },
    {
      title: 'броня на предмете дробная',
      content: {
        ...real,
        generatedMods: real.generatedMods.map((entry) =>
          entry.wear === 'armor'
            ? {
                ...entry,
                mods: entry.mods.map((m) => (m.stat === 'armor' ? { ...m, value: 12.5 } : m)),
              }
            : entry,
        ),
      },
      expect: ['броня', 'штуками', 'data/items.ts'],
    },
    {
      title: 'оружие несёт броню',
      content: {
        ...real,
        generatedMods: real.generatedMods.map((entry) =>
          entry.wear === 'weapon'
            ? { ...entry, mods: [...entry.mods, { stat: 'armor', kind: 'flat', value: 30 }] }
            : entry,
        ),
      },
      expect: ['оружие', 'не бьёт', 'game/loot.ts'],
    },
    {
      title: 'кривая брони со стопроцентным потолком',
      content: { ...real, balance: { ...real.balance, armorMaxReduction: 1 } },
      expect: ['ARMOR_CURVE.maxReduction', 'бессмертие', 'data/balance.ts'],
    },
    {
      title: 'лестница открытий обещает механику не на своём уровне',
      content: {
        ...real,
        progression: real.progression.map((step) =>
          step.unlocks?.some((u) => u.kind === 'mechanic')
            ? { ...step, level: step.level + 10 }
            : step,
        ),
      },
      expect: ['ступень', 'обещает механику', 'data/progression.ts'],
    },
    {
      title: 'у брони нулевой бюджет защиты',
      content: { ...real, balance: { ...real.balance, armorBaseDefense: 0 } },
      expect: ['ARMOR_BASE_DEFENSE', 'не защищает', 'data/balance.ts'],
    },
    {
      // Ровно та поломка, которая жила в игре: генератор не проверял НИЧЕГО и
      // выдавал броню всему, что не рука. Талисман нёс 15 % брони эталонного
      // комплекта, а проверка молчала.
      title: 'талисман несёт броню',
      content: {
        ...real,
        generatedMods: real.generatedMods.map((entry) =>
          entry.wear === 'trinket'
            ? { ...entry, mods: [...entry.mods, { stat: 'armor', kind: 'flat', value: 44 }] }
            : entry,
        ),
      },
      expect: ['украшение', 'части брони и щиты', 'SLOT_DEFENSE'],
    },
    {
      // Покупки за золото жили мимо content:check вовсе. Дубликат id — самая
      // дешёвая из возможных поломок: `upgradeById` вернёт первую, вторая
      // станет недостижимой, и заметить это можно только в игре.
      title: 'две покупки с одинаковым id',
      content: {
        ...real,
        upgrades: real.upgrades.map((u, i) =>
          i === 1 ? { ...u, id: real.upgrades[0].id } : u,
        ),
      },
      expect: ['покупка за золото', real.upgrades[0].id],
    },
    {
      title: 'покупка ссылается на несуществующий значок',
      content: {
        ...real,
        upgrades: real.upgrades.map((u, i) =>
          i === 0 ? { ...u, icon: 'нет-такого-значка' as typeof u.icon } : u,
        ),
      },
      expect: ['покупка за золото', 'нет-такого-значка'],
    },
    {
      title: 'покупка сумки не даёт мест',
      content: {
        ...real,
        upgrades: real.upgrades.map((u, i) =>
          i === 0 ? { ...u, effect: { kind: 'bag' as const, slots: 0 } } : u,
        ),
      },
      expect: ['покупка', 'прибавка к сумке'],
    },
    // --- ЧЕТЫРЕ ПОЛОМКИ ПРО ИСТОЧНИКИ РЕЦЕПТОВ ---
    //
    // Стадия «рецепт становится добычей» завела четыре правила, и без битого
    // образца каждое из них — просто строчка кода, которая, может быть, что-то
    // проверяет.
    {
      title: 'у рецепта нет источника — взять его неоткуда',
      content: {
        ...real,
        recipes: patch(real.recipes, first(real.recipes).id, {
          source: undefined as unknown as (typeof real.recipes)[number]['source'],
        }),
      },
      expect: [first(real.recipes).id, 'источник не назван'],
    },
    {
      title: 'рецепт падает не с последнего босса цепочки',
      content: {
        ...real,
        recipes: patch(real.recipes, bossRecipeId(real), {
          source: {
            kind: 'boss' as const,
            dungeonId: first(real.dungeons).id,
            bossId: first(real.dungeons).bosses[0].id,
          },
        }),
      },
      expect: [bossRecipeId(real), 'не с последнего'],
    },
    {
      title: 'один босс назначен источником для двух рецептов',
      content: {
        ...real,
        recipes: patch(real.recipes, first(real.recipes).id, {
          source: real.recipes.find((r) => r.source.kind === 'boss')!.source,
        }),
      },
      expect: ['назначен источником сразу'],
    },
    {
      title: 'у последнего босса подземелья нет своего рецепта',
      content: {
        ...real,
        recipes: real.recipes.filter((r) => r.id !== bossRecipeId(real)),
      },
      expect: ['не роняет ни одного рецепта'],
    },
    {
      title: 'лестница мастерства не начинается с нуля',
      content: {
        ...real,
        // Убираем ПЕРВУЮ ступень профессии: остальные требуют мастерства,
        // а расти теперь не на чем — профессия заперта сама на себя.
        recipes: real.recipes.filter((r) => r.id !== firstMasteryId(real)),
      },
      expect: ['учить не на чем'],
    },
    // --- ТРИ ПОЛОМКИ ПРО ДЕРЕВО, КОТОРЫЕ НЕ ВИДНЫ ЧТЕНИЕМ ---
    //
    // У всех трёх общая беда: имена настоящие, ссылки целые, схема довольна,
    // а таланта как будто нет. Такое ловится только проверкой.
    {
      // Талант Стража правит умение Псаря: чужое умение не попадает ни в ряд
      // действий, ни в модель боя, и правка не делает НИЧЕГО.
      title: 'талант правит умение чужого класса',
      content: {
        ...real,
        talents: patch(real.talents, foreignTunedTalent(real).talent.id, {
          effect: {
            ...(foreignTunedTalent(real).talent.effect as { kind: 'ability' }),
            abilityId: foreignTunedTalent(real).foreignAbilityId,
          },
        } as Partial<TalentDef>),
      },
      expect: [foreignTunedTalent(real).talent.id, 'не делает НИЧЕГО'],
    },
    {
      // Прок раздаёт СИЛУ. Модификатору это запрещено прямо, а проку — только
      // если правило додумали до конца: прибавка прока идёт тем же плоским
      // модификатором конвейера, просто на восемь секунд. Не проверь это — и
      // «+5 силы на окно» проходило бы там, где «+5 силы» не проходит.
      title: 'прок даёт базовую характеристику',
      content: { ...real, talents: procTalentWith(real, { stat: 'strength' }) },
      expect: [procTalentId(real), 'БАЗОВЫХ'],
    },
    {
      // Прок двигает ПОРОГ ПРИВАЛА: на экране у игрока 60 %, а герой уходит
      // отдыхать на 72 % — восемь секунд из каждых двадцати. Ползунок в этот
      // момент читается как поломка.
      title: 'прок двигает настройку игрока',
      content: { ...real, talents: procTalentWith(real, { stat: 'restThreshold' }) },
      expect: [procTalentId(real), 'НАСТРОЙКА ИГРОКА'],
    },
    {
      // Прок даёт плоскую силу атаки: к сотому уровню прибавка становится
      // шумом, а очко стоит столько же. Процента у прока нет вовсе, значит
      // такой стат ему закрыт целиком.
      title: 'прок даёт плоскую прибавку к растущему стату',
      content: { ...real, talents: procTalentWith(real, { stat: 'attackPower' }) },
      expect: [procTalentId(real), 'ПЛОСКУЮ'],
    },
    {
      // Окно нулевой длины: талант есть, ранг растёт, очки берутся, а в
      // конвейер уходит ноль. Тише мёртвого таланта — тот хотя бы виден.
      title: 'у прока нулевое окно',
      content: { ...real, talents: procTalentWith(real, { durationSec: 0, swings: 0 }) },
      expect: [procTalentId(real), 'не делает НИЧЕГО'],
    },
    {
      // НУЛЕВАЯ ПРИБАВКА — вторая половина того же правила, и проверяется она
      // отдельно от окна. Сама проверка говорит `!== 0`, а не `> 0`: у
      // `regenDelay` и `restDuration` прибавка ОТРИЦАТЕЛЬНАЯ и работает.
      // Образец нужен, чтобы послабление не превратилось в дыру: ноль обязан
      // ронять прогон по-прежнему.
      title: 'у прока нулевая прибавка',
      content: { ...real, talents: procTalentWith(real, { value: 0 }) },
      expect: [procTalentId(real), 'не делает НИЧЕГО'],
    },
    {
      // Условие «ниже ста процентов здоровья» верно ВСЕГДА: в записи
      // ограничение есть, в игре его нет, а игрок читает его в подсказке.
      title: 'условие прока верно всегда',
      content: { ...real, talents: procTalentWhen(real, 1) },
      expect: [conditionalProcId(real), 'условие не условие'],
    },
    {
      // Клеймо переносится ЦЕЛИКОМ уже на первом ранге при пяти рангах: на
      // потолке переносилось бы впятеро больше, чем было.
      title: 'перенос метки отдаёт больше, чем было',
      content: { ...real, talents: carryTalentWith(real, { share: 1 }) },
      expect: [carryTalentId(real), 'больше, чем было'],
    },
    {
      // Перенос метки, которую классу ветки нечем поставить: имена
      // настоящие, ссылки целые, а талант не делает НИЧЕГО.
      title: 'перенос метки, которую класс не вешает',
      content: { ...real, talents: carryTalentInForeignBranch(real) },
      expect: ['нет ни одного', 'умения, которое её вешает'],
    },
    {
      // Замена подставляет умение, лежащее в книге класса: игрок мог
      // поставить его сам, и в ряду оказались бы два экземпляра одного
      // умения с одним откатом — id-то остаётся от заменяемого.
      title: 'замена подставляет умение из книги класса',
      content: { ...real, talents: swapTalentWith(real, { to: ownedAbilityId(real) }) },
      expect: [swapTalentId(real), 'лежит в книге класса'],
    },
    {
      // Замена умения на себя же: талант есть, ранг растёт, очко берут, а не
      // меняется ничего.
      title: 'замена умения на себя же',
      content: { ...real, talents: swapTalentWith(real, { to: swapFrom(real) }) },
      expect: [swapTalentId(real), 'ничего не меняет'],
    },
    {
      // Умение вне всех книг, которое не подставляет ни один талант: оно есть
      // в реестре, проходит схему, весит иконку — и добраться до него нельзя
      // ничем.
      title: 'умение-сирота: ни в книге, ни в замене',
      content: { ...real, talents: withoutSwapTalent(real) },
      expect: ['не лежит ни в одной книге класса'],
    },
    {
      // Талант выдаёт умение, которое и так лежит в книге класса: очко
      // покупает то, что открывается уровнем.
      title: 'талант выдаёт умение из книги класса',
      content: { ...real, talents: grantTalentWith(real, ownedAbilityId(real)) },
      expect: [grantTalentId(real), 'лежит в книге класса'],
    },
    {
      // У выданного умения уровень открытия выше первого: вторые ворота
      // поверх очка — кнопка, которую видно и нельзя нажать.
      title: 'у выданного талантом умения есть уровень открытия',
      content: { ...real, abilities: grantedWithUnlock(real, 20) },
      expect: [grantTalentId(real), 'вторые ворота по уровню'],
    },
    {
      // Из ПОРЯДКА ПОКУПКИ убран венец: талант на месте, ветка цела, а путь
      // тратит все очки игры и до того, ради чего ветку берут, не доходит.
      // Прогон при этом зелёный — он просто меряет другую ветку.
      title: 'путь ветки не берёт венец',
      content: { ...real, pathsOf: pathsWithoutCapstone(real) },
      expect: ['не берёт венец'],
    },
    {
      // Венца нет вовсе: последний этаж ветки пуст, брать её незачем.
      title: 'у ветки нет венца',
      content: { ...real, talents: withoutCapstone(real) },
      expect: ['венца у ветки нет'],
    },
    {
      // Один талант режет откат вдвое за ранг: на потолке рангов откат
      // уходит в ноль, и умение жмётся каждый тик бесплатно.
      title: 'таланты на потолке рангов уводят откат в ноль',
      content: { ...real, tuneAbility: () => ({ ...first(real.abilities), cooldownSec: 0 }) },
      expect: ['откат'],
    },
    // --- ТРИ ПОЛОМКИ ПРО СВОЙСТВО СБОРКИ ---
    //
    // Правило одно: свойство правит умение и ОПЛАЧЕНО статами вещи. Ломается
    // оно с трёх сторон — некому платить, нечем платить, некого править.
    {
      title: 'свойство сборки правит несуществующее умение',
      content: {
        ...real,
        boons: patch(real.boons, first(real.boons).id, { abilityId: 'нет-такого-умения' }),
      },
      expect: [first(real.boons).id, 'нет-такого-умения'],
    },
    {
      title: 'свойство сборки достаётся даром',
      content: {
        ...real,
        boons: patch(real.boons, first(real.boons).id, { statShare: 0 }),
      },
      expect: [first(real.boons).id, 'statShare'],
    },
    {
      title: 'свойство сборки не носит ни один рецепт',
      content: {
        ...real,
        recipes: real.recipes.map((r) =>
          r.output.kind === 'item' && r.output.boonId
            ? { ...r, output: { ...r.output, boonId: undefined } }
            : r,
        ),
      },
      expect: ['не несёт ни один рецепт'],
    },
  ]
}
