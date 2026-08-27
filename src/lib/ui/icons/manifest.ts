// Реестр иконок игры.
//
// Иконки взяты с game-icons.net под CC BY 3.0 (см. CREDITS.md). Здесь
// перечислено, ЧТО нам нужно и откуда взято; сам спрайт собирается из этого
// списка скриптом scripts/build-icons.mjs и лежит рядом, в sprite.svg.
//
// Реестр — единственный источник имён: тип IconName выводится из него,
// поэтому опечатка в поле icon любого файла data/ становится ОШИБКОЙ
// ПРОВЕРКИ ТИПОВ, а не пустым квадратом на экране.

/** Откуда взята иконка: путь внутри репозитория game-icons и автор. */
export interface IconSource {
  /** Путь вида `lorc/broadsword.svg` в репозитории game-icons/icons. */
  file: string
  /** Автор — его требует лицензия CC BY 3.0. */
  author: string
}

export const ICONS = {
  // --- Умения ---
  'ability-quick-strike': { file: 'delapouite/sword-brandish.svg', author: 'Delapouite' },
  'ability-rending-wound': { file: 'lorc/bleeding-wound.svg', author: 'Lorc' },
  'ability-shattering-blow': { file: 'lorc/hammer-drop.svg', author: 'Lorc' },

  // --- Таланты: ветка «Ярость» ---
  'talent-honed-edge': { file: 'lorc/saber-slash.svg', author: 'Lorc' },
  'talent-keen-eye': { file: 'delapouite/eye-target.svg', author: 'Delapouite' },
  'talent-savage-blows': { file: 'lorc/crossed-swords.svg', author: 'Lorc' },
  'talent-rupture': { file: 'lorc/bloody-sword.svg', author: 'Lorc' },
  // --- Таланты: ветка «Стойкость» ---
  'talent-thick-hide': { file: 'lorc/leather-vest.svg', author: 'Lorc' },
  'talent-second-wind': { file: 'lorc/wolf-howl.svg', author: 'Lorc' },
  'talent-clear-mind': { file: 'lorc/brain.svg', author: 'Lorc' },
  'talent-swift-return': { file: 'lorc/angel-wings.svg', author: 'Lorc' },

  // --- Слоты экипировки ---
  'slot-weapon': { file: 'lorc/broadsword.svg', author: 'Lorc' },
  'slot-head': { file: 'lorc/crested-helmet.svg', author: 'Lorc' },
  'slot-chest': { file: 'delapouite/chest-armor.svg', author: 'Delapouite' },
  'slot-hands': { file: 'delapouite/gauntlet.svg', author: 'Delapouite' },
  'slot-legs': { file: 'delapouite/leg-armor.svg', author: 'Delapouite' },
  'slot-trinket': { file: 'lorc/gem-pendant.svg', author: 'Lorc' },

  // --- Статы. Ровно по одному на каждый StatId плюс производный swingTime ---
  'stat-attackPower': { file: 'skoll/fist.svg', author: 'Skoll' },
  'stat-weaponDamageMin': { file: 'delapouite/axe-sword.svg', author: 'Delapouite' },
  'stat-weaponDamageMax': { file: 'lorc/anvil-impact.svg', author: 'Lorc' },
  'stat-maxHp': { file: 'sbed/health-normal.svg', author: 'Sbed' },
  'stat-maxMana': { file: 'sbed/water-drop.svg', author: 'Sbed' },
  'stat-weaponSpeed': { file: 'skoll/stopwatch.svg', author: 'Skoll' },
  'stat-haste': { file: 'darkzaitzev/running-ninja.svg', author: 'DarkZaitzev' },
  'stat-critChance': { file: 'delapouite/convergence-target.svg', author: 'Delapouite' },
  'stat-critMultiplier': { file: 'lorc/lightning-arc.svg', author: 'Lorc' },
  'stat-hpRegen': { file: 'zeromancer/heart-plus.svg', author: 'Zeromancer' },
  'stat-hpRegenOutOfCombat': { file: 'lorc/campfire.svg', author: 'Lorc' },
  'stat-manaRegen': { file: 'delapouite/star-formation.svg', author: 'Delapouite' },
  'stat-damageReduction': { file: 'lorc/bordered-shield.svg', author: 'Lorc' },
  'stat-swingTime': { file: 'lorc/hourglass.svg', author: 'Lorc' },

  // --- Зоны ---
  'zone-shepherds-meadow': { file: 'generalace135/shepherds-crook.svg', author: 'GeneralAce135' },
  'zone-hollow-quarry': { file: 'delapouite/stone-pile.svg', author: 'Delapouite' },
  'zone-mirefen-hollows': { file: 'delapouite/swamp-bat.svg', author: 'Delapouite' },
  'zone-ashen-ridge': { file: 'lorc/volcano.svg', author: 'Lorc' },

  // --- Данжи ---
  'dungeon-sunken-barrow': { file: 'delapouite/dungeon-gate.svg', author: 'Delapouite' },

  // --- Улучшения и валюты ---
  'upgrade-weapon-sharpening': { file: 'delapouite/upgrade.svg', author: 'Delapouite' },
  gold: { file: 'delapouite/coins.svg', author: 'Delapouite' },
  xp: { file: 'lorc/archery-target.svg', author: 'Lorc' },
} as const satisfies Record<string, IconSource>

/** Имя иконки. Ничего, кроме перечисленного здесь, в игре нарисовать нельзя. */
export type IconName = keyof typeof ICONS

export const ICON_NAMES = Object.keys(ICONS) as IconName[]
