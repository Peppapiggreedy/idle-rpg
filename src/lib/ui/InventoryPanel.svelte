<script lang="ts">
  import { formatNumber, sellPrice, INVENTORY_SIZE } from '../game'
  import { RARITY_BY_ID } from '../data/rarity'
  import { gameState, sellInventoryItem } from '../stores/game'

  const emptySlots = $derived(
    Math.max(0, INVENTORY_SIZE - $gameState.inventory.length),
  )
</script>

<section class="inventory">
  <h2>Инвентарь ({$gameState.inventory.length}/{INVENTORY_SIZE})</h2>
  <div class="grid">
    {#each $gameState.inventory as item (item.id)}
      {@const rarity = RARITY_BY_ID[item.rarity]}
      <div class="slot filled" style="--rarity-color: {rarity.color}">
        <span class="name">{item.name}</span>
        <span class="rarity">{rarity.name}</span>
        <span class="bonus">+{formatNumber(item.statBonus)} к урону</span>
        <button type="button" onclick={() => sellInventoryItem(item.id)}>
          Продать за {formatNumber(sellPrice(item))}
        </button>
      </div>
    {/each}
    {#each Array(emptySlots) as _, i (i)}
      <div class="slot empty"></div>
    {/each}
  </div>
</section>

<style>
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    gap: 0.6rem;
  }
  .slot {
    min-height: 6.5rem;
    border-radius: 8px;
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.2rem;
    font-size: 0.85rem;
  }
  .slot.empty {
    border: 1px dashed #8885;
    opacity: 0.4;
  }
  .slot.filled {
    border: 1px solid var(--rarity-color);
    box-shadow: inset 0 0 0.5rem color-mix(in srgb, var(--rarity-color) 25%, transparent);
  }
  .name {
    font-weight: 600;
  }
  .rarity {
    color: var(--rarity-color);
    font-size: 0.8rem;
  }
  .bonus {
    opacity: 0.85;
    font-size: 0.8rem;
  }
  button {
    font: inherit;
    font-size: 0.78rem;
    margin-top: 0.3rem;
    padding: 0.25em 0.6em;
    border: 1px solid #8886;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  button:hover {
    border-color: var(--color-gold);
  }
</style>
