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
  // --- Таланты: шесть веток глубиной 61 ---
  'talent-double-strike': { file: 'lorc/sword-clash.svg', author: 'Lorc' },
  'talent-second-charge': { file: 'lorc/charged-arrow.svg', author: 'Lorc' },
  'talent-block-resource': { file: 'lorc/shield-bounces.svg', author: 'Lorc' },
  'talent-block-reflect': { file: 'lorc/mirror-mirror.svg', author: 'Lorc' },
  'talent-kill-refund': { file: 'lorc/trophy.svg', author: 'Lorc' },
  'talent-shorter-rest': { file: 'lorc/campfire.svg', author: 'Lorc' },
  'talent-strength': { file: 'delapouite/biceps.svg', author: 'Delapouite' },
  'talent-vitality': { file: 'lorc/heart-tower.svg', author: 'Lorc' },
  'talent-intellect': { file: 'lorc/brain.svg', author: 'Lorc' },
  'talent-relentless': { file: 'lorc/quick-slash.svg', author: 'Lorc' },
  'talent-bleed-deep': { file: 'lorc/barbed-coil.svg', author: 'Lorc' },
  'talent-blood-charge': { file: 'delapouite/swords-power.svg', author: 'Delapouite' },
  'talent-guard-echo': { file: 'lorc/shield-echoes.svg', author: 'Lorc' },
  'talent-hard-to-kill': { file: 'lorc/skull-crack.svg', author: 'Lorc' },
  'talent-spiked-guard': { file: 'lorc/spiked-armor.svg', author: 'Lorc' },

  // --- Травы и зелья ---
  'herb-bitterleaf': { file: 'delapouite/dandelion-flower.svg', author: 'Delapouite' },
  'herb-emberroot': { file: 'lorc/root-tip.svg', author: 'Lorc' },
  'herb-hoarbloom': { file: 'lorc/vine-flower.svg', author: 'Lorc' },
  'profession-herbalism': { file: 'lorc/cauldron.svg', author: 'Lorc' },
  'potion-fury': { file: 'lorc/bubbling-flask.svg', author: 'Lorc' },
  'potion-wind': { file: 'lorc/fizzing-flask.svg', author: 'Lorc' },
  'potion-stone': { file: 'lorc/standing-potion.svg', author: 'Lorc' },

  // --- Зачарование ---
  'material-dust': { file: 'lorc/powder.svg', author: 'Lorc' },
  'action-disenchant': { file: 'lorc/crumbling-ball.svg', author: 'Lorc' },
  'profession-enchanting': { file: 'lorc/rune-stone.svg', author: 'Lorc' },
  'enchant-rune-edge': { file: 'lorc/rune-sword.svg', author: 'Lorc' },
  'enchant-wind-notch': { file: 'lorc/wind-hole.svg', author: 'Lorc' },
  'enchant-wall-oath': { file: 'lorc/shield-echoes.svg', author: 'Lorc' },
  'enchant-heavy-hand': { file: 'delapouite/weight-lifting-up.svg', author: 'Delapouite' },
  'enchant-light-tread': { file: 'lorc/wingfoot.svg', author: 'Lorc' },
  'enchant-clear-sight': { file: 'lorc/psychic-waves.svg', author: 'Lorc' },
  'enchant-stone-core': { file: 'lorc/stone-sphere.svg', author: 'Lorc' },

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
  'stat-strength': { file: 'delapouite/biceps.svg', author: 'Delapouite' },
  'stat-agility': { file: 'lorc/sprint.svg', author: 'Lorc' },
  'stat-intellect': { file: 'lorc/brain.svg', author: 'Lorc' },
  'stat-vitality': { file: 'lorc/heart-tower.svg', author: 'Lorc' },
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
  'zone-root-vaults': { file: 'delapouite/tree-roots.svg', author: 'Delapouite' },
  'zone-mold-horizon': { file: 'delapouite/mushrooms-cluster.svg', author: 'Delapouite' },
  'zone-sulfur-springs': { file: 'lorc/boiling-bubbles.svg', author: 'Lorc' },
  'zone-windswept-pass': { file: 'delapouite/mountain-road.svg', author: 'Delapouite' },
  'zone-wormwood-rise': { file: 'delapouite/tumbleweed.svg', author: 'Delapouite' },
  'zone-emery-stack': { file: 'lorc/windy-stripes.svg', author: 'Lorc' },
  'zone-frozen-crookwood': { file: 'lorc/dead-wood.svg', author: 'Lorc' },
  'zone-hollow-dell': { file: 'lorc/dust-cloud.svg', author: 'Lorc' },
  'zone-mute-bluff': { file: 'delapouite/sea-cliff.svg', author: 'Delapouite' },

  // --- Данжи ---
  // Общая иконка данжа: ею лог помечает события забега, у которых своего
  // данжа под рукой нет (вход, выход, прохождение).
  dungeon: { file: 'delapouite/dungeon-gate.svg', author: 'Delapouite' },
  'dungeon-sunken-barrow': { file: 'delapouite/crypt-entrance.svg', author: 'Delapouite' },
  'dungeon-ninth-drift': { file: 'delapouite/hole-ladder.svg', author: 'Delapouite' },
  'dungeon-tier-cisterns': { file: 'delapouite/well.svg', author: 'Delapouite' },
  'dungeon-boiling-adits': { file: 'delapouite/cave-entrance.svg', author: 'Delapouite' },
  'dungeon-wind-galleries': { file: 'delapouite/ancient-ruins.svg', author: 'Delapouite' },
  'dungeon-salt-womb': { file: 'delapouite/dungeon-light.svg', author: 'Delapouite' },
  'dungeon-rime-catacombs': { file: 'lorc/coffin.svg', author: 'Lorc' },
  'dungeon-bluff-hollow': { file: 'delapouite/temple-gate.svg', author: 'Delapouite' },

  // --- Реагенты данжей ---
  'reagent-silt-clot': { file: 'lorc/dripping-goo.svg', author: 'Lorc' },
  'reagent-drift-sinter': { file: 'delapouite/coal-pile.svg', author: 'Delapouite' },
  'reagent-sediment-core': { file: 'lorc/stone-sphere.svg', author: 'Lorc' },
  'reagent-sulfur-growth': { file: 'lorc/crystal-growth.svg', author: 'Lorc' },
  'reagent-wind-glass': { file: 'lorc/glass-heart.svg', author: 'Lorc' },
  'reagent-brine-crystal': { file: 'lorc/gems.svg', author: 'Lorc' },
  'reagent-rime-vein': { file: 'lorc/frozen-block.svg', author: 'Lorc' },
  'reagent-mute-shard': { file: 'lorc/rune-stone.svg', author: 'Lorc' },

  // --- Интерфейс ---
  log: { file: 'lorc/scroll-unfurled.svg', author: 'Lorc' },

  // --- Улучшения и валюты ---
  gold: { file: 'delapouite/coins.svg', author: 'Delapouite' },
  xp: { file: 'lorc/archery-target.svg', author: 'Lorc' },
} as const satisfies Record<string, IconSource>

/** Имя иконки. Ничего, кроме перечисленного здесь, в игре нарисовать нельзя. */
export type IconName = keyof typeof ICONS

export const ICON_NAMES = Object.keys(ICONS) as IconName[]
