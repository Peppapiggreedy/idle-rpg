// Схемы данных игры и проверка целостности.
//
// ЗАЧЕМ. Добавление контента должно быть безопасным: новая зона, талант или
// модель — это правка в data/, и единственное, что стоит между опечаткой и
// сломанной игрой, — эта проверка. Ошибка обязана читаться как указание, куда
// идти чинить: не «undefined is not an object», а «данж sunken-barrow
// ссылается на зону whispering-woods, которой нет в data/zones.ts».
//
// Проверка ЧИСТАЯ: на вход идёт слепок контента (`Content`), на выход — список
// замечаний. Поэтому её можно натравить не только на живые данные, но и на
// заведомо битую фикстуру и убедиться, что она вообще срабатывает. Без этого
// сам страж мог бы сломаться, и никто бы не заметил.
//
// Модуль лежит в __tests__, а не в data/: в data/ живут ДАННЫЕ, а это код.
import { Decimal } from '../../game/numbers'
import type { AbilityDef } from '../abilities'
import type { ModelAsset, PropAsset } from '../assets'
import type { DungeonDef } from '../dungeons'
import { ARMOR_ATTRIBUTES, type AttributeId, type ShieldTemplate, type WeaponTemplate } from '../items'
import type { ClassDef } from '../classes'
import type { MaterialDef } from '../materials'
import type { HerbDef } from '../herbs'
import type { EnchantDef } from '../enchants'
import { clearKey } from '../dungeons'
import type { ProcDef } from '../procs'
import type { BossAbilityDef } from '../heroic'
import type { TempleDef } from '../temple'
import { QUEST_CHAIN, type QuestDef } from '../quests'
import { MECHANIC_IDS, type ProgressionStep } from '../progression'
import type { ReagentDef } from '../reagents'
import type { DungeonSceneKey } from '../scenery'
import type { ProfessionDef, RecipeDef } from '../recipes'
import type { RarityDef } from '../rarity'
import type { SoundCue } from '../sounds'
import {
  SOUND_GAIN_MAX_DB,
  SOUND_MIN_VARIATIONS,
  SOUND_PITCH_MAX_SEMITONES,
  SOUND_PITCH_MIN_SEMITONES,
} from '../balance'
import type { SlotId } from '../slots'
import type { BranchDef, TalentDef } from '../talents'
import type { Zone } from '../zones'
import type { StatId } from '../../game/stats'

// ---------------------------------------------------------------------------
// Слепок контента
// ---------------------------------------------------------------------------

/**
 * Всё, что проверяется, — одним объектом. Списки иконок спрайта и файлов
 * моделей приходят СНАРУЖИ (их читает content.ts с диска): проверка обязана
 * оставаться чистой, иначе её нельзя прогнать на фикстуре.
 */
export interface Content {
  abilities: readonly AbilityDef[]
  herbs: readonly HerbDef[]
  enchants: readonly EnchantDef[]
  procs: readonly ProcDef[]
  bossAbilities: readonly BossAbilityDef[]
  temples: readonly TempleDef[]
  quests: readonly QuestDef[]
  /** Сколько пыли даёт распыление каждого тира (DUST_BY_RARITY). */
  dustByRarity: Record<string, number>
  /** Статы, где зачарованию разрешена плоская прибавка (ENCHANT_FLAT_STATS). */
  enchantFlatStats: readonly StatId[]
  branches: readonly BranchDef[]
  talents: readonly TalentDef[]
  zones: readonly Zone[]
  dungeons: readonly DungeonDef[]
  weapons: readonly WeaponTemplate[]
  shields: readonly ShieldTemplate[]
  sounds: readonly SoundCue[]
  classes: readonly ClassDef[]
  materials: readonly MaterialDef[]
  progression: readonly ProgressionStep[]
  reagents: readonly ReagentDef[]
  /** Ключи интерьеров данжей из data/scenery.ts. */
  dungeonSceneKeys: readonly DungeonSceneKey[]
  recipes: readonly RecipeDef[]
  professions: readonly ProfessionDef[]
  props: readonly PropAsset[]
  /** Имена файлов в public/models/props. */
  propFiles: readonly string[]
  /** Пути звуковых файлов, реально лежащих в public/. */
  audioFiles: readonly string[]
  rarities: readonly RarityDef[]
  models: readonly ModelAsset[]
  /** Уровень, с которого открыта цепочка преквестов (QUEST_CHAIN.unlockLevel). */
  questChainUnlockLevel: number
  slots: readonly SlotId[]
  slotNames: Record<SlotId, string>
  slotIcons: Record<SlotId, string>
  slotDropWeights: Record<SlotId, number>
  armorNouns: Record<Exclude<SlotId, 'mainHand' | 'offHand'>, readonly string[]>
  statIds: readonly StatId[]
  /** Имена из реестра иконок (ui/icons/manifest.ts). */
  iconNames: readonly string[]
  /** Имена, под которыми symbol реально лежит в sprite.svg. */
  spriteIconNames: readonly string[]
  /** Имена файлов в public/models. */
  modelFiles: readonly string[]
  /** Числа баланса, у которых есть допустимый диапазон. */
  balance: BalanceNumbers
}

export interface BalanceNumbers {
  dropChance: number
  shieldShare: number
  baseCritChance: number
  baseDamageReduction: number
  offlineEfficiency: number
  autocastMaxLoss: number
  talentFirstLevel: number
  enchantUnlockLevel: number
  potionUnlockLevel: number
  levelCap: number
  ttkHardFloor: number
  ttkTargetMin: number
  ttkTargetMax: number
  ttkHardCeiling: number
  ttkBehindMax: number
  ttkAheadMin: number
  ttkDriftMax: number
  /** Ступени штрафа опыта за отставание: gap <= maxGap -> share. */
  xpGapPenalty: ReadonlyArray<{ maxGap: number; share: number }>
}

// ---------------------------------------------------------------------------
// Замечания
// ---------------------------------------------------------------------------

export interface ContentIssue {
  /** О ком речь: «зона shepherds-meadow», «талант rupture». */
  where: string
  /** Что не так и куда идти чинить. Полное предложение, без сокращений. */
  message: string
}

/** Собиратель замечаний. Один экземпляр на прогон. */
class Report {
  readonly issues: ContentIssue[] = []

  add(where: string, message: string): void {
    this.issues.push({ where, message })
  }

  /** Условие обязано быть истинным, иначе — замечание. */
  need(ok: boolean, where: string, message: string): void {
    if (!ok) this.add(where, message)
  }
}

// ---------------------------------------------------------------------------
// Схема одного типа данных
// ---------------------------------------------------------------------------

/** Число в данных бывает и обычным, и Decimal — проверяем одинаково. */
type Num = number | Decimal

function toNumber(value: Num | undefined): number {
  if (value === undefined || value === null) return Number.NaN
  return typeof value === 'number' ? value : value.toNumber()
}

/** Диапазон для числового поля. Границы включаются, если не сказано иначе. */
export interface NumberRule<T> {
  field: string
  get: (entity: T) => Num | undefined
  min?: number
  max?: number
  /** Строгое сравнение с min: значение обязано быть БОЛЬШЕ него. */
  exclusiveMin?: boolean
  integer?: boolean
  /** Почему такой диапазон — уходит в текст замечания. */
  why?: string
}

/** Ссылка на другую сущность по идентификатору. */
export interface RefRule<T> {
  field: string
  /** Один id, список или ничего, если ссылки в этой записи нет. */
  get: (entity: T) => string | readonly string[] | undefined
  /** Как называть цель в тексте: «зону», «умение» — винительный падеж. */
  target: string
  /** Относительное местоимение под род цели: «которой» для зоны, «которого»
   *  для умения. Мелочь, но замечание читают глазами, а не грепом. */
  which: 'которого' | 'которой' | 'которых'
  targetFile: string
  ids: (content: Content) => Set<string>
}

export interface EntitySchema<T> {
  /** Как называть сущность: «зона», «умение» — именительный падеж. */
  kind: string
  /** Где эти данные живут: попадает в текст замечания. */
  file: string
  entities: (content: Content) => readonly T[]
  id: (entity: T) => string | undefined
  /** Человеческое имя. Не у всех типов оно называется `name`. */
  name?: (entity: T) => string | undefined
  icon?: (entity: T) => string | undefined
  numbers?: NumberRule<T>[]
  refs?: RefRule<T>[]
  /** Всё, что не ложится в правила выше. */
  extra?: (entity: T, content: Content, report: Report) => void
}

/** Прогон одной схемы: общие правила плюс `extra`. */
function runSchema<T>(schema: EntitySchema<T>, content: Content, report: Report): void {
  const entities = schema.entities(content)
  const seen = new Map<string, number>()

  report.need(
    entities.length > 0,
    schema.kind,
    `список ${schema.kind} пуст — в ${schema.file} не осталось ни одной записи`,
  )

  entities.forEach((entity, index) => {
    const rawId = schema.id(entity)
    const id = typeof rawId === 'string' && rawId.length > 0 ? rawId : null
    const where = id ? `${schema.kind} ${id}` : `${schema.kind} №${index + 1}`

    if (!id) {
      report.add(where, `у записи №${index + 1} в ${schema.file} нет поля id (или оно пустое)`)
      return
    }

    const twin = seen.get(id)
    if (twin !== undefined) {
      report.add(
        where,
        `id «${id}» встречается дважды в ${schema.file} (записи №${twin + 1} и №${index + 1}) — ` +
          'идентификаторы обязаны быть уникальными внутри своего типа',
      )
    } else {
      seen.set(id, index)
    }

    if (schema.name) {
      const name = schema.name(entity)
      report.need(
        typeof name === 'string' && name.trim().length > 0,
        where,
        `нет имени для игрока — заполни поле name в ${schema.file}`,
      )
    }

    if (schema.icon) {
      const icon = schema.icon(entity)
      if (typeof icon !== 'string' || icon.length === 0) {
        report.add(where, `нет иконки — заполни поле icon в ${schema.file}`)
      } else {
        if (!content.iconNames.includes(icon)) {
          report.add(
            where,
            `ссылается на иконку «${icon}», которой нет в реестре ui/icons/manifest.ts`,
          )
        } else if (!content.spriteIconNames.includes(icon)) {
          report.add(
            where,
            `иконка «${icon}» есть в реестре, но её symbol отсутствует в ui/icons/sprite.svg — ` +
              'пересобери спрайт: npm run icons:build',
          )
        }
      }
    }

    for (const rule of schema.numbers ?? []) {
      checkNumber(entity, rule, where, schema.file, report)
    }

    for (const rule of schema.refs ?? []) {
      const raw = rule.get(entity)
      if (raw === undefined) continue
      const ids = rule.ids(content)
      for (const target of typeof raw === 'string' ? [raw] : raw) {
        if (!ids.has(target)) {
          report.add(
            where,
            `ссылается на ${rule.target} «${target}» (поле ${rule.field}), ` +
              `${rule.which} нет в ${rule.targetFile}`,
          )
        }
      }
    }

    schema.extra?.(entity, content, report)
  })
}

function checkNumber<T>(
  entity: T,
  rule: NumberRule<T>,
  where: string,
  file: string,
  report: Report,
): void {
  const raw = rule.get(entity)
  const value = toNumber(raw)
  // Каждое замечание заканчивается адресом: почему так и где чинить.
  // Без файла в тексте починка превращается в поиск по репозиторию.
  const tail = `${rule.why ? ` (${rule.why})` : ''} — ${file}`
  if (!Number.isFinite(value)) {
    report.add(where, `поле ${rule.field} не заполнено числом${tail}`)
    return
  }
  if (rule.integer && !Number.isInteger(value)) {
    report.add(where, `поле ${rule.field} = ${value}, а обязано быть целым${tail}`)
  }
  if (rule.min !== undefined) {
    const ok = rule.exclusiveMin ? value > rule.min : value >= rule.min
    if (!ok) {
      report.add(
        where,
        `поле ${rule.field} = ${value}, а обязано быть ` +
          `${rule.exclusiveMin ? 'больше' : 'не меньше'} ${rule.min}${tail}`,
      )
    }
  }
  if (rule.max !== undefined && value > rule.max) {
    report.add(where, `поле ${rule.field} = ${value}, а обязано быть не больше ${rule.max}${tail}`)
  }
}

// ---------------------------------------------------------------------------
// Схемы по типам
// ---------------------------------------------------------------------------

const idsOf = <T>(list: readonly T[], id: (e: T) => string | undefined): Set<string> =>
  new Set(list.map(id).filter((v): v is string => typeof v === 'string'))

