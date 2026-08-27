<script lang="ts">
  import {
    Decimal,
    compareItem,
    formatNumber,
    sellPrice,
    INVENTORY_SIZE,
    type EquipComparison,
  } from '../game'
  import { RARITY_BY_ID } from '../data/rarity'
  import { SLOT_NAMES } from '../data/slots'
  import { equipInventoryItem, gameState, sellInventoryItem } from '../stores/game'
  import ItemMods from './ItemMods.svelte'

  const emptySlots = $derived(Math.max(0, INVENTORY_SIZE - $gameState.inventory.length))

  // Сравнение считаем только для предмета под курсором: заглядывать в будущее
  // для всего инвентаря каждый кадр незачем.
  let hovered = $state<string | null>(null)
  const comparison = $derived.by((): EquipComparison | null => {
    const item = $gameState.inventory.find((i) => i.id === hovered)
    return item ? compareItem($gameState, item) : null
  })

  const seconds = (v: number) => `${v.toFixed(2)}с`
  // Урон в секунду растёт неограниченно: пока читается — десятые доли,
  // дальше короткая запись formatNumber.
  const dps = (value: Decimal) => (value.lt(1000) ? value.toFixed(1) : formatNumber(value))
</script>

<section class="inventory">
  <h2>Инвентарь ({$gameState.inventory.length}/{INVENTORY_SIZE})</h2>
  <div class="grid">
    {#each $gameState.inventory as item (item.id)}
      {@const rarity = RARITY_BY_ID[item.rarity]}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        class="slot filled"
        style="--rarity-color: {rarity.color}"
        tabindex="0"
        role="group"
        onmouseenter={() => (hovered = item.id)}
        onmouseleave={() => (hovered = hovered === item.id ? null : hovered)}
        onfocusin={() => (hovered = item.id)}
      >
        <span class="slot-name">{SLOT_NAMES[item.slot]}</span>
        <span class="name">{item.name}</span>
        <span class="rarity">{rarity.name}</span>
        <ItemMods mods={item.mods} />

        {#if hovered === item.id && comparison}
          {@const c = comparison}
          <div class="compare">
            <div class="line">
              Урон {formatNumber(c.withItem.damageMin)}–{formatNumber(c.withItem.damageMax)},
              скорость {seconds(c.withItem.swingTime)} — {dps(c.withItem.damagePerSecond)} урона в секунду
            </div>
            <div class="line now">
              Сейчас: {formatNumber(c.current.damageMin)}–{formatNumber(c.current.damageMax)},
              {seconds(c.current.swingTime)} — {dps(c.current.damagePerSecond)}
              {#if c.currentItem}<span class="now-item">({c.currentItem.name})</span>{/if}
            </div>
            <div class="delta" class:up={c.isUpgrade} class:down={c.damagePerSecondDelta.lt(0)}>
              {c.damagePerSecondDelta.gte(0) ? '+' : '−'}{dps(c.damagePerSecondDelta.abs())} урона в секунду
            </div>
          </div>
        {/if}

        <div class="actions">
          <button type="button" onclick={() => equipInventoryItem(item.id)}>Надеть</button>
          <button type="button" onclick={() => sellInventoryItem(item.id)}>
            Продать за {formatNumber(sellPrice(item))}
          </button>
        </div>
      </div>
    {/each}
    {#each Array(emptySlots) as _, i (i)}
      <div class="slot empty"></div>
    {/each}
  </div>
  <p class="hint">Надетый предмет продать нельзя — сперва сними его в «Экипировке».</p>
</section>

<style>
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
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
  .compare {
    margin-top: 0.35rem;
    padding-top: 0.35rem;
    border-top: 1px solid #8884;
    font-size: 0.75rem;
    text-align: left;
  }
  .compare .now {
    opacity: 0.6;
  }
  .compare .now-item {
    font-style: italic;
  }
  .delta {
    margin-top: 0.2rem;
    font-weight: 600;
  }
  .delta.up {
    color: #4caf50;
  }
  .delta.down {
    color: #e57373;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    justify-content: center;
    margin-top: 0.3rem;
  }
  .hint {
    margin: 0.6rem 0 0;
    font-size: 0.78rem;
    opacity: 0.55;
  }
  button {
    font: inherit;
    font-size: 0.78rem;
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
