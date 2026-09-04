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
import type { ShieldTemplate, WeaponTemplate } from '../../items'
import { realContent } from '../content'
import type { Content } from '../schema'

/** Подмена одного поля у сущности с заданным id. */
function patch<T extends { id: string }>(list: readonly T[], id: string, fields: Partial<T>): T[] {
  return list.map((item) => (item.id === id ? { ...item, ...fields } : item))
}

/** Первый элемент списка — на нём удобно показывать поломку. */
function first<T>(list: readonly T[]): T {
  return list[0]
}

/** Первый ДОБЫВАЕМЫЙ материал: у материала-награды свои правила. */
function minedMaterial(real: Content) {
  return real.materials.find((m) => m.award === undefined) ?? first(real.materials)
}

/** Зона с самой высокой полосой мобов: в неё удобно «ошибочно» ставить вход. */
function highBandZone(real: Content) {
  return [...real.zones].sort(
    (a, b) => b.monsterLevelRange.min - a.monsterLevelRange.min,
  )[0]
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
      title: 'в зоне не падает ни одного материала: ремёсла в ней мертвы',
      content: {
        ...real,
        materials: real.materials.map((m) => ({
          ...m,
          zoneIds: m.zoneIds.filter((id) => id !== real.zones[1].id),
        })),
      },
      expect: [real.zones[1].id, 'материал', 'data/materials.ts'],
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
      title: 'ряды ветки идут с дыркой — на панели останется пустая строка',
      content: {
        ...real,
        talents: real.talents.map((t) =>
          t.branch === first(real.branches).id && t.row === 2 ? { ...t, row: 9 } : t,
        ),
      },
      expect: [first(real.branches).id, 'ряды идут'],
    },
    {
      title: 'рецепт требует материал, которого нет в игре',
      content: {
        ...real,
        recipes: patch(real.recipes, first(real.recipes).id, {
          inputs: [{ materialId: 'нет-такого', count: 1 }],
        }),
      },
      expect: [first(real.recipes).id, 'нет-такого', 'data/materials.ts'],
    },
    {
      title: 'материал не падает ни в одной зоне — рецепты с ним недостижимы',
      content: {
        ...real,
        // Берём ДОБЫВАЕМЫЙ материал: у материала-награды пустой список зон
        // законен, и поломка на нём не показала бы ничего.
        materials: patch(real.materials, minedMaterial(real).id, { zoneIds: [] }),
      },
      expect: [minedMaterial(real).id, 'не падает ни в одной зоне'],
    },
    {
      title: 'материал падает в зоне, которой нет',
      content: {
        ...real,
        materials: patch(real.materials, first(real.materials).id, { zoneIds: ['нет-зоны'] }),
      },
      expect: [first(real.materials).id, 'нет-зоны'],
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
        dungeons: real.dungeons.filter((d) => d.id !== real.dungeons[real.dungeons.length - 1].id),
      },
      expect: [
        real.reagents[real.reagents.length - 1].id,
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
  ]
}
