<script lang="ts">
  // Надетые предметы по слотам. Весь текст для игрока — здесь.
  import { formatNumber, INVENTORY_SIZE } from '../game'
  import { OFFHAND_PENALTY, UNARMED } from '../data/balance'
  import { SLOT_ICONS, SLOT_IDS, SLOT_NAMES } from '../data/slots'
  import { gameState, toggleAutoEquip, unequipSlot } from '../stores/game'
  import ItemMods from './ItemMods.svelte'
  import { Button, IconSlot, Panel, Tag } from './kit'
  import { Icon } from './icons'

  const inventoryFull = $derived($gameState.inventory.length >= INVENTORY_SIZE)
  // Двуручное занимает обе руки: левая не пуста, она ЗАНЯТА — и разницу
  // между «надень что-нибудь» и «сюда нельзя» игрок должен видеть.
  const twoHanded = $derived($gameState.equipment.mainHand?.hands === 2)
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
        {#snippet badge()}<Icon name={SLOT_ICONS[slot]} size="lg" />{/snippet}
        {#if item}
          <span class="name">{item.name}</span>
          <Tag rarity={item.rarity} />
          <ItemMods mods={item.mods} />
        {:else if slot === 'offHand' && twoHanded}
          <span class="locked">Занята двуручным оружием</span>
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
      Пустые руки — бой голыми руками:
      {formatNumber(UNARMED.weaponDamageMin)}–{formatNumber(UNARMED.weaponDamageMax)}
      урона раз в {UNARMED.weaponSpeed.toFixed(2)}с. Надетое оружие заменяет эти
      значения целиком, снятое — возвращает.
    </p>
    <p class="unarmed">
      Три стиля примерно равны по урону: два одноручных бьют чаще (левая рука
      наносит {Math.round(OFFHAND_PENALTY * 100)}% своего урона), двуручное бьёт
      реже, но сильнее, а щит меняет часть урона на блок. Сравнение при
      автонадевании идёт по итоговому урону в секунду ВСЕЙ связки, а не
      отдельного предмета.
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
  .locked {
    color: var(--c-text-faint);
    font-size: var(--text-sm);
  }
  .unarmed {
    margin: 0;
  }
</style>
