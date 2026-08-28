// Правила против усталости слуха. Проверяются ЧИСЛАМИ, а не ушами:
// «на слух вроде не раздражает» — не проверка, а через час игры она перестаёт
// быть правдой у всех.
import { describe, expect, it } from 'vitest'
import { createRng } from '../game/rng'
import { duckFactor, emptyMixer, planCue } from './mixer'
import { SOUNDS, SOUND_BY_ID, type SoundCue } from '../data/sounds'
import {
  SOUND_AGGREGATE_MS,
  SOUND_DUCK_DB,
  SOUND_GAIN_MAX_DB,
  SOUND_MIN_VARIATIONS,
  SOUND_PITCH_MAX_SEMITONES,
  SOUND_PITCH_MIN_SEMITONES,
  SOUND_VOICE_LIMIT,
} from '../data/balance'

const HIT = SOUND_BY_ID.hit
const DURATION = 200

function play(cue: SoundCue, times: number, stepMs: number) {
  const rng = createRng(7)
  let state = emptyMixer()
  const plans = []
  for (let i = 0; i < times; i += 1) {
    const result = planCue(state, cue, i * stepMs, DURATION, rng)
    state = result.state
    plans.push(result.plan)
  }
  return { state, plans }
}

describe('вариативность', () => {
  it('один и тот же звук не играет дважды подряд', () => {
    // Самое заметное на слух: два одинаковых сэмпла подряд слышно сразу,
    // а дальше ухо начинает ждать третий.
    const { plans } = play(HIT, 200, SOUND_AGGREGATE_MS + 10)
    const files = plans.filter((p) => p !== null).map((p) => p!.file)
    expect(files.length).toBeGreaterThan(100)
    for (let i = 1; i < files.length; i += 1) {
      expect(files[i], `повтор на ${i}`).not.toBe(files[i - 1])
    }
  })

  it('за сотню ударов используются ВСЕ варианты, а не два из четырёх', () => {
    const { plans } = play(HIT, 100, SOUND_AGGREGATE_MS + 10)
    const used = new Set(plans.filter((p) => p !== null).map((p) => p!.file))
    expect(used.size).toBe(HIT.files.length)
  })

  it('высота и громкость гуляют, а не стоят на месте', () => {
    const { plans } = play(HIT, 50, SOUND_AGGREGATE_MS + 10)
    const rates = new Set(plans.filter((p) => p !== null).map((p) => p!.playbackRate))
    const gains = new Set(plans.filter((p) => p !== null).map((p) => p!.gain))
    expect(rates.size).toBeGreaterThan(10)
    expect(gains.size).toBeGreaterThan(10)
  })

  it('разброс высоты держится в заданных полутонах', () => {
    // Меньше полутона неотличимо от отсутствия разброса, больше трёх —
    // звук начинает читаться как ДРУГОЙ, а не как тот же с вариацией.
    const { plans } = play(HIT, 300, SOUND_AGGREGATE_MS + 10)
    for (const plan of plans) {
      if (!plan) continue
      const semitones = Math.abs(12 * Math.log2(plan.playbackRate))
      expect(semitones).toBeGreaterThanOrEqual(SOUND_PITCH_MIN_SEMITONES - 1e-9)
      expect(semitones).toBeLessThanOrEqual(SOUND_PITCH_MAX_SEMITONES + 1e-9)
    }
  })
})

describe('склейка залпов', () => {
  it(`одинаковые события в пределах ${SOUND_AGGREGATE_MS} мс звучат один раз`, () => {
    // Дуалвилд, эффекты по времени и добивание умением дают залпы в один тик.
    // Без склейки это треск, а не удары.
    const { plans } = play(HIT, 10, 10)
    expect(plans.filter((p) => p !== null).length).toBe(1)
  })

  it('за окном склейки звук снова звучит', () => {
    const rng = createRng(1)
    let state = emptyMixer()
    const first = planCue(state, HIT, 0, DURATION, rng)
    state = first.state
    const inside = planCue(state, HIT, SOUND_AGGREGATE_MS - 1, DURATION, rng)
    state = inside.state
    const outside = planCue(state, HIT, SOUND_AGGREGATE_MS + 1, DURATION, rng)
    expect(first.plan).not.toBeNull()
    expect(inside.plan).toBeNull()
    expect(outside.plan).not.toBeNull()
  })

  it('склейка НЕ мешает разным звукам: они про разное', () => {
    const rng = createRng(2)
    let state = emptyMixer()
    const hit = planCue(state, HIT, 0, DURATION, rng)
    state = hit.state
    const hurt = planCue(state, SOUND_BY_ID.hurt, 5, DURATION, rng)
    expect(hit.plan).not.toBeNull()
    expect(hurt.plan).not.toBeNull()
  })
})

