<script lang="ts">
  // Модификаторы предмета человеческим текстом. Логика отдаёт коды статов —
  // все названия и знаки живут здесь.
  import { formatNumber, type StatId, type StatModifier } from '../game'

  interface Props {
    mods: StatModifier[]
  }
  let { mods }: Props = $props()

  const NAMES: Record<StatId, string> = {
    attackPower: 'сила атаки',
    weaponDamageMin: 'урон оружия (мин)',
    weaponDamageMax: 'урон оружия (макс)',
    maxHp: 'здоровье',
    maxMana: 'мана',
    weaponSpeed: 'скорость',
    offhandSpeed: 'скорость левой руки',
    offhandDamageMin: 'урон левой руки (мин)',
    offhandDamageMax: 'урон левой руки (макс)',
    blockChance: 'шанс блока',
    blockValue: 'сила блока',
    haste: 'ускорение',
    critChance: 'шанс крита',
    critMultiplier: 'множитель крита',
    hpRegen: 'восст. здоровья',
    hpRegenOutOfCombat: 'восст. здоровья (отдых)',
    manaRegen: 'восст. маны',
    damageReduction: 'снижение урона',
  }
  const PERCENT_STATS: StatId[] = ['critChance', 'damageReduction', 'haste', 'blockChance']

  function line(mod: StatModifier): string {
    const name = NAMES[mod.stat]
    // base ЗАМЕНЯЕТ базу (оружие задаёт скорость и урон), остальные — прибавки.
    if (mod.kind === 'base') {
      const v = mod.stat === 'weaponSpeed' ? `${mod.value.toFixed(2)}с` : formatNumber(mod.value)
      return `${name}: ${v}`
    }
    if (mod.kind === 'multiplier') return `${name} ×${mod.value.toFixed(2)}`
    const sign = mod.value.gte(0) ? '+' : ''
    if (mod.kind === 'percent' || PERCENT_STATS.includes(mod.stat)) {
      return `${sign}${mod.value.times(100).toFixed(mod.value.times(100).lt(10) ? 1 : 0)}% ${name}`
    }
    return `${sign}${formatNumber(mod.value)} ${name}`
  }
</script>

<ul>
  {#each mods as mod (mod.stat + mod.kind + mod.source)}
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
