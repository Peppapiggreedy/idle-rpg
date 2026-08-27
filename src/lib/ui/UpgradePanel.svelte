<script lang="ts">
  import { upgradeCost, ownedCount } from '../game'
  import { UPGRADES } from '../data/upgrades'
  import { gameState, purchaseUpgrade } from '../stores/game'
  import { NumberText, Panel } from './kit'
  import { Icon } from './icons'
</script>

<Panel title="Улучшения">
  <div class="upgrades">
    {#each UPGRADES as def (def.id)}
      {@const owned = ownedCount($gameState, def)}
      {@const cost = upgradeCost(def, owned)}
      <button
        type="button"
        class="upgrade"
        disabled={$gameState.gold.lt(cost)}
        onclick={() => purchaseUpgrade(def)}
      >
        <span class="name">
          <Icon name={def.icon} />{def.name}
          <span class="owned">×<NumberText value={owned} /></span>
        </span>
        <span class="effect">
          +<NumberText value={def.damageBonus} /> к силе атаки · цена
          <NumberText value={cost} tone="gold" />
        </span>
      </button>
    {/each}
  </div>
</Panel>

<style>
  .upgrades {
    display: flex;
    justify-content: center;
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  /* Кнопка-карточка: двухстрочная, поэтому не примитив Button, но цвета
     и отступы — те же токены. */
  .upgrade {
    font: inherit;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-md);
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
    transition: border-color var(--dur-fast) ease;
  }
  .upgrade:hover:not(:disabled) {
    border-color: var(--c-accent);
  }
  .upgrade:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .name {
    font-weight: var(--weight-bold);
  }
  .owned {
    color: var(--c-text-muted);
    font-weight: var(--weight-regular);
  }
  .effect {
    font-size: var(--text-sm);
    color: var(--c-text-muted);
  }
</style>
