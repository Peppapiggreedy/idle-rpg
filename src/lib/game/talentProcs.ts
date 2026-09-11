// ПРОК — ТРИГГЕР ПЛЮС ВРЕМЕННАЯ ПРИБАВКА, И ЖИВЁТ ОН ЦЕЛИКОМ В ДАННЫХ.
//
// Здесь только машинерия: поднять событие, отсчитать заряды, завести окно,
// дотикать его и отдать прибавку конвейеру статов. ЧТО именно откликается и
// на что — лежит в `data/talents.ts` закрытыми списками (`ProcTrigger`,
// `ProcEffect`), и ни одной ветки по id таланта здесь нет.
//
// ПОЧЕМУ ПРИБАВКА ИДЁТ ЧЕРЕЗ КОНВЕЙЕР СТАТОВ, А НЕ МИМО. Через конвейер её
// видят ВСЕ разом: тик, модель боя, оффлайн, обе оси героя и карточка. Мимо —
// видел бы только тик, и оффлайн (он считается моделью) врал бы на величину
// прока, а правило «оффлайн ≤ автокаст ≤ ручная игра» ломалось бы молча.
//
// ОКНО ПРОКА В СЕЙВ НЕ ПИШЕТСЯ — как стойка, щит и метки на мобе: после
// загрузки нет ни того боя, ни той секунды.
import { Decimal } from './numbers'
import { TALENTS, rankOf, type ProcBonus, type ProcTrigger } from '../data/talents'
import { applyModifiers, type StatBlock, type StatModifier } from './stats'
import type { GameState, TalentProcState } from './state'

/** Приставка источника модификатора: по ней модель их и вычищает. */
export const PROC_SOURCE = 'proc:'

/** Талант-прок с уже посчитанным рангом: всё, что нужно и тику, и модели. */
export interface TakenProc {
  talentId: string
  rank: number
  trigger: ProcTrigger
  /** На каждом N-м событии; единица — на каждом. */
  everyNth: number
  effect: ProcBonus
}

/**
 * Проки, которые у героя ВЗЯТЫ. Поиск по ИМЕНИ ФЛАГА, а не по id таланта:
 * два класса поднимут один и тот же прок разными талантами и с разными
 * числами, и логике всё равно, каким именно.
 */
export function takenProcs(ranks: Readonly<Record<string, number>>): TakenProc[] {
  const out: TakenProc[] = []
  for (const talent of TALENTS) {
    const effect = talent.effect
    if (effect.kind !== 'flag' || effect.flag !== 'proc') continue
    const rank = rankOf(ranks, talent.id)
    if (rank <= 0) continue
    out.push({
      talentId: talent.id,
      rank,
      trigger: effect.trigger,
      everyNth: Math.max(1, Math.round(effect.everyNth ?? 1)),
      effect: effect.effect,
    })
  }
  return out
}

/** Величина прибавки с учётом ранга: как у модификаторов и правок умений. */
function valueOf(proc: TakenProc): number {
  return proc.effect.value * proc.rank
}

function emptyState(talentId: string): TalentProcState {
  return { talentId, msLeft: 0, swingsLeft: 0, charges: 0 }
}

function find(procs: readonly TalentProcState[], talentId: string): TalentProcState {
  return procs.find((p) => p.talentId === talentId) ?? emptyState(talentId)
}

/** Окно прока открыто: тикает по времени или по замахам. */
export function isProcOpen(state: TalentProcState): boolean {
  return state.msLeft > 0 || state.swingsLeft > 0
}

/**
 * СОБЫТИЕ СЛУЧИЛОСЬ. Возвращает новый список окон; тот же объект — значит не
 * изменилось ничего, и статы пересчитывать не надо.
 *
 * ЗАРЯДЫ СЧИТАЮТСЯ ДАЖЕ У ОТКРЫТОГО ОКНА, а окно ПЕРЕОТКРЫВАЕТСЯ с полной
 * длиной. Иначе прок, у которого окно длиннее промежутка между событиями,
 * копил бы заряды впустую, а игрок читал бы это как «не работает».
 */
export function fireProcs(
  procs: readonly TalentProcState[],
  taken: readonly TakenProc[],
  trigger: ProcTrigger,
): TalentProcState[] {
  let changed = false
  const next = procs.slice()
  for (const proc of taken) {
    if (proc.trigger !== trigger) continue
    const at = next.findIndex((p) => p.talentId === proc.talentId)
    const current = at === -1 ? emptyState(proc.talentId) : next[at]
    const charges = current.charges + 1
    if (charges < proc.everyNth) {
      const bumped = { ...current, charges }
      if (at === -1) next.push(bumped)
      else next[at] = bumped
      changed = true
      continue
    }
    const opened: TalentProcState = {
      talentId: proc.talentId,
      charges: 0,
      msLeft: proc.effect.kind === 'stat' ? proc.effect.durationSec * 1000 : 0,
      swingsLeft: proc.effect.kind === 'stat-swings' ? Math.max(1, Math.round(proc.effect.swings)) : 0,
    }
    if (at === -1) next.push(opened)
    else next[at] = opened
    changed = true
  }
  return changed ? next : (procs as TalentProcState[])
}

/** Окна по времени — за тик. Тот же объект, если ничего не изменилось. */
export function advanceProcs(procs: readonly TalentProcState[], dtMs: number): TalentProcState[] {
  if (procs.length === 0) return procs as TalentProcState[]
  let changed = false
  const next = procs.map((p) => {
    if (p.msLeft <= 0) return p
    changed = true
    return { ...p, msLeft: Math.max(0, p.msLeft - dtMs) }
  })
  return changed ? next : (procs as TalentProcState[])
}

