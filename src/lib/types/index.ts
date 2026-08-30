import type { IconName } from '../ui/icons/manifest'
// TypeScript-типы и интерфейсы игры. Decimal берётся только из game/numbers.
// Игровые величины — Decimal; служебные (version, lastTimestamp, счётчики) — number.
import type { Decimal } from '../game/numbers'
import type { StatModifier } from '../game/stats'
import type { DungeonDifficulty } from '../data/dungeons'
import type { SlotId } from '../data/slots'
import type { Grip } from '../data/items'

export interface Monster {
  id: string
  name: string
  level: number // уровень моба; от него масштабируются hp, урон и награды
  maxHp: Decimal
  currentHp: Decimal
  goldReward: Decimal
  xpReward: Decimal
  damageMin: Decimal // нижняя граница урона по герою; 0/0 — моб не атакует
  damageMax: Decimal // верхняя граница урона по герою
  swingTime: number // секунд между ударами моба (у мобов нет оружия — время замаха задано прямо)
  swingProgress: number // доля замаха моба 0..1 (runtime, в шаблоне отсутствует)
}

// Шаблон моба для src/lib/data: без runtime-полей — они появляются при спавне.
export type MonsterTemplate = Omit<Monster, 'currentHp' | 'swingProgress'>

// Описание апгрейда для src/lib/data: цена растёт как baseCost * costGrowth^owned.
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

export interface Item {
  /** ХВАТ: 'one' — в любую руку, 'two' — обе руки, 'shield' — только вторая.
   *  Нет поля — предмет вообще не идёт в руки (броня, талисман). Хват
   *  приходит ИЗ ШАБЛОНА и отдельным броском не разыгрывается. */
  grip?: Grip
  id: string
  name: string
  rarity: Rarity
  slot: SlotId
  /** Уровень предмета = уровень моба, с которого он упал. Сила предмета
   *  растёт от него линейно (itemLevelScale в data/balance.ts). Ограничен
   *  уровнями мобов, поэтому обычный number, а не Decimal. */
  level: number
  // Модификаторы предмета в формате конвейера статов. У оружия среди них
  // ОБЯЗАТЕЛЬНО три kind: 'base' — weaponSpeed, weaponDamageMin, weaponDamageMax.
  mods: StatModifier[]
  /** Наложенное зачарование (id из data/enchants.ts). Ровно одно: новое
   *  затирает старое. Нет поля — предмет не зачарован. Модификаторы
   *  зачарования В mods НЕ КОПИРУЮТСЯ — их разворачивает enchantModifiers
   *  внутри конвейера, иначе снять зачарование было бы нечем. */
  enchantId?: string
  /** Прок вещи (data/procs.ts). Сама механика живёт в game/combat.ts, предмет
   *  только называет id: так один прок нельзя описать дважды по-разному,
   *  а внутренний кулдаун у него один на всю игру. */
  procId?: string
}

