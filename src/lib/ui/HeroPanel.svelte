<script lang="ts">
  import { formatNumber } from '../game'
  import { gameState } from '../stores/game'

  const xpPercent = $derived(
    Math.max(
      0,
      Math.min(100, $gameState.currentXp.div($gameState.xpToNext).times(100).toNumber()),
    ),
  )
</script>

<section class="hero">
  <h2>Воин · Уровень {formatNumber($gameState.level)}</h2>
  <div class="xp-bar" role="progressbar" aria-valuenow={xpPercent} aria-valuemin="0" aria-valuemax="100">
    <div class="xp-fill" style="width: {xpPercent}%"></div>
  </div>
  <div class="xp-text">
    Опыт: {formatNumber($gameState.currentXp)} / {formatNumber($gameState.xpToNext)}
  </div>
</section>

<style>
  .hero h2 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
  }
  .xp-bar {
    height: 0.7rem;
    border: 1px solid #8886;
    border-radius: 6px;
    overflow: hidden;
    background: rgba(136, 136, 136, 0.15);
  }
  .xp-fill {
    height: 100%;
    background: #7e6fff;
    transition: width 0.1s linear;
  }
  .xp-text {
    margin-top: 0.3rem;
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }
</style>