export const ABILITY_SCHEMA: EntitySchema<AbilityDef> = {
  kind: 'умение',
  file: 'data/abilities.ts',
  entities: (c) => c.abilities,
  id: (a) => a.id,
  name: (a) => a.name,
  icon: (a) => a.icon,
  numbers: [
    { field: 'manaCost', get: (a) => a.manaCost, min: 0 },
    {
      field: 'cooldownSec',
      get: (a) => a.cooldownSec,
      min: 0,
      exclusiveMin: true,
      why: 'нулевой кулдаун означал бы умение без ограничений',
    },
    {
      field: 'weaponDamagePercent',
      get: (a) => a.weaponDamagePercent,
      min: 0,
      exclusiveMin: true,
      why: 'урон умения — доля удара оружия, и она обязана быть положительной',
    },
    {
      field: 'unlockLevel',
      get: (a) => a.unlockLevel,
      min: 1,
      integer: true,
      why: 'уровень разблокировки — номер уровня героя, с первого и выше',
    },
  ],
  extra: (ability, _content, report) => {
    const where = `умение ${ability.id}`
    if (!ability.effect) return
    const effect = ability.effect
    checkNumber(
      effect,
      { field: 'effect.weaponDamagePercent', get: (e) => e.weaponDamagePercent, min: 0, exclusiveMin: true },
      where,
      'data/abilities.ts',
      report,
    )
    checkNumber(
      effect,
      { field: 'effect.ticks', get: (e) => e.ticks, min: 1, integer: true },
      where,
      'data/abilities.ts',
      report,
    )
    checkNumber(
      effect,
      { field: 'effect.tickIntervalSec', get: (e) => e.tickIntervalSec, min: 0, exclusiveMin: true },
      where,
      'data/abilities.ts',
      report,
    )
  },
}

export const BRANCH_SCHEMA: EntitySchema<BranchDef> = {
  kind: 'ветка талантов',
  file: 'data/talents.ts',
  entities: (c) => c.branches,
  id: (b) => b.id,
  name: (b) => b.name,
  extra: (branch, content, report) => {
    const where = `ветка ${branch.id}`
    const talents = content.talents
      .filter((t) => t.branch === branch.id)
      .sort((a, b) => a.row - b.row)
    // Ветка без талантов — вкладка, которая ничего не делает.
    if (talents.length === 0) {
      report.add(where, 'в ветке нет ни одного таланта (data/talents.ts)')
      return
    }
    // Ряды идут подряд с первого: дырка в нумерации означает, что талант
    // потеряли при правке, и на панели останется пустая строка.
    const rows = talents.map((t) => t.row)
    const expected = talents.map((_, i) => i + 1)
    if (rows.join(',') !== expected.join(',')) {
      report.add(
        where,
        `ряды идут как ${rows.join(', ')}, а должны подряд с первого ` +
          `(${expected.join(', ')}) — data/talents.ts`,
      )
    }
    // Первый ряд обязан быть открыт сразу: иначе в ветку не войти вовсе.
    if (talents[0].requiredPointsInBranch !== 0) {
      report.add(
        where,
        `первый ряд требует ${talents[0].requiredPointsInBranch} очков в ветке — ` +
          'в ветку невозможно войти (data/talents.ts)',
      )
    }
    // Требование ряда не может быть больше, чем реально можно вложить выше.
    let reachable = 0
    for (const talent of talents) {
      if (talent.requiredPointsInBranch > reachable) {
        report.add(
          `талант ${talent.id}`,
          `требует ${talent.requiredPointsInBranch} очков в ветке, а выше него ` +
            `можно вложить только ${reachable} — талант недостижим (data/talents.ts)`,
        )
      }
      reachable += talent.maxRank
    }
  },
}

/**
 * Числовой пейлоад каждого флага: поле и его диапазон. Ни одного `if (флаг
 * такой-то)` — новый флаг это новая СТРОКА здесь. У `ability-learns-effect`
 * числа нет вовсе: он несёт объект эффекта, который проверяет схема умений.
 */
const FLAG_PAYLOADS: Record<
  string,
  { field: string; min: number; max: number; exclusiveMin?: boolean; integer?: boolean; why: string }
> = {
  'ability-extra-charge': {
    field: 'extraCharges',
    min: 1,
    max: 3,
    integer: true,
    why: 'сколько ЛИШНИХ зарядов даёт талант: ноль означал бы талант без эффекта',
  },
  'double-strike': {
    field: 'chance',
    min: 0,
    exclusiveMin: true,
    max: 1,
    why: 'шанс повторного замаха: единица превратила бы автоатаку в удвоенную навсегда',
  },
  'block-reflects': {
    field: 'damageShare',
    min: 0,
    exclusiveMin: true,
    max: 1,
    why: 'доля поглощённого щитом урона, уходящая обратно в моба',
  },
  'block-restores-resource': {
    field: 'resourceShare',
    min: 0,
    exclusiveMin: true,
    max: 1,
    why: 'доля запаса ресурса за удачный блок',
  },
  'kill-refunds-cooldowns': {
    field: 'cooldownShare',
    min: 0,
    max: 1,
    why: 'доля, на которую множатся откаты после убийства: больше единицы — талант-наказание',
  },
  'rest-clears-cooldowns': {
    field: 'cooldownShare',
    min: 0,
    max: 1,
    why: 'доля, на которую множатся кулдауны после привала: больше единицы — талант-наказание',
  },
  'shorter-rest': {
    field: 'durationMultiplier',
    min: 0,
    exclusiveMin: true,
    max: 1,
    why: 'множитель длины привала только сокращает его',
  },
  'faster-revive': {
    field: 'reviveMultiplier',
    min: 0,
    exclusiveMin: true,
    max: 1,
    why: 'множитель времени воскрешения только сокращает его',
  },
}

export const TALENT_SCHEMA: EntitySchema<TalentDef> = {
  kind: 'талант',
  file: 'data/talents.ts',
  entities: (c) => c.talents,
  id: (t) => t.id,
  name: (t) => t.name,
  icon: (t) => t.icon,
  numbers: [
    { field: 'row', get: (t) => t.row, min: 1, integer: true },
    { field: 'maxRank', get: (t) => t.maxRank, min: 1, integer: true },
    { field: 'requiredPointsInBranch', get: (t) => t.requiredPointsInBranch, min: 0, integer: true },
  ],
  refs: [
    {
      field: 'branch',
      get: (t) => t.branch,
      target: 'ветку',
      which: 'которой',
      targetFile: 'data/talents.ts (BRANCHES)',
      ids: (c) => idsOf(c.branches, (b) => b.id),
    },
    {
      // Талант-флаг включает поведение КОНКРЕТНОГО умения. Умение переименовали,
      // а талант остался — молча перестал бы работать.
      field: 'effect.abilityId',
      get: (t) => (t.effect.kind === 'flag' && 'abilityId' in t.effect ? t.effect.abilityId : undefined),
      target: 'умение',
      which: 'которого',
      targetFile: 'data/abilities.ts',
      ids: (c) => idsOf(c.abilities, (a) => a.id),
    },
  ],
  extra: (talent, content, report) => {
    const where = `талант ${talent.id}`
    if (talent.effect.kind === 'modifiers') {
      report.need(
        talent.effect.mods.length > 0,
        where,
        'эффект вида modifiers без единого модификатора — талант ничего не делает ' +
          '(data/talents.ts)',
      )
      for (const mod of talent.effect.mods) {
        if (!content.statIds.includes(mod.stat)) {
          report.add(
            where,
            `модификатор ссылается на стат «${mod.stat}», которого нет среди StatId ` +
              'в game/stats.ts',
          )
        }
        // Ускорение живёт в долях: талант на weaponSpeed увёл бы скорость
        // оружия в ноль или в минус (см. правило про haste в CLAUDE.md).
        if (mod.stat === 'weaponSpeed') {
          report.add(
            where,
            'таланту нельзя менять weaponSpeed — ускорение выражается статом haste, ' +
              'иначе замах уходит в ноль или в бесконечность (data/talents.ts)',
          )
        }
      }
    }
    // Пейлоад флага проверяется ПО ТАБЛИЦЕ, а не отдельным `if` на каждый
    // талант: у флага одно числовое поле со своим диапазоном, и добавить
    // десятый флаг — значит дописать сюда строку, а не ещё одну ветку.
    if (talent.effect.kind === 'flag') {
      const spec = FLAG_PAYLOADS[talent.effect.flag]
      if (spec) {
        const effect = talent.effect as unknown as Record<string, number>
        checkNumber(
          effect,
          {
            field: `effect.${spec.field}`,
            get: (e) => e[spec.field],
            min: spec.min,
            exclusiveMin: spec.exclusiveMin,
            max: spec.max,
            integer: spec.integer,
            why: spec.why,
          },
          where,
          'data/talents.ts',
          report,
        )
      }
    }
  },
}

export const ZONE_SCHEMA: EntitySchema<Zone> = {
  kind: 'зона',
  file: 'data/zones.ts',
  entities: (c) => c.zones,
  id: (z) => z.id,
  name: (z) => z.name,
  icon: (z) => z.icon,
  numbers: [
    { field: 'monsterLevelRange.min', get: (z) => z.monsterLevelRange?.min, min: 1, integer: true },
    { field: 'monsterLevelRange.max', get: (z) => z.monsterLevelRange?.max, min: 1, integer: true },
    { field: 'rewardMultiplier', get: (z) => z.rewardMultiplier, min: 0, exclusiveMin: true },
  ],
  extra: (zone, _content, report) => {
    const where = `зона ${zone.id}`
    const range = zone.monsterLevelRange
    if (range && range.max < range.min) {
      report.add(
        where,
        `диапазон уровней мобов задом наперёд: min ${range.min} больше max ${range.max} ` +
          '(data/zones.ts)',
      )
    }
    report.need(
      Array.isArray(zone.monsterPool) && zone.monsterPool.length > 0,
      where,
      'пустой monsterPool — спавнить в зоне некого (data/zones.ts)',
    )
    for (const [index, archetype] of (zone.monsterPool ?? []).entries()) {
      const mobWhere = `моб ${archetype?.id ?? `№${index + 1}`} зоны ${zone.id}`
      report.need(
        typeof archetype?.id === 'string' && archetype.id.length > 0,
        mobWhere,
        `у моба №${index + 1} в пуле зоны ${zone.id} нет id (data/zones.ts)`,
      )
      report.need(
        typeof archetype?.name === 'string' && archetype.name.trim().length > 0,
        mobWhere,
        'нет имени для игрока — заполни поле name в monsterPool зоны (data/zones.ts)',
      )
      const role = archetype?.role
      if (!role) {
        report.add(mobWhere, 'нет роли — роль задаёт hp, урон и награду моба (роли живут в data/monsters.ts)')
        continue
      }
      for (const field of ['hpMult', 'damageMult', 'goldMult', 'xpMult'] as const) {
        checkNumber(
          role,
          { field: `role.${field}`, get: (r) => r[field], min: 0, exclusiveMin: true },
          mobWhere,
          'data/monsters.ts',
          report,
        )
      }
      checkNumber(
        role,
        {
          field: 'role.swingTime',
          get: (r) => r.swingTime,
          min: 0,
          exclusiveMin: true,
          why: 'у мобов оружия нет, время между ударами лежит прямо в роли',
        },
        mobWhere,
        'data/monsters.ts',
        report,
      )
    }
    // Вид зоны — обязательное поле: новая зона без сцены не должна собираться.
    if (!zone.scene) {
      report.add(where, 'нет конфигурации сцены — добавь её в data/scenery.ts и сошлись полем scene')
      return
    }
    checkNumber(
      zone.scene,
      { field: 'scene.fogDensity', get: (s) => s.fogDensity, min: 0 },
      where,
      'data/scenery.ts',
      report,
    )
    checkNumber(
      zone.scene,
      { field: 'scene.lightIntensity', get: (s) => s.lightIntensity, min: 0 },
      where,
      'data/scenery.ts',
      report,
    )
    checkNumber(
      zone.scene,
      { field: 'scene.seed', get: (s) => s.seed, min: 0, integer: true },
      where,
      'data/scenery.ts',
      report,
    )
    for (const [index, cluster] of (zone.scene.props ?? []).entries()) {
      checkNumber(
        cluster,
        { field: `scene.props[${index}].count`, get: (p) => p.count, min: 0, integer: true },
        where,
        'data/scenery.ts',
        report,
      )
      const [lo, hi] = cluster.scaleRange ?? [Number.NaN, Number.NaN]
      if (!(lo > 0) || !(hi >= lo)) {
        report.add(
          where,
          `scene.props[${index}].scaleRange = [${lo}, ${hi}] — разброс размера обязан быть ` +
            'положительным и по возрастанию (data/scenery.ts)',
        )
      }
    }
  },
}

