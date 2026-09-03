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
    /**
     * Роль ячейки в перетаскивании. Про сам инвентарь примитив по-прежнему
     * не знает — это чистое состояние вида:
     *   'carried' — вещь взята в руку и ждёт, куда её положат;
     *   'target'  — сюда можно положить то, что несут;
     *   'dim'     — сюда нельзя, ячейка приглушена.
     */
    drop?: 'carried' | 'target' | 'dim'
    draggable?: boolean
    children?: Snippet
    footer?: Snippet
    // Событие приходит целиком: сравнение предметов позиционируется по
    // курсору, и без координат окно пришлось бы ставить наугад.
    onmouseenter?: (event: MouseEvent) => void
    onmousemove?: (event: MouseEvent) => void
    onmouseleave?: (event: MouseEvent) => void
    onfocusin?: (event: FocusEvent) => void
    onclick?: (event: MouseEvent) => void
    ondblclick?: (event: MouseEvent) => void
    onkeydown?: (event: KeyboardEvent) => void
    onpointerdown?: (event: PointerEvent) => void
    onpointerup?: (event: PointerEvent) => void
    onpointercancel?: (event: PointerEvent) => void
    ondragstart?: (event: DragEvent) => void
    ondragover?: (event: DragEvent) => void
    ondrop?: (event: DragEvent) => void
    ondragend?: (event: DragEvent) => void
    /** Подпись ячейки для клавиатуры и чтения с экрана. */
    ariaLabel?: string
  }
  let {
    slotLabel,
    rarity,
    emptyText = 'пусто',
    badge,
    active = false,
    interactive = false,
    drop,
    draggable = false,
    children,
    footer,
    onmouseenter,
    onmousemove,
    onmouseleave,
    onfocusin,
    onclick,
    ondblclick,
    onkeydown,
    onpointerdown,
    onpointerup,
    onpointercancel,
    ondragstart,
    ondragover,
    ondrop,
    ondragend,
    ariaLabel,
  }: Props = $props()
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="slot"
  class:filled={rarity !== undefined}
  class:active
  class:carried={drop === 'carried'}
  class:target={drop === 'target'}
  class:dim={drop === 'dim'}
  style={rarity ? rarityStyle(rarity) : undefined}
  tabindex={interactive ? 0 : undefined}
  role={interactive ? 'button' : undefined}
  aria-label={ariaLabel}
  {draggable}
  data-drop={drop}
  {onmouseenter}
  {onmousemove}
  {onmouseleave}
  {onfocusin}
  {onclick}
  {ondblclick}
  {onkeydown}
  {onpointerdown}
  {onpointerup}
  {onpointercancel}
  {ondragstart}
  {ondragover}
  {ondrop}
  {ondragend}
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
  /* ФОКУС ВИДЕН. Ячейка получает фокус с клавиатуры, и без кольца непонятно,
     куда именно уедет Enter. Цвет — взаимодействия: это «сюда сейчас
     нажмут», а не «тут урон». */
  .slot:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  /* Вещь взята в руку: ячейка притушена и обведена цветом взаимодействия —
     видно, что она сейчас «в воздухе», а не лежит на месте. */
  .slot.carried {
    border-style: dashed;
    border-color: var(--c-accent);
    opacity: 0.7;
  }
  /* Сюда можно положить. Подсветка идёт РАМКОЙ И ФОНОМ, а не цветом текста:
     на кукле семь ячеек, и разницу надо видеть боковым зрением. */
  .slot.target {
    border-style: solid;
    border-color: var(--c-accent);
    background: color-mix(in srgb, var(--c-accent) var(--tint-weak), var(--c-surface-sunken));
  }
  /* Сюда нельзя — ячейка уходит на задний план. Не прячется: слот остаётся
     виден, просто перестаёт звать. */
  .slot.dim {
    opacity: 0.35;
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
