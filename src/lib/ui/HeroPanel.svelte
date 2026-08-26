<script lang="ts">
  import { formatNumber } from '../game'
  import { gameState } from '../stores/game'

  const hpPercent = $derived(
    Math.max(0, Math.min(100, $gameState.currentHp.div($gameState.stats.maxHp).times(100).toNumber())),
  )
  const manaPercent = $derived(
    Math.max(
      0,
      Math.min(100, $gameState.currentMana.div($gameState.stats.maxMana).times(100).toNumber()),
    ),
  )
  const revivePercent = $derived(
    Math.max(0, Math.min(100, (1 - $gameState.reviveMsLeft / 30_000) * 100)),
  )

  const xpPercent = $derived(
    Math.max(
      0,
      Math.min(100, $gameState.currentXp.div($gameState.xpToNext).times(100).toNumber()),
    ),
  )
</script>

<section class="hero">
  <h2>Воин · Уровень {formatNumber($gameState.level)}</h2>
  {#if $gameState.heroState === 'dead'}
    <div class="bar revive-bar" role="progressbar" aria-valuenow={revivePercent} aria-valuemin="0" aria-valuemax="100">
      <div class="fill revive-fill" style="width: {revivePercent}%"></div>
    </div>
    <div class="bar-text dead-text">
      Ты пал… воскрешение через {Math.ceil($gameState.reviveMsLeft / 1000)} с
    </div>
  {:else}
    <div class="bar hp-bar" role="progressbar" aria-valuenow={hpPercent} aria-valuemin="0" aria-valuemax="100">
      <div class="fill hp-fill" style="width: {hpPercent}%"></div>
    </div>
    <div class="bar-text">
      Здоровье: {formatNumber($gameState.currentHp)} / {formatNumber($gameState.stats.maxHp)}
    </div>
    <div class="bar mana-bar" role="progressbar" aria-valuenow={manaPercent} aria-valuemin="0" aria-valuemax="100">
      <div class="fill mana-fill" style="width: {manaPercent}%"></div>
    </div>
    <div class="bar-text">
      Мана: {formatNumber($gameState.currentMana)} / {formatNumber($gameState.stats.maxMana)}
    </div>
  {/if}
  <div class="bar xp-bar" role="progressbar" aria-valuenow={xpPercent} aria-valuemin="0" aria-valuemax="100">
    <div class="fill xp-fill" style="width: {xpPercent}%"></div>
  </div>
  <div class="bar-text">
    Опыт: {formatNumber($gameState.currentXp)} / {formatNumber($gameState.xpToNext)}
  </div>
</section>

<style>
  .hero h2 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
  }
  .bar {
    height: 0.7rem;
    border: 1px solid #8886;
    border-radius: 6px;
    overflow: hidden;
    background: rgba(136, 136, 136, 0.15);
    margin-top: 0.4rem;
  }
  .fill {
    height: 100%;
    transition: width 0.1s linear;
  }
  .hp-fill {
    background: #3fa34d;
  }
  .mana-fill {
    background: #2f6fd6;
  }
  .xp-fill {
    background: var(--color-xp);
  }
  .revive-fill {
    background: #777;
  }
  .bar-text {
    margin-top: 0.2rem;
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }
  .dead-text {
    color: #c0392b;
    font-weight: 600;
  }
</style>