// Структурированные события боя для лога. Логика их эмитит,
// весь текст для игрока рендерит UI.
export type CombatEvent =
  | { type: 'hit'; damage: Decimal; isCrit: boolean }
  // Удар умения: id, а не имя — текст рендерит UI по данным умения.
  | { type: 'ability'; abilityId: string; damage: Decimal; isCrit: boolean }
  // Тик эффекта (урон по времени) от умения abilityId.
  | { type: 'effect'; abilityId: string; damage: Decimal }
  // Убийство несёт и ID моба с зоной: по ним считается прогресс заданий,
  // а имя остаётся для лога. Раньше id тут не было — и это было исключением
  // из общего правила «событие несёт id, а текст рендерит UI».
  | {
      type: 'kill'
      monsterId: string
      monsterName: string
      zoneId: string
      gold: Decimal
      xp: Decimal
    }
  | { type: 'levelup'; level: Decimal }
  | { type: 'loot'; item: Item }
  // Находка не поместилась в сумку и ушла в золото сама. Отдельный код,
  // а не «продажа»: игрок этого не выбирал, и знать об этом он обязан.
  | { type: 'autosell'; item: Item; gold: Decimal }
  // Сумка полна, но находка ЛУЧШЕ надетого: место освободил худший
  // непригодный предмет. Апгрейд потерять нельзя ни при каких настройках.
  | { type: 'loot-swap'; item: Item; dropped: Item; gold: Decimal }
  | { type: 'spawn'; monsterName: string }
  | { type: 'hurt'; damage: Decimal; monsterName: string }
  | { type: 'death' }
  | { type: 'revive' }
  // Смена зоны: 'travel' — по воле игрока, 'retreat' — откат после смерти.
  | { type: 'zone'; zoneName: string; reason: 'travel' | 'retreat' }
  // Данж: очередной босс цепочки, выход наружу, полное прохождение.
  | {
      type: 'boss'
      bossName: string
      index: number
      total: number
      difficulty: DungeonDifficulty
    }
  | { type: 'dungeon-exit'; defeated: boolean }
  | {
      type: 'dungeon-clear'
      dungeonId: string
      dungeonName: string
      difficulty: DungeonDifficulty
      firstClear: boolean
    }
  // Способность героического босса сработала. `damage` есть только у отдачи.
  | { type: 'boss-ability'; abilityId: string; damage?: Decimal }
  | { type: 'enrage'; bossName: string; multiplier: number }
  // Привал: управляемая пауза по порогу. 'interrupted' — игрок прервал сам,
  // и восстановление вышло частичным.
  // Блок щитом: `damage` — что прошло, `blocked` — что снял щит.
  // `reflected` появляется только у героя с талантом-отражением: щит
  // возвращает долю поглощённого обратно в моба.
  | {
      type: 'block'
      damage: Decimal
      blocked: Decimal
      reflected?: Decimal
      monsterName: string
    }
  // Материал с моба и собранный рецепт: id, текст рендерит UI.
  | { type: 'material'; materialId: string }
  | { type: 'craft'; recipeId: string }
  // Зелья: id рецепта, текст рендерит UI. Сбор трав события НЕ порождает —
  // это фон, а не событие, и ленте боя шуршать травой незачем.
  | { type: 'potion'; recipeId: string }
  | { type: 'potion-expired'; recipeId: string }
  // Распыление и зачарование: id и предмет, текст рендерит UI.
  | { type: 'disenchant'; item: Item; dust: Decimal }
  | { type: 'enchant'; itemName: string; enchantId: string }
  // Прок: что сработало и на сколько. Текст рендерит UI.
  | { type: 'proc'; procId: string; effect: 'damage' | 'heal'; amount: Decimal }
  // Храм испытаний: начало забега, пройденная волна (record — новый рекорд),
  // открытый рубежом рецепт и конец забега.
  | { type: 'temple-start'; templeName: string }
  | { type: 'temple-wave'; wave: number; record: boolean }
  // Итог завершённого забега храма: докуда дошёл и что за это начислено.
  | {
      type: 'temple-result'
      reached: number
      dust: number
      gold: Decimal
      fullClear: boolean
    }
  | { type: 'temple-reward'; recipeId: string; wave: number }
  | { type: 'temple-end'; wave: number; defeated: boolean }
  // Задание цепочки сдано. chainComplete поднимается один раз — на последнем.
  | { type: 'quest-complete'; questId: string; chainComplete: boolean }
  | { type: 'rest-start' }
  | { type: 'rest-end'; interrupted: boolean }

// Активный забег по данжу. Хранится в состоянии и в сейве: цепочку можно
// продолжить после перезагрузки, но не после смерти внутри.
export interface DungeonRun {
  dungeonId: string
  /** Сложность забега. Обычная и героическая — один и тот же данж и один и
   *  тот же id, но разные числа и разные достижения. */
  difficulty: DungeonDifficulty
  bossIndex: number
  fightMs: number // сколько идёт бой с текущим боссом; от него ярость
}

/**
 * Прогресс цепочки преквестов. Ключ — id задания, а НЕ номер в цепочке:
 * вставка задания в середину не должна сдвигать чужой прогресс, ровно как
 * у dungeonsCleared. `counter` — счётчик ТЕКУЩЕГО задания (убийств, крафтов);
 * это служебное число, а не игровая величина, поэтому обычный number.
 */
export interface QuestProgress {
  done: Record<string, boolean>
  counter: number
}

/** Забег по храму: волна, сутки попытки, сид и уровень героя на входе. */
export interface TempleRun {
  templeId: string
  /** Номер этажа, с первого. Тот, на котором герой стоит СЕЙЧАС. */
  wave: number
  /**
   * Последний ПОЛНОСТЬЮ пройденный этаж этого забега. Живёт в забеге, а не в
   * рекорде: рекорд поднимает только завершение забега, и брошенный забег
   * уносит пройденное с собой.
   */
  cleared: number
  seed: number
  /** Уровень героя НА ВХОДЕ: подстройка бойцов не едет вслед за левелапом. */
  level: number
}

// Событие одного удара для шины game/events.ts (всплывающие числа урона и т.п.).
export interface AttackEvent {
  sourceId: string
  targetId: string
  amount: Decimal
  isCrit: boolean
  abilityId: string | null // авто-атака = null; умение — его id
  /**
   * Тик урона по времени, а не удар. Ресурс класса на ярости копится от
   * УДАРОВ: тик кровотечения ударом не является, иначе одно умение с
   * эффектом кормило бы ресурс втрое лучше остальных.
   */
  overTime?: boolean
  /** Сработавший прок (data/procs.ts). Удар прока замахом НЕ считается —
   *  ресурс копится от замахов героя, а не от того, что сработало само. */
  procId?: string
  timestamp: number // игровое время (playtimeMs) на момент удара
}
