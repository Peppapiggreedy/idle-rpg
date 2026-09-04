// Игровое состояние и его создание. Отдельный модуль, чтобы tick, loot и save
// зависели от него, а не друг от друга.
import { Decimal } from './numbers'
import { DEFAULT_UPGRADE_PRIORITY, type UpgradePriority } from '../data/upgrade'
import { DEFAULT_LOOT_POLICY, type LootPolicy } from '../data/upgrades'
import { xpToNextLevel } from './formulas'
import { randomSeed } from './rng'
import { buildMonster } from '../data/monsters'
import { SAFE_ZONE, spawnLevelWeights, type Zone } from '../data/zones'
import { ABILITY_BY_ID, type AbilityDef } from '../data/abilities'
import { CLASS_BY_ID, DEFAULT_CLASS, classById, type ClassDef } from '../data/classes'
import { RARITY_BY_ID } from '../data/rarity'
import { ARMOR_NOUNS, SHIELD_BY_ID, WEAPON_BY_ID } from '../data/items'
import { armorMods, shieldMods, weaponMods } from './loot'
import {
  ABILITY_SLOTS,
  AUTOCAST_DELAY_MS,
  REGEN_TICK_S,
  REST_HP_THRESHOLD_DEFAULT,
} from '../data/balance'
import { recomputeStats, type StatBlock } from './stats'
import { SLOT_IDS, type SlotId } from '../data/slots'
import { createRng, type Rng } from './rng'
import type {
  CombatEvent,
  DungeonRun,
  Item,
  Monster,
  MonsterTemplate,
  QuestProgress,
  TempleRun,
} from '../types'

// Сколько последних событий боя храним для лога на экране.
export const COMBAT_LOG_SIZE = 8

