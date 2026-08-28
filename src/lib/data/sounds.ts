// Реестр звуков. ДАННЫЕ: путь к файлу, категория, разброс высоты и громкости,
// приоритет и то, ЧТО звук сообщает игроку.
//
// Здесь нет ни одной строки логики воспроизведения: расписание считает чистый
// `audio/mixer.ts`, играет `audio/engine.ts`. Игровая логика про звук не знает
// вовсе — менеджер сидит на шине событий и читает состояние.
//
// Правила против усталости слуха живут в двух местах: числа — здесь и в
// data/balance.ts, проверки на них — в content:check и audio/mixer.test.ts.
// Час в одной зоне — это тысячи ударов, и одинаковый сэмпл на каждом из них
// превращает игру в дрель.
import type { CombatEvent } from '../types'

export type SoundCategory = 'combat' | 'loot' | 'ui'

/**
 * Что звук СООБЩАЕТ. Не украшение: на этом поле держится запрет на
 * «почти получилось» и на победные сигналы у потерь. Проиграть под фанфары —
 * приём игровых автоматов, а не игры.
 */
export type SoundValence = 'good' | 'bad' | 'neutral'

export interface SoundCue {
  id: string
  category: SoundCategory
  /** Файлы-варианты, пути от корня сайта. */
  files: readonly string[]
  /** Разброс высоты, полутонов в каждую сторону. 0 — без разброса. */
  pitchSemitones: number
  /** Разброс громкости, дБ в каждую сторону. 0 — без разброса. */
  gainDb: number
  /** Базовая громкость кью относительно категории, дБ. */
  levelDb: number
  /** Кого вытеснять при переполнении голосов: чем больше, тем важнее. */
  priority: number
  valence: SoundValence
  /** На сколько мс приглушить остальные категории. 0 — не приглушать. */
  duckMs: number
}

const UI = (name: string) => `audio/ui/${name}.ogg`
const DIGITAL = (name: string) => `audio/digital/${name}.ogg`

