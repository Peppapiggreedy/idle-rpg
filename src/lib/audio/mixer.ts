// Расписание звука: ЧИСТАЯ функция, никакого WebAudio.
//
// Здесь живут все правила против усталости слуха — вариант, разброс, склейка
// залпов, потолок голосов, приглушение фона. Отдельно от движка они потому,
// что проверять их надо в node, а не глазами и ушами: «на слух вроде не
// раздражает» — не проверка.
//
// Случайность СВОИМ потоком (как у расстановки пропсов сцены): вычерпывать
// поток симуляции из звука нельзя — ход игры стал бы зависеть от того,
// включён ли звук.
import {
  SOUND_AGGREGATE_MS,
  SOUND_DUCK_DB,
  SOUND_PITCH_MIN_SEMITONES,
  SOUND_VOICE_LIMIT,
} from '../data/balance'
import type { SoundCategory, SoundCue } from '../data/sounds'

/** Звучащий прямо сейчас голос. */
export interface MixerVoice {
  cueId: string
  priority: number
  /** Игровое время, когда голос освободится. */
  endsAtMs: number
}

export interface MixerState {
  /** Какой файл кью играл прошлый раз: два одинаковых подряд запрещены. */
  lastFile: Record<string, string>
  /** Когда кью звучал прошлый раз: по нему склеиваются залпы. */
  lastAtMs: Record<string, number>
  voices: MixerVoice[]
  /** До какого момента фон приглушён. */
  duckUntilMs: number
}

export function emptyMixer(): MixerState {
  return { lastFile: {}, lastAtMs: {}, voices: [], duckUntilMs: 0 }
}

/** Что именно проиграть. Движок только исполняет — решений он не принимает. */
export interface CuePlan {
  cueId: string
  category: SoundCategory
  file: string
  /** Множитель скорости воспроизведения: он же сдвиг высоты. */
  playbackRate: number
  /** Линейная громкость 0..1 относительно категории. */
  gain: number
  /** Приглушить остальные категории до этого момента (0 — не приглушать). */
  duckUntilMs: number
}

export interface PlanResult {
  state: MixerState
  /** null — звук НЕ играется: склеен с предыдущим или вытеснен по голосам. */
  plan: CuePlan | null
}


const dbToGain = (db: number): number => Math.pow(10, db / 20)

/** Разброс высоты: 1..pitchSemitones полутонов в случайную сторону. */
function playbackRate(cue: SoundCue, rng: () => number): number {
  if (cue.pitchSemitones <= 0) return 1
  const span = Math.max(0, cue.pitchSemitones - SOUND_PITCH_MIN_SEMITONES)
  const magnitude = SOUND_PITCH_MIN_SEMITONES + rng() * span
  const sign = rng() < 0.5 ? -1 : 1
  return Math.pow(2, (sign * magnitude) / 12)
}

/** Вариант, ОТЛИЧНЫЙ от прошлого: одинаковый звук подряд слышно сразу. */
function pickFile(cue: SoundCue, previous: string | undefined, rng: () => number): string {
  const pool = cue.files.length > 1 ? cue.files.filter((f) => f !== previous) : cue.files
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]
}

/**
 * Освободить отзвучавшие голоса. Отдельной функции нет: голос живёт ровно
 * столько, сколько длится файл, и никакого «стоп» движок не шлёт.
 */
function alive(voices: MixerVoice[], nowMs: number): MixerVoice[] {
  return voices.filter((v) => v.endsAtMs > nowMs)
}

/**
 * Решение по одному кью.
 *
 * `durationMs` — длина сэмпла: её знает движок (буфер уже декодирован), а
 * миксер только считает, когда голос освободится.
 */
export function planCue(
  state: MixerState,
  cue: SoundCue,
  nowMs: number,
  durationMs: number,
  rng: () => number,
): PlanResult {
  const voices = alive(state.voices, nowMs)

  // 1. Склейка залпа: одинаковые события в пределах окна звучат ОДИН раз.
  const last = state.lastAtMs[cue.id]
  if (last !== undefined && nowMs - last < SOUND_AGGREGATE_MS) {
    return { state: { ...state, voices }, plan: null }
  }

  // 2. Потолок голосов: новый звук вытесняет только МЕНЕЕ важный.
  let kept = voices
  if (voices.length >= SOUND_VOICE_LIMIT) {
    const weakest = voices.reduce((min, v) => (v.priority < min.priority ? v : min), voices[0])
    if (weakest.priority >= cue.priority) return { state: { ...state, voices }, plan: null }
    kept = voices.filter((v) => v !== weakest)
  }

  const file = pickFile(cue, state.lastFile[cue.id], rng)
  const rate = playbackRate(cue, rng)
  // Разброс громкости в дБ, а не в долях: слух логарифмичен, и «±3 дБ»
  // одинаково слышно и у тихого кью, и у громкого.
  const jitterDb = cue.gainDb > 0 ? (rng() * 2 - 1) * cue.gainDb : 0
  const duckUntilMs = cue.duckMs > 0 ? Math.max(state.duckUntilMs, nowMs + cue.duckMs) : state.duckUntilMs

  return {
    state: {
      lastFile: { ...state.lastFile, [cue.id]: file },
      lastAtMs: { ...state.lastAtMs, [cue.id]: nowMs },
      voices: [...kept, { cueId: cue.id, priority: cue.priority, endsAtMs: nowMs + durationMs }],
      duckUntilMs,
    },
    plan: {
      cueId: cue.id,
      category: cue.category,
      file,
      playbackRate: rate,
      gain: dbToGain(cue.levelDb + jitterDb),
      duckUntilMs,
    },
  }
}

/** Во сколько раз приглушён фон прямо сейчас. 1 — не приглушён. */
export function duckFactor(state: MixerState, nowMs: number, category: SoundCategory): number {
  if (nowMs >= state.duckUntilMs) return 1
  // Приглушается ФОН, а не то, ради чего приглушали: находка высокого тира
  // не должна тонуть в собственном приглушении.
  return category === 'loot' ? 1 : dbToGain(SOUND_DUCK_DB)
}

