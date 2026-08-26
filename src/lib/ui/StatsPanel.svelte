<script lang="ts">
  import {
    Decimal,
    explainStat,
    explainSwingTime,
    formatNumber,
    STAT_IDS,
    type StatId,
    type StatModifier,
  } from '../game'
  import { UPGRADES } from '../data/upgrades'
  import { gameState } from '../stores/game'

  // Весь текст панели статов живёт здесь; логика отдаёт только раскладку.
  const STAT_NAMES: Record<StatId, string> = {
    attackPower: 'Сила атаки',
    maxHp: 'Здоровье',
    maxMana: 'Мана',
    weaponSpeed: 'Скорость оружия',
    haste: 'Ускорение',
    critChance: 'Шанс крита',
    critMultiplier: 'Множитель крита',
    hpRegen: 'Восст. здоровья (бой)',
    hpRegenOutOfCombat: 'Восст. здоровья (отдых)',
    manaRegen: 'Восст. маны',
    damageReduction: 'Снижение урона',
  }

  // Проценты и секунды читаются иначе, чем растущие величины.
  const PERCENT_STATS: StatId[] = ['critChance', 'damageReduction', 'haste']
  const SECONDS_STATS: StatId[] = ['weaponSpeed']

  // 'swingTime' — производная строка, не модифицируемый стат.
  type RowId = StatId | 'swingTime'

  let openStat = $state<RowId | null>(null)

  function toggle(stat: RowId) {
    openStat = openStat === stat ? null : stat
  }

  const swing = $derived(explainSwingTime($gameState))
  const formatSeconds = (v: number) => `${v.toFixed(2)}с`
  const formatPercent = (v: number) => `${(v * 100).toFixed(0)}%`

  function statValue(stat: StatId): string {
    if (SECONDS_STATS.includes(stat)) return formatSeconds(Number($gameState.stats[stat]))
    const v = $gameState.stats[stat]
    const d = v instanceof Decimal ? v : new Decimal(v)
    if (PERCENT_STATS.includes(stat)) return `${d.times(100).toFixed(0)}%`
    if (stat === 'critMultiplier') return `×${d.toFixed(1)}`
    return formatNumber(d)
  }

  function formatModValue(stat: StatId, mod: StatModifier): string {
    if (mod.kind === 'percent') return `${mod.value.gte(0) ? '+' : ''}${mod.value.times(100).toFixed(0)}%`
    if (mod.kind === 'multiplier') return `×${mod.value.toFixed(2)}`
    if (PERCENT_STATS.includes(stat)) return `${mod.value.gte(0) ? '+' : ''}${mod.value.times(100).toFixed(0)}%`
    return `${mod.value.gte(0) ? '+' : ''}${formatNumber(mod.value)}`
  }

  // 'upgrade:weapon-sharpening' -> «Заточка оружия», 'base' -> «база» и т.д.
  function sourceName(source: string): string {
    if (source === 'base') return 'база'
    const [kind, id] = source.split(':')
    if (kind === 'upgrade') return UPGRADES.find((u) => u.id === id)?.name ?? id
    if (kind === 'equipment') return `экипировка: ${id}`
    if (kind === 'talent') return `талант: ${id}`
    if (kind === 'zone') return `зона: ${id}`
    return source
  }
</script>

<section class="stats-panel">
  <h2>Статы</h2>
  <ul>
    <li>
      <button type="button" class="stat-row" onclick={() => toggle('swingTime')}>
        <span class="name">Время замаха</span>
        <span class="value">{formatSeconds(swing.swingTime)}</span>
      </button>
      {#if openStat === 'swingTime'}
        <div class="breakdown">
          <span>{formatSeconds(swing.weaponSpeed)} скорость оружия</span>
          <span>/ (1 + {formatPercent(swing.haste)} ускорения)</span>
          <span>= {formatSeconds(swing.swingTime)}</span>
        </div>
      {/if}
    </li>
    {#each STAT_IDS as stat (stat)}
      {@const breakdown = explainStat($gameState, stat)}
      <li>
        <button type="button" class="stat-row" onclick={() => toggle(stat)}>
          <span class="name">{STAT_NAMES[stat]}</span>
          <span class="value">{statValue(stat)}</span>
        </button>
        {#if openStat === stat}
          <div class="breakdown">
            {#if PERCENT_STATS.includes(stat)}
              <span>{breakdown.base.times(100).toFixed(0)}% база{breakdown.baseSource
                  ? ` (${sourceName(breakdown.baseSource)})`
                  : ''}</span>
            {:else if SECONDS_STATS.includes(stat)}
              <span>{breakdown.base.toNumber().toFixed(2)}с база{breakdown.baseSource
                  ? ` (${sourceName(breakdown.baseSource)})`
                  : ''}</span>
            {:else}
              <span>{formatNumber(breakdown.base)} база{breakdown.baseSource
                  ? ` (${sourceName(breakdown.baseSource)})`
                  : ''}</span>
            {/if}
            {#each breakdown.entries as mod}
              <span>· {formatModValue(stat, mod)} {sourceName(mod.source)}</span>
            {/each}
            <span>= {statValue(stat)}</span>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  .stats-panel h2 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid #8884;
    border-radius: 8px;
    overflow: hidden;
  }
  li + li {
    border-top: 1px solid #8883;
  }
  .stat-row {
    font: inherit;
    width: 100%;
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.35em 0.8em;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .stat-row:hover {
    background: rgba(136, 136, 136, 0.1);
  }
  .name {
    opacity: 0.85;
  }
  .value {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .breakdown {
    padding: 0.3em 0.9em 0.6em;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35em;
    font-size: 0.85rem;
    text-align: left;
    opacity: 0.85;
    background: rgba(136, 136, 136, 0.07);
  }
</style>