export const DUNGEON_SCHEMA: EntitySchema<DungeonDef> = {
  kind: 'данж',
  file: 'data/dungeons.ts',
  entities: (c) => c.dungeons,
  // Единица данжа — ПАРА (данж, сложность): обычная и героическая версии
  // делят id, но это две разные цепочки с разными числами и достижениями.
  id: (d) => clearKey(d.id, d.difficulty),
  name: (d) => d.name,
  icon: (d) => d.icon,
  numbers: [
    { field: 'unlockRequirement', get: (d) => d.unlockRequirement, min: 1, integer: true },
    {
      field: 'tier',
      get: (d) => d.tier,
      min: 1,
      integer: true,
      why: 'ступень лестницы данжей: из неё выводятся все числа боссов',
    },
  ],
  refs: [
    {
      field: 'zoneId',
      get: (d) => d.zoneId,
      target: 'зону',
      which: 'которой',
      targetFile: 'data/zones.ts',
      ids: (c) => idsOf(c.zones, (z) => z.id),
    },
    {
      field: 'reagentId',
      get: (d) => d.reagentId,
      target: 'реагент',
      which: 'которого',
      targetFile: 'data/reagents.ts',
      ids: (c) => idsOf(c.reagents, (r) => r.id),
    },
  ],
  extra: (dungeon, content, report) => {
    const where = `данж ${dungeon.id}`
    // Интерьер — ключ, а не собственный конфиг: восемь наборов пропсов руками
    // держать нельзя, а промах по ключу дал бы пустую сцену без ошибки.
    if (!content.dungeonSceneKeys.includes(dungeon.scenery)) {
      report.add(
        where,
        `ссылается на обстановку «${dungeon.scenery}», которой нет в DUNGEON_SCENES ` +
          '(data/scenery.ts)',
      )
    } else if (!dungeon.scene) {
      report.add(where, 'ключ обстановки есть, а конфига нет — проверь DUNGEON_SCENES в data/scenery.ts')
    }
    // Реагент обязан быть СВОЕГО тира: перепутанные реагенты сделали бы
    // два данжа взаимозаменяемыми, и никто бы этого не заметил.
    const reagent = content.reagents.find((r) => r.id === dungeon.reagentId)
    if (reagent && reagent.tier !== dungeon.tier) {
      report.add(
        where,
        `тир ${dungeon.tier}, а реагент «${reagent.id}» помечен тиром ${reagent.tier}: ` +
          'реагент обязан быть своего тира (data/reagents.ts)',
      )
    }
    report.need(
      Array.isArray(dungeon.bosses) && dungeon.bosses.length > 0,
      where,
      'пустая цепочка боссов — проходить нечего (data/dungeons.ts)',
    )
    // Реагент падает ровно с ПОСЛЕДНЕГО босса: с первого он был бы наградой
    // за одну схватку, а не за пройденную цепочку.
    const bosses = dungeon.bosses ?? []
    bosses.forEach((boss, index) => {
      const isLast = index === bosses.length - 1
      const carries = typeof boss?.reagentId === 'string' && boss.reagentId.length > 0
      if (isLast && !carries) {
        report.add(
          `босс ${boss?.id ?? `№${index + 1}`} данжа ${dungeon.id}`,
          'последний босс цепочки не роняет реагент — тир данжа станет недостижим ' +
            '(data/dungeons.ts)',
        )
      }
      if (!isLast && carries) {
        report.add(
          `босс ${boss.id} данжа ${dungeon.id}`,
          `роняет реагент «${boss.reagentId}», не будучи последним в цепочке — ` +
            'реагент это отметка о полном прохождении (data/dungeons.ts)',
        )
      }
      if (carries && boss.reagentId !== dungeon.reagentId) {
        report.add(
          `босс ${boss.id} данжа ${dungeon.id}`,
          `роняет реагент «${boss.reagentId}», а данж заявляет «${dungeon.reagentId}» ` +
            '(data/dungeons.ts)',
        )
      }
    })
    const slots = new Set<string>(content.slots)
    const rarities = idsOf(content.rarities, (r) => r.id)
    const seenBoss = new Set<string>()
    for (const [index, boss] of (dungeon.bosses ?? []).entries()) {
      const bossWhere = `босс ${boss?.id ?? `№${index + 1}`} данжа ${dungeon.id}`
      if (typeof boss?.id !== 'string' || boss.id.length === 0) {
        report.add(bossWhere, `у босса №${index + 1} в ${dungeon.id} нет id (data/dungeons.ts)`)
        continue
      }
      if (seenBoss.has(boss.id)) {
        report.add(bossWhere, `id «${boss.id}» встречается в цепочке дважды (data/dungeons.ts)`)
      }
      seenBoss.add(boss.id)
      report.need(
        typeof boss.name === 'string' && boss.name.trim().length > 0,
        bossWhere,
        'нет имени для игрока — заполни поле name в data/dungeons.ts',
      )
      const rules: NumberRule<typeof boss>[] = [
        { field: 'level', get: (b) => b.level, min: 1, integer: true },
        { field: 'hpMult', get: (b) => b.hpMult, min: 1, why: 'босс не бывает слабее обычного моба' },
        { field: 'damageMult', get: (b) => b.damageMult, min: 0, exclusiveMin: true },
        { field: 'goldMult', get: (b) => b.goldMult, min: 0, exclusiveMin: true },
        { field: 'xpMult', get: (b) => b.xpMult, min: 0, exclusiveMin: true },
        { field: 'swingTime', get: (b) => b.swingTime, min: 0, exclusiveMin: true },
        {
          field: 'enrageAfterSec',
          get: (b) => b.enrageAfterSec,
          min: 0,
          exclusiveMin: true,
          why: 'ярость с нулевой отметки не оставила бы времени на бой',
        },
      ]
      for (const rule of rules) checkNumber(boss, rule, bossWhere, 'data/dungeons.ts', report)

      const loot = boss.loot
      if (!loot || !Array.isArray(loot.slots) || loot.slots.length === 0) {
        report.add(bossWhere, 'пустой лут-пул — за босса не выпадет ничего (data/dungeons.ts)')
        continue
      }
      for (const slot of loot.slots) {
        if (!slots.has(slot)) {
          report.add(
            bossWhere,
            `лут-пул ссылается на слот «${slot}», которого нет в data/slots.ts (SLOT_IDS)`,
          )
        }
      }
      if (!rarities.has(loot.minRarity)) {
        report.add(
          bossWhere,
          `лут-пул ссылается на редкость «${loot.minRarity}», которой нет в data/rarity.ts`,
        )
      }
    }
  },
}

export const REAGENT_SCHEMA: EntitySchema<ReagentDef> = {
  kind: 'реагент',
  file: 'data/reagents.ts',
  entities: (c) => c.reagents,
  id: (r) => r.id,
  name: (r) => r.name,
  icon: (r) => r.icon,
  numbers: [
    {
      field: 'tier',
      get: (r) => r.tier,
      min: 1,
      integer: true,
      why: 'реагент принадлежит тиру данжа, а тиры нумеруются с первого',
    },
  ],
  extra: (reagent, content, report) => {
    // Реагент без данжа — недостижимый контент: уронить его будет некому.
    report.need(
      content.dungeons.some((d) => d.reagentId === reagent.id),
      `реагент ${reagent.id}`,
      'его не роняет ни один данж — рецепты с ним недостижимы (data/dungeons.ts)',
    )
  },
}

export const PROGRESSION_SCHEMA: EntitySchema<ProgressionStep> = {
  kind: 'ступень лестницы',
  file: 'data/progression.ts',
  entities: (c) => c.progression,
  id: (s) => s.id,
  name: (s) => s.name,
  icon: (s) => s.icon,
  numbers: [
    {
      field: 'level',
      get: (s) => s.level,
      min: 1,
      integer: true,
      why: 'ступень открывается уровнем героя, а уровни начинаются с первого',
    },
  ],
  extra: (step, content, report) => {
    const where = `ступень ${step.id}`
    report.need(
      !!step.description?.trim(),
      where,
      'нет строки о том, что именно откроется (data/progression.ts)',
    )
    // Ссылки ступени обязаны вести на существующее. Пустой список законен:
    // лестница живёт раньше содержимого, и механики может ещё не быть.
    for (const unlock of step.unlocks ?? []) {
      if (unlock.kind === 'dungeon') {
        report.need(
          content.dungeons.some((d) => d.id === unlock.id),
          where,
          `ссылается на данж «${unlock.id}», которого нет в data/dungeons.ts`,
        )
        continue
      }
      report.need(
        MECHANIC_IDS.includes(unlock.id),
        where,
        `ссылается на механику «${unlock.id}», которой нет в списке MECHANIC_IDS ` +
          '(data/progression.ts)',
      )
    }
    // Ступень со ссылками не может быть заглушкой, и наоборот: «будет
    // добавлено» и «вот вход» — взаимоисключающие обещания.
    report.need(
      !(step.placeholder && (step.unlocks?.length ?? 0) > 0),
      where,
      'помечена заглушкой, но что-то открывает — обещания противоречат друг другу ' +
        '(data/progression.ts)',
    )
  },
}

/**
 * ТОЛЬКО ФЛЭТ НА ВЕЩАХ, КОТОРЫЕ ПАДАЮТ И КУЮТСЯ.
 *
 * Процент считается от СУММЫ конвейера, то есть от остальной экипировки, и
 * из этого следуют сразу две беды. Предмет с процентом нельзя оценить сам по
 * себе — его ценность зависит от того, что надето в других слотах, а
 * сравнение находок в игре именно поштучное. И он не растёт ни от уровня
 * вещи, ни от тира: множитель силы в `loot.ts` умножает плоские прибавки,
 * а проценту умножать нечего. Крушитель с «+10% силы» это показывал в упор:
 * на первом уровне, когда силы нет вовсе, прибавка была РОВНО НУЛЁМ.
 *
 * Проценты остались там, где они и осмысленны: в зачарованиях, талантах и
 * зельях. Там они множат растущий флэт — поэтому позднее зачарование само
 * по себе сильнее раннего, и это правильно.
 */
function flatOnly(
  mods: ReadonlyArray<{ stat: string; kind: string }> | undefined,
  where: string,
  file: string,
  report: Report,
): void {
  for (const mod of mods ?? []) {
    if (mod.kind === 'flat' || mod.kind === 'base') continue
    report.add(
      where,
      `стат «${mod.stat}» помечен kind: '${mod.kind}' — на выпадающих и кованых ` +
        `вещах бывает только 'flat': процент считается от остальной экипировки ` +
        `и не растёт ни от уровня вещи, ни от тира (${file})`,
    )
  }
}

export const WEAPON_SCHEMA: EntitySchema<WeaponTemplate> = {
  kind: 'оружие',
  file: 'data/items.ts',
  entities: (c) => c.weapons,
  id: (w) => w.id,
  name: (w) => w.noun,
  numbers: [
    {
      field: 'weaponSpeed',
      get: (w) => w.weaponSpeed,
      min: 0,
      exclusiveMin: true,
      why: 'секунды между ударами, ноль означал бы бесконечный урон в секунду',
    },
    { field: 'damageMin', get: (w) => w.damageMin, min: 0, exclusiveMin: true },
    { field: 'damageMax', get: (w) => w.damageMax, min: 0, exclusiveMin: true },
  ],
  extra: (weapon, content, report) => {
    const where = `оружие ${weapon.id}`
    // ХВАТ обязателен и обязан быть оружейным. Щит оружием не бывает:
    // предмет, который одновременно и щит, и оружие, выразить нечем — и
    // проверка обязана сказать это раньше, чем такой предмет упадёт игроку.
    if (weapon.grip !== 'one' && weapon.grip !== 'two') {
      report.add(
        where,
        `хват «${String(weapon.grip)}» — у оружия он бывает только 'one' ` +
          "(одноручное) или 'two' (двуручное) (data/items.ts)",
      )
    }
    if (weapon.damageMax?.lt(weapon.damageMin)) {
      report.add(
        where,
        `damageMax (${weapon.damageMax}) меньше damageMin (${weapon.damageMin}) — ` +
          'диапазон урона задом наперёд (data/items.ts)',
      )
    }
    for (const mod of weapon.extra ?? []) {
      if (!content.statIds.includes(mod.stat)) {
        report.add(
          where,
          `побочный стат «${mod.stat}» не входит в StatId из game/stats.ts ` +
            '(шаблон оружия — data/items.ts)',
        )
      }
      // База боя приходит тремя модификаторами из loot.ts; шаблон задаёт
      // только ПОБОЧНЫЕ статы, и base среди них означал бы вторую базу.
      if (mod.kind === 'base') {
        report.add(
          where,
          `побочный стат «${mod.stat}» помечен kind: 'base' — базу боя задаёт ` +
            'weaponMods в game/loot.ts, второй базы быть не должно',
        )
      }
    }
    flatOnly(weapon.extra, where, 'data/items.ts', report)
  },
}

