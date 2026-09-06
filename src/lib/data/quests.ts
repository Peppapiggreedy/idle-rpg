// Цепочка преквестов к рейду — данные.
//
// ЗАЧЕМ ОНА ЕСТЬ. Между восьмидесятым и сотым уровнями игроку остаётся одно
// занятие — бить мобов лучшей зоны, пока не наберётся уровень. Цепочка
// превращает эти двадцать уровней в МАРШРУТ: сходи туда, скуй это, пройди
// вот тот данж. Ни одного нового боевого правила она не вводит — только
// называет порядок, в котором стоит делать то, что уже есть.
//
// ЦЕЛЬ ЗАДАНИЯ БЫВАЕТ ЧЕТЫРЁХ ВИДОВ, и это закрытый список. Логика ветвится
// по ВИДУ цели и никогда по id задания (game/quests.ts), поэтому новое
// задание — правка только этого файла.
//
// Пятого вида — «пройти героику» — здесь намеренно НЕТ. Героический режим
// в игре ещё не появился, наблюдаемого события у него тоже, и задание,
// которое нечем закрыть, заперло бы врата рейда навсегда. Появится режим —
// появится вид цели и строка в этой цепочке; до тех пор обещать нечего.
//
// ОФФЛАЙН ЗАДАНИЯ НЕ ДВИГАЕТ. Оффлайн — агрегат, событий убийства он не
// порождает вовсе, и это то же правило, что у данжа: цепочка сама себя не
// проходит. Специального кода для этого не нужно — достаточно того, что
// прогресс считается по событиям.
import type { IconName } from '../ui/icons/manifest'

/**
 * Что именно требует задание. Видов ровно четыре, и они перечислимы:
 * `game/quests.ts` разбирает их одним switch, и компилятор не даст забыть
 * новый вид ни в одном из мест.
 */
export type QuestGoal =
  // Убить N мобов КОНКРЕТНОГО архетипа в КОНКРЕТНОЙ зоне. Два id, а не один:
  // «двадцать скрипунов» без места — это не маршрут, а тот же фарм.
  | { kind: 'kill'; monsterId: string; zoneId: string; count: number }
  // Пройти цепочку боссов данжа целиком.
  | { kind: 'dungeon'; dungeonId: string }
  // Собрать рецепт N раз.
  | { kind: 'craft'; recipeId: string; count: number }
  // Достичь уровня. Счётчика не требует: уровень и так лежит в состоянии.
  | { kind: 'level'; level: number }

/** Виды целей списком — по нему content:check и UI обходят их все. */
export const QUEST_GOAL_KINDS = ['kill', 'dungeon', 'craft', 'level'] as const


/**
 * Награда в ЕДИНИЦАХ ИГРОКА, а не в голых числах.
 *
 * `kills` — во столько убийств типичного моба своей полосы обойдётся та же
 * сумма, `levelShare` — какую долю текущего уровня закрывает опыт. Так
 * награда едет вместе с кривой (data/balance.ts) и множителями зон: поправили
 * их — задание не начало врать. Записанные руками «50 000 золота» отстали бы
 * от игры молча, ровно как отстала бы формула опыта от таблицы убийств.
 */
export interface QuestReward {
  kills: number
  levelShare: number
}

export interface QuestDef {
  id: string
  name: string
  /** Иконка. Тип выведен из реестра: опечатка — ошибка проверки типов. */
  icon: IconName
  /** Одна строка лора. Условие цели UI собирает из самой цели, а не отсюда. */
  flavor: string
  goal: QuestGoal
  reward: QuestReward
}

export interface QuestChainDef {
  id: string
  name: string
  /** С какого уровня героя выдаётся ПЕРВОЕ задание цепочки. */
  unlockLevel: number
  /**
   * Ступень лестницы открытий, которую отпирает пройденная цепочка.
   * Ссылка живёт ЗДЕСЬ, а не в data/progression.ts: лестница описывает, что
   * появится и когда, а условие входа — свойство цепочки. Проверяется
   * content:check, поэтому переименованная ступень не отвалится молча.
   */
  opensStepId: string
  /** Порядок фиксирован: задания выдаются сверху вниз, по одному. */
  quests: QuestDef[]
}