export interface GameState {
  /** Класс героя. Выбирается при новой игре и не меняется никогда. */
  classId: string
  totalTicks: Decimal
  playtimeMs: Decimal
  /**
   * Сколько умений герой применил за всю игру. Счётчик, а не поиск по логу:
   * лог хранит короткий хвост, и новое событие вытолкнуло бы каст за край —
   * отпечаток golden поехал бы без изменения игры.
   */
  abilityCasts: Decimal
  gold: Decimal
  level: Decimal
  currentXp: Decimal
  xpToNext: Decimal
  // Прогресс замаха ДОЛЕЙ 0..1, а не в миллисекундах: при смене оружия или
  // haste доля сохраняется сама — ни сброса удара, ни мгновенного удара.
  swingProgress: number
  // Прогресс замаха ЛЕВОЙ руки — свой и независимый. Две руки бьют по своим
  // таймерам, а не по одному общему: в этом и весь дуалвилд.
  offhandSwingProgress: number
  currentHp: Decimal // текущее здоровье героя, кап — stats.maxHp
  currentMana: Decimal // текущая мана героя, кап — stats.maxMana
  // Правило задержки регенерации. regenDelayMsLeft — сколько ещё ждать до
  // старта восстановления маны (0 — уже идёт); regenTickMsLeft — сколько до
  // следующего тика, чтобы мана капала порциями раз в REGEN_TICK_S, а не
  // размазывалась по шагам симуляции. Оба — служебные счётчики, обычные
  // number: это миллисекунды, а не игровая величина.
  regenDelayMsLeft: number
  regenTickMsLeft: number
  // Умения. Кулдауны и GCD идут ИГРОВЫМ временем (тем же dtMs, что и бой),
  // поэтому множитель скорости из отладочной панели ускоряет и их.
  gcdMsLeft: number // глобальный кулдаун; 0 — свободен
  abilityCooldownsMs: Record<string, number> // id умения -> сколько мс осталось
  // Нерастраченные заряды умений: id -> сколько осталось. ОТСУТСТВИЕ записи
  // означает полный комплект, поэтому у героя без талантов-зарядов поле всегда
  // пустое и в сейв ничего лишнего не едет. Заряды копятся откатом по одному.
  abilityCharges: Record<string, number>
  // Действующие зелья. Список, а не одно поле: зелья разных рецептов
  // складываются, одного и того же — обновляются (см. game/potions.ts).
  activePotions: ActivePotion[]
  // Недорезанная доля пучка по каждой траве, 0..1. Служебный счётчик, как
  // regenTickMsLeft: копится долей, чтобы на медленном шаге ничего не
  // терялось. В сейв не пишется — терять меньше одного пучка не жалко.
  herbProgress: Record<string, number>
  /** Пыль зачарования: копится ТОЛЬКО распылением находок, с мобов не падает.
   *  Растёт неограниченно (сотни находок за сотню уровней) — значит Decimal. */
  enchantDust: Decimal
  // Внутренние кулдауны проков: id прока -> сколько мс осталось. Ключ — ПРОК,
  // а не предмет: два предмета с одним проком делят один кулдаун, ровно как
  // их считает оценка (equippedProcs схлопывает дубли).
  procCooldownsMs: Record<string, number>
  /** Идентификатор ЭТОЙ игры. Неизменен; вместе с датой даёт сид забега
   *  по храму — поэтому за один день поток волн один и тот же. */
  saveId: number
  /** Активный забег по храму; null — герой снаружи. */
  templeRun: TempleRun | null
  /** Храм пройден целиком хотя бы раз: награда за это выдаётся однажды. */
  templeCleared: boolean
  /** Личный рекорд: максимальный ПОЛНОСТЬЮ пройденный этаж храма.
   *  Он же ключ: рубежи открывают рецепты, и он же решает, за что платить. */
  templeBestWave: number
  /** Цепочка преквестов: сданные задания и счётчик текущего (game/quests.ts). */
  questProgress: QuestProgress
  // Умение типа onNextSwing, поставленное в очередь: заменит следующую
  // автоатаку. Одновременно только одно; null — очередь пуста.
  queuedAbilityId: string | null
  activeEffects: ActiveEffect[] // эффекты на текущем мобе (урон по времени)
  /**
   * РЯД ДЕЙСТВИЙ: какие умения герой носит и в каком порядке. Индекс — и
   * место кнопки под сценой, и приоритет автокаста. `null` — пустой слот.
   */
  abilitySlots: AbilitySlots
  // Настройки автокаста по умениям: включено ли и сколько ресурса беречь.
  abilitySettings: AbilitySettings
  // Задержка реакции автокаста ПО КАЖДОМУ умению, мс. Пока умение недоступно,
  // его таймер взведён; как только стало доступно — тикает, и по нулю умение
  // применяется. Из-за этого автокаст всегда бьёт на autocastDelay позже
  // идеальной игры. В сейв не пишется: перевзводится за полсекунды.
  autocastReadyMs: Record<string, number>
  // 'resting' — герой сидит на привале: не бьёт и не получает по себе.
  // Это НЕ смерть: привал управляемый, а смерть теперь следствие неверно
  // выставленного порога.
  heroState: 'alive' | 'dead' | 'resting'
  reviveMsLeft: number // обратный отсчёт воскрешения; > 0 только при heroState 'dead'
  restMsLeft: number // сколько осталось сидеть; > 0 только при heroState 'resting'
  // Сколько всего должен был длиться ЭТОТ привал: по нему считается доля
  // восстановления, если игрок прервёт его руками.
  restTotalMs: number
  // Порог ухода на привал: доля HP. Настройка игрока, часть сейва.
  // Ноль — не уходить на привал вовсе.
  restHpThreshold: number
  /**
   * Беречь ману под лечение: автокаст не жмёт боевое умение, если после него
   * не останется на одно лечение. Настройка автокаста, по умолчанию включена;
   * руками игрок волен потратить всё. Без лечащего умения в классе — ничего
   * не делает.
   */
  holdManaForHeal: boolean
  /**
   * ПРИОРИТЕТ АПГРЕЙДА: что игрок считает улучшением — урон, выживание или
   * то и другое. Настройка, а не свойство героя: лежит в сейве, меняется
   * переключателем в панели сумки, по умолчанию «баланс». Решает две вещи:
   * какая ось зажигает метку «Апгрейд» и что считается лишним при разборе
   * добычи. Правила положений — данными в `data/upgrade.ts`.
   */
  upgradePriority: UpgradePriority
  /**
   * ЧТО КУПЛЕНО ЗА ЗОЛОТО. Список id, а не набор флагов и не счётчик мест:
   * из него ПРОИЗВОДНЫ и размер сумки, и открытые положения переключателя
   * разбора (`game/upgrades.ts`). Отдельные поля пришлось бы чинить
   * миграцией при каждой правке лестницы и разъезжались бы они молча.
   */
  purchasedUpgradeIds: string[]
  /**
   * ЧТО ДЕЛАТЬ С ЛИШНЕЙ НАХОДКОЙ: не трогать, продавать, распылять.
   * Настройка игрока; положения открываются покупками. Что считать
   * «лишним», решает приоритет апгрейда — здесь только судьба лишнего.
   */
  lootPolicy: LootPolicy
  // Что ускоряет привал. Пока всегда null: сюда приедет еда из кулинарии.
  // Поле и место его учёта заведены заранее, чтобы профессии не пришлось
  // втискивать в конвейер тика задним числом.
  restSpeedupSource: string | null
  // Таланты: id -> вложенный ранг. Тоже источник статов, а часть талантов
  // ещё и поднимает флаги, меняющие поведение (см. data/talents.ts).
  talents: Record<string, number>
  talentResets: number // сколько раз игрок сбрасывал таланты; от этого цена
  equipment: Equipment // надетые предметы по слотам (источник статов)
  // Производные статы из конвейера stats.ts. Прямых полей урона/скорости/критов
  // в состоянии НЕТ — только пересчёт из источников (упгрейды, позже экипировка).
  stats: StatBlock
  statsDirty: boolean // источники изменились -> ensureStats пересчитает
  inventory: Item[]
  /** Материалы и готовая еда: id -> количество. Свой мешок, вне инвентаря. */
  materials: Record<string, Decimal>
  itemSeq: number // служебный счётчик для уникальных id предметов
  rngSeed: number // служебный сид потока случайности (в сейв пока не пишется)
  // Активный забег по данжу; null — герой снаружи. Прогресс цепочки живёт
  // только здесь: смерть внутри стирает его целиком.
  dungeonRun: DungeonRun | null
  dungeonsCleared: Record<string, boolean> // данжи, пройденные целиком хоть раз
  /**
   * ОТКРЫТЫЕ ЗОНЫ — отдельным полем, а не выводом из `dungeonsCleared`.
   *
   * Соблазн вывести был, и он неверен: «данж пройден» это ДОСТИЖЕНИЕ (за него
   * идёт постоянный бонус к опыту и уникальные награды), а «зона открыта» —
   * доступ. Совпадают они только в свежей игре. Миграция старых сейвов обязана
   * вернуть игроку зоны, которые он уже видел по прежней лестнице уровней, —
   * но не выдавать при этом бонус за данжи, которых он не проходил.
   *
   * Стартовые зоны здесь НЕ лежат: они открыты всегда и выводятся из данных
   * (INITIAL_ZONE_IDS). В сейве только то, что игрок открыл сам.
   */
  unlockedZoneIds: Record<string, boolean>
  currentZoneId: string // где герой фармит сейчас
  // Последняя зона, в которой герой ВЫЖИЛ (убил там хотя бы одного моба).
  // Смерть отбрасывает сюда; null — выживать ещё негде, значит в безопасную.
  lastSurvivedZoneId: string | null
  monster: Monster
  // Служебный обратный отсчёт до респауна в мс (как dtMs): 0 — моб жив.
  respawnMsLeft: number
  combatLog: CombatEvent[] // последние события, новые в начале
  msSinceAutosave: number // служебный счётчик игрового времени с последнего сейва
}