export const SHIELD_SCHEMA: EntitySchema<ShieldTemplate> = {
  kind: 'щит',
  file: 'data/items.ts',
  entities: (c) => c.shields,
  id: (s) => s.id,
  name: (s) => s.noun,
  numbers: [
    {
      field: 'blockChance',
      get: (s) => s.blockChance,
      min: 0,
      max: 1,
      exclusiveMin: true,
      why: 'вероятность блока — доля 0..1; ноль означал бы щит, который не блокирует',
    },
    {
      field: 'blockValue',
      get: (s) => s.blockValue,
      min: 0,
      exclusiveMin: true,
      why: 'щит с нулевой силой блока не снимает урона и не отличим от пустой руки',
    },
  ],
  extra: (shield, content, report) => {
    const where = `щит ${shield.id}`
    // Хват щита — всегда 'shield', и он ЛЕЖИТ В ДАННЫХ, а не подставляется
    // кодом: генерация лута берёт его из шаблона, и «щит с хватом оружия»
    // попал бы в главную руку.
    if (shield.grip !== 'shield') {
      report.add(
        where,
        `хват «${String(shield.grip)}» — у щита он обязан быть 'shield': ` +
          'щит надевается только во вторую руку и оружием не бывает (data/items.ts)',
      )
    }
    for (const mod of shield.extra ?? []) {
      if (!content.statIds.includes(mod.stat)) {
        report.add(
          where,
          `побочный стат «${mod.stat}» не входит в StatId из game/stats.ts ` +
            '(шаблон щита — data/items.ts)',
        )
      }
      if (mod.kind === 'base') {
        report.add(
          where,
          `побочный стат «${mod.stat}» помечен kind: 'base' — блок задаёт ` +
            'shieldMods в game/loot.ts, второй базы быть не должно',
        )
      }
      // Щит НЕ оружие: урона он не даёт ни в каком виде, иначе стиль «щит»
      // перестал бы быть платой за живучесть.
      if (String(mod.stat).startsWith('offhandDamage') || String(mod.stat).startsWith('weaponDamage')) {
        report.add(
          where,
          `щит даёт урон статом «${mod.stat}» — щит не оружие, его вклад ` +
            'это блок и живучесть (data/items.ts)',
        )
      }
    }
    flatOnly(shield.extra, where, 'data/items.ts', report)
  },
}

export const MATERIAL_SCHEMA: EntitySchema<MaterialDef> = {
  kind: 'материал',
  file: 'data/materials.ts',
  entities: (c) => c.materials,
  id: (m) => m.id,
  name: (m) => m.name,
  icon: (m) => m.icon,
  numbers: [
    {
      field: 'weight',
      get: (m) => (m.award === undefined ? m.weight : 1),
      min: 0,
      exclusiveMin: true,
      why: 'нулевой вес рулетки означал бы, что материал не падает никогда',
    },
  ],
  extra: (material, content, report) => {
    const where = `материал ${material.id}`
    // Материал без зоны — недостижимый контент: рецепт с ним не собрать
    // никогда. Исключение ровно одно и названо в самих данных: материал,
    // который ВЫДАЁТСЯ за достижение, а не падает. Проверка при этом не
    // отключается — она спрашивает про второй источник.
    const awarded = material.award !== undefined
    report.need(
      awarded || (Array.isArray(material.zoneIds) && material.zoneIds.length > 0),
      where,
      'не падает ни в одной зоне и не выдаётся за достижение — рецепты с ним ' +
        'недостижимы (data/materials.ts)',
    )
    if (awarded && material.award === 'temple-clear') {
      report.need(
        content.temples.some((t) => t.clearReward.materialId === material.id),
        where,
        'помечен наградой за зачистку храма, но ни один храм его не выдаёт (data/temple.ts)',
      )
    }
    for (const id of material.zoneIds ?? []) {
      report.need(
        content.zones.some((z) => z.id === id),
        where,
        `падает в зоне «${id}», которой нет в data/zones.ts`,
      )
    }
  },
}

export const RECIPE_SCHEMA: EntitySchema<RecipeDef> = {
  kind: 'рецепт',
  file: 'data/recipes.ts',
  entities: (c) => c.recipes,
  id: (r) => r.id,
  name: (r) => r.name,
  icon: (r) => r.icon,
  extra: (recipe, content, report) => {
    const where = `рецепт ${recipe.id}`
    report.need(
      content.professions.some((p) => p.id === recipe.profession),
      where,
      `ссылается на профессию «${recipe.profession}», которой нет в data/recipes.ts`,
    )
    report.need(
      Array.isArray(recipe.inputs) && recipe.inputs.length > 0,
      where,
      'нет ни одного материала на входе — рецепт собирается из ничего (data/recipes.ts)',
    )
    for (const input of recipe.inputs ?? []) {
      // Вход бывает трёх видов: материал с моба, трава из зоны и реагент
      // босса. Входы у них разные (бросок, время, цепочка боссов), но в
      // рецепте они лежат одинаково.
      const knownInput =
        content.materials.some((m) => m.id === input.materialId) ||
        content.herbs.some((h) => h.id === input.materialId) ||
        content.reagents.some((r) => r.id === input.materialId)
      report.need(
        knownInput,
        where,
        `требует материал «${input.materialId}», которого нет ни в data/materials.ts, ` +
          'ни в data/herbs.ts, ни в data/reagents.ts',
      )
      report.need(
        Number.isInteger(input.count) && input.count > 0,
        where,
        `количество материала «${input.materialId}» должно быть целым и больше нуля ` +
          '(data/recipes.ts)',
      )
    }
    // ДОСТИЖИМОСТЬ: все материалы рецепта должны падать хоть где-то вместе с
    // прогрессом. Достаточно, чтобы каждый падал хотя бы в одной зоне.
    for (const input of recipe.inputs ?? []) {
      const material = content.materials.find((m) => m.id === input.materialId)
      // Материал-НАГРАДА добывается не в зоне, а достижением, и его
      // достижимость проверена своей схемой: там же сказано, кто его выдаёт.
      if (material && material.award === undefined && material.zoneIds.length === 0) {
        report.add(
          where,
          `материал «${input.materialId}» не падает ни в одной зоне — рецепт ` +
            'недостижим (data/materials.ts)',
        )
      }
      const herb = content.herbs.find((h) => h.id === input.materialId)
      if (herb && herb.zoneIds.length === 0) {
        report.add(
          where,
          `трава «${input.materialId}» не растёт ни в одной зоне — рецепт ` +
            'недостижим (data/herbs.ts)',
        )
      }
    }
    const output = recipe.output
    if (output.kind === 'item') {
      report.need(
        content.slots.includes(output.slot),
        where,
        `делает предмет в слот «${output.slot}», которого нет в data/slots.ts`,
      )
      report.need(
        content.rarities.some((r) => r.id === output.rarity),
        where,
        `делает предмет редкости «${output.rarity}», которой нет в data/rarity.ts`,
      )
      if (output.slot === 'mainHand' || output.slot === 'offHand') {
        const shield = content.shields.find((sh) => sh.id === output.templateId)
        const weapon = content.weapons.find((w) => w.id === output.templateId)
        report.need(
          Boolean(shield || weapon),
          where,
          `предмет в руку без шаблона: «${output.templateId ?? '—'}» не найден в data/items.ts`,
        )
        // Хват и слот обязаны сходиться: кованый щит в главной руке надеть
        // нельзя, а рецепт, который его туда шлёт, — это рецепт вещи,
        // которую игрок никогда не наденет.
        report.need(
          !shield || output.slot === 'offHand',
          where,
          `кует щит «${output.templateId ?? '—'}» в слот «${output.slot}»: хват 'shield' ` +
            'надевается только во вторую руку (data/recipes.ts)',
        )
        report.need(
          !weapon || weapon.grip !== 'two' || output.slot === 'mainHand',
          where,
          `кует двуручное «${output.templateId ?? '—'}» в слот «${output.slot}»: хват 'two' ` +
            'занимает обе руки и надевается только в главную (data/recipes.ts)',
        )
      } else {
        // У дропа главный атрибут случайный, у крафта — обещанный данными:
        // без него armorMods собрать нечего.
        report.need(
          ARMOR_ATTRIBUTES.includes(output.attribute as AttributeId),
          where,
          `кованая броня обязана называть главный атрибут: «${output.attribute ?? '—'}» ` +
            'не из ARMOR_ATTRIBUTES (data/recipes.ts)',
        )
      }
    } else if (output.kind === 'potion') {
      report.need(
        output.id === `potion:${recipe.id}`,
        where,
        `id склянки «${output.id}» обязан быть «potion:${recipe.id}»: по нему зелье ` +
          'лежит в мешке, им же подписан source модификатора (data/recipes.ts)',
      )
      checkNumber(
        output,
        {
          field: 'output.durationSec',
          get: (o) => o.durationSec,
          min: 0,
          exclusiveMin: true,
          max: 3600,
          why: 'секунды действия: ноль означал бы склянку, которая не успевает подействовать',
        },
        where,
        'data/recipes.ts',
        report,
      )
      report.need(
        Array.isArray(output.mods) && output.mods.length > 0,
        where,
        'зелье без единого модификатора — склянка ничего не делает (data/recipes.ts)',
      )
      for (const mod of output.mods ?? []) {
        if (!content.statIds.includes(mod.stat)) {
          report.add(
            where,
            `зелье меняет стат «${mod.stat}», которого нет среди StatId в game/stats.ts`,
          )
        }
        if (mod.kind === 'base') {
          report.add(
            where,
            `модификатор зелья на «${mod.stat}» помечен kind: 'base' — базу боя задаёт ` +
              'оружие, и временной склянке её подменять нечем (data/recipes.ts)',
          )
        }
        if (mod.value?.lte(0)) {
          report.add(
            where,
            `модификатор зелья на «${mod.stat}» не положителен — зелье не бывает ` +
              'наказанием, а на этом держится правило «автокаст <= ручная игра» ' +
              '(data/recipes.ts)',
          )
        }
        if (POTION_FORBIDDEN_STATS.has(String(mod.stat))) {
          report.add(
            where,
            `зелью нельзя трогать «${mod.stat}»: у этого стата меньше — лучше, и ` +
              'прибавка к нему была бы штрафом (data/recipes.ts)',
          )
        }
      }
    } else {
      report.need(
        output.id.startsWith('food:'),
        where,
        `id еды «${output.id}» должен начинаться с «food:» — по нему привал её и находит`,
      )
    }
  },
}

// Статы, у которых МЕНЬШЕ — лучше: положительная прибавка к ним была бы
// штрафом, а зелье не бывает наказанием. weaponSpeed здесь ещё и по общему
// правилу: ускорение живёт в haste.
const POTION_FORBIDDEN_STATS = new Set<string>([
  'weaponSpeed',
  'offhandSpeed',
  'regenDelay',
  'restDuration',
  'offhandPenalty',
])

export const HERB_SCHEMA: EntitySchema<HerbDef> = {
  kind: 'трава',
  file: 'data/herbs.ts',
  entities: (c) => c.herbs,
  id: (h) => h.id,
  name: (h) => h.name,
  icon: (h) => h.icon,
  numbers: [
    {
      field: 'perMinute',
      get: (h) => h.perMinute,
      min: 0,
      exclusiveMin: true,
      max: 60,
      why:
        'пучков в минуту: ноль означал бы траву, которую не срезать никогда, ' +
        'а шестьдесят — по пучку в секунду',
    },
  ],
  extra: (herb, content, report) => {
    const where = `трава ${herb.id}`
    report.need(
      Array.isArray(herb.zoneIds) && herb.zoneIds.length > 0,
      where,
      'не растёт ни в одной зоне — зелья с ней недостижимы (data/herbs.ts)',
    )
    for (const id of herb.zoneIds ?? []) {
      report.need(
        content.zones.some((z) => z.id === id),
        where,
        `растёт в зоне «${id}», которой нет в data/zones.ts`,
      )
    }
  },
}

