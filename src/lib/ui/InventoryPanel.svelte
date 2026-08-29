<script lang="ts">
  import {
    Decimal,
    compareItem,
    disenchantStatus,
    enchantModifiers,
    enchantOf,
    formatNumber,
    sellPrice,
    upgradeShare,
    INVENTORY_SIZE,
    type DisenchantBlockReason,
    type EquipComparison,
  } from '../game'
  import { SLOT_NAMES } from '../data/slots'
  import {
    disenchantInventoryItem,
    equipInventoryItem,
    gameState,
    sellInventoryItem,
  } from '../stores/game'
  import ItemMods from './ItemMods.svelte'
  import { RARITY_BY_ID } from '../data/rarity'
  import { Button, IconSlot, NumberText, Panel, Tag } from './kit'

  const emptySlots = $derived(Math.max(0, INVENTORY_SIZE - $gameState.inventory.length))

  // МЕТКА АПГРЕЙДА — то, ради чего снесено автонадевание. Видно не только
  // «лучше», но и НА СКОЛЬКО: доля прироста урона в секунду. Считается тем
  // же estimateCombatRate, что и сравнение под курсором, — двух мер
  // «хорошести» в игре нет.
  const shares = $derived(
    new Map($gameState.inventory.map((i) => [i.id, upgradeShare($gameState, i)])),
  )
  // Сортировка одна и по делу: сверху то, что сильнее всего поднимет урон.
  const sorted = $derived(
    [...$gameState.inventory].sort(
      (a, b) => (shares.get(b.id) ?? -1) - (shares.get(a.id) ?? -1),
    ),
  )
  function upgradeLabel(share: number | null | undefined): string | null {
    if (share === null || share === undefined) return null
    if (!Number.isFinite(share)) return 'слот пуст'
    return `+${Math.round(share * 100)}%`
  }

  // Сравнение считаем только для предмета под курсором: заглядывать в будущее
  // для всего инвентаря каждый кадр незачем.
  let hovered = $state<string | null>(null)
  const comparison = $derived.by((): EquipComparison | null => {
    const item = $gameState.inventory.find((i) => i.id === hovered)
    return item ? compareItem($gameState, item) : null
  })

  // Распыление живёт ЗДЕСЬ, рядом с продажей: это две половины одного
  // решения — «что делать с находкой», — и разносить их по экранам нельзя.
  const DISENCHANT_REASON: Record<DisenchantBlockReason, string> = {
    locked: 'Распыление откроется на 50 уровне',
    equipped: 'Сперва сними предмет',
    missing: 'Предмета больше нет',
  }
  // Подтверждение спрашивается ТОЛЬКО у зачарованной вещи: лишний клик на
  // каждую находку убил бы разбор сумки.
  let confirming = $state<string | null>(null)

  const seconds = (v: number) => `${v.toFixed(2)}с`
  // Урон в секунду растёт неограниченно: пока читается — десятые доли,
  // дальше короткая запись formatNumber.
  const dps = (value: Decimal) => (value.lt(1000) ? value.toFixed(1) : formatNumber(value))
</script>

<Panel
  title="Инвентарь"
  subtitle="{$gameState.inventory.length} из {INVENTORY_SIZE} слотов{$gameState.enchantDust.gt(0)
    ? ` · ${formatNumber($gameState.enchantDust)} пыли`
    : ''}"
>
  <div class="grid">
    {#each sorted as item (item.id)}
      {@const share = shares.get(item.id)}
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
        <!-- Уровень вещи — её главная сила: без него «Редкий» 3-го уровня
             выглядел бы равным «Редкому» 60-го. -->
        <Tag rarity={item.rarity} label="{RARITY_BY_ID[item.rarity].name} · {item.level} ур." />
        {#if upgradeLabel(share)}
          <span class="upgrade" data-upgrade>Апгрейд {upgradeLabel(share)}</span>
        {/if}
        <ItemMods mods={item.mods} />
        {#if enchantOf(item)}
          <span class="enchant">Зачаровано: {enchantOf(item)?.name}</span>
          <ItemMods mods={enchantModifiers(item)} />
        {/if}

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
          {@const dis = disenchantStatus($gameState, item.id)}
          {#if confirming === item.id}
            <span class="warn">
              На вещи «{enchantOf(item)?.name}» — она исчезнет вместе с ней.
            </span>
            <Button
              size="sm"
              variant="primary"
              onclick={() => {
                disenchantInventoryItem(item.id)
                confirming = null
              }}
            >
              Всё равно распылить
            </Button>
            <Button size="sm" onclick={() => (confirming = null)}>Отмена</Button>
          {:else}
            <Button size="sm" variant="primary" onclick={() => equipInventoryItem(item.id)}>
              Надеть
            </Button>
            <Button size="sm" onclick={() => sellInventoryItem(item.id)}>
              Продать за {formatNumber(sellPrice(item))}
            </Button>
            {#if dis.reason !== 'locked'}
              <Button
                size="sm"
                disabled={!dis.canDisenchant}
                title={dis.reason ? DISENCHANT_REASON[dis.reason] : 'Предмет исчезнет навсегда'}
                onclick={() =>
                  item.enchantId ? (confirming = item.id) : disenchantInventoryItem(item.id)}
              >
                Распылить · {formatNumber(dis.dust)} пыли
              </Button>
            {/if}
          {/if}
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
  .enchant {
    font-size: var(--text-xs);
    color: var(--c-accent);
  }
  .warn {
    font-size: var(--text-xs);
    color: var(--c-warning);
  }
  .name {
    font-weight: var(--weight-bold);
  }
  /* Апгрейд обязан быть виден без наведения: ради этого мгновения лут
     и существует. Цвет — здоровья: «стало лучше», а не «тут урон». */
  .upgrade {
    align-self: flex-start;
    font-size: var(--text-2xs);
    font-weight: var(--weight-bold);
    color: var(--c-heal);
    border: 1px solid var(--c-heal);
    border-radius: var(--radius-sm);
    padding: 0 var(--space-1);
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