// Семь заданий на двадцать уровней: примерно одно на три уровня, и каждое
// отправляет в другое место карты. Два задания «достичь уровня» стоят не для
// объёма — они ГАРАНТИРУЮТ уровень для следующего шага цепочки: без
// девяностого не открыт восьмой данж, а без сотого нечего открывать рейду.
// Эту гарантию проверяет content:check, а не внимательность.
export const QUEST_CHAIN: QuestChainDef = {
  id: 'gates-of-the-bluff',
  name: 'Врата Немой кручи',
  unlockLevel: 80,
  opensStepId: 'step-raid',
  quests: [
    {
      id: 'emery-toll',
      name: 'Наждачная подать',
      icon: 'zone-emery-stack',
      flavor: 'Скрипуны точат останец до сквозной дыры. Проредить — и станет слышно, что за ним.',
      goal: { kind: 'kill', monsterId: 'emery-creaker', zoneId: 'emery-stack', count: 25 },
      reward: { kills: 30, levelShare: 0.4 },
    },
    {
      id: 'rime-ward',
      name: 'Стылый заслон',
      icon: 'profession-smithing',
      flavor: 'К вратам не ходят с голой рукой. Заслон куют из своей руды и своей соли.',
      goal: { kind: 'craft', recipeId: 'forged-bulwark', count: 1 },
      reward: { kills: 40, levelShare: 0.4 },
    },
    {
      id: 'catacomb-descent',
      name: 'Спуск в катакомбы',
      icon: 'dungeon-rime-catacombs',
      flavor: 'Наледный исполин держит первую половину ключа. Отдаст только целиком.',
      goal: { kind: 'dungeon', dungeonId: 'rime-catacombs' },
      reward: { kills: 60, levelShare: 0.6 },
    },
    {
      id: 'hollow-vigil',
      name: 'Дозор в Порожней пади',
      icon: 'zone-hollow-dell',
      flavor: 'Горбыли сползают в падь с той стороны кручи. Значит, там есть та сторона.',
      goal: { kind: 'kill', monsterId: 'drift-slab', zoneId: 'hollow-dell', count: 30 },
      reward: { kills: 70, levelShare: 0.5 },
    },
    {
      id: 'verge-mettle',
      name: 'Проба кромки',
      icon: 'xp',
      flavor: 'Кромка не пускает тех, кто дошёл до неё случайно.',
      goal: { kind: 'level', level: 90 },
      reward: { kills: 90, levelShare: 0.5 },
    },
    {
      id: 'bellringer-silence',
      name: 'Молчание звонаря',
      icon: 'dungeon-bluff-hollow',
      flavor: 'Немой звонарь держит вторую половину ключа и звонит без звука.',
      goal: { kind: 'dungeon', dungeonId: 'bluff-hollow' },
      reward: { kills: 120, levelShare: 0.6 },
    },
    {
      id: 'gatekeepers-word',
      name: 'Слово привратника',
      icon: 'raid-gate',
      flavor: 'Ключ собран. Осталось дорасти до того, кому его вручают.',
      goal: { kind: 'level', level: 100 },
      // Опыта на потолке нет по определению (xpToNextLevel = 0), поэтому доля
      // нулевая: обещать полоску, которой больше не существует, нечестно.
      reward: { kills: 200, levelShare: 0 },
    },
  ],
}

/** Задания цепочки в порядке выдачи. */
export const QUESTS: readonly QuestDef[] = QUEST_CHAIN.quests

export const QUEST_BY_ID: Record<string, QuestDef> = Object.fromEntries(
  QUEST_CHAIN.quests.map((q) => [q.id, q]),
)