export const ENCHANT_SCHEMA: EntitySchema<EnchantDef> = {
  kind: 'зачарование',
  file: 'data/enchants.ts',
  entities: (c) => c.enchants,
  id: (e) => e.id,
  name: (e) => e.name,
  icon: (e) => e.icon,
  numbers: [
    {
      field: 'dustCost',
      get: (e) => e.dustCost,
      min: 1,
      integer: true,
      why: 'цена в пыли: бесплатное зачарование не стоит ни одного распыления',
    },
  ],
  extra: (enchant, content, report) => {
    const where = `зачарование ${enchant.id}`
    report.need(
      !!enchant.tagline?.trim(),
      where,
      'нет строки о том, зачем оно нужно — заполни tagline в data/enchants.ts',
    )
    // Без слотов зачарование недостижимо: наложить его будет не на что.
    if (!Array.isArray(enchant.slots) || enchant.slots.length === 0) {
      report.add(where, 'не подходит ни одному слоту — наложить его некуда (data/enchants.ts)')
    }
    for (const slot of enchant.slots ?? []) {
      report.need(
        content.slots.includes(slot),
        where,
        `ссылается на слот «${slot}», которого нет в data/slots.ts (SLOT_IDS)`,
      )
    }
    if (!Array.isArray(enchant.mods) || enchant.mods.length === 0) {
      report.add(where, 'ни одного модификатора — зачарование ничего не делает (data/enchants.ts)')
      return
    }
    for (const mod of enchant.mods) {
      if (!content.statIds.includes(mod.stat)) {
        report.add(
          where,
          `модификатор ссылается на стат «${mod.stat}», которого нет среди StatId в game/stats.ts`,
        )
        continue
      }
      // Базу боя задаёт ОРУЖИЕ, ровно одним источником. Зачарование с kind
      // 'base' стало бы вторым и подменило бы скорость или урон оружия.
      if (mod.kind === 'base') {
        report.add(
          where,
          `модификатор на «${mod.stat}» помечен kind: 'base' — базу боя задаёт оружие ` +
            'через weaponMods в game/loot.ts, второй базы быть не должно (data/enchants.ts)',
        )
      }
      // То же правило, что у талантов: ускорение живёт статом haste.
      if (mod.stat === 'weaponSpeed') {
        report.add(
          where,
          'зачарованию нельзя менять weaponSpeed — ускорение выражается статом haste, ' +
            'иначе замах уходит в ноль или в бесконечность (data/enchants.ts)',
        )
      }
      // Зачарование НЕ растёт от уровня вещи, поэтому плоская прибавка к
      // растущему стату обесценится вместе с прогрессом: такие статы
      // зачарование обязано давать процентом.
      if (mod.kind === 'flat' && !content.enchantFlatStats.includes(mod.stat)) {
        report.add(
          where,
          `плоская прибавка к стату «${mod.stat}» обесценится с уровнем: зачарование не ` +
            'растёт от уровня вещи, поэтому растущие статы даются процентом ' +
            '(ENCHANT_FLAT_STATS в data/enchants.ts)',
        )
      }
    }
  },
}

export const PROC_SCHEMA: EntitySchema<ProcDef> = {
  kind: 'прок',
  file: 'data/procs.ts',
  entities: (c) => c.procs,
  id: (p) => p.id,
  name: (p) => p.name,
  icon: (p) => p.icon,
  numbers: [
    {
      field: 'chance',
      get: (p) => p.chance,
      min: 0,
      exclusiveMin: true,
      max: 1,
      why: 'вероятность на удар: ноль означал бы прок, который не срабатывает никогда',
    },
    {
      field: 'internalCooldownMs',
      get: (p) => p.internalCooldownMs,
      min: 1,
      max: 120000,
      integer: true,
      why:
        'внутренний кулдаун обязателен: без потолка темп прока рос бы вместе с ' +
        'ускорением, и быстрое оружие выигрывало бы дважды',
    },
  ],
  extra: (proc, content, report) => {
    const where = `прок ${proc.id}`
    // Прок обязан кому-то принадлежать: прок без вещи — мёртвые числа.
    report.need(
      content.recipes.some((r) => r.output.kind === 'item' && r.output.procId === proc.id),
      where,
      'ни один рецепт не выдаёт вещь с этим проком — он недостижим (data/recipes.ts)',
    )
    if (proc.effect.kind === 'damage') {
      checkNumber(
        proc.effect,
        {
          field: 'effect.weaponDamagePercent',
          get: (e) => e.weaponDamagePercent.toNumber(),
          min: 0,
          exclusiveMin: true,
          max: 10,
          why:
            'урон прока — ДОЛЯ удара оружия, как у умений: своей формулы у него нет, ' +
            'иначе он перестал бы масштабироваться от оружия',
        },
        where,
        'data/procs.ts',
        report,
      )
    } else {
      checkNumber(
        proc.effect,
        {
          field: 'effect.healShare',
          get: (e) => e.healShare,
          min: 0,
          exclusiveMin: true,
          max: 1,
          why: 'доля запаса здоровья за срабатывание',
        },
        where,
        'data/procs.ts',
        report,
      )
    }
  },
}

export const BOSS_ABILITY_SCHEMA: EntitySchema<BossAbilityDef> = {
  kind: 'способность босса',
  file: 'data/heroic.ts',
  entities: (c) => c.bossAbilities,
  id: (a) => a.id,
  name: (a) => a.name,
  icon: (a) => a.icon,
  numbers: [],
  extra: (ability, content, report) => {
    const where = `способность босса ${ability.id}`
    // Способность, которую никто не носит, — мёртвые числа.
    report.need(
      content.dungeons.some((d) => d.bosses.some((b) => b.abilityId === ability.id)),
      where,
      'её не носит ни один босс — недостижимый контент (data/dungeons.ts)',
    )
    const effect = ability.effect
    if (effect.kind === 'dispel') {
      checkNumber(
        effect,
        {
          field: 'effect.intervalSec',
          get: (e) => e.intervalSec,
          min: 1,
          max: 120,
          why: 'период рассеивания: чаще секунды это не механика, а стена',
        },
        where,
        'data/heroic.ts',
        report,
      )
    } else if (effect.kind === 'frenzy-below-hp') {
      checkNumber(
        effect,
        {
          field: 'effect.hpShare',
          get: (e) => e.hpShare,
          min: 0,
          exclusiveMin: true,
          max: 1,
          why: 'доля здоровья босса, ниже которой он ускоряется',
        },
        where,
        'data/heroic.ts',
        report,
      )
      checkNumber(
        effect,
        {
          field: 'effect.hasteBonus',
          get: (e) => e.hasteBonus,
          min: 0,
          exclusiveMin: true,
          max: 3,
          why:
            'ускорение в ДОЛЯХ: плоская правка времени замаха увела бы его в ноль — ' +
            'то же правило, что и у героя',
        },
        where,
        'data/heroic.ts',
        report,
      )
    } else {
      checkNumber(
        effect,
        {
          field: 'effect.hpSharePerResource',
          get: (e) => e.hpSharePerResource,
          min: 0,
          exclusiveMin: true,
          max: 1,
          why: 'доля запаса HP за полностью потраченный запас ресурса',
        },
        where,
        'data/heroic.ts',
        report,
      )
    }
  },
}

export const TEMPLE_SCHEMA: EntitySchema<TempleDef> = {
  kind: 'храм',
  file: 'data/temple.ts',
  entities: (c) => c.temples,
  id: (t) => t.id,
  name: (t) => t.name,
  icon: (t) => t.icon,
  numbers: [
    { field: 'unlockRequirement', get: (t) => t.unlockRequirement, min: 1, integer: true },
    {
      field: 'rewardMultiplier',
      get: (t) => t.rewardMultiplier.toNumber(),
      min: 0,
      exclusiveMin: true,
      max: 20,
      why: 'множитель наград волны — то же, что rewardMultiplier у зоны',
    },
  ],
  extra: (temple, content, report) => {
    const where = `храм ${temple.id}`
    // Награда за полную зачистку — две ссылки, и обе обязаны существовать:
    // токен ниоткуда и рецепт-призрак заперли бы конец храма навсегда.
    report.need(
      content.materials.some((m) => m.id === temple.clearReward.materialId),
      where,
      `за полную зачистку выдаёт «${temple.clearReward.materialId}», которого нет ` +
        'в data/materials.ts',
    )
    report.need(
      content.recipes.some((r) => r.id === temple.clearReward.recipeId),
      where,
      `за полную зачистку открывает рецепт «${temple.clearReward.recipeId}», которого нет ` +
        'в data/recipes.ts',
    )
    report.need(
      Number.isInteger(temple.floors) && temple.floors > 0,
      where,
      `этажей ${temple.floors}: храм обязан быть конечным, иначе полная зачистка ` +
        'недостижима (data/temple.ts)',
    )
    // Рубеж выше потолка не возьмёт никто.
    for (const milestone of temple.milestones) {
      report.need(
        milestone.wave <= temple.floors,
        where,
        `рубеж на ${milestone.wave} этаже выше потолка в ${temple.floors} — его не взять ` +
          'никогда (data/temple.ts)',
      )
    }
    report.need(
      content.zones.some((z) => z.id === temple.zoneId),
      where,
      `вход из зоны «${temple.zoneId}», которой нет в data/zones.ts`,
    )
    report.need(
      Array.isArray(temple.ladder) && temple.ladder.length > 0,
      where,
      'пул бойцов пуст — волне некого выставить (data/temple.ts)',
    )
    report.need(
      content.dungeonSceneKeys.includes(temple.scenery),
      where,
      `обстановки «${temple.scenery}» нет в DUNGEON_SCENES (data/scenery.ts)`,
    )
    // Рубежи строго по возрастанию: иначе «дошёл до пятой» открывало бы
    // награду десятой, и лестница наград перестала бы быть лестницей.
    let previous = 0
    for (const milestone of temple.milestones ?? []) {
      if (milestone.wave <= previous) {
        report.add(
          where,
          `рубеж волны ${milestone.wave} стоит после рубежа ${previous}: рубежи обязаны ` +
            'идти строго по возрастанию (data/temple.ts)',
        )
      }
      previous = milestone.wave
      report.need(
        content.recipes.some((r) => r.id === milestone.recipeId),
        where,
        `рубеж открывает рецепт «${milestone.recipeId}», которого нет в data/recipes.ts`,
      )
    }
  },
}

export const QUEST_SCHEMA: EntitySchema<QuestDef> = {
  kind: 'задание',
  file: 'data/quests.ts',
  entities: (c) => c.quests,
  id: (q) => q.id,
  name: (q) => q.name,
  icon: (q) => q.icon,
  numbers: [],
  extra: (quest, content, report) => {
    const where = `задание ${quest.id}`
    report.need(
      !!quest.flavor?.trim(),
      where,
      'нет строки о том, зачем это делать — заполни flavor в data/quests.ts',
    )
    // Цель проверяется ПО ТИПУ: пятого типа нет, а у каждого из четырёх своя
    // ссылка, и промах в ней запер бы цепочку навсегда.
    const goal = quest.goal
    if (goal.kind === 'kill') {
      const zone = content.zones.find((z) => z.id === goal.zoneId)
      report.need(zone !== undefined, where, `зоны «${goal.zoneId}» нет в data/zones.ts`)
      report.need(
        zone?.monsterPool.some((m) => m.id === goal.monsterId) ?? false,
        where,
        `в зоне «${goal.zoneId}» не водится «${goal.monsterId}» — задание невыполнимо ` +
          '(data/zones.ts)',
      )
      report.need(
        Number.isInteger(goal.count) && goal.count > 0,
        where,
        'число убийств должно быть целым и больше нуля (data/quests.ts)',
      )
    } else if (goal.kind === 'dungeon') {
      report.need(
        content.dungeons.some((d) => d.id === goal.dungeonId),
        where,
        `данжа «${goal.dungeonId}» нет в data/dungeons.ts`,
      )
    } else if (goal.kind === 'craft') {
      report.need(
        content.recipes.some((r) => r.id === goal.recipeId),
        where,
        `рецепта «${goal.recipeId}» нет в data/recipes.ts`,
      )
      report.need(
        Number.isInteger(goal.count) && goal.count > 0,
        where,
        'число крафтов должно быть целым и больше нуля (data/quests.ts)',
      )
    } else {
      report.need(
        Number.isInteger(goal.level) && goal.level > 0 && goal.level <= content.balance.levelCap,
        where,
        `цель «достичь ${goal.level} уровня» выше потолка ${content.balance.levelCap} — ` +
          'задание невыполнимо (data/quests.ts)',
      )
    }
  },
}

