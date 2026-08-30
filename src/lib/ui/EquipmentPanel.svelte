<script lang="ts">
  // Надетые предметы по слотам. Весь текст для игрока — здесь.
  import { formatNumber, INVENTORY_SIZE } from '../game'
  import { OFFHAND_PENALTY, UNARMED } from '../data/balance'
  import { SLOT_ICONS, SLOT_IDS, SLOT_NAMES } from '../data/slots'
  import { gameState, unequipSlot } from '../stores/game'
  import ItemMods from './ItemMods.svelte'
  import EnchantLine from './EnchantLine.svelte'
  import { GRIP_TEXT } from './itemText'
  import { RARITY_BY_ID } from '../data/rarity'
  import { Button, IconSlot, Panel, Tag } from './kit'
  import { Icon } from './icons'

  const inventoryFull = $derived($gameState.inventory.length >= INVENTORY_SIZE)
  // Двуручное занимает обе руки: левая не пуста, она ЗАНЯТА — и разницу
  // между «надень что-нибудь» и «сюда нельзя» игрок должен видеть.
  const twoHanded = $derived($gameState.equipment.mainHand?.grip === 'two')
</script>

<!-- Автонадевания больше нет: предметы надевает только игрок. Оно съедало
     то самое ощущение, ради которого лут и существует, — апгрейд проходил
     незамеченным. Что нашлось и насколько оно лучше, показывает сумка. -->
<Panel title="Экипировка">
  <div class="grid">
    {#each SLOT_IDS as slot (slot)}
      {@const item = $gameState.equipment[slot]}
      <IconSlot
        slotLabel={SLOT_NAMES[slot]}
        rarity={item?.rarity}
        active={item !== null}
        emptyText={slot === 'offHand' && twoHanded ? 'Занята двуручным' : 'пусто'}
      >
        {#snippet badge()}<Icon name={SLOT_ICONS[slot]} size="lg" />{/snippet}
        {#if item}
          <span class="name">{item.name}</span>
          <Tag rarity={item.rarity} label="{RARITY_BY_ID[item.rarity].name} · {item.level} ур." />
          {#if item.grip}<span class="grip">{GRIP_TEXT[item.grip]}</span>{/if}
          <!-- Зачарование НАДЕТОЙ вещи. Раньше здесь рисовались только
               item.mods, и наложенное зачарование работало (оно приходит в
               конвейер вместе с предметом), но нигде не было видно. -->
          <EnchantLine {item} />
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
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    gap: var(--space-2);
  }
  .name {
    font-weight: var(--weight-bold);
  }
  .grip {
    font-size: var(--text-2xs);
    color: var(--c-text-faint);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
  }
  .unarmed {
    margin: 0;
  }
</style>