/** Замах героя съедает один шаг у окон, которые меряются замахами. */
export function spendProcSwing(procs: readonly TalentProcState[]): TalentProcState[] {
  if (procs.length === 0) return procs as TalentProcState[]
  let changed = false
  const next = procs.map((p) => {
    if (p.swingsLeft <= 0) return p
    changed = true
    return { ...p, swingsLeft: p.swingsLeft - 1 }
  })
  return changed ? next : (procs as TalentProcState[])
}

/**
 * Прибавки ОТКРЫТЫХ окон — в конвейер статов. Источник называет талант, и
 * раскладка статов показывает игроку, откуда взялось число.
 */
export function procModifiers(state: Pick<GameState, 'talents' | 'talentProcs'>): StatModifier[] {
  if (state.talentProcs.length === 0) return []
  const mods: StatModifier[] = []
  for (const proc of takenProcs(state.talents)) {
    const open = find(state.talentProcs, proc.talentId)
    if (!isProcOpen(open)) continue
    mods.push({
      stat: proc.effect.stat,
      kind: 'flat',
      value: new Decimal(valueOf(proc)),
      source: `${PROC_SOURCE}${proc.talentId}`,
    })
  }
  return mods
}

/**
 * СКОЛЬКО ВРЕМЕНИ ОКНО ОТКРЫТО В СРЕДНЕМ — для модели боя.
 *
 * Модель не знает про «сейчас»: её вход — статы и моб, а не секунда боя.
 * Поэтому прок входит в неё ДОЛЕЙ ВРЕМЕНИ, как метки умений в `abilityMods`,
 * и доля эта считается первым порядком.
 *
 * ДВА СЛУЧАЯ, И ОНИ РАЗНЫЕ:
 *   • окно на N ЗАМАХОВ от события с вероятностью p на замах — доля замахов,
 *     попавших в окно, равна 1 − (1−p)^N: ровно вероятность того, что хотя бы
 *     одно из N предыдущих событий случилось;
 *   • окно на D СЕКУНД — частота события × D, зажатая единицей.
 *
 * ЧАСТОТА СОБЫТИЯ БЕРЁТСЯ ИЗ СТАТОВ ГЕРОЯ, И ЭТО ОНА ЗАДАЛА СПИСОК ТРИГГЕРОВ,
 * а не наоборот: удар и крит считаются из замаха и шанса крита, то есть из
 * статов, и потому лежат в `ProcTrigger`; полученный удар, блок и убийство
 * зависят от противника и от темпа боя — от того, что модель ещё только
 * считает, — и потому в списке их нет вовсе (причина записана рядом с ним, в
 * `data/talents.ts`).
 */
export function procUptime(proc: TakenProc, stats: StatBlock): number {
  const swingTime = stats.swingTime > 0 ? stats.swingTime : 1
  // ОБА СОБЫТИЯ СЧИТАЮТСЯ ИЗ ЗАМАХА ГЕРОЯ, и список `ProcTrigger` закрыт
  // ровно по этому признаку: попадание — каждый замах, крит — его доля.
  const perSwing = proc.trigger === 'crit' ? Math.min(1, Math.max(0, stats.critChance)) : 1
  if (perSwing <= 0) return 0
  // Заряды режут частоту ровно во столько раз, во сколько их нужно набрать.
  const chance = perSwing / proc.everyNth
  if (proc.effect.kind === 'stat-swings') {
    const swings = Math.max(1, Math.round(proc.effect.swings))
    return 1 - Math.pow(1 - Math.min(1, chance), swings)
  }
  const perSec = chance / swingTime
  return Math.min(1, perSec * proc.effect.durationSec)
}

/** Прибавки прока по СРЕДНЕМУ аптайму — то, чем модель заменяет «сейчас». */
export function averageProcModifiers(
  state: Pick<GameState, 'talents'>,
  stats: StatBlock,
): StatModifier[] {
  const mods: StatModifier[] = []
  for (const proc of takenProcs(state.talents)) {
    const uptime = procUptime(proc, stats)
    if (uptime <= 0) continue
    mods.push({
      stat: proc.effect.stat,
      kind: 'flat',
      value: new Decimal(valueOf(proc) * uptime),
      source: `${PROC_SOURCE}${proc.talentId}`,
    })
  }
  return mods
}

// Кеш по объекту статов — как у зелий: пересчёт конвейера на каждый вызов
// модели стоил бы дороже самой модели.
const MODEL_STATS = new WeakMap<StatBlock, StatBlock>()

/**
 * СТАТЫ ДЛЯ МОДЕЛИ: вместо окон, открытых ПРЯМО СЕЙЧАС, — их средняя доля.
 *
 * Без подмены модель считала бы героя то с проком, то без, в зависимости от
 * того, в какую миллисекунду её позвали: оценка зоны прыгала бы в бою, а
 * сравнение предметов меняло бы ответ между двумя ударами.
 *
 * Героя БЕЗ проков это не касается вовсе: список пуст, и возвращается тот же
 * объект статов, бит в бит.
 */
export function statsForModel(
  state: Pick<GameState, 'talents' | 'talentProcs' | 'stats'>,
  base: StatBlock,
  modifiers: () => StatModifier[],
): StatBlock {
  const taken = takenProcs(state.talents)
  if (taken.length === 0) return base
  const cached = MODEL_STATS.get(base)
  if (cached) return cached
  const withoutProcs = modifiers().filter((m) => !m.source.startsWith(PROC_SOURCE))
  const computed = applyModifiers([...withoutProcs, ...averageProcModifiers(state, base)])
  MODEL_STATS.set(base, computed)
  return computed
}