describe('потолок голосов', () => {
  it(`одновременно звучит не больше ${SOUND_VOICE_LIMIT}`, () => {
    const rng = createRng(3)
    let state = emptyMixer()
    // Разные кью, чтобы не срабатывала склейка; длинные сэмплы, чтобы голоса
    // не успевали освободиться.
    for (let i = 0; i < 40; i += 1) {
      const cue = SOUNDS[i % SOUNDS.length]
      state = planCue(state, cue, i, 60_000, rng).state
      expect(state.voices.length).toBeLessThanOrEqual(SOUND_VOICE_LIMIT)
    }
  })

  it('важное вытесняет неважное, а не наоборот', () => {
    const rng = createRng(4)
    let state = emptyMixer()
    // Забиваем все голоса самыми неважными кью. Берём РАЗНЫЕ: одинаковые
    // склеились бы окном агрегации, и голоса не заполнились бы.
    const cheap = [...SOUNDS]
      .sort((a, b) => a.priority - b.priority)
      .slice(0, SOUND_VOICE_LIMIT)
    cheap.forEach((cue, i) => {
      state = planCue(state, cue, i, 60_000, rng).state
    })
    expect(state.voices.length).toBe(SOUND_VOICE_LIMIT)
    const loud = planCue(state, SOUND_BY_ID['loot-legendary'], 100, 60_000, rng)
    expect(loud.plan).not.toBeNull()
    // А обратно — нет: тихий удар в переполненный микс не лезет.
    let full = loud.state
    for (const cue of cheap) {
      const attempt = planCue(full, cue, 200, 60_000, rng)
      full = attempt.state
    }
    expect(full.voices.length).toBeLessThanOrEqual(SOUND_VOICE_LIMIT)
    expect(full.voices.some((v) => v.cueId === 'loot-legendary')).toBe(true)
  })

  it('отзвучавшие голоса освобождаются сами', () => {
    const rng = createRng(5)
    let state = emptyMixer()
    for (let i = 0; i < SOUND_VOICE_LIMIT; i += 1) {
      state = planCue(state, SOUNDS[i % SOUNDS.length], i, DURATION, rng).state
    }
    expect(state.voices.length).toBe(SOUND_VOICE_LIMIT)
    const later = planCue(state, HIT, DURATION * 10, DURATION, rng)
    expect(later.state.voices.length).toBe(1)
  })
})

describe('приглушение фона', () => {
  it('важный звук приглушает бой и не приглушает себя', () => {
    const rng = createRng(6)
    const legendary = SOUND_BY_ID['loot-legendary']
    const { state } = { state: planCue(emptyMixer(), legendary, 0, DURATION, rng).state }
    expect(state.duckUntilMs).toBe(legendary.duckMs)
    const quiet = duckFactor(state, 10, 'combat')
    expect(quiet).toBeCloseTo(Math.pow(10, SOUND_DUCK_DB / 20), 9)
    expect(duckFactor(state, 10, 'loot')).toBe(1)
    // Приглушение кончается само, без чьей-либо команды.
    expect(duckFactor(state, legendary.duckMs + 1, 'combat')).toBe(1)
  })

  it('обычный удар фон не приглушает', () => {
    const rng = createRng(6)
    const { state } = planCue(emptyMixer(), HIT, 0, DURATION, rng)
    expect(duckFactor(state, 1, 'combat')).toBe(1)
  })
})

describe('реестр звуков', () => {
  it(`либо ${SOUND_MIN_VARIATIONS} варианта, либо разброс — «ни того, ни другого» нельзя`, () => {
    for (const cue of SOUNDS) {
      const varied = cue.files.length >= SOUND_MIN_VARIATIONS
      const jittered = cue.pitchSemitones > 0 && cue.gainDb > 0
      expect(varied || jittered, `${cue.id}: один сэмпл без разброса`).toBe(true)
    }
  })

  it('разброс не выходит за границы: иначе это уже другой звук', () => {
    for (const cue of SOUNDS) {
      if (cue.pitchSemitones > 0) {
        expect(cue.pitchSemitones, cue.id).toBeGreaterThanOrEqual(SOUND_PITCH_MIN_SEMITONES)
        expect(cue.pitchSemitones, cue.id).toBeLessThanOrEqual(SOUND_PITCH_MAX_SEMITONES)
      }
      expect(cue.gainDb, cue.id).toBeLessThanOrEqual(SOUND_GAIN_MAX_DB)
    }
  })
})
