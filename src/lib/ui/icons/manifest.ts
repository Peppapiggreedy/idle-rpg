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
  // «Пролом» — умение, которого нет ни в одной книге класса: его кладёт в
  // ряд талант замены (`replace-ability`), вместо «Сокрушения».
  'ability-breach': { file: 'lorc/groundbreaker.svg', author: 'Lorc' },
  // Два венца Гнева — умения, выданные ТАЛАНТОМ (`grant-ability`). В книге
  // класса их нет: их открывает не уровень, а очко.
  'ability-sever': { file: 'lorc/tearing.svg', author: 'Lorc' },
  'ability-echo': { file: 'lorc/echo-ripples.svg', author: 'Lorc' },
  'ability-mend-wounds': { file: 'delapouite/first-aid-kit.svg', author: 'Delapouite' },
  'ability-shield-shove': { file: 'delapouite/shield-bash.svg', author: 'Delapouite' },
  'ability-rupture': { file: 'lorc/tearing.svg', author: 'Lorc' },
  'ability-bulwark': { file: 'lorc/energy-shield.svg', author: 'Lorc' },
  'ability-mercy': { file: 'lorc/skull-crack.svg', author: 'Lorc' },
  'ability-brand': { file: 'sbed/hot-surface.svg', author: 'Sbed' },
  'ability-focus': { file: 'lorc/concentration-orb.svg', author: 'Lorc' },
  'ability-stance': { file: 'lorc/turtle-shell.svg', author: 'Lorc' },
  'ability-gut-rip': { file: 'delapouite/cleaver.svg', author: 'Delapouite' },
  'ability-blood-frenzy': { file: 'lorc/fire-punch.svg', author: 'Lorc' },
  'ability-skull-splitter': { file: 'lorc/battle-axe.svg', author: 'Lorc' },
  'ability-blood-letting': { file: 'lorc/dripping-blade.svg', author: 'Lorc' },
  'ability-blood-thirst': { file: 'lorc/heart-drop.svg', author: 'Lorc' },
  'ability-sinew-tear': { file: 'lorc/claw-slashes.svg', author: 'Lorc' },
  'ability-dug-in': { file: 'lorc/spiked-armor.svg', author: 'Lorc' },
  'ability-reckoning': { file: 'lorc/decapitation.svg', author: 'Lorc' },
  'ability-blood-price': { file: 'skoll/blood.svg', author: 'Skoll' },
  'ability-blood-roar': { file: 'lorc/shouting.svg', author: 'Lorc' },
  'ability-berserk': { file: 'delapouite/enrage.svg', author: 'Delapouite' },

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

  // --- Таланты, правящие умения (ночь «три ветки»): ветка «Гнев» ---
  'talent-firm-hand': { file: 'lorc/quick-slash.svg', author: 'Lorc' },
  'talent-deep-cut': { file: 'lorc/serrated-slash.svg', author: 'Lorc' },
  'talent-spare-edge': { file: 'lorc/pointy-sword.svg', author: 'Lorc' },
  'talent-swift-shatter': { file: 'lorc/blade-fall.svg', author: 'Lorc' },
  'talent-headlong': { file: 'lorc/spiral-thrust.svg', author: 'Lorc' },
  'talent-deep-brand': { file: 'sbed/hot-surface.svg', author: 'Sbed' },
  'talent-wide-mercy': { file: 'lorc/chopped-skull.svg', author: 'Lorc' },
  'talent-heavy-shatter': { file: 'lorc/heavy-fall.svg', author: 'Lorc' },
  'talent-long-focus': { file: 'lorc/hourglass.svg', author: 'Lorc' },
  'talent-cold-blood': { file: 'lorc/frozen-orb.svg', author: 'Lorc' },
  'talent-open-vein': { file: 'lorc/vile-fluid.svg', author: 'Lorc' },
  'talent-open-wound': { file: 'lorc/dripping-blade.svg', author: 'Lorc' },

  // --- Таланты, правящие умения: ветка «Оплот» ---
  'talent-press': { file: 'delapouite/shield-bash.svg', author: 'Delapouite' },
  'talent-long-wall': { file: 'lorc/shield-echoes.svg', author: 'Lorc' },
  'talent-quick-mend': { file: 'delapouite/medicines.svg', author: 'Delapouite' },
  'talent-hard-stance': { file: 'lorc/turtle.svg', author: 'Lorc' },
  'talent-braced': { file: 'lorc/edged-shield.svg', author: 'Lorc' },
  'talent-thrift-wall': { file: 'lorc/bordered-shield.svg', author: 'Lorc' },
  'talent-deep-mend': { file: 'lorc/hospital-cross.svg', author: 'Lorc' },
  'talent-long-stance': { file: 'lorc/turtle-shell.svg', author: 'Lorc' },
  'talent-early-call': { file: 'lorc/life-support.svg', author: 'Lorc' },
  'talent-often-wall': { file: 'lorc/clockwork.svg', author: 'Lorc' },
  'talent-wide-wall': { file: 'lorc/surrounded-shield.svg', author: 'Lorc' },
  'talent-firm-press': { file: 'lorc/checked-shield.svg', author: 'Lorc' },
  'talent-quiet-mend': { file: 'lorc/rosa-shield.svg', author: 'Lorc' },
  'talent-immovable': { file: 'lorc/cracked-shield.svg', author: 'Lorc' },

  // --- Таланты, правящие умения: ветка «Бдение» ---
  'talent-quick-focus': { file: 'lorc/concentration-orb.svg', author: 'Lorc' },
  'talent-long-brand': { file: 'lorc/burning-passion.svg', author: 'Lorc' },
  'talent-thrift-rupture': { file: 'lorc/tearing.svg', author: 'Lorc' },
  'talent-thrift-shatter': { file: 'lorc/hammer-drop.svg', author: 'Lorc' },
  'talent-long-mind': { file: 'lorc/meditation.svg', author: 'Lorc' },
  'talent-early-brand': { file: 'lorc/burning-eye.svg', author: 'Lorc' },
  'talent-thrift-wound': { file: 'lorc/fire-silhouette.svg', author: 'Lorc' },
  'talent-thrift-mercy': { file: 'lorc/inner-self.svg', author: 'Lorc' },
  'talent-often-brand': { file: 'lorc/lightning-frequency.svg', author: 'Lorc' },
  'talent-lasting-brand': { file: 'lorc/eclipse-flare.svg', author: 'Lorc' },
  'talent-thrift-stance': { file: 'lorc/mineral-heart.svg', author: 'Lorc' },
  'talent-quick-mercy': { file: 'lorc/stopwatch.svg', author: 'Lorc' },
  'talent-full-rupture': { file: 'lorc/vortex.svg', author: 'Lorc' },
  'talent-endless-mind': { file: 'lorc/book-aura.svg', author: 'Lorc' },

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

  // --- Реликвии и проки ---
  'relic-echo': { file: 'lorc/relic-blade.svg', author: 'Lorc' },
  'relic-thorn': { file: 'lorc/crown-of-thorns.svg', author: 'Lorc' },
  'relic-storm': { file: 'lorc/lightning-shadow.svg', author: 'Lorc' },
  'relic-shell': { file: 'lorc/spiral-shell.svg', author: 'Lorc' },
  'relic-facet': { file: 'lorc/diamond-hard.svg', author: 'Lorc' },
  'relic-sign': { file: 'lorc/holy-symbol.svg', author: 'Lorc' },
  'relic-spark': { file: 'lorc/tesla-coil.svg', author: 'Lorc' },
  'relic-gilded': { file: 'lorc/gold-shell.svg', author: 'Lorc' },
  'proc-strike': { file: 'lorc/thunder-struck.svg', author: 'Lorc' },
  'proc-ward': { file: 'lorc/shining-heart.svg', author: 'Lorc' },
  'profession-relics': { file: 'lorc/gem-chain.svg', author: 'Lorc' },

  // --- Героика: режим, способности боссов и её реагенты ---
  'dungeon-heroic': { file: 'lorc/crowned-skull.svg', author: 'Lorc' },
  'boss-ability-dispel': { file: 'lorc/vortex.svg', author: 'Lorc' },
  'boss-ability-frenzy': { file: 'lorc/flame-spin.svg', author: 'Lorc' },
  'boss-ability-backlash': { file: 'lorc/burning-dot.svg', author: 'Lorc' },
  'reagent-drowned-whorl': { file: 'lorc/spiral-shell.svg', author: 'Lorc' },
  'reagent-drift-charge': { file: 'lorc/mine-explosion.svg', author: 'Lorc' },
  'reagent-bottom-tear': { file: 'lorc/drop.svg', author: 'Lorc' },
  'reagent-seething-coal': { file: 'lorc/burning-embers.svg', author: 'Lorc' },
  'reagent-booming-whirl': { file: 'lorc/tornado.svg', author: 'Lorc' },
  'reagent-brine-druse': { file: 'lorc/crystalize.svg', author: 'Lorc' },
  'reagent-rime-core': { file: 'lorc/frozen-orb.svg', author: 'Lorc' },
  'reagent-mute-stone': { file: 'lorc/tombstone.svg', author: 'Lorc' },

  'recipe-relic-plate': { file: 'lorc/breastplate.svg', author: 'Lorc' },

  // --- Храм испытаний ---
  temple: { file: 'delapouite/greek-temple.svg', author: 'Delapouite' },
  'temple-wave': { file: 'lorc/wave-crest.svg', author: 'Lorc' },

  // --- Преквесты и врата рейда ---
  'raid-gate': { file: 'lorc/magic-gate.svg', author: 'Lorc' },

  // --- Классы ---
  'class-warden': { file: 'delapouite/spiked-shield.svg', author: 'Delapouite' },
  'class-reaver': { file: 'lorc/axe-swing.svg', author: 'Lorc' },
  'class-houndmaster': { file: 'lorc/hound.svg', author: 'Lorc' },

  // --- Умения Псаря ---
  'ability-undercut': { file: 'lorc/knife-thrust.svg', author: 'Lorc' },
  'ability-sic': { file: 'delapouite/sniffing-dog.svg', author: 'Delapouite' },
  'ability-hamstring': { file: 'lorc/blade-bite.svg', author: 'Lorc' },
  'ability-recall': { file: 'delapouite/whistle.svg', author: 'Delapouite' },
  'ability-grip': { file: 'delapouite/neck-bite.svg', author: 'Delapouite' },
  'ability-flurry': { file: 'lorc/crossed-claws.svg', author: 'Lorc' },
  'ability-bandage': { file: 'lorc/bandage-roll.svg', author: 'Lorc' },
  'ability-unleash': { file: 'lorc/direwolf.svg', author: 'Lorc' },
  'ability-skulk': { file: 'lorc/hood.svg', author: 'Lorc' },
  'ability-rally': { file: 'lorc/hunting-horn.svg', author: 'Lorc' },
  'ability-pack': { file: 'lorc/paw-print.svg', author: 'Lorc' },
  // Таланты Псаря — ветка Гон.
  'talent-sharp-fangs': { file: 'lorc/bestial-fangs.svg', author: 'Lorc' },
  'talent-fast-jaws': { file: 'lorc/croc-jaws.svg', author: 'Lorc' },
  'talent-pack-tactics': { file: 'lorc/paw-front.svg', author: 'Lorc' },
  'talent-savage-unleash': { file: 'delapouite/wolverine-claws.svg', author: 'Delapouite' },
  'talent-avenger': { file: 'lorc/fanged-skull.svg', author: 'Lorc' },
  'talent-fourth-cut': { file: 'lorc/claw-slashes.svg', author: 'Lorc' },
  'talent-fangs-of-old': { file: 'lorc/pretty-fangs.svg', author: 'Lorc' },
  'talent-twin-fang': { file: 'lorc/snake-bite.svg', author: 'Lorc' },
  // Таланты Псаря — ветка Привязь.
  'talent-fur-shield': { file: 'delapouite/animal-hide.svg', author: 'Delapouite' },
  'talent-fast-return': { file: 'delapouite/jumping-dog.svg', author: 'Delapouite' },
  'talent-hound-mending': { file: 'lorc/paw-heart.svg', author: 'Lorc' },
  'talent-full-rally': { file: 'delapouite/mighty-horn.svg', author: 'Delapouite' },
  // Таланты Псаря — ветка Тропа.
  'talent-hound-rests': { file: 'delapouite/sitting-dog.svg', author: 'Delapouite' },
  'talent-hound-sleeps': { file: 'delapouite/dog-house.svg', author: 'Delapouite' },

  // --- Таланты Псаря ---
  'talent-quick-hands': { file: 'lorc/sprint.svg', author: 'Lorc' },
  'talent-sure-cut': { file: 'lorc/crossed-slashes.svg', author: 'Lorc' },
  'talent-thick-coat': { file: 'delapouite/animal-hide.svg', author: 'Delapouite' },
  'talent-even-breath': { file: 'delapouite/lungs.svg', author: 'Delapouite' },
  'talent-restless-legs': { file: 'lorc/run.svg', author: 'Lorc' },
  'talent-short-camp': { file: 'lorc/campfire.svg', author: 'Lorc' },

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
  // Значки ВЕЩЕЙ в руках — по хвату, а не по слоту (data/items.ts, GRIP_ICONS).
  'item-one-handed': { file: 'skoll/gladius.svg', author: 'Skoll' },
  'item-two-handed': { file: 'delapouite/two-handed-sword.svg', author: 'Delapouite' },
  'item-shield': { file: 'delapouite/roman-shield.svg', author: 'Delapouite' },
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
  'stat-armor': { file: 'delapouite/abdominal-armor.svg', author: 'Delapouite' },
  // Одиннадцать характеристик, заведённых вместе с машинерией дерева.
  'stat-doubleStrike': { file: 'lorc/double-shot.svg', author: 'Lorc' },
  'stat-dodge': { file: 'lorc/dodging.svg', author: 'Lorc' },
  'stat-reviveSpeed': { file: 'lorc/wingfoot.svg', author: 'Lorc' },
  'stat-houndMaxHp': { file: 'lorc/heart-bottle.svg', author: 'Lorc' },
  'stat-houndHpRegen': { file: 'delapouite/healing.svg', author: 'Delapouite' },
  'stat-houndAttackPower': { file: 'lorc/bestial-fangs.svg', author: 'Lorc' },
  'stat-houndCritChance': { file: 'lorc/pretty-fangs.svg', author: 'Lorc' },
  'stat-houndArmor': { file: 'lorc/leather-vest.svg', author: 'Lorc' },
  'stat-houndDodge': { file: 'lorc/tread.svg', author: 'Lorc' },
  'stat-houndReviveSpeed': { file: 'lorc/wolf-howl.svg', author: 'Lorc' },
  'stat-redirectShare': { file: 'lorc/interleaved-arrows.svg', author: 'Lorc' },
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

  // --- Обычные реагенты полос: по одному-двум на каждую из десяти ---
  // Шесть прежних материалов зон свои иконки сохранили (material-*): у них
  // не поменялось ничего, кроме того, что теперь у каждого одна полоса.
  'reagent-furrow-rust': { file: 'lorc/rock.svg', author: 'Lorc' },
  'reagent-glass-sliver': { file: 'lorc/cracked-glass.svg', author: 'Lorc' },
  'reagent-shaft-iron': { file: 'delapouite/stone-pile.svg', author: 'Delapouite' },
  'reagent-root-fibre': { file: 'delapouite/plant-roots.svg', author: 'Delapouite' },
  'reagent-tier-scale': { file: 'lorc/scale-mail.svg', author: 'Lorc' },
  'reagent-mould-cap': { file: 'lorc/mushroom-gills.svg', author: 'Lorc' },
  'reagent-sulfur-crust': { file: 'lorc/acid-blob.svg', author: 'Lorc' },
  'reagent-terrace-slag': { file: 'lorc/stone-block.svg', author: 'Lorc' },
  'reagent-pass-flint': { file: 'delapouite/flint-spark.svg', author: 'Delapouite' },
  'reagent-wormwood-resin': { file: 'lorc/curled-leaf.svg', author: 'Lorc' },
  'reagent-emery-grit': { file: 'lorc/dust-cloud.svg', author: 'Lorc' },
  'reagent-crookwood-knot': { file: 'delapouite/wood-beam.svg', author: 'Delapouite' },
  'reagent-hoar-quartz': { file: 'lorc/crystal-cluster.svg', author: 'Lorc' },
  'reagent-dell-bloom': { file: 'lorc/spiral-bloom.svg', author: 'Lorc' },
  'reagent-bluff-obsidian': { file: 'lorc/dripping-stone.svg', author: 'Lorc' },

  // --- Промежуточные реагенты: второй передел кузнечного ---
  'reagent-flood-billet': { file: 'delapouite/clay-brick.svg', author: 'Delapouite' },
  'reagent-sulfur-billet': { file: 'lorc/anvil-impact.svg', author: 'Lorc' },
  'reagent-pass-billet': { file: 'delapouite/brick-pile.svg', author: 'Delapouite' },
  'reagent-salt-billet': { file: 'lorc/stone-tablet.svg', author: 'Lorc' },
  'reagent-rime-billet': { file: 'lorc/cubes.svg', author: 'Lorc' },
  'reagent-dell-billet': { file: 'lorc/heavy-thorny-triskelion.svg', author: 'Lorc' },
  'reagent-rime-extract': { file: 'lorc/bubbling-flask.svg', author: 'Lorc' },
  'reagent-dell-extract': { file: 'lorc/potion-ball.svg', author: 'Lorc' },

  // --- Интерфейс ---
  log: { file: 'lorc/scroll-unfurled.svg', author: 'Lorc' },
  // Автокаст: рука — жмёшь сам, механизм — жмёт игра. Пара, а не одна
  // иконка с галкой: кнопка стоит в ряду действий и читается по рисунку,
  // а не по подписи.
  'autocast-off': { file: 'lorc/hand.svg', author: 'Lorc' },
  'autocast-on': { file: 'lorc/auto-repair.svg', author: 'Lorc' },

  // --- Улучшения и валюты ---
  gold: { file: 'delapouite/coins.svg', author: 'Delapouite' },
  xp: { file: 'lorc/archery-target.svg', author: 'Lorc' },
} as const satisfies Record<string, IconSource>

/** Имя иконки. Ничего, кроме перечисленного здесь, в игре нарисовать нельзя. */
export type IconName = keyof typeof ICONS

export const ICON_NAMES = Object.keys(ICONS) as IconName[]
