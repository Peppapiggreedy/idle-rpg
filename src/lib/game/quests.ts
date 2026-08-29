// Цепочка преквестов: правила прохождения. Ни одного «если задание такое-то»:
// ветвление здесь ТОЛЬКО по виду цели, а виды перечислимы (data/quests.ts).
//
// ПРОГРЕСС СЧИТАЕТСЯ ПО СОБЫТИЯМ, а не собственными счётчиками в тике.
// Убийство, крафт и пройденный данж игра и так объявляет событиями лога;
// задание лишь смотрит на эту ленту. Поэтому ради заданий в конвейер тика не
// добавлено ни одного нового поля — то же правило, по которому живёт прогон
// баланса: мерить наблюдаемое, а не заводить счётчик под каждый вопрос.
//
// Текста для игрока здесь нет: наружу уходят id задания и числа, строку
// «Одолеть 25 …» рисует ui/questText.ts.
import { Decimal } from './numbers'
import { applyXp, xpToNextLevel } from './formulas'
import { QUEST_CHAIN, type QuestDef, type QuestGoal, type QuestReward } from '../data/quests'
import { representativeMonster, zoneForMonsterLevel } from '../data/zones'
import { pushEvent, type GameState } from './state'
import type { CombatEvent, QuestProgress } from '../types'

/** Пустой прогресс: цепочка не начата. */
export function emptyQuestProgress(): QuestProgress {
  return { done: {}, counter: 0 }
}

export function isQuestDone(state: GameState, questId: string): boolean {
  return state.questProgress.done[questId] === true
}

/** Открыта ли цепочка вообще: до этого уровня заданий не выдают. */
export function chainUnlocked(state: GameState): boolean {
  return state.level.gte(QUEST_CHAIN.unlockLevel)
}

/** Текущее задание; null — цепочка ещё закрыта или уже пройдена целиком. */
export function activeQuest(state: GameState): QuestDef | null {
  if (!chainUnlocked(state)) return null
  return QUEST_CHAIN.quests.find((q) => !isQuestDone(state, q.id)) ?? null
}

export function chainComplete(state: GameState): boolean {
  return QUEST_CHAIN.quests.every((q) => isQuestDone(state, q.id))
}

/**
 * Отперта ли ступень лестницы открытий.
 *
 * Ступеней, запертых цепочкой, ровно столько, сколько названо в данных
 * (`opensStepId`), — ветвления по id ступени здесь нет: id приходит из
 * данных и сравнивается с данными.
 */
export function progressionGateOpen(state: GameState, stepId: string): boolean {
  return QUEST_CHAIN.opensStepId !== stepId || chainComplete(state)
}

/** Сколько нужно для цели. */
export function goalTarget(goal: QuestGoal): number {
  switch (goal.kind) {
    case 'kill':
      return goal.count
    case 'craft':
      return goal.count
    case 'dungeon':
      return 1
    case 'level':
      return goal.level
  }
}

/**
 * Сколько уже есть. Цель по уровню читается ПРЯМО ИЗ СОСТОЯНИЯ: уровень и так
 * наблюдаем, и заводить под него счётчик значило бы хранить одно и то же
 * дважды — с шансом разойтись.
 */
export function goalProgress(state: GameState, goal: QuestGoal): number {
  if (goal.kind === 'level') return Math.min(state.level.toNumber(), goal.level)
  return Math.min(state.questProgress.counter, goalTarget(goal))
}

export function goalDone(state: GameState, goal: QuestGoal): boolean {
  return goalProgress(state, goal) >= goalTarget(goal)
}

/** Сколько событий засчитывается цели. Цель по уровню событий не считает. */
function countMatches(goal: QuestGoal, events: readonly CombatEvent[]): number {
  let hits = 0
  for (const event of events) {
    switch (goal.kind) {
      case 'kill':
        // Событие несёт id архетипа и id зоны — имена в нём только для ленты.
        if (event.type === 'kill' && event.monsterId === goal.monsterId && event.zoneId === goal.zoneId) {
          hits += 1
        }
        break
      case 'craft':
        if (event.type === 'craft' && event.recipeId === goal.recipeId) hits += 1
        break
      case 'dungeon':
        if (event.type === 'dungeon-clear' && event.dungeonId === goal.dungeonId) hits += 1
        break
      case 'level':
        break
    }
  }
  return hits
}