// Наложенный эффект. Урон тика ЗАСНЯТ в момент применения: смена оружия
// посреди эффекта не меняет уже наложенный урон.
export interface ActiveEffect {
  abilityId: string
  damagePerTick: Decimal
  ticksLeft: number
  msToNextTick: number
}

/**
 * Действующее зелье. Модификаторы НЕ снимаются с него слепком: они живут в
 * данных рецепта, и правка баланса зелья действует сразу, а не со следующего
 * глотка. Это осознанно иначе, чем у ActiveEffect: там заснят урон тика,
 * потому что он зависит от оружия в момент удара.
 */
export interface ActivePotion {
  recipeId: string
  // Обычный number: это миллисекунды, а не растущая игровая величина.
  msLeft: number
}

/**
 * Настройка автокаста одного умения.
 *
 * ПОЛЯ ПРИОРИТЕТА ЗДЕСЬ НЕТ, И ЭТО ГЛАВНОЕ В ЭТОМ ТИПЕ. Порядок задаёт РЯД
 * ДЕЙСТВИЙ (`abilitySlots`): первый слот жмётся первым. Числом приоритета
 * порядок жил здесь до четырёх слотов, и два источника одного и того же
 * разъехались бы на первой перестановке — игрок двигает кнопку в ряду, а
 * автокаст читает старое число.
 */
