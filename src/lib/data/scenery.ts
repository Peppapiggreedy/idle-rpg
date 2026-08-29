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
  /**
   * Форма-примитив. ОБЯЗАТЕЛЬНА даже там, где есть модель: примитив встаёт
   * сразу, модель заменяет его, когда доедет. Не доехала — зона всё равно
   * выглядит зоной. То же правило, что у бойцов.
   */
  shape: PropShape
  /** Id пропса из data/assets.ts. Нет — кластер так и останется примитивом. */
  model?: string
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

// --- Зоны второй половины лестницы -------------------------------------
// Один набор примитивов плюс пропсы из KayKit дают одиннадцать разных мест,
// не рисуя ни одной картинки. Цвет и плотность тумана — главное, что их
// различает: место узнаётся раньше, чем прочитано его название.

/** Ржавые борозды: рыжая глина, брошенные бочки. */
export const FURROWS_SCENE: SceneConfig = {
  fogColor: 0x2b2118,
  fogDensity: 0.055,
  groundColor: 0x4a3826,
  lightColor: 0xffdca8,
  lightIntensity: 2,
  lightAngleDeg: 70,
  ambientIntensity: 0.6,
  props: [
    { shape: 'stump', model: 'prop-barrel', count: 12, scaleRange: [0.8, 1.3], color: 0x6b4a2c },
    { shape: 'rock', count: 8, scaleRange: [0.4, 1.0], color: 0x5a4636 },
  ],
  seed: 6120,
}

/** Стеклянная пустошь: холодный свет, битые кристаллы. */
export const GLASSWASTE_SCENE: SceneConfig = {
  fogColor: 0x1b2030,
  fogDensity: 0.05,
  groundColor: 0x2b3242,
  lightColor: 0xcfe0ff,
  lightIntensity: 2.1,
  lightAngleDeg: 150,
  ambientIntensity: 0.55,
  props: [
    { shape: 'crystal', count: 16, scaleRange: [0.6, 1.8], color: 0x5f7fae },
    { shape: 'rock', model: 'prop-rubble', count: 8, scaleRange: [0.7, 1.4], color: 0x3f4757 },
  ],
  seed: 6420,
}

/** Обвал старой шахты: пыль, обломки, брошенные ящики. */
export const COLLAPSE_SCENE: SceneConfig = {
  fogColor: 0x211d1a,
  fogDensity: 0.085,
  groundColor: 0x332e28,
  lightColor: 0xffd9a8,
  lightIntensity: 1.5,
  lightAngleDeg: 250,
  ambientIntensity: 0.4,
  props: [
    { shape: 'rock', model: 'prop-rubble', count: 16, scaleRange: [0.6, 1.6], color: 0x5c554a },
    { shape: 'stump', model: 'prop-crates', count: 6, scaleRange: [0.7, 1.2], color: 0x6a5334 },
  ],
  seed: 6733,
}

/** Затопленный ярус: вода по щиколотку, колонны в тумане. */
export const FLOODED_SCENE: SceneConfig = {
  fogColor: 0x101d24,
  fogDensity: 0.105,
  groundColor: 0x1c2e36,
  lightColor: 0x9fd0e8,
  lightIntensity: 1.3,
  lightAngleDeg: 20,
  ambientIntensity: 0.42,
  props: [
    { shape: 'stump', model: 'prop-column', count: 10, scaleRange: [0.9, 1.5], color: 0x4a5460 },
    { shape: 'rock', count: 10, scaleRange: [0.4, 1.1], color: 0x28363c },
  ],
  seed: 7014,
}

/** Пепельная терраса: выше гребня, жарче и суше. */
export const TERRACE_SCENE: SceneConfig = {
  fogColor: 0x33170f,
  fogDensity: 0.07,
  groundColor: 0x46281d,
  lightColor: 0xff9a5c,
  lightIntensity: 2.6,
  lightAngleDeg: 300,
  ambientIntensity: 0.4,
  props: [
    { shape: 'crystal', count: 10, scaleRange: [0.8, 1.9], color: 0xa8452c },
    { shape: 'stump', model: 'prop-pillar', count: 6, scaleRange: [0.8, 1.3], color: 0x6b4234 },
  ],
  seed: 7311,
}

/** Соляной провал: белёсая земля, глухая тишина. */
export const SALTPIT_SCENE: SceneConfig = {
  fogColor: 0x2b2c2a,
  fogDensity: 0.09,
  groundColor: 0x50514c,
  lightColor: 0xf2f0e4,
  lightIntensity: 1.7,
  lightAngleDeg: 190,
  ambientIntensity: 0.5,
  props: [
    { shape: 'rock', count: 18, scaleRange: [0.5, 1.5], color: 0x6f7069 },
    { shape: 'stump', model: 'prop-keg', count: 5, scaleRange: [0.7, 1.2], color: 0x585a52 },
  ],
  seed: 7620,
}

/** Стылая гряда: последняя зона лестницы, темнее и холоднее всех. */
export const RIMEBACK_SCENE: SceneConfig = {
  fogColor: 0x121a26,
  fogDensity: 0.115,
  groundColor: 0x1f2a38,
  lightColor: 0xb9d6ff,
  lightIntensity: 1.1,
  lightAngleDeg: 130,
  ambientIntensity: 0.32,
  props: [
    { shape: 'crystal', count: 14, scaleRange: [0.7, 2.0], color: 0x6c86b8 },
    { shape: 'stump', model: 'prop-chest', count: 4, scaleRange: [0.8, 1.2], color: 0x4a3a28 },
  ],
  seed: 7911,
}

/**
 * Подсветка при ярости босса: чем сильнее ярость, тем сильнее сцену
 * заливает тревожным светом. Число — доля подмешивания, не игровая величина.
 */
export const ENRAGE_TINT = 0xff5a3c
export const ENRAGE_TINT_MAX = 0.55