export const CLASS_SCHEMA: EntitySchema<ClassDef> = {
  kind: 'класс',
  file: 'data/classes.ts',
  entities: (c) => c.classes,
  id: (c) => c.id,
  name: (c) => c.name,
  icon: (c) => c.icon,
  numbers: [
    { field: 'resource.perSwingDealt', get: (c) => c.resource?.perSwingDealt, min: 0 },
    { field: 'resource.perHitTaken', get: (c) => c.resource?.perHitTaken, min: 0 },
    { field: 'resource.decayShare', get: (c) => c.resource?.decayShare, min: 0, max: 1 },
  ],
  extra: (hero, content, report) => {
    const where = `класс ${hero.id}`
    report.need(!!hero.tagline?.trim(), where, 'нет строки о том, как в него играют (data/classes.ts)')
    // Умения: без них у класса нет ни одной кнопки.
    report.need(
      Array.isArray(hero.abilityIds) && hero.abilityIds.length > 0,
      where,
      'ни одного умения — играть будет нечем (data/classes.ts)',
    )
    for (const id of hero.abilityIds ?? []) {
      report.need(
        content.abilities.some((a) => a.id === id),
        where,
        `ссылается на умение «${id}», которого нет в data/abilities.ts`,
      )
    }
    // Умения открываются уровнями, но первая кнопка обязана быть с первого:
    // класс, у которого всё заперто, встречает игрока пустой панелью.
    const ownAbilities = (hero.abilityIds ?? [])
      .map((id) => content.abilities.find((a) => a.id === id))
      .filter((a): a is AbilityDef => !!a)
    report.need(
      ownAbilities.length === 0 || ownAbilities.some((a) => toNumber(a.unlockLevel) <= 1),
      where,
      'ни одного умения первого уровня — на старте у класса пустая панель (data/abilities.ts)',
    )
    // Ветки: без них дерево талантов у класса пустое.
    report.need(
      Array.isArray(hero.branchIds) && hero.branchIds.length > 0,
      where,
      'ни одной ветки талантов — очки некуда вкладывать (data/classes.ts)',
    )
    for (const id of hero.branchIds ?? []) {
      report.need(
        content.branches.some((b) => b.id === id),
        where,
        `ссылается на ветку «${id}», которой нет в data/talents.ts (BRANCHES)`,
      )
    }
    // Стартовая экипировка ссылается на настоящие шаблоны. Броне шаблон
    // не нужен — у неё вместо него главный атрибут, как у кованой вещи.
    for (const item of hero.startingEquipment ?? []) {
      if (item.kind === 'armor') {
        report.need(
          item.slot !== 'mainHand' && item.slot !== 'offHand',
          where,
          `стартовая броня лежит в слоте рук «${item.slot}» (data/classes.ts)`,
        )
        report.need(
          ARMOR_ATTRIBUTES.includes(item.attribute as AttributeId),
          where,
          `стартовая броня в слоте «${item.slot}» не называет главный атрибут: ` +
            `«${item.attribute ?? '—'}» не из ARMOR_ATTRIBUTES (data/classes.ts)`,
        )
        continue
      }
      const known =
        item.kind === 'shield'
          ? content.shields.some((sh) => sh.id === item.templateId)
          : content.weapons.some((w) => w.id === item.templateId)
      report.need(
        known,
        where,
        `стартовый предмет «${item.templateId ?? '—'}» не найден среди ${item.kind === 'shield' ? 'щитов' : 'оружия'} (data/items.ts)`,
      )
      report.need(
        item.slot === 'mainHand' || item.slot === 'offHand',
        where,
        `стартовое оружие лежит в слоте «${item.slot}»: оружие бывает только в руках (data/classes.ts)`,
      )
    }
    // ОДНА БЕЛАЯ ВЕЩЬ, И БОЛЬШЕ НИЧЕГО.
    //
    // Комплект — это то, с чем игрок остаётся, пока не найдёт первую вещь.
    // Полный редкий комплект прежней версии закрывал все семь слотов вещами
    // выше среднего по рулетке, и петля «убил — нашёл — надел» не запускалась
    // часами: находка почти всегда была хуже подарка. Пустые слоты — это
    // место под находки, а не недосмотр, поэтому правило держится проверкой,
    // а не комментарием.
    const start = hero.startingEquipment ?? []
    report.need(
      start.length === 1,
      where,
      `в стартовом комплекте ${start.length} предметов вместо одного: пустые ` +
        'слоты — это место под находки, и закрывать их подарком нельзя ' +
        '(data/classes.ts)',
    )
    for (const item of start) {
      report.need(
        item.kind === 'weapon' && item.slot === 'mainHand',
        where,
        `стартовый предмет — «${item.kind}» в слоте «${item.slot}»: комплект ` +
          'состоит из одного оружия в правой руке (data/classes.ts)',
      )
      report.need(
        item.rarity === 'common',
        where,
        `стартовое оружие тира «${item.rarity}»: комплект обязан быть белым, ` +
          'иначе первые находки будут хуже подарка (data/classes.ts)',
      )
    }
    // Ресурс обязан хоть как-то пополняться: либо временем, либо боем.
    const resource = hero.resource
    if (!resource) {
      report.add(where, 'нет описания ресурса (data/classes.ts)')
      return
    }
    const fromCombat = resource.perSwingDealt?.gt(0) || resource.perHitTaken?.gt(0)
    const fromTime = hero.baseMods?.every((m) => m.stat !== 'manaRegen' || !m.value.eq(0)) ?? true
    report.need(
      fromCombat || fromTime,
      where,
      'ресурс не пополняется ни временем, ни боем — умения не применить ни разу ' +
        '(data/classes.ts)',
    )
    // Ярость без утечки — копилка на потом, а не ресурс непрерывного боя.
    if (fromCombat) {
      report.need(
        resource.decayShare?.gt(0) ?? false,
        where,
        'ресурс копится боем, но не тает вне боя: его можно накопить впрок, ' +
          'и ритм класса пропадает (data/classes.ts)',
      )
    }
  },
}

export const PROP_SCHEMA: EntitySchema<PropAsset> = {
  kind: 'пропс',
  file: 'data/assets.ts',
  entities: (c) => c.props,
  id: (p) => p.id,
  name: (p) => p.id,
  numbers: [
    {
      field: 'targetHeight',
      get: (p) => p.targetHeight,
      min: 0,
      exclusiveMin: true,
      max: 20,
      why: 'высота пропса на площадке в метрах: ноль не видно, двадцать закроет бой',
    },
  ],
  extra: (prop, content, report) => {
    const where = `пропс ${prop.id}`
    const file = prop.path?.split('/').pop() ?? ''
    // Ассет → файл: та же проверка, что у моделей бойцов. Промах даёт не
    // ошибку, а вечную коробку вместо бочки, и этого никто не заметит.
    report.need(
      content.propFiles.includes(file),
      where,
      `файла «${prop.path}» нет в public/models/props (data/assets.ts)`,
    )
    report.need(!!prop.license?.trim(), where, 'не указана лицензия (data/assets.ts)')
    report.need(!!prop.author?.trim(), where, 'не указан автор (data/assets.ts)')
    report.need(!!prop.sourceUrl?.trim(), where, 'не указан источник (data/assets.ts)')
  },
}

export const SOUND_SCHEMA: EntitySchema<SoundCue> = {
  kind: 'звук',
  file: 'data/sounds.ts',
  entities: (c) => c.sounds,
  id: (s) => s.id,
  name: (s) => s.id,
  numbers: [
    {
      field: 'pitchSemitones',
      get: (s) => s.pitchSemitones,
      min: 0,
      max: SOUND_PITCH_MAX_SEMITONES,
      why: 'разброс больше трёх полутонов читается как ДРУГОЙ звук, а не как вариация',
    },
    { field: 'gainDb', get: (s) => s.gainDb, min: 0, max: SOUND_GAIN_MAX_DB },
    { field: 'priority', get: (s) => s.priority, min: 0 },
    { field: 'duckMs', get: (s) => s.duckMs, min: 0, max: 3000 },
  ],
  extra: (cue, content, report) => {
    const where = `звук ${cue.id}`
    if (!Array.isArray(cue.files) || cue.files.length === 0) {
      report.add(where, 'нет ни одного файла — кью не прозвучит никогда (data/sounds.ts)')
      return
    }
    for (const file of cue.files) {
      if (!content.audioFiles.includes(file)) {
        report.add(
          where,
          `файл «${file}» не найден в public/ — промах даёт не ошибку, ` +
            'а тишину, которую никто не заметит (data/sounds.ts)',
        )
      }
    }
    if (new Set(cue.files).size !== cue.files.length) {
      report.add(where, 'один и тот же файл записан вариантом дважды (data/sounds.ts)')
    }
    // Правило против усталости слуха: час в одной зоне — тысячи ударов.
    const varied = cue.files.length >= SOUND_MIN_VARIATIONS
    const jittered = cue.pitchSemitones > 0 && cue.gainDb > 0
    if (!varied && !jittered) {
      report.add(
        where,
        `${cue.files.length} вариант(а) и нулевой разброс: нужно либо ` +
          `${SOUND_MIN_VARIATIONS} файла, либо разброс высоты И громкости ` +
          '(data/sounds.ts)',
      )
    }
    if (cue.pitchSemitones > 0 && cue.pitchSemitones < SOUND_PITCH_MIN_SEMITONES) {
      report.add(
        where,
        `разброс ${cue.pitchSemitones} полутона на слух неотличим от нуля — ` +
          `минимум ${SOUND_PITCH_MIN_SEMITONES} (data/sounds.ts)`,
      )
    }
  },
}

export const RARITY_SCHEMA: EntitySchema<RarityDef> = {
  kind: 'редкость',
  file: 'data/rarity.ts',
  entities: (c) => c.rarities,
  id: (r) => r.id,
  name: (r) => r.name,
  numbers: [
    {
      field: 'weight',
      get: (r) => r.weight,
      min: 0,
      exclusiveMin: true,
      why: 'нулевой вес рулетки означал бы, что тир не выпадает никогда',
    },
    { field: 'bonusMult', get: (r) => r.bonusMult, min: 0, exclusiveMin: true },
    { field: 'sellMult', get: (r) => r.sellMult, min: 0, exclusiveMin: true },
  ],
  extra: (rarity, _content, report) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(rarity.color ?? '')) {
      report.add(
        `редкость ${rarity.id}`,
        `цвет «${rarity.color}» не похож на #rrggbb — цвета редкостей живут в data/rarity.ts`,
      )
    }
  },
}

export const MODEL_SCHEMA: EntitySchema<ModelAsset> = {
  kind: 'модель',
  file: 'data/assets.ts',
  entities: (c) => c.models,
  id: (m) => m.id,
  numbers: [
    {
      field: 'scale',
      get: (m) => m.scale,
      min: 0,
      exclusiveMin: true,
      why: 'это тонкая подстройка около единицы, основной масштаб считается сам',
    },
  ],
  extra: (model, content, report) => {
    const where = `модель ${model.id}`
    for (const [field, value] of [
      ['license', model.license],
      ['author', model.author],
      ['sourceUrl', model.sourceUrl],
    ] as const) {
      report.need(
        typeof value === 'string' && value.trim().length > 0,
        where,
        `не заполнено поле ${field} — этого требует лицензия, см. CREDITS.md`,
      )
    }
    const path = model.path ?? ''
    const file = path.split('/').pop() ?? ''
    if (!path.startsWith('models/')) {
      report.add(
        where,
        `путь «${path}» обязан начинаться с models/ — файлы моделей лежат в public/models`,
      )
    } else if (!content.modelFiles.includes(file)) {
      report.add(
        where,
        `ссылается на файл «${file}», которого нет в public/models — ` +
          'положи файл рядом с остальными или поправь path в data/assets.ts',
      )
    }
    // idle есть у любой модели: это состояние по умолчанию, и без него боец
    // застынет в T-позе. Остальные состояния деградируют осмысленно.
    report.need(
      typeof model.clips?.idle === 'string' && model.clips.idle.length > 0,
      where,
      'не указан клип покоя (clips.idle) — без него боец застынет в T-позе ' +
        '(data/assets.ts)',
    )
  },
}

export const SCHEMAS = [
  ABILITY_SCHEMA,
  BRANCH_SCHEMA,
  TALENT_SCHEMA,
  ZONE_SCHEMA,
  DUNGEON_SCHEMA,
  WEAPON_SCHEMA,
  SHIELD_SCHEMA,
  SOUND_SCHEMA,
  PROP_SCHEMA,
  CLASS_SCHEMA,
  MATERIAL_SCHEMA,
  HERB_SCHEMA,
  ENCHANT_SCHEMA,
  PROC_SCHEMA,
  BOSS_ABILITY_SCHEMA,
  TEMPLE_SCHEMA,
  QUEST_SCHEMA,
  REAGENT_SCHEMA,
  PROGRESSION_SCHEMA,
  RECIPE_SCHEMA,
  RARITY_SCHEMA,
  MODEL_SCHEMA,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- разные типы сущностей
] as unknown as EntitySchema<unknown>[]

// ---------------------------------------------------------------------------
// Сквозные проверки: недостижимый контент и слоты
// ---------------------------------------------------------------------------

/**
 * Недостижимый контент — самая тихая из поломок: игра работает, тесты зелёные,
 * а до половины предметов игрок не доберётся никогда.
 */
