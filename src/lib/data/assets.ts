// Реестр моделей: что грузим, откуда взято и как это ставить на площадку.
//
// ЗАЧЕМ РЕЕСТР. Имена анимационных клипов внутри файла придумал не я:
// у KayKit это `1H_Melee_Attack_Chop`, у RobotExpressive из three.js —
// `Punch`, у Fox — `Run`. Если бы сцена знала эти имена, замена модели
// требовала бы правок в коде рендера, а промах в имени давал бы немую
// сцену без единой ошибки. Поэтому имена живут ЗДЕСЬ, а сцена оперирует
// игровыми состояниями: idle / attack / hit / death.
//
// Ни одного строкового имени клипа за пределами этого файла быть не должно —
// закреплено тестом.

/** Игровое состояние бойца, для которого нужен клип. */
export type ActorState = 'idle' | 'attack' | 'hit' | 'death'

/**
 * Маппинг состояния на имя клипа В ФАЙЛЕ.
 * null — у модели такого клипа нет, и сцена деградирует осмысленно:
 * нет `death` — вместо анимации короткая вспышка, нет `hit` — только
 * отдача и вспышка попадания.
 */
export type ClipMap = Record<ActorState, string | null>

export interface ModelAsset {
  id: string
  /** Путь от корня сайта; base подставляется загрузчиком. */
  path: string
  license: string
  author: string
  sourceUrl: string
  /**
   * ТОНКАЯ подстройка размера, около 1. Основной масштаб считается сам,
   * по измеренной высоте модели: у разных паков разные единицы, и держать
   * это число вручную значило бы подбирать его заново под каждую модель.
   * Здесь только поправка «этот чуть крупнее/мельче, чем должен быть».
   */
  scale: number
  /** Сдвиг по вертикали, м: ноги модели не всегда в начале координат. */
  yOffset: number
  clips: ClipMap
  /** Отдельная строка о лицензии, если она сложнее одной ссылки. */
  licenseNote?: string
}

/**
 * Герой. Knight из KayKit Adventurers: рыцарь подходит воину, и это ОДИН
 * источник с мобами — единый стиль важнее разнообразия.
 * GLB самодостаточен: ни внешнего .bin, ни отдельных текстур.
 */
export const HERO_MODEL: ModelAsset = {
  id: 'hero-knight',
  path: 'models/Knight.glb',
  license: 'CC0 1.0',
  author: 'Kay Lousberg',
  sourceUrl: 'https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0',
  scale: 1,
  yOffset: 0,
  clips: {
    idle: 'Idle',
    attack: '1H_Melee_Attack_Chop',
    hit: 'Hit_A',
    death: 'Death_A',
  },
}

/**
 * Моб. Skeleton_Minion из KayKit Skeletons — тот же автор, тот же стиль,
 * та же лицензия.
 */
export const MONSTER_MODEL: ModelAsset = {
  id: 'monster-skeleton',
  path: 'models/Skeleton_Minion.glb',
  license: 'CC0 1.0',
  author: 'Kay Lousberg',
  sourceUrl: 'https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0',
  scale: 1,
  yOffset: 0,
  clips: {
    idle: 'Idle',
    attack: '1H_Melee_Attack_Chop',
    hit: 'Hit_A',
    death: 'Death_A',
  },
}

export const MODEL_ASSETS: ModelAsset[] = [HERO_MODEL, MONSTER_MODEL]