/**
 * Награда задания в числах. Золото — столько же, сколько дают N убийств
 * типичного моба полосы, которая герою по силам; опыт — доля стоимости
 * текущего уровня. Обе величины выводятся из тех же кривых, что и весь
 * остальной доход, поэтому не могут отстать от него молча.
 */
export function questReward(state: GameState, reward: QuestReward): { gold: Decimal; xp: Decimal } {
  const zone = zoneForMonsterLevel(state.level.toNumber())
  const mob = representativeMonster(zone)
  return {
    gold: mob.goldReward.times(reward.kills).floor(),
    xp: xpToNextLevel(state.level).times(reward.levelShare).floor(),
  }
}

function completeQuest(state: GameState, quest: QuestDef): GameState {
  const reward = questReward(state, quest.reward)
  const leveled = applyXp(state.level, state.currentXp, reward.xp)
  const done = { ...state.questProgress.done, [quest.id]: true }
  const complete = QUEST_CHAIN.quests.every((q) => done[q.id] === true)
  return {
    ...state,
    gold: state.gold.plus(reward.gold),
    level: leveled.level,
    currentXp: leveled.currentXp,
    xpToNext: leveled.xpToNext,
    // Уровень — источник статов: наградной опыт мог его поднять.
    statsDirty: state.statsDirty || leveled.level.gt(state.level),
    questProgress: { done, counter: 0 },
    combatLog: pushEvent(state.combatLog, {
      type: 'quest-complete',
      questId: quest.id,
      chainComplete: complete,
    }),
  }
}

const NO_EVENTS: readonly CombatEvent[] = []

/**
 * Двигает цепочку событиями одного тика. ЧИСТАЯ: то же состояние и те же
 * события дают тот же результат, поэтому проверяется в node без игры.
 *
 * Возвращает ТОТ ЖЕ объект, если ничего не изменилось: функция зовётся каждый
 * тик, и лишняя копия состояния на ровном месте — это мусор для сборщика и
 * ложное «состояние поменялось» для подписчиков.
 */
export function advanceQuests(
  state: GameState,
  events: readonly CombatEvent[] = NO_EVENTS,
): GameState {
  let s = state
  let pending = events
  // Сдача одного задания открывает следующее, а оно может оказаться
  // выполненным прямо сейчас (цель по уровню, поднятому наградой) — отсюда
  // цикл. События при этом засчитываются РОВНО ОДИН РАЗ, текущему заданию:
  // «добил моба и заодно закрыл следующее задание» было бы подарком из
  // ниоткуда. Предел цикла — длина цепочки, дальше закрывать нечего.
  for (let guard = 0; guard <= QUEST_CHAIN.quests.length; guard += 1) {
    const quest = activeQuest(s)
    if (!quest) return s
    const gained = countMatches(quest.goal, pending)
    pending = NO_EVENTS
    if (gained > 0) {
      s = {
        ...s,
        questProgress: { ...s.questProgress, counter: s.questProgress.counter + gained },
      }
    }
    if (!goalDone(s, quest.goal)) return s
    s = completeQuest(s, quest)
  }
  return s
}

/** Как показать задание в панели. Текст к этому рисует UI. */
export interface QuestStatus {
  quest: QuestDef
  /** 'done' — сдано, 'active' — текущее, 'locked' — ещё не выдано. */
  stage: 'done' | 'active' | 'locked'
  progress: number
  target: number
}

export function questStatuses(state: GameState): QuestStatus[] {
  const active = activeQuest(state)
  return QUEST_CHAIN.quests.map((quest) => ({
    quest,
    stage: isQuestDone(state, quest.id) ? 'done' : quest === active ? 'active' : 'locked',
    progress: isQuestDone(state, quest.id) ? goalTarget(quest.goal) : goalProgress(state, quest.goal),
    target: goalTarget(quest.goal),
  }))
}

export { QUEST_CHAIN }
export type { QuestDef, QuestGoal, QuestReward } from '../data/quests'


