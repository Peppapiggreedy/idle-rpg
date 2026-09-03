<script lang="ts">
  import {
    Decimal,
    attackPowerContribution,
    estimateCombatRate,
    explainStat,
    explainSwingTime,
    expectedSwingDamage,
    critFactor,
    formatNumber,
    swingDamageRange,
    type StatId,
    type StatModifier,
  } from '../game'
  import { TALENT_BY_ID } from '../data/talents'
  import { gameState } from '../stores/game'
  import { heroDetailsOpen, toggleHeroDetails } from '../stores/ui'
  import { Button, NumberText, Panel } from './kit'
  import { STAT_ICONS } from '../data/stats'
  import { resourceWords } from './resource'
  import { PERCENT_STATS, SECONDS_STATS, SHOWN_STAT_IDS, statNames } from './statFormat'
  import { flatText } from './statText'
  import { Icon } from './icons'

  // Три строки называют ресурс, а он у классов разный: у изувера это ярость,
  // и «Восст. маны» в его статах было бы просто неправдой.
  const resource = $derived(resourceWords($gameState.classId))

  // Названия и способ прочтения — из ОБЩЕГО реестра ui/statFormat.ts.
  // Сравнение предметов берёт их оттуда же, поэтому «Живучесть» в двух
  // местах игры называется одинаково и по одной причине, а не по двум.
  const STAT_NAMES = $derived(statNames($gameState.classId))

  // 'swingTime' — производная строка, не модифицируемый стат.
  type RowId = StatId | 'swingTime' | 'swingDamage' | 'dps'

  let openStat = $state<RowId | null>(null)

  function toggle(stat: RowId) {
    openStat = openStat === stat ? null : stat
  }

  const swing = $derived(explainSwingTime($gameState))
  const damageRange = $derived(swingDamageRange($gameState.stats))
  const apPart = $derived(attackPowerContribution($gameState.stats))
  const avgSwing = $derived(expectedSwingDamage($gameState.stats))
  const crit = $derived(critFactor($gameState.stats))
  const dps = $derived(estimateCombatRate($gameState).damagePerSecond)
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
    return flatText(mod.value)
  }

  // 'attribute:strength' -> «от силы», 'base' -> «база» и т.д.
  const ATTRIBUTE_SOURCE: Record<string, string> = {
    strength: 'от силы',
    agility: 'от ловкости',
    intellect: 'от интеллекта',
    vitality: 'от живучести',
  }
  function sourceName(source: string): string {
    if (source === 'base') return 'база'
    if (source === 'level') return 'уровень'
    const [kind, id] = source.split(':')
    if (kind === 'attribute') return ATTRIBUTE_SOURCE[id] ?? id
    if (kind === 'equipment') return `экипировка: ${id}`
    if (kind === 'talent') return `талант: ${TALENT_BY_ID[id]?.name ?? id}`
    if (kind === 'class') return 'класс'
    if (kind === 'zone') return `зона: ${id}`
    return source
  }
</script>

<!-- ДВА ЧИСЛА КРУПНО, ОСТАЛЬНОЕ ПОД «ДЕТАЛЯМИ».
     Именно два, а не одно: одним числом «лучше» уже мерили, и двуручное
     било связку одноручное+щит ровно потому, что живучесть в это число не
     входила. Остальные три десятка строк нужны редко и раз в час —
     им место в свёрнутом списке. -->
<Panel title="Герой">
  <div class="big" data-hero-summary>
    <div class="tile">
      <span class="tile-name">Урон в секунду</span>
      <span class="tile-value">{dps.toNumber().toFixed(2)}</span>
    </div>
    <div class="tile">
      <span class="tile-name">Здоровье</span>
      <span class="tile-value"><NumberText value={$gameState.stats.maxHp} /></span>
    </div>
  </div>

  <div class="details-row">
    <Button size="sm" variant="ghost" onclick={toggleHeroDetails}>
      {$heroDetailsOpen ? 'Свернуть детали' : 'Детали'}
    </Button>
    <span class="details-hint">нажми строку — покажу, из чего сложилось</span>
  </div>

  {#if $heroDetailsOpen}
  <ul>
    <li>
      <button type="button" class="stat-row" onclick={() => toggle('swingDamage')}>
        <span class="name">Урон удара</span>
        <span class="value">{formatNumber(damageRange.min)}–{formatNumber(damageRange.max)}</span>
      </button>
      {#if openStat === 'swingDamage'}
        <div class="breakdown">
          <span
            >{formatNumber($gameState.stats.weaponDamageMin)}–{formatNumber(
              $gameState.stats.weaponDamageMax,
            )} оружие</span
          >
          <span
            >· +{formatNumber(apPart)} от силы атаки ({formatNumber($gameState.stats.attackPower)} ×
            {formatSeconds($gameState.stats.weaponSpeed)} / 14)</span
          >
          <span>= {formatNumber(damageRange.min)}–{formatNumber(damageRange.max)}</span>
        </div>
      {/if}
    </li>
    <li>
      <button type="button" class="stat-row" onclick={() => toggle('dps')}>
        <span class="name">Урон в секунду</span>
        <span class="value">{dps.toNumber().toFixed(2)}</span>
      </button>
      {#if openStat === 'dps'}
        <div class="breakdown">
          <span>{formatNumber(avgSwing)} средний удар</span>
          <span>· ×{crit.toNumber().toFixed(2)} за криты ({formatPercent($gameState.stats.critChance)} × {$gameState.stats.critMultiplier.toNumber().toFixed(1)})</span>
          <span>· / {formatSeconds(swing.swingTime)} замах</span>
          <span>= {dps.toNumber().toFixed(2)}</span>
        </div>
      {/if}
    </li>
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
    {#each SHOWN_STAT_IDS as stat (stat)}
      {@const breakdown = explainStat($gameState, stat)}
      <li>
        <button type="button" class="stat-row" onclick={() => toggle(stat)}>
          <Icon name={STAT_ICONS[stat]} size="sm" /><span class="name">{STAT_NAMES[stat]}</span>
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
  {/if}
</Panel>

<style>
  /* Два числа крупно. Ширина плитки — доля строки, а не число: на телефоне
     они встают друг под друга сами. */
  .big {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .tile {
    flex: 1 1 8rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    background: var(--c-surface-sunken);
  }
  .tile-name {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--c-text-faint);
  }
  .tile-value {
    font-size: var(--text-xl);
    font-weight: var(--weight-bold);
    font-variant-numeric: tabular-nums;
  }
  .details-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    margin-bottom: var(--space-2);
  }
  .details-hint {
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  li + li {
    border-top: 1px solid var(--c-border);
  }
  .stat-row {
    font: inherit;
    width: 100%;
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-1) var(--space-3);
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }
  .stat-row:hover {
    background: var(--c-surface-raised);
  }
  .name {
    color: var(--c-text-muted);
    font-size: var(--text-sm);
  }
  .value {
    font-weight: var(--weight-bold);
    font-size: var(--text-sm);
  }
  .breakdown {
    padding: var(--space-1) var(--space-3) var(--space-2);
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    font-size: var(--text-xs);
    color: var(--c-text-muted);
    background: var(--c-surface-sunken);
  }
</style>
