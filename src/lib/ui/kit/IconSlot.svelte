<script lang="ts">
  // Ячейка предмета: рамка по редкости, состояние «пусто», подпись слота.
  // Про инвентарь и экипировку не знает — только пропсы.
  import type { Snippet } from 'svelte'
  import type { Rarity } from '../../types'
  import { rarityStyle } from './rarity'

  interface Props {
    // Подпись сверху мелким капсом: «Оружие», «Голова», …
    slotLabel?: string
    // Редкость содержимого; без неё ячейка считается пустой.
    rarity?: Rarity
    emptyText?: string
    /** Значок слота рядом с подписью: чей это слот, видно и когда он пуст. */
    badge?: Snippet
    // Ячейка выделена (выбрана, наведена, активна).
    active?: boolean
    interactive?: boolean
    children?: Snippet
    footer?: Snippet
    onmouseenter?: () => void
    onmouseleave?: () => void
    onfocusin?: () => void
  }
  let {
    slotLabel,
    rarity,
    emptyText = 'пусто',
    badge,
    active = false,
    interactive = false,
    children,
    footer,
    onmouseenter,
    onmouseleave,
    onfocusin,
  }: Props = $props()
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="slot"
  class:filled={rarity !== undefined}
  class:active
  style={rarity ? rarityStyle(rarity) : undefined}
  tabindex={interactive ? 0 : undefined}
  role={interactive ? 'group' : undefined}
  {onmouseenter}
  {onmouseleave}
  {onfocusin}
>
  {#if slotLabel || badge}
    <span class="slot-head">
      {#if badge}<span class="badge">{@render badge()}</span>{/if}
      {#if slotLabel}<span class="slot-label">{slotLabel}</span>{/if}
    </span>
  {/if}
  {#if rarity !== undefined}
    <div class="content">{@render children?.()}</div>
  {:else}
    <span class="empty">{emptyText}</span>
  {/if}
  {#if footer}<div class="foot">{@render footer()}</div>{/if}
</div>

<style>
  .slot {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: 6.5rem;
    padding: var(--space-2);
    border: 1px dashed var(--c-border);
    border-radius: var(--radius-md);
    background: var(--c-surface-sunken);
    font-size: var(--text-sm);
    text-align: left;
  }
  .slot:not(.filled) {
    min-height: 4rem;
  }
  .slot-head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  /* Значок слота приглушён: он подсказка «чей это слот», а не содержимое. */
  .badge {
    display: inline-flex;
    color: var(--c-text-faint);
  }
  .slot.filled {
    border: 1px solid color-mix(in srgb, var(--rarity-color) 70%, transparent);
    background: color-mix(in srgb, var(--rarity-color) var(--tint-weak), var(--c-surface-sunken));
  }
  .slot.active {
    box-shadow: inset 0 0 var(--space-2) color-mix(in srgb, var(--rarity-color) var(--tint), transparent);
  }
  .slot-label {
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--c-text-faint);
  }
  .content {
    display: flex;
    flex-direction: column;
    /* Ярлык редкости и кнопки — по содержимому, а не во всю ширину ячейки:
       колоночный flex иначе растягивает их до краёв. */
    align-items: flex-start;
    gap: var(--space-1);
    flex: 1;
  }
  .empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--c-text-faint);
    opacity: 0.6;
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-1);
  }
</style>