export interface AbilitySetting {
  autocast: boolean
  // Резерв: не жать умение, если маны меньше этой доли от запаса. Это и есть
  // рычаг «урон против автономности»: нулевой резерв выжимает весь урон и
  // не даёт регенерации запуститься, высокий — бережёт окна под неё.
  reserve: number
}

export type AbilitySettings = Record<string, AbilitySetting>

/**
 * СОСТАВ И ПОРЯДОК ЧЕТВЁРКИ. Длина всегда `ABILITY_SLOTS`; `null` — пустой
 * слот. Индекс И ЕСТЬ приоритет автокаста.
 */
export type AbilitySlots = (string | null)[]

/** Что читает ротация: состав ряда плюс галки и резервы по умениям. */
export interface Rotation {
  slots: readonly (string | null)[]
  settings: AbilitySettings
}

export const rotationOf = (state: GameState): Rotation => ({
  slots: state.abilitySlots,
  settings: state.abilitySettings,
})

/** Настройки по умолчанию: автокаст включён, резерв нулевой. Порядок здесь
 *  не задаётся — он живёт в `abilitySlots`. */
/** Умения класса в порядке кнопок; неизвестный класс отдаёт умения дефолтного. */
export function abilitiesOf(classId: string): AbilityDef[] {
  const hero = classById(classId)
  return hero.abilityIds.map((id) => ABILITY_BY_ID[id]).filter((a): a is AbilityDef => !!a)
}

export function defaultAbilitySettings(classId: string = DEFAULT_CLASS.id): AbilitySettings {
  return Object.fromEntries(
    abilitiesOf(classId).map((a) => [a.id, { autocast: true, reserve: 0 }]),
  )
}

/**
 * ЧЕТВЁРКА ПО УМОЛЧАНИЮ: первые умения класса в порядке данных, сколько
 * влезет. Пустая панель у героя недопустима — ни у новичка, ни у
 * вернувшегося со старым сейвом.
 *
 * УРОВЕНЬ ЗДЕСЬ НИ ПРИ ЧЁМ, И ЭТО НЕ НЕДОСМОТР. Запертое умение стоит в ряду
 * ЗАПЕРТОЙ КНОПКОЙ с уровнем открытия — так было и до четырёх слотов, и это
 * та самая «кнопка видна с причиной», которую обещает правило умений. Ставь
 * фильтр по уровню — и новичок увидел бы три пустых квадрата вместо трёх
 * обещаний.
 */
export function defaultAbilitySlots(classId: string = DEFAULT_CLASS.id): AbilitySlots {
  return fillAbilitySlots(new Array(ABILITY_SLOTS).fill(null), classId)
}

/**
 * ДОЛОЖИТЬ В ПУСТЫЕ СЛОТЫ УМЕНИЯ КЛАССА. Пустой ряд у героя недопустим:
 * сейв прошлой версии, чужие имена в слотах, ряд короче нынешнего — всё это
 * приводится к четвёрке здесь, в одной точке.
 *
 * Как только слоты заняты, функция молчит: состав выбирает игрок, и
 * подменять его выбор игра не вправе. Функция ЧИСТАЯ и идемпотентная.
 */
export function fillAbilitySlots(
  slots: readonly (string | null)[],
  classId: string,
): AbilitySlots {
  const next: AbilitySlots = [...slots]
  // Длина ряда — свойство игры, а не сейва: короткий массив дополняем,
  // длинный (ряд когда-то ужали) обрезаем.
  while (next.length < ABILITY_SLOTS) next.push(null)
  next.length = ABILITY_SLOTS
  const own = new Set(abilitiesOf(classId).map((a) => a.id))
  // Чужое или неизвестное имя в слоте — не «пустой слот», а мусор: чистим,
  // иначе оно займёт место и ряд молча станет короче.
  for (let i = 0; i < next.length; i += 1) {
    if (next[i] !== null && !own.has(next[i] as string)) next[i] = null
  }
  const taken = new Set(next.filter((id): id is string => id !== null))
  for (const ability of abilitiesOf(classId)) {
    if (taken.has(ability.id)) continue
    const free = next.indexOf(null)
    if (free === -1) break
    next[free] = ability.id
    taken.add(ability.id)
  }
  return next
}

