<script lang="ts">
  // Надетые предметы по слотам. Весь текст для игрока — здесь.
  import { formatNumber, INVENTORY_SIZE } from '../game'
  import { UNARMED } from '../data/balance'
  import { SLOT_IDS, SLOT_NAMES } from '../data/slots'
  import { gameState, toggleAutoEquip, unequipSlot } from '../stores/game'
  import ItemMods from './ItemMods.svelte'
  import { Button, IconSlot, Panel, Tag } from './kit'

  const inventoryFull = $derived($gameState.inventory.length >= INVENTORY_SIZE)
</script>

<Panel title="Экипировка">
  {#snippet header()}
    <label class="auto">
      <input
        type="checkbox"
        checked={$gameState.autoEquip}
        onchange={(e) => toggleAutoEquip(e.currentTarget.checked)}
      />
      Надевать автоматически, если лучше
    </label>
  {/snippet}

  <div class="grid">
    {#each SLOT_IDS as slot (slot)}
      {@const item = $gameState.equipment[slot]}
      <IconSlot slotLabel={SLOT_NAMES[slot]} rarity={item?.rarity} active={item !== null}>
        {#if item}
          <span class="name">{item.name}</span>
          <Tag rarity={item.rarity} />
          <ItemMods mods={item.mods} />
        {/if}
        {#snippet footer()}
          {#if item}
            <Button
              size="sm"
              disabled={inventoryFull}
              title={inventoryFull ? 'Инвентарь полон — освободи место' : ''}
              onclick={() => unequipSlot(slot)}
            >
              Снять
            </Button>
          {/if}
        {/snippet}
      </IconSlot>
    {/each}
  </div>

  {#snippet footer()}
    <p class="unarmed">
      Пустой слот оружия — бой голыми руками:
      {formatNumber(UNARMED.weaponDamageMin)}–{formatNumber(UNARMED.weaponDamageMax)}
      урона раз в {UNARMED.weaponSpeed.toFixed(2)}с. Надетое оружие заменяет эти
      значения целиком, снятое — возвращает. Сравнение при автонадевании идёт по
      итоговому урону в секунду.
    </p>
  {/snippet}
</Panel>

<style>
  .auto {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--c-text-muted);
    cursor: pointer;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    gap: var(--space-2);
  }
  .name {
    font-weight: var(--weight-bold);
  }
  .unarmed {
    margin: 0;
  }
</style>
