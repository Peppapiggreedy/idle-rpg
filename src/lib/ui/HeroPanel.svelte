<script lang="ts">
  import { formatNumber } from '../game'
  import { REVIVE_DELAY_MS } from '../data/balance'
  import { gameState } from '../stores/game'
  import { Panel, StatBar } from './kit'

  const hp = $derived($gameState.currentHp.toNumber())
  const maxHp = $derived($gameState.stats.maxHp.toNumber())
  const mana = $derived($gameState.currentMana.toNumber())
  const maxMana = $derived($gameState.stats.maxMana.toNumber())
  const xp = $derived($gameState.currentXp.toNumber())
  const xpToNext = $derived($gameState.xpToNext.toNumber())
  // Отсчёт воскрешения идёт вниз, полоска — вверх: видно, сколько осталось.
  const revive = $derived(REVIVE_DELAY_MS - $gameState.reviveMsLeft)

  const pair = (a: unknown, b: unknown) => `${a} / ${b}`
</script>

<Panel title="Воин · Уровень {formatNumber($gameState.level)}">
  {#if $gameState.heroState === 'dead'}
    <StatBar
      value={revive}
      max={REVIVE_DELAY_MS}
      tone="neutral"
      size="lg"
      label="Воскрешение"
      valueLabel="{Math.ceil($gameState.reviveMsLeft / 1000)} с"
    />
    <p class="dead">Ты пал…</p>
  {:else}
    <StatBar
      value={hp}
      max={maxHp}
      tone="hp"
      size="lg"
      label="Здоровье"
      valueLabel={pair(formatNumber($gameState.currentHp), formatNumber($gameState.stats.maxHp))}
    />
    <StatBar
      value={mana}
      max={maxMana}
      tone="mana"
      label="Мана"
      valueLabel={pair(
        formatNumber($gameState.currentMana),
        formatNumber($gameState.stats.maxMana),
      )}
    />
  {/if}
  <StatBar
    value={xp}
    max={xpToNext}
    tone="xp"
    size="sm"
    label="Опыт"
    valueLabel={pair(formatNumber($gameState.currentXp), formatNumber($gameState.xpToNext))}
  />
</Panel>

<style>
  .dead {
    margin: 0;
    color: var(--c-damage);
    font-weight: var(--weight-bold);
    font-size: var(--text-sm);
  }
</style>
