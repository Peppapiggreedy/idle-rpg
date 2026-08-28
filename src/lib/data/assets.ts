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

/**
 * Пропс — модель БЕЗ анимаций: бочка, ящик, обломок. Отдельный тип, а не
 * ModelAsset с четырьмя null: клипы у пропса не «отсутствуют», их у него
 * не бывает, и требовать маппинг состояний от бочки бессмысленно.
 *
 * Пропсы обязательны только на бумаге: сцена ставит примитив СРАЗУ и
 * заменяет его моделью, когда та доедет. Не доехала — остаётся примитив,
 * и зона по-прежнему выглядит зоной. Это то же правило, что у бойцов.
 */
export interface PropAsset {
  id: string
  path: string
  license: string
  author: string
  sourceUrl: string
  /** Целевая высота на площадке, м. Реальный масштаб считается по модели. */
  targetHeight: number
}

/**
 * Пропсы из KayKit Dungeon Remastered — тот же автор и та же лицензия, что
 * у героя и мобов. Третий пак от Kay Lousberg взят намеренно: единый стиль
 * важнее разнообразия источников (тот же довод, что и у персонажей).
 */
export const PROP_ASSETS: PropAsset[] = [
  {
    id: 'prop-barrel',
    path: 'models/props/barrel_large.glb',
    license: 'CC0 1.0',
    author: 'Kay Lousberg',
    sourceUrl: 'https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0',
    targetHeight: 1.2,
  },
  {
    id: 'prop-crates',
    path: 'models/props/crates_stacked.glb',
    license: 'CC0 1.0',
    author: 'Kay Lousberg',
    sourceUrl: 'https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0',
    targetHeight: 1.6,
  },
  {
    id: 'prop-rubble',
    path: 'models/props/rubble_large.glb',
    license: 'CC0 1.0',
    author: 'Kay Lousberg',
    sourceUrl: 'https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0',
    targetHeight: 0.7,
  },
  {
    id: 'prop-pillar',
    path: 'models/props/pillar.glb',
    license: 'CC0 1.0',
    author: 'Kay Lousberg',
    sourceUrl: 'https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0',
    targetHeight: 3,
  },
  {
    id: 'prop-column',
    path: 'models/props/column.glb',
    license: 'CC0 1.0',
    author: 'Kay Lousberg',
    sourceUrl: 'https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0',
    targetHeight: 2.6,
  },
  {
    id: 'prop-keg',
    path: 'models/props/keg.glb',
    license: 'CC0 1.0',
    author: 'Kay Lousberg',
    sourceUrl: 'https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0',
    targetHeight: 1,
  },
  {
    id: 'prop-chest',
    path: 'models/props/chest.glb',
    license: 'CC0 1.0',
    author: 'Kay Lousberg',
    sourceUrl: 'https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0',
    targetHeight: 0.9,
  },
]

export const PROP_BY_ID: Record<string, PropAsset> = Object.fromEntries(
  PROP_ASSETS.map((p) => [p.id, p]),
)
