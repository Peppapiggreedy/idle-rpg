// Реестр ассетов двумерной боевой сцены: спрайты бойцов и фоны зон.
//
// Сцена не знает имён файлов: она спрашивает у реестра «какой спрайт у этого
// архетипа» и «какой фон у этой полосы уровней». Поэтому замена заглушки на
// настоящую картинку — правка ОДНОЙ строки здесь, а не поход по компонентам.
// Пути, автор, лицензия и источник обязательны у каждой записи (этого требуют
// лицензии, см. CREDITS.md); ссылки «архетип → спрайт», «спрайт → файл» и
// сплошность полос держит `npm run content:check`.
//
// Сейчас все картинки — цветные силуэты-заглушки, нарисованные для проекта.

export interface SpriteAsset {
  id: string
  /** Путь от корня public/: `sprites/<файл>.svg`. */
  path: string
  author: string
  license: string
  sourceUrl: string
}

/** Фон одной полосы уровней: включительно от minLevel до maxLevel. */
export interface BackgroundBand extends SpriteAsset {
  minLevel: number
  maxLevel: number
}

const PLACEHOLDER = {
  author: 'Idle RPG (силуэт-заглушка)',
  license: 'CC0-1.0',
  sourceUrl: 'https://github.com/Peppapiggreedy/idle-rpg/tree/main/public/sprites',
} as const

export const HERO_SPRITE: SpriteAsset = {
  id: 'hero',
  path: 'sprites/hero.svg',
  ...PLACEHOLDER,
}

/** Силуэты мобов: по одному на роль плюс босс и запасной. */
export const MONSTER_SPRITES: readonly SpriteAsset[] = [
  { id: 'runt', path: 'sprites/monster-runt.svg', ...PLACEHOLDER },
  { id: 'common', path: 'sprites/monster-common.svg', ...PLACEHOLDER },
  { id: 'brute', path: 'sprites/monster-brute.svg', ...PLACEHOLDER },
  { id: 'boss', path: 'sprites/monster-boss.svg', ...PLACEHOLDER },
  { id: 'unknown', path: 'sprites/monster-unknown.svg', ...PLACEHOLDER },
]

/** Спрайт любого босса данжа и героики: боссы — одна сущность с мобами, но выглядят иначе. */
export const BOSS_SPRITE_ID = 'boss'

/** Спрайт для моба, которого в маппинге нет: сцена не падает, а показывает тень. */
export const FALLBACK_SPRITE_ID = 'unknown'

/**
 * Архетип моба → спрайт. Ключи — id архетипов из data/zones.ts; каждый
 * архетип из пула любой зоны обязан быть здесь, а каждое значение — быть id
 * из MONSTER_SPRITES. Держится проверкой контента в обе стороны.
 */
export const MONSTER_SPRITE_BY_ARCHETYPE: Readonly<Record<string, string>> = {
  // Пастуший луг
  'meadow-squelcher': 'common',
  'pasture-tick': 'runt',
  'straw-lumberer': 'brute',
  // Полая каменоломня
  'stone-gnawer': 'runt',
  'dust-digger': 'common',
  'rumbling-caver': 'brute',
  // Ржавые борозды
  'rust-chewer': 'runt',
  'furrow-stalker': 'common',
  'clay-heaver': 'brute',
  // Топкие лощины
  'silt-crawler': 'runt',
  rotfang: 'common',
  'bog-drifter': 'brute',
  // Стеклянная пустошь
  'shard-skitter': 'runt',
  'pane-walker': 'common',
  'prism-lurker': 'brute',
  // Пепельный гребень
  'ember-stinger': 'runt',
  'ash-walker': 'common',
  'flint-colossus': 'brute',
  // Обвал старой шахты
  'scree-nibbler': 'runt',
  'shaft-lurcher': 'common',
  'beam-breaker': 'brute',
  // Корневые своды
  'root-borer': 'runt',
  'marsh-puffer': 'common',
  'bole-oaf': 'brute',
  // Затопленный ярус
  'brack-nipper': 'runt',
  'tide-wader': 'common',
  'column-clinger': 'brute',
  // Плесневый горизонт
  'punkwood-midge': 'runt',
  'damp-bracket': 'common',
  'rot-uproot': 'brute',
  // Серные ключи
  'steam-hisser': 'runt',
  'sulfur-fumer': 'common',
  'mud-bruiser': 'brute',
  // Пепельная терраса
  'cinder-flit': 'runt',
  'terrace-strider': 'common',
  'slag-bearer': 'brute',
  // Продувной перевал
  'ledge-hopper': 'runt',
  'pass-cutter': 'common',
  'weathered-hunch': 'brute',
  // Полынный увал
  'wormwood-chirper': 'runt',
  'dust-scraper': 'common',
  'drywind-crag': 'brute',
  // Соляной провал
  'brine-gnat': 'runt',
  'salt-treader': 'common',
  'crust-hauler': 'brute',
  // Наждачный останец
  'whirl-flaker': 'runt',
  'emery-creaker': 'common',
  'weathered-boulderer': 'brute',
  // Стылая гряда
  'frost-nibbler': 'runt',
  'rime-walker': 'common',
  'glacier-brute': 'brute',
  // Мёрзлое криволесье
  'needle-snapper': 'runt',
  'brittle-breaker': 'common',
  'frozen-snag': 'brute',
  // Порожняя падь
  'tussock-rustler': 'runt',
  'hollow-wheezer': 'common',
  'drift-slab': 'brute',
  // Немая круча
  'crevice-scraper': 'runt',
  'verge-patroller': 'common',
  'craggy-idol': 'brute',
}

