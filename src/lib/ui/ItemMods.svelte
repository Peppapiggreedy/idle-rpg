<script lang="ts">
  // Модификаторы предмета человеческим текстом. Логика отдаёт коды статов —
  // все названия и знаки живут здесь.
  import { changesAnything, formatNumber, type StatId, type StatModifier } from '../game'
  import { gameState } from '../stores/game'
  import { resourceWords } from './resource'
  import { flatText } from './statText'
  // СПИСОК ПРОЦЕНТНЫХ СТАТОВ БЕРЁТСЯ ИЗ ОБЩЕГО РЕЕСТРА, а не переписывается
  // здесь. Своя копия у этого файла была, и разъехалась она молча: список
  // совпадал, а способ применения нет — см. ветку base ниже.
  import { PERCENT_STATS } from './statFormat'

  interface Props {
    mods: StatModifier[]
  }
  let { mods }: Props = $props()

  // Ресурс называется по классу: «восст. маны» на вещи изувера — неправда.
  const resource = $derived(resourceWords($gameState.classId))

  const NAMES: Record<StatId, string> = $derived({
    strength: 'сила',
    agility: 'ловкость',
    intellect: 'интеллект',
    vitality: 'живучесть',
    attackPower: 'сила атаки',
    weaponDamageMin: 'урон оружия (мин)',
    weaponDamageMax: 'урон оружия (макс)',
    maxHp: 'здоровье',
    maxMana: resource.name.toLowerCase(),
    weaponSpeed: 'скорость',
    offhandSpeed: 'скорость левой руки',
    offhandDamageMin: 'урон левой руки (мин)',
    offhandDamageMax: 'урон левой руки (макс)',
    blockChance: 'шанс блока',
    blockValue: 'сила блока',
    offhandPenalty: 'сила левой руки',
    regenDelay: `пауза восст. ${resource.genitive}`,
    restDuration: 'длина привала',
    restThreshold: 'порог привала',
    haste: 'ускорение',
    critChance: 'шанс крита',
    critMultiplier: 'множитель крита',
    hpRegen: 'восст. здоровья',
    hpRegenOutOfCombat: 'восст. здоровья (отдых)',
    manaRegen: `восст. ${resource.genitive}`,
    damageReduction: 'снижение урона',
  })
  function line(mod: StatModifier): string {
    const name = NAMES[mod.stat]
    // base ЗАМЕНЯЕТ базу (оружие задаёт скорость и урон), остальные — прибавки.
    //
    // ПРОЦЕНТ ЧИТАЕТСЯ ПРОЦЕНТОМ И ЗДЕСЬ. Раньше эта ветка звала formatNumber
    // на любую величину, а formatNumber округляет всё меньше тысячи до целого:
    // шанс блока щита (0.25 — это база, она ЗАМЕНЯЕТ «без щита не блокируется
    // ничего») печатался как «шанс блока: 0». Игрок читал это как «блока не
    // будет никогда» и был прав в своём выводе — при верной механике и верных
    // данных. Соседняя «сила блока: 12» не врала только потому, что целая.
    if (mod.kind === 'base') {
      if (mod.stat === 'weaponSpeed') return `${name}: ${mod.value.toFixed(2)}с`
      if (PERCENT_STATS.includes(mod.stat)) return `${name}: ${mod.value.times(100).toFixed(0)}%`
      return `${name}: ${formatNumber(mod.value)}`
    }
    if (mod.kind === 'multiplier') return `${name} ×${mod.value.toFixed(2)}`
    const sign = mod.value.gte(0) ? '+' : ''
    if (mod.kind === 'percent' || PERCENT_STATS.includes(mod.stat)) {
      return `${sign}${mod.value.times(100).toFixed(mod.value.times(100).lt(10) ? 1 : 0)}% ${name}`
    }
    return `${flatText(mod.value)} ${name}`
  }
</script>

<!--
  НУЛЕВЫЕ СТРОКИ НЕ ПОКАЗЫВАЮТСЯ. «0 шанс блока» читается как «блока не будет
  никогда», а значит всего лишь «этот предмет ничего сюда не добавляет» — и
  вторая мысль игроку не приходит. Мера «ничего не меняет» одна на игру и
  живёт в game/equipment.ts: у прибавки это ноль, у множителя — единица.
-->
<ul>
  {#each mods.filter(changesAnything) as mod (mod.stat + mod.kind + mod.source)}
    <li class:base={mod.kind === 'base'}>{line(mod)}</li>
  {/each}
</ul>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: var(--text-xs);
    color: var(--c-text-muted);
  }
  /* База боя (скорость и урон оружия) — не прибавка, а замена: выделяем. */
  li.base {
    color: var(--c-text);
    font-weight: var(--weight-bold);
  }
</style>
