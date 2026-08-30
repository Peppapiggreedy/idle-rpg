<script lang="ts">
  import {
    Decimal,
    disenchantStatus,
    equipStatus,
    enchantModifiers,
    enchantOf,
    formatNumber,
    sellPrice,
    upgradeShare,
    INVENTORY_SIZE,
    type DisenchantBlockReason,
  } from '../game'
  import { EQUIP_BLOCK_TEXT, GRIP_TEXT } from './itemText'
  import { SLOT_NAMES } from '../data/slots'
  import {
    disenchantInventoryItem,
    equipInventoryItem,
    gameState,
    sellInventoryItem,
  } from '../stores/game'
  import ItemMods from './ItemMods.svelte'
  import EnchantLine from './EnchantLine.svelte'
  import ItemCompare from './ItemCompare.svelte'
  import { RARITY_BY_ID } from '../data/rarity'
  import { Button, IconSlot, Panel, Tag } from './kit'

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

  /**
   * ОКНО СРАВНЕНИЯ. Живёт отдельно от карточки и позиционируется по курсору.
   *
   * Раньше сравнение раскрывалось внутри карточки: она росла, и кнопки
   * «Продать» и «Распылить» уезжали из-под курсора ровно тогда, когда игрок
   * к ним тянулся. Теперь карточка при наведении не меняет ни высоту, ни
   * содержимое — двигается только это окно.
   *
   * `pinned` — тач: наведения там нет вовсе, поэтому окно открывается
   * нажатием по иконке и закрывается нажатием вне или по Esc.
   */
  let compare = $state<{ id: string; x: number; y: number } | null>(null)
  let pinned = $state(false)
  const compareItemOf = $derived(
    compare ? ($gameState.inventory.find((i) => i.id === compare!.id) ?? null) : null,
  )

  function track(event: MouseEvent, id: string) {
    if (pinned) return
    compare = { id, x: event.clientX, y: event.clientY }
  }
  function unhover(id: string) {
    if (pinned) return
    if (compare?.id === id) compare = null
  }
  /** Нажатие по иконке: на тач-экране это единственный способ открыть окно. */
  function toggle(event: MouseEvent, id: string) {
    if (pinned && compare?.id === id) {
      pinned = false
      compare = null
      return
    }
    pinned = true
    compare = { id, x: event.clientX, y: event.clientY }
  }
  function dismiss() {
    pinned = false
    compare = null
  }
</script>

<svelte:window
  onkeydown={(e) => e.key === 'Escape' && dismiss()}
  onpointerdown={(e) => {
    // Клик ВНЕ карточки закрывает прикреплённое окно. Кнопки внутри
    // карточки остаются своими целями нажатия — окно мышь не ловит.
    if (pinned && !(e.target as HTMLElement)?.closest?.('[data-item-card]')) dismiss()
  }}
/>

<Panel
  title="Инвентарь"
  subtitle="{$gameState.inventory.length} из {INVENTORY_SIZE} слотов{$gameState.enchantDust.gt(0)
    ? ` · ${formatNumber($gameState.enchantDust)} пыли`
    : ''}"
>
  <div class="grid" data-item-card>
    {#each sorted as item (item.id)}
      {@const share = shares.get(item.id)}
      <IconSlot
        slotLabel={SLOT_NAMES[item.slot]}
        rarity={item.rarity}
        active={compare?.id === item.id}
        interactive
        onmouseenter={(e: MouseEvent) => track(e, item.id)}
        onmousemove={(e: MouseEvent) => track(e, item.id)}
        onmouseleave={() => unhover(item.id)}
        onclick={(e: MouseEvent) => toggle(e, item.id)}
      >
        <span class="name">{item.name}</span>
        <!-- Уровень вещи — её главная сила: без него «Редкий» 3-го уровня
             выглядел бы равным «Редкому» 60-го. -->
        <Tag rarity={item.rarity} label="{RARITY_BY_ID[item.rarity].name} · {item.level} ур." />
        {#if upgradeLabel(share)}
          <span class="upgrade" data-upgrade>Апгрейд {upgradeLabel(share)}</span>
        {/if}
        {#if item.grip}
          <span class="grip">{GRIP_TEXT[item.grip]}</span>
        {/if}
        <ItemMods mods={item.mods} />
        <EnchantLine {item} />

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
            {@const eq = equipStatus($gameState, item)}
            <Button
              size="sm"
              variant="primary"
              disabled={!eq.canEquip}
              title={eq.reason ? EQUIP_BLOCK_TEXT[eq.reason] : ''}
              onclick={() => equipInventoryItem(item.id)}
            >
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
            <!-- Причина СТРОКОЙ, а не только подсказкой кнопки: на телефоне
                 наведения нет вовсе, и выключенная кнопка без объяснения
                 читается как поломка. -->
            {#if eq.reason}
              <span class="deny">{EQUIP_BLOCK_TEXT[eq.reason]}</span>
            {/if}
          {/if}
        {/snippet}
      </IconSlot>
    {/each}
    {#each Array(emptySlots) as _, i (i)}
      <IconSlot emptyText="—" />
    {/each}
  </div>

  {#if compareItemOf && compare}
    <ItemCompare item={compareItemOf} x={compare.x} y={compare.y} />
  {/if}

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
  .grip {
    font-size: var(--text-2xs);
    color: var(--c-text-faint);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
  }
  .deny {
    font-size: var(--text-2xs);
    color: var(--c-warning);
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
  .hint {
    margin: 0;
  }
</style>