/** Все галки автокаста сняты — герой бьёт только автоатакой. */
export function manualOnlySettings(classId: string = DEFAULT_CLASS.id): AbilitySettings {
  return Object.fromEntries(
    abilitiesOf(classId).map((a) => [a.id, { autocast: false, reserve: 0 }]),
  )
}

export type Equipment = Record<SlotId, Item | null>

export function emptyEquipment(): Equipment {
  return Object.fromEntries(SLOT_IDS.map((slot) => [slot, null])) as Equipment
}

/**
 * Стартовая экипировка класса. Собирается ТЕМИ ЖЕ функциями, что и лут
 * (weaponMods / shieldMods), поэтому застыть в невозможной форме не может:
 * стартовый клинок — обычный предмет, его можно снять и продать.
 *
 * ЧТО ИМЕННО ЛЕЖИТ В КОМПЛЕКТЕ, РЕШАЮТ ДАННЫЕ — и тир в том числе. Раньше
 * тир был написан здесь строкой (`rare`), и «во что одет герой на первой
 * минуте» нельзя было прочитать в `data/classes.ts` вообще. Комплект — это
 * баланс, а балансу место в данных.
 */
export function startingEquipment(hero: ClassDef): Equipment {
  const equipment = emptyEquipment()
  for (const entry of hero.startingEquipment) {
    const rarity = RARITY_BY_ID[entry.rarity]
    if (!rarity) continue
    if (entry.kind === 'armor') {
      // Броня собирается той же armorMods, что и находка: стартовая вещь —
      // обычный предмет, его можно снять, продать и заменить лучшим.
      if (entry.slot === 'mainHand' || entry.slot === 'offHand') continue
      if (!entry.attribute) continue
      equipment[entry.slot] = {
        id: `start-${entry.slot}`,
        name: ARMOR_NOUNS[entry.slot][0],
        rarity: rarity.id,
        slot: entry.slot,
        level: 1,
        mods: armorMods(entry.slot, rarity, 1, entry.attribute),
      }
      continue
    }
    if (entry.slot !== 'mainHand' && entry.slot !== 'offHand') continue
    if (!entry.templateId) continue
    if (entry.kind === 'shield') {
      const template = SHIELD_BY_ID[entry.templateId]
      if (!template) continue
      equipment[entry.slot] = {
        id: `start-${entry.slot}-${template.id}`,
        name: template.noun,
        rarity: rarity.id,
        slot: entry.slot,
        level: 1,
        grip: template.grip,
        mods: shieldMods(template, rarity),
      }
      continue
    }
    const template = WEAPON_BY_ID[entry.templateId]
    if (!template) continue
    equipment[entry.slot] = {
      id: `start-${entry.slot}-${template.id}`,
      name: template.noun,
      rarity: rarity.id,
      slot: entry.slot,
      level: 1,
      grip: template.grip,
      mods: weaponMods(template, rarity, entry.slot),
    }
  }
  return equipment
}

export function monsterFromTemplate(template: MonsterTemplate): Monster {
  return { ...template, currentHp: template.maxHp, swingProgress: 0 }
}

/**
 * УРОВЕНЬ МОБА ПРИ СПАВНЕ. Распределение — вокруг уровня героя
 * (`SPAWN_LEVEL_SPREAD` в data/monsters.ts), зажатое границами полосы зоны и
 * заново нормированное: отброшенные смещения не должны воровать вероятность
 * у оставшихся, иначе на краю полосы бросок начал бы промахиваться мимо всех
 * вариантов и падать на запасной.
 *
 * Центр — уровень героя, ПРИЖАТЫЙ к полосе: герой выше зоны получает мобов у
 * верхней границы, ниже — у нижней. Ровно один бросок rng, как и было.
 */