/**
 * ВХОД ИНСТАНСА СТОИТ В СВОЕЙ ПОЛОСЕ. Уровень открытия инстанса и зона его
 * входа — две независимые системы, и без связи между ними они разъезжаются
 * молча: храм открывался с семидесятого, а вход стоял в полосе 91-95, куда
 * герой семидесятого уровня не дойдёт живым. Числа при этом у обеих систем
 * правильные — неверна связь, и увидеть её можно только проверкой.
 *
 *     zone.min - 1 <= unlock <= zone.max
 *
 * Нижняя граница — «герой приходит к входу не раньше, чем начинает выживать
 * у двери»: открытие ровно на пороге зоны законно, герой шагнёт в неё сразу.
 * Верхняя — «зона входа не отстала от открытия»: иначе новый контент выдают
 * там, где всё давно пройдено.
 *
 * ГЕРОИКА ПРОВЕРЯЕТСЯ ТОЛЬКО НИЖНЕЙ ГРАНИЦЕЙ, и это не поблажка. Героика —
 * повторный заход в УЖЕ ПРОЙДЕННЫЙ данж (см. «вторая строка того же данжа»),
 * поэтому её вход по построению стоит в зоне обычной версии, а порог у неё
 * общий эндгеймовый. Верхняя граница запрещала бы саму эту конструкцию, а не
 * ловила ошибку. Опасность, ради которой проверка написана, — вход ВПЕРЕДИ
 * открытия, и её ловит нижняя граница, которая для героики действует.
 */
function checkInstanceEntrances(content: Content, report: Report): void {
  const zoneById = new Map(content.zones.map((z) => [z.id, z]))
  interface Entrance {
    where: string
    file: string
    zoneId: string
    unlock: number
    /** Повторный заход в пройденное: верхняя граница к нему не применяется. */
    rerun: boolean
  }
  const entrances: Entrance[] = [
    ...content.dungeons.map((d) => ({
      where: `данж ${clearKey(d.id, d.difficulty)}`,
      file: 'data/dungeons.ts',
      zoneId: d.zoneId,
      unlock: d.unlockRequirement,
      rerun: d.difficulty !== 'normal',
    })),
    ...content.temples.map((t) => ({
      where: `храм ${t.id}`,
      file: 'data/temple.ts',
      zoneId: t.zoneId,
      unlock: t.unlockRequirement,
      rerun: false,
    })),
  ]
  for (const e of entrances) {
    const zone = zoneById.get(e.zoneId)
    // Ссылку на несуществующую зону ловит своя проверка — здесь молчим,
    // иначе на одну поломку пришлось бы два замечания.
    if (!zone) continue
    const { min, max } = zone.monsterLevelRange
    const band = `${min}-${max}`
    if (e.unlock < min - 1) {
      report.add(
        e.where,
        `открывается с ${e.unlock} уровня, а вход стоит в зоне «${e.zoneId}» (мобы ${band}): ` +
          `герой придёт к двери раньше, чем начнёт там выживать (${e.file})`,
      )
    }
    if (!e.rerun && e.unlock > max) {
      report.add(
        e.where,
        `открывается с ${e.unlock} уровня, а вход стоит в зоне «${e.zoneId}» (мобы ${band}): ` +
          `зона отстала от открытия, новый контент выдаётся в давно пройденном месте (${e.file})`,
      )
    }
  }
}

function checkReachable(content: Content, report: Report): void {
  // --- Цепочка преквестов: она отпирает ступень лестницы ---
  report.need(
    content.progression.some((step) => step.id === QUEST_CHAIN.opensStepId),
    'цепочка заданий',
    `отпирает ступень «${QUEST_CHAIN.opensStepId}», которой нет в data/progression.ts`,
  )
  report.need(
    QUEST_CHAIN.quests.length > 0,
    'цепочка заданий',
    'в цепочке нет ни одного задания — ступень рейда не отпереть (data/quests.ts)',
  )

  // --- Зачарование: пыль и достижимость ---
  for (const rarity of content.rarities) {
    const dust = content.dustByRarity[rarity.id]
    if (!(dust > 0)) {
      report.add(
        `редкость ${rarity.id}`,
        `распыление даёт ${dust} пыли: распылять предметы этого тира бессмысленно ` +
          '(DUST_BY_RARITY в data/enchants.ts)',
      )
    }
  }
  for (const slot of content.slots) {
    const forSlot = content.enchants.filter((e) => e.slots?.includes(slot))
    report.need(
      forSlot.length > 0,
      `слот ${slot}`,
      'в этот слот предметы падают, а зачаровать их нечем — добавь зачарование ' +
        'с этим слотом в data/enchants.ts',
    )
  }

  // --- Зоны: в каждой растёт хоть одна трава ---
  for (const zone of content.zones) {
    report.need(
      content.herbs.some((h) => h.zoneIds?.includes(zone.id)),
      `зона ${zone.id}`,
      'в ней не растёт ни одной травы — травничество в этой зоне мертво (data/herbs.ts)',
    )
  }

  // --- Травы: каждая нужна хоть одному рецепту ---
  for (const herb of content.herbs) {
    report.need(
      content.recipes.some((r) => r.inputs?.some((i) => i.materialId === herb.id)),
      `трава ${herb.id}`,
      'не входит ни в один рецепт — её некуда девать, это недостижимый контент ' +
        '(data/recipes.ts)',
    )
  }

  // --- Зоны: в каждую есть путь ---
  //
  // ЛЕСТНИЦА ЗОН ДЕРЖИТСЯ НА ДАНЖАХ, и проверок здесь три. Зону не должны
  // открывать двое (иначе «пройди тот или этот» — уже не лестница), стартовых
  // зон должно быть ровно столько, чтобы герой дошёл до первого данжа, и
  // раскладка обязана сойтись без остатка: двадцать зон это четыре стартовых
  // плюс восемь данжей по две.
  const openedBy = new Map<string, string[]>()
  for (const dungeon of content.dungeons) {
    if (dungeon.difficulty === 'heroic') continue // героика второй раз не открывает
    for (const zoneId of dungeon.opensZoneIds ?? []) {
      openedBy.set(zoneId, [...(openedBy.get(zoneId) ?? []), dungeon.id])
      report.need(
        content.zones.some((z) => z.id === zoneId),
        `данж ${dungeon.id}`,
        `открывает зону «${zoneId}», которой нет в data/zones.ts`,
      )
    }
  }
  for (const [zoneId, openers] of openedBy) {
    report.need(
      openers.length === 1,
      `зона ${zoneId}`,
      `её открывают сразу ${openers.length} данжа (${openers.join(', ')}) — ` +
        'лестница должна быть лестницей, а не развилкой (data/dungeons.ts)',
    )
  }
  const openAtStart = content.zones.filter((z) => !openedBy.has(z.id))
  report.need(
    openAtStart.length > 0,
    'зоны',
    'каждую зону открывает какой-нибудь данж — игроку негде начать и нечем ' +
      'открыть первый данж (data/dungeons.ts)',
  )
  for (const dungeon of content.dungeons) {
    if (dungeon.difficulty === 'heroic') continue
    report.need(
      (dungeon.opensZoneIds ?? []).length === 2,
      `данж ${dungeon.id}`,
      `открывает ${(dungeon.opensZoneIds ?? []).length} зон вместо двух: двадцать зон ` +
        'раскладываются как четыре стартовых плюс восемь данжей по две, и остатка ' +
        'здесь быть не может (data/dungeons.ts)',
    )
  }
  const safe = content.zones.filter((z) => z.isSafe)
  report.need(
    safe.length === 1,
    'зоны',
    `безопасных зон ${safe.length}, а обязана быть ровно одна: в неё возвращает смерть ` +
      '(поле isSafe в data/zones.ts)',
  )
  if (safe.length === 1) {
    report.need(
      !openedBy.has(safe[0].id),
      `зона ${safe[0].id}`,
      'безопасную зону открывает данж — вернуться в неё до его прохождения будет ' +
        'некуда (data/dungeons.ts)',
    )
  }

  // --- Зоны: полосы уровней мобов идут подряд, без дыр и без нахлёстов ---
  //
  // Дыра — это уровни мобов, которых в игре нет ни в одной зоне: лестница
  // мира рвётся, и на каком-то отрезке прогрессии герою некуда идти. Нахлёст
  // тише и потому хуже: две зоны спорят за одни и те же уровни, и одна из них
  // навсегда остаётся бессмысленной копией другой.
  const bands = [...content.zones]
    .map((z) => ({ id: z.id, min: z.monsterLevelRange?.min, max: z.monsterLevelRange?.max }))
    .filter((b) => Number.isFinite(b.min) && Number.isFinite(b.max))
    .sort((a, b) => a.min - b.min)
  if (bands.length > 0) {
    report.need(
      bands[0].min === 1,
      `зона ${bands[0].id}`,
      `самая нижняя полоса начинается с ${bands[0].min}-го уровня мобов, а обязана с первого: ` +
        'иначе новичку не с кем драться (data/zones.ts)',
    )
    for (let i = 1; i < bands.length; i += 1) {
      const prev = bands[i - 1]
      const zone = bands[i]
      if (zone.min === prev.max + 1) continue
      report.add(
        `зона ${zone.id}`,
        zone.min > prev.max + 1
          ? `полоса ${zone.min}-${zone.max} начинается после ${prev.max} у зоны ${prev.id}: ` +
              `уровни мобов ${prev.max + 1}-${zone.min - 1} не покрыты ни одной зоной ` +
              '(data/zones.ts)'
          : `полоса ${zone.min}-${zone.max} налезает на ${prev.min}-${prev.max} у зоны ` +
              `${prev.id}: две зоны спорят за одни и те же уровни мобов (data/zones.ts)`,
      )
    }
    // ВЕРХ ЛЕСТНИЦЫ ПРИВЯЗАН К ПОТОЛКУ. Сегодня это совпадение (20 полос по
    // пять, верх ровно 100), и держалось оно ни на чём.
    //
    // Подними потолок под рейд, оставив зоны прежними, — и
    // zoneForMonsterLevel начнёт МОЛЧА отдавать последнюю зону для всех
    // уровней выше: стоимость последних уровней посчитается по наградам не
    // тех мобов, intendedZone покажет зону, где мобов твоего уровня нет
    // вовсе, а в разделе «Мир» она будет помечена «по силам».
    const top = bands[bands.length - 1]
    report.need(
      top.max === content.balance.levelCap,
      `зона ${top.id}`,
      `самая глубокая полоса кончается на ${top.max}, а LEVEL_CAP = ` +
        `${content.balance.levelCap}: на последних уровнях герою не с кем драться ` +
        '(data/zones.ts)',
    )
  }

  // --- Зоны: в каждой что-то падает из материалов ---
  for (const zone of content.zones) {
    const drops = content.materials.filter((m) => m.zoneIds?.includes(zone.id))
    report.need(
      drops.length > 0,
      `зона ${zone.id}`,
      'ни один материал в ней не падает — ремёсла в этой зоне мертвы (data/materials.ts)',
    )
  }

  // --- Данжи: лестница тиров идёт подряд и по возрастанию уровня входа ---
  //
  // Данж — не украшение зоны, а ступень: тир задаёт числа боссов, а уровень
  // входа — когда до неё доходит очередь. Дырка в тирах означала бы пропущенный
  // реагент и данж, чьи числа выведены не из своего места в лестнице; равные
  // или убывающие уровни входа — две ступени на одной высоте.
  // Лестница проверяется ПО СЛОЖНОСТЯМ отдельно: у героики свой ряд тиров и
  // один уровень входа на все восемь — она не продолжение лестницы, а второй
  // проход по ней, и сравнивать её ступени с обычными нечем.
  const normal = content.dungeons.filter((d) => d.difficulty === 'normal')
  const ladder = [...normal].sort((a, b) => a.tier - b.tier)
  ladder.forEach((dungeon, index) => {
    if (dungeon.tier !== index + 1) {
      report.add(
        `данж ${dungeon.id}`,
        `тир ${dungeon.tier} стоит ${index + 1}-м по счёту: тиры обязаны идти подряд ` +
          'с первого и не повторяться (data/dungeons.ts)',
      )
    }
    if (index === 0) return
    const prev = ladder[index - 1]
    if (dungeon.unlockRequirement <= prev.unlockRequirement) {
      report.add(
        `данж ${dungeon.id}`,
        `открывается с ${dungeon.unlockRequirement} уровня, а данж тиром ниже ` +
          `(${prev.id}) — с ${prev.unlockRequirement}: уровни входа обязаны расти ` +
          'вместе с тиром (data/dungeons.ts)',
      )
    }
  })

  // --- Данжи: вход из зоны, которая открыта РАНЬШЕ самого данжа ---
  //
  // Кольцо — самая тихая поломка лестницы: данж, вход в который лежит в зоне,
  // открываемой им же, недостижим навсегда, и ни один тест боя этого не
  // заметит. Порядок считается по тиру: данж тира T открывается тем, что
  // прошли данж T-1.
  const tierOfZone = new Map<string, number>()
  for (const dungeon of content.dungeons) {
    if (dungeon.difficulty === 'heroic') continue
    for (const zoneId of dungeon.opensZoneIds ?? []) tierOfZone.set(zoneId, dungeon.tier)
  }
  for (const dungeon of content.dungeons) {
    if (dungeon.difficulty === 'heroic') continue
    const zone = content.zones.find((z) => z.id === dungeon.zoneId)
    if (!zone) continue // про отсутствие зоны уже сказала схема
    const openedAt = tierOfZone.get(zone.id)
    if (openedAt !== undefined && openedAt >= dungeon.tier) {
      report.add(
        `данж ${dungeon.id}`,
        `вход в него лежит в зоне ${zone.id}, которую открывает данж тира ${openedAt} — ` +
          `то есть он сам или тот, что за ним: до входа не добраться никогда ` +
          '(data/dungeons.ts)',
      )
    }
  }

  // --- Предметы: каждый слот выпадает ---
  for (const slot of content.slots) {
    const weight = content.slotDropWeights[slot]
    if (!(weight > 0)) {
      report.add(
        `слот ${slot}`,
        `вес в рулетке дропа = ${weight}: предметы этого слота не выпадут никогда ` +
          '(SLOT_DROP_WEIGHTS в data/slots.ts)',
      )
    }
    report.need(
      typeof content.slotNames[slot] === 'string' && content.slotNames[slot].length > 0,
      `слот ${slot}`,
      'нет названия — заполни SLOT_NAMES в data/slots.ts',
    )
    const icon = content.slotIcons[slot]
    report.need(
      typeof icon === 'string' && content.iconNames.includes(icon),
      `слот ${slot}`,
      `иконка «${icon}» не найдена в реестре ui/icons/manifest.ts (SLOT_ICONS в data/slots.ts)`,
    )
    if (slot === 'mainHand' || slot === 'offHand') continue
    const nouns = content.armorNouns[slot as Exclude<SlotId, 'mainHand' | 'offHand'>]
    report.need(
      Array.isArray(nouns) && nouns.length > 0,
      `слот ${slot}`,
      'нет ни одного существительного в ARMOR_NOUNS (data/items.ts) — имя предмета не собрать',
    )
  }
  report.need(
    content.weapons.length > 0,
    'оружие',
    'в WEAPONS нет ни одного шаблона — из слота оружия не выпадет ничего (data/items.ts)',
  )

  // --- Мобы: id уникальны по ВСЕМ зонам ---
  // Архетипы лежат внутри зон, отдельного реестра мобов нет, поэтому повиснуть
  // ссылке негде — а вот совпасть двум id из разных зон очень даже. Совпадут —
  // и лог боя, и модель на сцене начнут путать двух разных противников.
  const mobHome = new Map<string, string>()
  for (const zone of content.zones) {
    for (const archetype of zone.monsterPool ?? []) {
      if (typeof archetype?.id !== 'string' || archetype.id.length === 0) continue
      const home = mobHome.get(archetype.id)
      if (home !== undefined && home !== zone.id) {
        report.add(
          `моб ${archetype.id}`,
          `встречается в пулах двух зон (${home} и ${zone.id}) — id мобов обязаны быть ` +
            'уникальными по всей игре (data/zones.ts)',
        )
      } else if (home === zone.id) {
        report.add(
          `моб ${archetype.id}`,
          `встречается в пуле зоны ${zone.id} дважды (data/zones.ts)`,
        )
      }
      mobHome.set(archetype.id, zone.id)
    }
  }

  // --- Таланты: до каждого можно дойти ---
  for (const talent of content.talents) {
    const earlier = content.talents.filter(
      (t) => t.branch === talent.branch && t.row < talent.row,
    )
    const available = earlier.reduce((sum, t) => sum + t.maxRank, 0)
    if (talent.requiredPointsInBranch > available) {
      report.add(
        `талант ${talent.id}`,
        `требует ${talent.requiredPointsInBranch} очков в ветке ${talent.branch}, ` +
          `а вложить в таланты выше него можно только ${available}: до него не добраться ` +
          '(data/talents.ts)',
      )
    }
  }
  for (const branch of content.branches) {
    const inBranch = content.talents.filter((t) => t.branch === branch.id)
    report.need(
      inBranch.length > 0,
      `ветка ${branch.id}`,
      'в ветке нет ни одного таланта — вкладывать очки некуда (data/talents.ts)',
    )
    const rows = inBranch.map((t) => t.row)
    report.need(
      new Set(rows).size === rows.length,
      `ветка ${branch.id}`,
      `в ветке два таланта в одном ряду (ряды: ${rows.join(', ')}) — дерево рисуется ` +
        'по рядам (data/talents.ts)',
    )
  }
}

