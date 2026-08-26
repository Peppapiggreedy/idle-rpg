<script lang="ts">
  import { formatNumber, upgradeCost, ownedCount } from '../game'
  import { UPGRADES } from '../data/upgrades'
  import { gameState, purchaseUpgrade } from '../stores/game'
</script>

<section class="upgrades">
  {#each UPGRADES as def (def.id)}
    {@const owned = ownedCount($gameState, def)}
    {@const cost = upgradeCost(def, owned)}
    <button
      type="button"
      disabled={$gameState.gold.lt(cost)}
      onclick={() => purchaseUpgrade(def)}
    >
      <span class="name">{def.name} <span class="owned">×{formatNumber(owned)}</span></span>
      <span class="effect">+{formatNumber(def.damageBonus)} к урону · цена {formatNumber(cost)} золота</span>
    </button>
  {/each}
</section>

<style>
  .upgrades {
    display: flex;
    justify-content: center;
    gap: 1rem;
    flex-wrap: wrap;
  }
  button {
    font: inherit;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.6em 1.2em;
    border: 1px solid #8886;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    border-color: var(--color-gold);
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .name {
    font-weight: 600;
  }
  .owned {
    opacity: 0.7;
    font-weight: 400;
  }
  .effect {
    font-size: 0.85rem;
    opacity: 0.8;
  }
</style>