function rollMonsterLevel(zone: Zone, rng: Rng, heroLevel: number): number {
  // Веса считает ОДНА функция на игру и модель (`spawnLevelWeights` в
  // data/zones.ts): вторая копия распределения разошлась бы с моделью темпа
  // зоны молча, и прогноз начал бы обещать не ту игру.
  const options = spawnLevelWeights(zone, heroLevel)
  let roll = rng()
  for (const option of options) {
    roll -= option.weight
    if (roll < 0) return option.level
  }
  return options[options.length - 1].level
}

// Спавн из зоны: сперва бросок уровня, затем бросок архетипа из пула.
// Порядок бросков фиксирован — от него зависит воспроизводимость.
export function spawnMonster(zone: Zone, rng: Rng, heroLevel: number): Monster {
  const level = rollMonsterLevel(zone, rng, heroLevel)
  const pool = zone.monsterPool
  const archetype = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]
  return monsterFromTemplate(buildMonster(archetype, level, zone.rewardMultiplier))
}

export function createInitialState(
  rngSeed: number = randomSeed(),
  classId: string = DEFAULT_CLASS.id,
  saveId: number = randomSeed(),
): GameState {
  const level = new Decimal(1)
  const hero = classById(classId)
  const base: Omit<GameState, 'stats'> = {
    classId: hero.id,
    totalTicks: new Decimal(0),
    playtimeMs: new Decimal(0),
    abilityCasts: new Decimal(0),
    gold: new Decimal(0),
    level,
    currentXp: new Decimal(0),
    xpToNext: xpToNextLevel(level),
    swingProgress: 0,
    offhandSwingProgress: 0,
    currentHp: new Decimal(0), // заполняется ниже из пересчитанных статов
    currentMana: new Decimal(0),
    // Свежий герой начинает с полной маной и с уже идущей регенерацией.
    regenDelayMsLeft: 0,
    regenTickMsLeft: REGEN_TICK_S * 1000,
    gcdMsLeft: 0,
    restMsLeft: 0,
    restTotalMs: 0,
    restHpThreshold: REST_HP_THRESHOLD_DEFAULT,
    holdManaForHeal: true,
    upgradePriority: DEFAULT_UPGRADE_PRIORITY,
    purchasedUpgradeIds: [],
    lootPolicy: DEFAULT_LOOT_POLICY,
    restSpeedupSource: null,
    abilityCooldownsMs: {},
    abilityCharges: {},
    activePotions: [],
    herbProgress: {},
    enchantDust: new Decimal(0),
    procCooldownsMs: {},
    saveId,
    templeRun: null,
    templeCleared: false,
    templeBestWave: 0,
    // Литералом, а не вызовом из quests.ts: state.ts не должен зависеть от
    // модуля, который зависит от него.
    questProgress: { done: {}, counter: 0 },
    queuedAbilityId: null,
    activeEffects: [],
    abilitySlots: defaultAbilitySlots(hero.id),
    abilitySettings: defaultAbilitySettings(hero.id),
    autocastReadyMs: {},
    heroState: 'alive',
    reviveMsLeft: 0,
    talents: {},
    talentResets: 0,
    equipment: startingEquipment(hero),
    statsDirty: false,
    dungeonRun: null,
    dungeonsCleared: {},
    unlockedZoneIds: {},
    currentZoneId: SAFE_ZONE.id,
    lastSurvivedZoneId: null,
    inventory: [],
    materials: {},
    itemSeq: 0,
    rngSeed,
    // Первый моб — из безопасной зоны; поток случайности берём от того же сида,
    // что и весь прогон, поэтому старт детерминирован.
    monster: spawnMonster(SAFE_ZONE, createRng(rngSeed), level.toNumber()),
    respawnMsLeft: 0,
    combatLog: [],
    msSinceAutosave: 0,
  }
  const stats = recomputeStats(base as GameState)
  return {
    ...base,
    stats,
    currentHp: stats.maxHp,
    // Мана начинается полной, ярость — пустой. Это ДАННЫЕ класса, а не
    // условие в коде: обнули startFull, и класс начнёт с пустым ресурсом.
    currentMana: hero.resource.startFull ? stats.maxMana : new Decimal(0),
  }
}

export function pushEvent(log: CombatEvent[], event: CombatEvent): CombatEvent[] {
  return [event, ...log].slice(0, COMBAT_LOG_SIZE)
}