/**
 * Фоны по полосам уровней: десять картинок, по одной на две зоны. Полосы
 * идут подряд без дыр и наложений от первого уровня до потолка — иначе моб
 * какого-то уровня остался бы без фона; сплошность держит проверка контента.
 */
export const BACKGROUND_BANDS: readonly BackgroundBand[] = [
  { id: 'meadow', minLevel: 1, maxLevel: 10, path: 'sprites/bg-meadow.svg', ...PLACEHOLDER },
  { id: 'furrows', minLevel: 11, maxLevel: 20, path: 'sprites/bg-furrows.svg', ...PLACEHOLDER },
  { id: 'glass', minLevel: 21, maxLevel: 30, path: 'sprites/bg-glass.svg', ...PLACEHOLDER },
  { id: 'mines', minLevel: 31, maxLevel: 40, path: 'sprites/bg-mines.svg', ...PLACEHOLDER },
  { id: 'flood', minLevel: 41, maxLevel: 50, path: 'sprites/bg-flood.svg', ...PLACEHOLDER },
  { id: 'sulfur', minLevel: 51, maxLevel: 60, path: 'sprites/bg-sulfur.svg', ...PLACEHOLDER },
  { id: 'pass', minLevel: 61, maxLevel: 70, path: 'sprites/bg-pass.svg', ...PLACEHOLDER },
  { id: 'salt', minLevel: 71, maxLevel: 80, path: 'sprites/bg-salt.svg', ...PLACEHOLDER },
  { id: 'rime', minLevel: 81, maxLevel: 90, path: 'sprites/bg-rime.svg', ...PLACEHOLDER },
  { id: 'dell', minLevel: 91, maxLevel: 100, path: 'sprites/bg-dell.svg', ...PLACEHOLDER },
]

export const MONSTER_SPRITE_BY_ID: Readonly<Record<string, SpriteAsset>> = Object.fromEntries(
  MONSTER_SPRITES.map((sprite) => [sprite.id, sprite]),
)

/**
 * Спрайт моба по его id. Боссы идут своим силуэтом; мобы храма получают
 * id вида `<архетип>-w<волна>`, поэтому после точного совпадения ищется
 * архетип-префикс. Ничего не нашлось — запасной силуэт, а не падение.
 */
export function monsterSpriteFor(monsterId: string, isBoss: boolean): SpriteAsset {
  if (isBoss) return MONSTER_SPRITE_BY_ID[BOSS_SPRITE_ID]
  const exact = MONSTER_SPRITE_BY_ARCHETYPE[monsterId]
  if (exact) return MONSTER_SPRITE_BY_ID[exact] ?? MONSTER_SPRITE_BY_ID[FALLBACK_SPRITE_ID]
  const archetype = Object.keys(MONSTER_SPRITE_BY_ARCHETYPE).find((id) =>
    monsterId.startsWith(`${id}-`),
  )
  const spriteId = archetype ? MONSTER_SPRITE_BY_ARCHETYPE[archetype] : FALLBACK_SPRITE_ID
  return MONSTER_SPRITE_BY_ID[spriteId] ?? MONSTER_SPRITE_BY_ID[FALLBACK_SPRITE_ID]
}

/** Фон по уровню моба: полосы сплошные, но на всякий случай крайние тянутся за края. */
export function backgroundForLevel(level: number): BackgroundBand {
  const safe = Number.isFinite(level) ? level : 1
  const band = BACKGROUND_BANDS.find((b) => safe >= b.minLevel && safe <= b.maxLevel)
  if (band) return band
  return safe < BACKGROUND_BANDS[0].minLevel
    ? BACKGROUND_BANDS[0]
    : BACKGROUND_BANDS[BACKGROUND_BANDS.length - 1]
}
