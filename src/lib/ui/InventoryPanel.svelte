<script lang="ts">
  import {
    Decimal,
    compareItem,
    formatNumber,
    sellPrice,
    INVENTORY_SIZE,
    type EquipComparison,
  } from '../game'
  import { SLOT_NAMES } from '../data/slots'
  import { equipInventoryItem, gameState, sellInventoryItem } from '../stores/game'
  import ItemMods from './ItemMods.svelte'
  import { Button, IconSlot, NumberText, Panel, Tag } from './kit'

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

<Panel title="Инвентарь" subtitle="{$gameState.inventory.length} из {INVENTORY_SIZE} слотов">
  <div class="grid">
    {#each $gameState.inventory as item (item.id)}
      <IconSlot
        slotLabel={SLOT_NAMES[item.slot]}
        rarity={item.rarity}
        active={hovered === item.id}
        interactive
        onmouseenter={() => (hovered = item.id)}
        onmouseleave={() => (hovered = hovered === item.id ? null : hovered)}
        onfocusin={() => (hovered = item.id)}
      >
        <span class="name">{item.name}</span>
        <Tag rarity={item.rarity} />
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
            <div class="delta">
              <NumberText
                value={c.damagePerSecondDelta}
                tone={c.isUpgrade ? 'hp' : 'damage'}
                sign="auto"
                bold
                suffix=" урона в секунду"
              />
            </div>
          </div>
        {/if}

        {#snippet footer()}
          <Button size="sm" variant="primary" onclick={() => equipInventoryItem(item.id)}>
            Надеть
          </Button>
          <Button size="sm" onclick={() => sellInventoryItem(item.id)}>
            Продать за {formatNumber(sellPrice(item))}
          </Button>
        {/snippet}
      </IconSlot>
    {/each}
    {#each Array(emptySlots) as _, i (i)}
      <IconSlot emptyText="—" />
    {/each}
  </div>

  {#snippet footer()}
    <p class="hint">Надетый предмет продать нельзя — сперва сними его в «Экипировке».</p>
  {/snippet}
</Panel>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: var(--space-2);
  }
  .name {
    font-weight: var(--weight-bold);
  }
  .compare {
    margin-top: var(--space-1);
    padding-top: var(--space-1);
    border-top: 1px solid var(--c-border);
    font-size: var(--text-xs);
  }
  .compare .now {
    color: var(--c-text-faint);
  }
  .compare .now-item {
    font-style: italic;
  }
  .delta {
    margin-top: var(--space-1);
  }
  .hint {
    margin: 0;
  }
</style>