export const SOUNDS: SoundCue[] = [
  // --- Бой ---
  {
    // Самый частый звук в игре: четыре варианта И разброс, а не «или».
    id: 'hit',
    category: 'combat',
    files: [DIGITAL('zap1'), DIGITAL('zap2'), DIGITAL('laser4'), DIGITAL('laser5')],
    pitchSemitones: 2,
    gainDb: 3,
    levelDb: -6,
    priority: 1,
    valence: 'neutral',
    duckMs: 0,
  },
  {
    id: 'crit',
    category: 'combat',
    files: [DIGITAL('phaserUp5'), DIGITAL('phaseJump1')],
    pitchSemitones: 2,
    gainDb: 2,
    levelDb: -3,
    priority: 4,
    valence: 'good',
    duckMs: 0,
  },
  {
    id: 'ability',
    category: 'combat',
    files: [DIGITAL('laser1'), DIGITAL('laser2'), DIGITAL('laser3')],
    pitchSemitones: 2,
    gainDb: 3,
    levelDb: -4,
    priority: 3,
    valence: 'neutral',
    duckMs: 0,
  },
  {
    id: 'hurt',
    category: 'combat',
    files: [
      DIGITAL('spaceTrash1'),
      DIGITAL('spaceTrash2'),
      DIGITAL('spaceTrash3'),
      DIGITAL('lowDown'),
    ],
    pitchSemitones: 2,
    gainDb: 3,
    levelDb: -6,
    priority: 2,
    valence: 'bad',
    duckMs: 0,
  },
  {
    // Блок — отдельный звук от удара: игрок должен слышать, что щит сработал,
    // не глядя в лог. Это по-прежнему потеря HP, поэтому valence 'bad'.
    id: 'block',
    category: 'combat',
    files: [UI('switch16'), UI('switch21')],
    pitchSemitones: 2,
    gainDb: 3,
    levelDb: -5,
    priority: 2,
    valence: 'bad',
    duckMs: 0,
  },
  {
    id: 'kill',
    category: 'combat',
    files: [DIGITAL('phaserDown1'), DIGITAL('phaserDown2'), DIGITAL('phaserDown3')],
    pitchSemitones: 1,
    gainDb: 2,
    levelDb: -3,
    priority: 5,
    valence: 'good',
    duckMs: 0,
  },
  {
    id: 'death',
    category: 'combat',
    files: [DIGITAL('lowThreeTone')],
    pitchSemitones: 1,
    gainDb: 2,
    levelDb: 0,
    priority: 9,
    valence: 'bad',
    duckMs: 700,
  },
  {
    id: 'levelup',
    category: 'combat',
    files: [DIGITAL('powerUp3')],
    pitchSemitones: 1,
    gainDb: 2,
    levelDb: 0,
    priority: 9,
    valence: 'good',
    duckMs: 700,
  },
  {
    id: 'rest-start',
    category: 'combat',
    files: [DIGITAL('highDown')],
    pitchSemitones: 1,
    gainDb: 2,
    levelDb: -4,
    priority: 6,
    valence: 'neutral',
    duckMs: 0,
  },
  {
    id: 'rest-end',
    category: 'combat',
    files: [DIGITAL('highUp')],
    pitchSemitones: 1,
    gainDb: 2,
    levelDb: -4,
    priority: 6,
    valence: 'neutral',
    duckMs: 0,
  },

  // --- Лут: по звуку на тир редкости ---
  // Второе кодирование редкости. Цвет уже есть (data/rarity.ts), но цвет
  // требует смотреть на экран, а игра идёт в фоне. Тир слышно, не глядя.
  {
    id: 'loot-common',
    category: 'loot',
    files: [DIGITAL('pepSound1')],
    pitchSemitones: 2,
    gainDb: 3,
    levelDb: -8,
    priority: 2,
    valence: 'neutral',
    duckMs: 0,
  },
  {
    id: 'loot-uncommon',
    category: 'loot',
    files: [DIGITAL('pepSound2')],
    pitchSemitones: 2,
    gainDb: 3,
    levelDb: -6,
    priority: 3,
    valence: 'good',
    duckMs: 0,
  },
  {
    id: 'loot-rare',
    category: 'loot',
    files: [DIGITAL('twoTone1')],
    pitchSemitones: 1,
    gainDb: 2,
    levelDb: -4,
    priority: 5,
    valence: 'good',
    duckMs: 0,
  },
  {
    id: 'loot-epic',
    category: 'loot',
    files: [DIGITAL('threeTone1')],
    pitchSemitones: 1,
    gainDb: 2,
    levelDb: -2,
    priority: 7,
    valence: 'good',
    duckMs: 900,
  },
  {
    id: 'loot-legendary',
    category: 'loot',
    files: [DIGITAL('powerUp12')],
    // Разброс минимальный, но НЕ ноль: правило «либо четыре варианта, либо
    // разброс» держится без исключений. Исключение «этот звук всё равно
    // редкий» пришлось бы оценивать на глаз, а на глаз оценивают неверно.
    pitchSemitones: 1,
    gainDb: 2,
    levelDb: 0,
    priority: 10,
    valence: 'good',
    duckMs: 1200,
  },

  // --- Интерфейс ---
  {
    id: 'ui-click',
    category: 'ui',
    files: [UI('click1'), UI('click2'), UI('click3'), UI('click4'), UI('click5')],
    pitchSemitones: 1,
    gainDb: 2,
    levelDb: -8,
    priority: 1,
    valence: 'neutral',
    duckMs: 0,
  },
  {
    id: 'ui-toggle',
    category: 'ui',
    files: [UI('switch3'), UI('switch5')],
    pitchSemitones: 2,
    gainDb: 3,
    levelDb: -8,
    priority: 1,
    valence: 'neutral',
    duckMs: 0,
  },
  {
    id: 'ui-deny',
    category: 'ui',
    files: [UI('rollover1'), UI('rollover2')],
    pitchSemitones: 2,
    gainDb: 3,
    levelDb: -8,
    priority: 1,
    valence: 'bad',
    duckMs: 0,
  },
]

export const SOUND_BY_ID: Record<string, SoundCue> = Object.fromEntries(
  SOUNDS.map((s) => [s.id, s]),
)

/**
 * Какое событие боя каким кью озвучивается.
 *
 * Озвучены НЕ ВСЕ события намеренно: 'spawn', 'zone', 'effect' и прочее идут
 * потоком, и звук на каждом превратился бы в шум. Молчание — тоже решение.
 * Лута здесь нет: его кью выбирается по редкости (см. data/rarity.ts).
 */
export const EVENT_CUES: Partial<Record<CombatEvent['type'], string>> = {
  hit: 'hit',
  ability: 'ability',
  hurt: 'hurt',
  block: 'block',
  kill: 'kill',
  death: 'death',
  levelup: 'levelup',
  'rest-start': 'rest-start',
  'rest-end': 'rest-end',
}

/**
 * События, которые для игрока — ПОТЕРЯ. У их звуков не может быть valence
 * 'good': «проиграл под фанфары» — приём игровых автоматов, а не игры.
 * Список держится руками и проверяется content:check.
 */
export const LOSS_EVENTS: readonly CombatEvent['type'][] = ['hurt', 'block', 'death']
