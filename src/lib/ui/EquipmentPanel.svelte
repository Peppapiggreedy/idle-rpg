<script lang="ts">
  // Надетые предметы по слотам. Весь текст для игрока — здесь.
  import { formatNumber, INVENTORY_SIZE } from '../game'
  import { RARITY_BY_ID } from '../data/rarity'
  import { UNARMED } from '../data/balance'
  import { SLOT_IDS, SLOT_NAMES } from '../data/slots'
  import { gameState, toggleAutoEquip, unequipSlot } from '../stores/game'
  import ItemMods from './ItemMods.svelte'

  const inventoryFull = $derived($gameState.inventory.length >= INVENTORY_SIZE)
</script>

<section class="equipment">
  <h2>Экипировка</h2>

  <label class="auto">
    <input
      type="checkbox"
      checked={$gameState.autoEquip}
      onchange={(e) => toggleAutoEquip(e.currentTarget.checked)}
    />
    Надевать автоматически, если лучше
    <span class="hint">— сравнение по итоговому урону в секунду</span>
  </label>

  <div class="grid">
    {#each SLOT_IDS as slot (slot)}
      {@const item = $gameState.equipment[slot]}
      <div
        class="slot"
        class:filled={item !== null}
        style="--rarity-color: {item ? RARITY_BY_ID[item.rarity].color : 'transparent'}"
      >
        <span class="slot-name">{SLOT_NAMES[slot]}</span>
        {#if item}
          <span class="name">{item.name}</span>
          <span class="rarity">{RARITY_BY_ID[item.rarity].name}</span>
          <ItemMods mods={item.mods} />
          <button
            type="button"
            disabled={inventoryFull}
            title={inventoryFull ? 'Инвентарь полон — освободи место' : ''}
            onclick={() => unequipSlot(slot)}
          >
            Снять
          </button>
        {:else}
          <span class="empty-text">пусто</span>
        {/if}
      </div>
    {/each}
  </div>

  <p class="unarmed">
    Пустой слот оружия — бой голыми руками:
    {formatNumber(UNARMED.weaponDamageMin)}–{formatNumber(UNARMED.weaponDamageMax)}
    урона раз в {UNARMED.weaponSpeed.toFixed(2)}с. Надетое оружие заменяет эти
    значения целиком, снятое — возвращает.
  </p>
</section>

<style>
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
  }
  .auto {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    justify-content: center;
    font-size: 0.85rem;
    margin-bottom: 0.75rem;
    cursor: pointer;
  }
  .auto .hint {
    opacity: 0.6;
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
    border: 1px dashed #8885;
  }
  .slot.filled {
    border: 1px solid var(--rarity-color);
    box-shadow: inset 0 0 0.5rem color-mix(in srgb, var(--rarity-color) 25%, transparent);
  }
  .slot-name {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.55;
  }
  .name {
    font-weight: 600;
  }
  .rarity {
    color: var(--rarity-color);
    font-size: 0.8rem;
  }
  .empty-text {
    opacity: 0.4;
  }
  .unarmed {
    margin: 0.75rem 0 0;
    font-size: 0.78rem;
    opacity: 0.6;
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
  button:hover:not(:disabled) {
    border-color: var(--color-gold);
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
