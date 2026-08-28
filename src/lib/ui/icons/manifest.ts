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
  'ability-gut-rip': { file: 'delapouite/cleaver.svg', author: 'Delapouite' },
  'ability-blood-frenzy': { file: 'lorc/fire-punch.svg', author: 'Lorc' },
  'ability-skull-splitter': { file: 'lorc/battle-axe.svg', author: 'Lorc' },

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
  // --- Таланты: добавленные в третью итерацию дерева ---
  'talent-frenzy': { file: 'delapouite/wolverine-claws.svg', author: 'Delapouite' },
  'talent-offhand-mastery': { file: 'delapouite/hook-swords.svg', author: 'Delapouite' },
  'talent-shield-wall': { file: 'lorc/shield-reflect.svg', author: 'Lorc' },
  'talent-bulwark-training': { file: 'delapouite/armor-upgrade.svg', author: 'Delapouite' },
  'talent-iron-skin': { file: 'lorc/mineral-heart.svg', author: 'Lorc' },
  // --- Таланты: ветка «Самообладание» ---
  'talent-steady-breath': { file: 'lorc/magic-swirl.svg', author: 'Lorc' },
  'talent-deep-well': { file: 'delapouite/water-flask.svg', author: 'Delapouite' },
  'talent-quick-camp': { file: 'delapouite/camping-tent.svg', author: 'Delapouite' },
  'talent-field-medicine': { file: 'delapouite/first-aid-kit.svg', author: 'Delapouite' },
  'talent-unbroken-focus': { file: 'lorc/sands-of-time.svg', author: 'Lorc' },

  // --- Классы ---
  'class-warden': { file: 'delapouite/spiked-shield.svg', author: 'Delapouite' },
  'class-reaver': { file: 'lorc/axe-swing.svg', author: 'Lorc' },

  // --- Материалы профессий ---
  'material-herb': { file: 'delapouite/herbs-bundle.svg', author: 'Delapouite' },
  'material-meat': { file: 'lorc/meat.svg', author: 'Lorc' },
  'material-ore': { file: 'faithtoken/ore.svg', author: 'FaithToken' },
  'material-hide': { file: 'delapouite/animal-hide.svg', author: 'Delapouite' },
  'material-shard': { file: 'lorc/crystal-shine.svg', author: 'Lorc' },
  'material-salt': { file: 'lorc/stone-block.svg', author: 'Lorc' },

  // --- Профессии и рецепты ---
  'profession-cooking': { file: 'delapouite/cooking-pot.svg', author: 'Delapouite' },
  'profession-smithing': { file: 'lorc/hammer-nails.svg', author: 'Lorc' },
  'recipe-broth': { file: 'delapouite/meal.svg', author: 'Delapouite' },
  'recipe-stew': { file: 'lorc/fire-bowl.svg', author: 'Lorc' },
  'recipe-jerky': { file: 'lorc/mushroom.svg', author: 'Lorc' },

  // --- Слоты экипировки ---
  'slot-weapon': { file: 'lorc/broadsword.svg', author: 'Lorc' },
  'slot-offhand': { file: 'sbed/shield.svg', author: 'Sbed' },
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
  // Левая рука и щит. Своя иконка у КАЖДОГО стата: в панели статов они стоят
  // рядом со статами правой руки, и повтор картинки читался бы как ошибка.
  'stat-offhandSpeed': { file: 'delapouite/hook-swords.svg', author: 'Delapouite' },
  'stat-offhandDamageMin': { file: 'lorc/dervish-swords.svg', author: 'Lorc' },
  'stat-offhandDamageMax': { file: 'lorc/sword-spin.svg', author: 'Lorc' },
  'stat-blockChance': { file: 'lorc/shield-reflect.svg', author: 'Lorc' },
  'stat-blockValue': { file: 'delapouite/shield-bash.svg', author: 'Delapouite' },
  // Четыре стата, которые раньше были константами: штраф левой руки, пауза
  // регенерации, длина привала и порог ухода на него.
  'stat-offhandPenalty': { file: 'delapouite/split-arrows.svg', author: 'Delapouite' },
  'stat-regenDelay': { file: 'lorc/time-trap.svg', author: 'Lorc' },
  'stat-restDuration': { file: 'delapouite/night-sleep.svg', author: 'Delapouite' },
  'stat-restThreshold': { file: 'lorc/meditation.svg', author: 'Lorc' },

  // --- Зоны ---
  'zone-shepherds-meadow': { file: 'generalace135/shepherds-crook.svg', author: 'GeneralAce135' },
  'zone-hollow-quarry': { file: 'delapouite/stone-pile.svg', author: 'Delapouite' },
  'zone-mirefen-hollows': { file: 'delapouite/swamp-bat.svg', author: 'Delapouite' },
  'zone-ashen-ridge': { file: 'lorc/volcano.svg', author: 'Lorc' },
  'zone-rusted-furrows': { file: 'delapouite/plow.svg', author: 'Delapouite' },
  'zone-glasswaste': { file: 'lorc/crystal-cluster.svg', author: 'Lorc' },
  'zone-mine-collapse': { file: 'delapouite/mine-wagon.svg', author: 'Delapouite' },
  'zone-flooded-tier': { file: 'lorc/water-splash.svg', author: 'Lorc' },
  'zone-ashen-terrace': { file: 'delapouite/mountain-cave.svg', author: 'Delapouite' },
  'zone-salt-pit': { file: 'lorc/salt-shaker.svg', author: 'Lorc' },
  'zone-rimeback-ridge': { file: 'lorc/ice-spear.svg', author: 'Lorc' },

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
