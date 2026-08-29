<script lang="ts">
  // Подсказка. Работает тремя способами, и это не роскошь:
  //
  //  - наведение — десктоп;
  //  - фокус с клавиатуры — иначе подсказка недоступна без мыши;
  //  - НАЖАТИЕ — мобильный. Наведения там нет вовсе, и подсказка,
  //    открывающаяся только по hover, на телефоне не существует.
  //
  // Закрывается по Esc и по клику вне: открытая подсказка, которую нечем
  // убрать, хуже отсутствующей.
  //
  // Позиционируется чистым CSS, но края экрана поправляются числом: на 390px
  // подсказка у правой кнопки иначе уезжает за границу окна по горизонтали,
  // а длинное описание умения у верхнего края — за верх экрана. Горизонталь
  // лечится сдвигом, вертикаль — переворотом на другую сторону хоста.
  // Замер идёт по требованию, при открытии, — не на каждый кадр.
  import type { Snippet } from 'svelte'

  interface Props {
    text: string
    placement?: 'top' | 'bottom'
    // Ширина пузыря; узкая подсказка читается лучше широкой.
    width?: 'auto' | 'wide'
    // Показать пузырь принудительно, без наведения — для витрины примитивов.
    open?: boolean
    // Хост во всю ширину: подсказка оборачивает элемент сетки или колонки.
    block?: boolean
    children: Snippet
  }
  let {
    text,
    placement = 'top',
    width = 'auto',
    open = false,
    block = false,
    children,
  }: Props = $props()

  let host = $state<HTMLElement | null>(null)
  let bubble = $state<HTMLElement | null>(null)
  /** Открыта нажатием: живёт до Esc, клика вне или повторного нажатия. */
  let pinned = $state(false)
  /** Сдвиг пузыря по горизонтали, чтобы он не вылезал за край окна. */
  let shift = $state(0)
  /** Пузырь не влез со своей стороны — показываем с противоположной. */
  let flipped = $state(false)

  const shown = $derived(open || pinned)
  const side = $derived(flipped ? (placement === 'top' ? 'bottom' : 'top') : placement)

  function clamp(): void {
    if (!bubble) return
    // Сначала снимаем прежние поправки, иначе замеряем уже поправленное.
    shift = 0
    flipped = false
    requestAnimationFrame(() => {
      if (!bubble) return
      const rect = bubble.getBoundingClientRect()
      const margin = 8
      if (rect.left < margin) shift = margin - rect.left
      else if (rect.right > window.innerWidth - margin) {
        shift = window.innerWidth - margin - rect.right
      }
      if (placement === 'top' && rect.top < margin) flipped = true
      else if (placement === 'bottom' && rect.bottom > window.innerHeight - margin) flipped = true
    })
  }

  function toggle(event: MouseEvent): void {
    // Нажатие открывает подсказку, но не мешает кнопке под ней сработать:
    // это подсказка, а не модалка.
    void event
    pinned = !pinned
    if (pinned) clamp()
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && pinned) {
      pinned = false
      event.stopPropagation()
    }
  }

  function onPointerDown(event: PointerEvent): void {
    if (!pinned || !host) return
    if (!host.contains(event.target as Node)) pinned = false
  }

  $effect(() => {
    if (!pinned) return
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  })
</script>

<svelte:window onkeydown={onKey} />

<!-- Обёртка ловит нажатие ради мобильных: клавиатуре она не нужна вовсе —
     с клавиатуры подсказка открывается фокусом на вложенном элементе,
     а закрывается по Esc (обработчик на window выше). Поэтому отдельного
     клавиатурного обработчика здесь нет и быть не должно. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<span
  class="host"
  class:block
  bind:this={host}
  onclick={toggle}
  onmouseenter={clamp}
  onfocusin={clamp}
>
  {@render children()}
  <span
    class="bubble {side} {width}"
    class:open={shown}
    bind:this={bubble}
    style="--shift: {shift}px"
    role="tooltip">{text}</span
  >
</span>

<style>
  .host {
    position: relative;
    display: inline-flex;
  }
  .host.block {
    display: flex;
    width: 100%;
  }
  /* Недоступная кнопка внутри подсказки не должна съедать нажатие.
     Браузер не шлёт событий с disabled-элементов вообще, и без этого
     подсказка у выключенной кнопки на телефоне не открывалась бы НИКОГДА —
     а именно там она и нужна: игрок хочет знать, почему нельзя нажать.
     :global здесь обязателен: кнопка приходит из другого компонента. */
  .host :global(:disabled) {
    pointer-events: none;
  }
  .bubble {
    position: absolute;
    left: 50%;
    /* --shift держит пузырь в пределах окна на узком экране. */
    transform: translateX(calc(-50% + var(--shift, 0px)));
    z-index: 50;
    width: max-content;
    max-width: min(18rem, calc(100vw - 2 * var(--space-4)));
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-md);
    background: var(--c-surface-raised);
    box-shadow: var(--shadow-md);
    color: var(--c-text);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    text-align: left;
    /* Переносы строк из текста подсказки сохраняем как есть. */
    white-space: pre-line;
    opacity: 0;
    visibility: hidden;
    transition:
      opacity var(--dur-fast) ease,
      visibility var(--dur-fast);
    pointer-events: none;
  }
  .bubble.wide {
    max-width: min(24rem, calc(100vw - 2 * var(--space-4)));
  }
  .bubble.top {
    bottom: calc(100% + var(--space-2));
  }
  .bubble.bottom {
    top: calc(100% + var(--space-2));
  }
  .bubble.open,
  .host:hover .bubble,
  .host:focus-within .bubble {
    opacity: 1;
    visibility: visible;
  }
  /* На узком экране наведения нет: подсказка открывается НАЖАТИЕМ и живёт,
     пока её не закроют. Наведённое состояние там только мешало бы попасть
     пальцем по кнопке под пузырём. */
  @media (max-width: 719px) {
    .host:hover .bubble:not(.open),
    .host:focus-within .bubble:not(.open) {
      opacity: 0;
      visibility: hidden;
    }
  }
</style>
