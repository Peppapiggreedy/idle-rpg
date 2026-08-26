<script lang="ts">
  import { estimateCombatRate, formatNumber } from '../game'
  import { gameState } from '../stores/game'
  import { RARITY_BY_ID } from '../data/rarity'
  import type { CombatEvent } from '../types'

  // Весь текст боевого лога живёт здесь: логика отдаёт только события.
  function eventText(e: CombatEvent): string {
    switch (e.type) {
      case 'hit':
        return e.isCrit
          ? `КРИТ! ${formatNumber(e.damage)} урона`
          : `Удар: ${formatNumber(e.damage)} урона`
      case 'kill':
        return `${e.monsterName} повержен! +${formatNumber(e.gold)} золота, +${formatNumber(e.xp)} опыта`
      case 'levelup':
        return `Новый уровень: ${formatNumber(e.level)}!`
      case 'loot':
        return `Выпало: ${e.item.name} [${RARITY_BY_ID[e.item.rarity].name}]`
      case 'spawn':
        return `Появился ${e.monsterName}`
    }
  }

  const combatRate = $derived(estimateCombatRate($gameState))

  const hpPercent = $derived(
    Math.max(
      0,
      Math.min(
        100,
        $gameState.monster.currentHp.div($gameState.monster.maxHp).times(100).toNumber(),
      ),
    ),
  )
</script>

<section class="combat">
  <div class="stats">
    <div class="stat">
      <span class="label">Золото</span>
      <span class="value gold">{formatNumber($gameState.gold)}</span>
    </div>
    <div class="stat">
      <span class="label">Урон за удар</span>
      <span class="value">{formatNumber($gameState.damagePerSwing)}</span>
    </div>
    <div class="stat">
      <span class="label">Урон в секунду</span>
      <span class="value">{formatNumber(combatRate.damagePerSecond)}</span>
    </div>
  </div>

  <div class="monster">
    <h2>{$gameState.monster.name}</h2>
    <div class="hp-bar" role="progressbar" aria-valuenow={hpPercent} aria-valuemin="0" aria-valuemax="100">
      <div class="hp-fill" style="width: {hpPercent}%"></div>
    </div>
    <div class="hp-text">
      {formatNumber($gameState.monster.currentHp)} / {formatNumber($gameState.monster.maxHp)}
    </div>
  </div>

  <ul class="log">
    {#each $gameState.combatLog as event}
      <li class:crit={event.type === 'hit' && event.isCrit}>{eventText(event)}</li>
    {/each}
  </ul>
</section>

<style>
  .combat {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .stats {
    display: flex;
    justify-content: center;
    gap: 2rem;
    flex-wrap: wrap;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .label {
    font-size: 0.8rem;
    opacity: 0.7;
  }
  .value {
    font-size: 1.3rem;
    font-variant-numeric: tabular-nums;
  }
  .value.gold {
    color: var(--color-gold);
  }

  .monster h2 {
    margin: 0 0 0.5rem;
  }
  .hp-bar {
    height: 1.1rem;
    border: 1px solid #8886;
    border-radius: 6px;
    overflow: hidden;
    background: rgba(136, 136, 136, 0.15);
  }
  .hp-fill {
    height: 100%;
    background: #c0392b;
    transition: width 0.1s linear;
  }
  .hp-text {
    margin-top: 0.3rem;
    font-size: 0.9rem;
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }

  .log {
    margin: 0 auto;
    padding: 0;
    list-style: none;
    font-size: 0.9rem;
    min-height: calc(8 * 1.5em);
  }
  .log li {
    opacity: 0.9;
  }
  .log li:not(:first-child) {
    opacity: 0.55;
  }
  .log li.crit {
    color: var(--color-gold);
    font-weight: 600;
  }
</style>
