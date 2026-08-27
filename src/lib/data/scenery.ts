// Как выглядит зона: атмосфера сцены как ДАННЫЕ.
//
// Почему цвета здесь, а не в ui/tokens.css. Токены — единственный источник
// величин ИНТЕРФЕЙСА: панелей, текста, кнопок. Атмосфера зоны — это контент,
// такой же как названия мобов и их награда: болото зелёное, а пепельный
// гребень рыжий не потому, что так решил дизайн интерфейса, а потому что
// это разные места мира. Прецедент уже есть — цвета редкостей живут
// в data/rarity.ts по ровно той же причине.
//
// Один набор примитивов плюс разные палитра, туман, свет и расстановка дают
// визуально разные места, не рисуя ни одной картинки. Расстановка
// процедурная и с ФИКСИРОВАННЫМ сидом: одна зона всегда выглядит одинаково.

/** Форма пропса. Моделей нет — только примитивы, как и во всей сцене. */
export type PropShape = 'tree' | 'rock' | 'stump' | 'crystal'

export interface PropCluster {
  shape: PropShape
  count: number
  /** Разброс размера: множитель к базовому размеру формы. */
  scaleRange: [number, number]
  /** Цвет. Один на кластер: разнобой в мелочи на площадке только шумит. */
  color: number
}

export interface SceneConfig {
  /** Цвет тумана и фона: он же задаёт настроение места. */
  fogColor: number
  /** Плотность экспоненциального тумана: чем выше, тем теснее место. */
  fogDensity: number
  /** Цвет площадки. */
  groundColor: number
  /** Направленный свет: цвет, сила и угол по горизонтали в градусах. */
  lightColor: number
  lightIntensity: number
  lightAngleDeg: number
  /** Заливка. Низкая делает место мрачным, высокая — открытым. */
  ambientIntensity: number
  props: PropCluster[]
  /** Сид расстановки. Меняешь — меняется вид зоны, и это осознанное решение. */
  seed: number
}

/** Пастуший луг: открыто, светло, трава и редкие деревья. */
export const MEADOW_SCENE: SceneConfig = {
  fogColor: 0x1a2418,
  fogDensity: 0.045,
  groundColor: 0x2f4029,
  lightColor: 0xfff3d6,
  lightIntensity: 2.2,
  lightAngleDeg: 45,
  ambientIntensity: 0.7,
  props: [
    { shape: 'tree', count: 14, scaleRange: [0.8, 1.6], color: 0x3c5a30 },
    { shape: 'rock', count: 6, scaleRange: [0.4, 0.9], color: 0x555f52 },
  ],
  seed: 1041,
}

/** Полая каменоломня: камень, пыль, ни одного дерева. */
export const QUARRY_SCENE: SceneConfig = {
  fogColor: 0x26221d,
  fogDensity: 0.06,
  groundColor: 0x3a352d,
  lightColor: 0xffe6c0,
  lightIntensity: 1.9,
  lightAngleDeg: 110,
  ambientIntensity: 0.55,
  props: [
    { shape: 'rock', count: 20, scaleRange: [0.5, 1.8], color: 0x6b6357 },
    { shape: 'stump', count: 4, scaleRange: [0.6, 1.0], color: 0x4a4136 },
  ],
  seed: 2077,
}

/** Топкие лощины: тесно, сыро, туман гуще всего. */
export const MIREFEN_SCENE: SceneConfig = {
  fogColor: 0x13221f,
  fogDensity: 0.095,
  groundColor: 0x24352f,
  lightColor: 0xbfe4d8,
  lightIntensity: 1.4,
  lightAngleDeg: 200,
  ambientIntensity: 0.5,
  props: [
    { shape: 'tree', count: 18, scaleRange: [1.0, 2.2], color: 0x2d4038 },
    { shape: 'stump', count: 10, scaleRange: [0.5, 1.1], color: 0x3a3229 },
  ],
  seed: 3313,
}

/** Пепельный гребень: жар, кристаллы, выжженная земля. */
export const ASHEN_SCENE: SceneConfig = {
  fogColor: 0x2a1714,
  fogDensity: 0.075,
  groundColor: 0x3b2822,
  lightColor: 0xffb27a,
  lightIntensity: 2.4,
  lightAngleDeg: 320,
  ambientIntensity: 0.45,
  props: [
    { shape: 'crystal', count: 12, scaleRange: [0.7, 1.7], color: 0x8c3a2e },
    { shape: 'rock', count: 10, scaleRange: [0.5, 1.4], color: 0x4a352c },
  ],
  seed: 4201,
}

/**
 * Данж. Он не зона и своей записи в ZONES не имеет, но выглядеть обязан
 * отчётливо иначе: темнее всего, туман плотный, света мало — под землёй.
 */
export const DUNGEON_SCENE: SceneConfig = {
  fogColor: 0x0d0f14,
  fogDensity: 0.13,
  groundColor: 0x1b1e26,
  lightColor: 0x8fa4d8,
  lightIntensity: 1.2,
  lightAngleDeg: 90,
  ambientIntensity: 0.3,
  props: [
    { shape: 'rock', count: 14, scaleRange: [0.6, 1.6], color: 0x2a2f3a },
    { shape: 'crystal', count: 6, scaleRange: [0.5, 1.2], color: 0x3d4a72 },
  ],
  seed: 5150,
}

/**
 * Подсветка при ярости босса: чем сильнее ярость, тем сильнее сцену
 * заливает тревожным светом. Число — доля подмешивания, не игровая величина.
 */
export const ENRAGE_TINT = 0xff5a3c
export const ENRAGE_TINT_MAX = 0.55
