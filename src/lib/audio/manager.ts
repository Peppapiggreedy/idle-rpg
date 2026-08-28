// Менеджер звука: сидит на шине событий и превращает их в решения миксера.
//
// ЖЕЛЕЗНОЕ ПРАВИЛО, то же, что у сцены: слой звука ТОЛЬКО ЧИТАЕТ. Ни одного
// экшена, ни одной записи в игровое состояние. Логика про звук не знает
// вовсе — она эмитит события, а кто на них подписан, ей неизвестно.
//
// Всё, что здесь решается, решается ЧИСТЫМИ функциями: какое событие каким
// кью озвучивается, слышно ли сейчас вообще и что именно проиграть. Движок
// (audio/engine.ts) только исполняет.
import { EVENT_CUES, SOUND_BY_ID, type SoundCue } from '../data/sounds'
import { RARITY_BY_ID } from '../data/rarity'
import { emptyMixer, planCue, duckFactor, type CuePlan, type MixerState } from './mixer'
import { subscribeLog } from '../game/events'
import type { CombatEvent } from '../types'

/** Условия, при которых звук вообще слышен. Все — снаружи игровой логики. */
export interface AudioGate {
  /** Был ли жест игрока. До него браузер всё равно не даст звука. */
  unlocked: boolean
  /** Общая громкость больше нуля. */
  enabled: boolean
  /** Вкладка спрятана. */
  hidden: boolean
  /** Множитель скорости отладочной панели. */
  speed: number
  /** Текстовый режим. */
  textMode: boolean
}

/**
 * Слышно ли сейчас.
 *
 * Молчим на ускорении: на ×5 звуки идут впятеро чаще и сливаются в треск —
 * это не «быстрее играть», это «сломать уши». Молчим в спрятанной вкладке:
 * игра в фоне не должна пищать поверх чужой музыки. Молчим в текстовом
 * режиме: его выбирают ради тишины и слабой машины.
 */
export function isAudible(gate: AudioGate): boolean {
  return gate.unlocked && gate.enabled && !gate.hidden && !gate.textMode && gate.speed <= 1
}

/**
 * Кью для события лога. Лут озвучивается ПО РЕДКОСТИ — это второе кодирование
 * тира: цвет требует смотреть на экран, а игра идёт в фоне.
 */
export function cueForEvent(event: CombatEvent): SoundCue | null {
  if (event.type === 'loot') return SOUND_BY_ID[RARITY_BY_ID[event.item.rarity].sound] ?? null
  // Крит — свой звук: иначе он ничем не отличался бы от обычного удара, и
  // самое приятное событие боя проходило бы мимо ушей.
  if (event.type === 'hit' && event.isCrit) return SOUND_BY_ID.crit ?? null
  if (event.type === 'ability' && event.isCrit) return SOUND_BY_ID.crit ?? null
  const id = EVENT_CUES[event.type]
  return id ? (SOUND_BY_ID[id] ?? null) : null
}

/** Что умеет движок. Тесты подставляют свой — WebAudio в node не нужен. */
export interface SoundEngine {
  /** Длина сэмпла в мс; 0 — файл ещё не загружен. */
  durationMs(file: string): number
  /** Проиграть. `duck` — во сколько раз приглушить (1 — не приглушать). */
  play(plan: CuePlan, duck: number): void
}

export interface SoundPlayerOptions {
  engine: SoundEngine
  gate: () => AudioGate
  now: () => number
  /** Свой поток случайности: поток симуляции вычерпывать нельзя. */
  rng: () => number
}

/**
 * Проигрыватель кью: держит состояние миксера и ворота.
 *
 * Отдельно от подписки, чтобы его можно было гонять в тестах по шагам —
 * ровно так и проверяются правила против усталости слуха.
 */
export class SoundPlayer {
  private mixer: MixerState = emptyMixer()
  constructor(private readonly options: SoundPlayerOptions) {}

  /** Сколько кью реально прозвучало (нужно тестам и отладке). */
  cue(cue: SoundCue | null): CuePlan | null {
    if (!cue) return null
    if (!isAudible(this.options.gate())) return null
    const now = this.options.now()
    const duration = this.options.engine.durationMs(cue.files[0]) || DEFAULT_DURATION_MS
    const { state, plan } = planCue(this.mixer, cue, now, duration, this.options.rng)
    this.mixer = state
    if (plan) this.options.engine.play(plan, duckFactor(state, now, cue.category))
    return plan
  }

  event(event: CombatEvent): CuePlan | null {
    return this.cue(cueForEvent(event))
  }

  events(list: readonly CombatEvent[]): void {
    for (const event of list) this.event(event)
  }

  /** Звук интерфейса: его шлёт UI напрямую, событий боя у него нет. */
  ui(id: 'ui-click' | 'ui-toggle' | 'ui-deny'): CuePlan | null {
    return this.cue(SOUND_BY_ID[id] ?? null)
  }
}

// Пока файл не загружен, длину не знаем. Полсекунды — не «примерно правда»,
// а осознанный потолок: голос освободится чуть раньше или чуть позже, и на
// потолок голосов это влияет мягко.
const DEFAULT_DURATION_MS = 500

/** Подписка на шину лога. Возвращает функцию отписки. */
export function listenToGame(player: SoundPlayer): () => void {
  return subscribeLog((events) => player.events(events))
}