/** Числа баланса, у которых есть допустимый диапазон по смыслу. */
function checkBalance(content: Content, report: Report): void {
  const b = content.balance
  const where = 'баланс'
  const rules: NumberRule<BalanceNumbers>[] = [
    { field: 'DROP_CHANCE', get: (x) => x.dropChance, min: 0, exclusiveMin: true, max: 1, why: 'это вероятность' },
    { field: 'SHIELD_SHARE', get: (x) => x.shieldShare, min: 0, max: 1, why: 'это доля находок в левую руку' },
    { field: 'BASE_STATS.critChance', get: (x) => x.baseCritChance, min: 0, max: 1, why: 'это вероятность' },
    { field: 'BASE_STATS.damageReduction', get: (x) => x.baseDamageReduction, min: 0, max: 0.99, why: 'доля срезаемого урона; единица означала бы бессмертие' },
    { field: 'OFFLINE_EFFICIENCY', get: (x) => x.offlineEfficiency, min: 0, exclusiveMin: true, max: 1, why: 'оффлайн не бывает выгоднее живой игры' },
    { field: 'AUTOCAST_MAX_LOSS', get: (x) => x.autocastMaxLoss, min: 0, max: 1, why: 'это доля' },
    { field: 'TALENT_FIRST_LEVEL', get: (x) => x.talentFirstLevel, min: 1, integer: true },
    { field: 'ENCHANT_UNLOCK_LEVEL', get: (x) => x.enchantUnlockLevel, min: 1, integer: true },
    { field: 'POTION_UNLOCK_LEVEL', get: (x) => x.potionUnlockLevel, min: 1, integer: true },
    { field: 'TTK_DRIFT_MAX', get: (x) => x.ttkDriftMax, min: 0, exclusiveMin: true, max: 1, why: 'это доля разброса' },
  ]
  for (const rule of rules) checkNumber(b, rule, where, 'data/balance.ts', report)
  // Механика, которая открывается выше потолка, не откроется никогда.
  for (const [field, level] of [
    ['TALENT_FIRST_LEVEL', b.talentFirstLevel],
    ['POTION_UNLOCK_LEVEL', b.potionUnlockLevel],
    ['ENCHANT_UNLOCK_LEVEL', b.enchantUnlockLevel],
  ] as const) {
    if (level > b.levelCap) {
      report.add(
        where,
        `${field} = ${level} выше LEVEL_CAP = ${b.levelCap}: механика не откроется ` +
          'никогда (data/balance.ts)',
      )
    }
  }

  // Коридор темпа обязан быть коридором, а не набором чисел врозь.
  const ordered: Array<[string, number, string, number]> = [
    ['TTK_HARD_FLOOR', b.ttkHardFloor, 'TTK_TARGET_MIN', b.ttkTargetMin],
    ['TTK_TARGET_MIN', b.ttkTargetMin, 'TTK_TARGET_MAX', b.ttkTargetMax],
    ['TTK_TARGET_MAX', b.ttkTargetMax, 'TTK_HARD_CEILING', b.ttkHardCeiling],
  ]
  for (const [loName, lo, hiName, hi] of ordered) {
    if (!(lo <= hi)) {
      report.add(
        where,
        `${loName} = ${lo} больше ${hiName} = ${hi}: коридор темпа вывернут наизнанку ` +
          '(PACING в data/balance.ts)',
      )
    }
  }
  if (!(b.ttkBehindMax < b.ttkTargetMin)) {
    report.add(
      where,
      `TTK_BEHIND_MAX = ${b.ttkBehindMax} не меньше TTK_TARGET_MIN = ${b.ttkTargetMin}: ` +
        'отстающая зона обязана проходиться быстрее актуальной',
    )
  }
  if (!(b.ttkAheadMin > b.ttkTargetMax)) {
    report.add(
      where,
      `TTK_AHEAD_MIN = ${b.ttkAheadMin} не больше TTK_TARGET_MAX = ${b.ttkTargetMax}: ` +
        'опережающая зона обязана проходиться дольше актуальной',
    )
  }

  // Ступени штрафа опыта. Проверка не про «красиво», а про то, что таблицу
  // читает ЛИНЕЙНЫЙ поиск первой подходящей ступени: перепутанный порядок
  // молча выключил бы половину таблицы, а доля вне 0..1 выдавала бы за моба
  // больше опыта, чем он стоит.
  const steps = b.xpGapPenalty
  if (steps.length === 0) {
    report.add(where, 'XP_GAP_PENALTY пуст: доля опыта не определена ни для какого разрыва (data/balance.ts)')
  }
  steps.forEach((step, i) => {
    if (!(step.share >= 0 && step.share <= 1)) {
      report.add(
        where,
        `XP_GAP_PENALTY[${i}].share = ${step.share} вне 0..1: это доля награды (data/balance.ts)`,
      )
    }
    if (i === 0) return
    const prev = steps[i - 1]
    if (!(step.maxGap > prev.maxGap)) {
      report.add(
        where,
        `XP_GAP_PENALTY[${i}].maxGap = ${step.maxGap} не больше предыдущего ${prev.maxGap}: ` +
          'таблица читается первой подходящей ступенью, и эта уже недостижима (data/balance.ts)',
      )
    }
    if (!(step.share <= prev.share)) {
      report.add(
        where,
        `XP_GAP_PENALTY[${i}].share = ${step.share} больше предыдущего ${prev.share}: ` +
          'штраф за больший разрыв обязан быть не мягче (data/balance.ts)',
      )
    }
  })
  const last = steps[steps.length - 1]
  if (last && Number.isFinite(last.maxGap)) {
    report.add(
      where,
      `последняя ступень XP_GAP_PENALTY кончается на ${last.maxGap}: разрыв больше неё ` +
        'останется без доли (data/balance.ts)',
    )
  }
}

// ---------------------------------------------------------------------------
// Точка входа
// ---------------------------------------------------------------------------

/** Полная проверка контента. Пустой список — всё в порядке. */

/**
 * ТОТ ЖЕ ДОВОД, НО ПРО ВЕСЬ КОНТЕНТ, А НЕ ПРО ТРИ КОНСТАНТЫ.
 *
 * Правило «выше потолка — значит никогда» было написано для трёх чисел из
 * data/balance.ts, а уровни входа зон, данжей, храмов, умений, ступеней
 * лестницы и цепочки заданий с потолком не сверялись вовсе.
 *
 * Запас здесь нулевой уже сегодня: ступень рейда стоит РОВНО на сотом
 * уровне. Опечатка в одну цифру — и главный контент итерации не открывается
 * никогда, а прогон остаётся зелёным.
 *
 * Сравнение НЕСТРОГОЕ: ровно на потолке — законно, это последний уровень.
 */
function checkUnlockLevels(content: Content, report: Report): void {
  const cap = content.balance.levelCap
  type Entry = { where: string; field: string; level: number; file: string }
  const entries: Entry[] = [
    ...content.dungeons.map((d) => ({
      where: `данж ${clearKey(d.id, d.difficulty)}`, field: 'unlockRequirement',
      level: d.unlockRequirement, file: 'data/dungeons.ts',
    })),
    ...content.temples.map((t) => ({
      where: `храм ${t.id}`, field: 'unlockRequirement', level: t.unlockRequirement,
      file: 'data/temple.ts',
    })),
    ...content.abilities.map((a) => ({
      where: `умение ${a.id}`, field: 'unlockLevel', level: a.unlockLevel,
      file: 'data/abilities.ts',
    })),
    ...content.progression.map((p) => ({
      where: `ступень ${p.id}`, field: 'level', level: p.level, file: 'data/progression.ts',
    })),
    {
      where: 'цепочка заданий', field: 'unlockLevel', level: content.questChainUnlockLevel,
      file: 'data/quests.ts',
    },
  ]
  for (const e of entries) {
    if (!Number.isFinite(e.level) || e.level <= cap) continue
    report.add(
      e.where,
      `${e.field} = ${e.level} выше LEVEL_CAP = ${cap}: до этого уровня не дойти, ` +
        `контент не откроется никогда (${e.file})`,
    )
  }
}

export function checkContent(content: Content): ContentIssue[] {
  const report = new Report()
  for (const schema of SCHEMAS) runSchema(schema, content, report)
  checkReachable(content, report)
  checkInstanceEntrances(content, report)
  checkBalance(content, report)
  checkUnlockLevels(content, report)
  return report.issues
}

/** Замечания одним читаемым текстом — его печатает и тест, и content:check. */
export function formatIssues(issues: readonly ContentIssue[]): string {
  return issues.map((i) => `  • ${i.where}: ${i.message}`).join('\n')
}
