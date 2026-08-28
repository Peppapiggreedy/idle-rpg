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
      title: 'модель ссылается на файл, которого нет в public/models',
      content: {
        ...real,
        models: patch(real.models, first(real.models).id, { path: 'models/Wyvern.glb' }),
      },
      expect: [first(real.models).id, 'Wyvern.glb', 'public/models'],
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
      title: 'ни одной зоны на первом уровне',
      content: {
        ...real,
        zones: real.zones.map((z) => ({ ...z, unlockRequirement: z.unlockRequirement + 5 })),
      },
      expect: ['негде начать', 'data/zones.ts'],
    },
    {
      title: 'данж открывается раньше своей зоны',
      content: {
        ...real,
        dungeons: patch(real.dungeons, first(real.dungeons).id, { unlockRequirement: 1 }),
      },
      expect: [first(real.dungeons).id, 'не добраться'],
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
      title: 'вероятность дропа больше единицы',
      content: {
        ...real,
        balance: { ...real.balance, dropChance: 1.5 },
      },
      expect: ['DROP_CHANCE', 'вероятность'],
    },
  ]
}
