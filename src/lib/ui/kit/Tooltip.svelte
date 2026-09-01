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
  // ПОЗИЦИЯ — FIXED, И ЭТО НЕ ПРИДИРКА К СТИЛЮ.
  //
  // Пузырь висел `absolute` внутри хоста и клипался ЛЮБЫМ прокручиваемым
  // предком. Ряд действий под сценой — как раз такой: у него `overflow-x:
  // auto`, чтобы иконки прокручивались на узком экране. Подсказка умения
  // открывается ВВЕРХ, то есть целиком за пределы этого блока, и срезалась
  // до последнего пикселя.
  //
  // Хуже всего то, как это выглядело в прогоне: `getBoundingClientRect`
  // отдаёт неурезанный прямоугольник, а `getComputedStyle` — `visibility:
  // visible`. Playwright такой элемент считает видимым, поэтому ШЕСТЬ тестов
  // на подсказку были зелёными, пока игрок не видел ничего. Правка приезжала
  // дважды и дважды «не доезжала».
  //
  // `fixed` вырывает пузырь из всех клипов (у предков нет transform), но
  // тогда координаты обязан считать JS: CSS больше не знает, где хост.
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
  /** Место пузыря в координатах окна: считает JS, потому что позиция fixed. */
  let pos = $state({ left: 0, top: 0 })
  /** Пузырь не влез со своей стороны — показываем с противоположной. */
  let flipped = $state(false)

  const shown = $derived(open || pinned)
  const side = $derived(flipped ? (placement === 'top' ? 'bottom' : 'top') : placement)

  /** Отступ пузыря от хоста и от края окна. */
  const GAP = 8

  /**
   * Считает место для пузыря в координатах ОКНА.
   *
   * По горизонтали — по центру хоста, прижимаясь к краям; по вертикали —
   * со стороны `placement`, а если там не помещается, с противоположной.
   */
  function place(): void {
    if (!host || !bubble) return
    const h = host.getBoundingClientRect()
    const b = bubble.getBoundingClientRect()
    const w = b.width
    const hgt = b.height

    let left = h.left + h.width / 2 - w / 2
    left = Math.max(GAP, Math.min(left, window.innerWidth - GAP - w))

    const above = h.top - GAP - hgt
    const below = h.bottom + GAP
    let top: number
    if (placement === 'top') {
      flipped = above < GAP
      top = flipped ? below : above
    } else {
      flipped = below + hgt > window.innerHeight - GAP
      top = flipped ? above : below
    }
    // Последняя защита: не даём уехать за верх или низ окна.
    top = Math.max(GAP, Math.min(top, window.innerHeight - GAP - hgt))

    pos = { left, top }
  }

  /** Замер идёт ПОСЛЕ отрисовки: до неё у пузыря нет размеров. */
  function schedule(): void {
    place()
    requestAnimationFrame(place)
  }

  function toggle(event: MouseEvent): void {
    // Нажатие открывает подсказку, но не мешает кнопке под ней сработать:
    // это подсказка, а не модалка.
    void event
    pinned = !pinned
    if (pinned) schedule()
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

  // Витрина примитивов открывает пузырь пропсом, без наведения: место ему
  // всё равно нужно посчитать.
  $effect(() => {
    if (open) schedule()
  })

  // fixed НЕ ЕДЕТ ЗА ХОСТОМ. Пока подсказка приколота, страницу могут
  // прокрутить или повернуть телефон — пересчитываем, иначе пузырь останется
  // висеть там, где хоста уже нет.
  $effect(() => {
    if (!pinned) return
    const again = () => place()
    window.addEventListener('scroll', again, true)
    window.addEventListener('resize', again)
    return () => {
      window.removeEventListener('scroll', again, true)
      window.removeEventListener('resize', again)
    }
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
  onmouseenter={schedule}
  onfocusin={schedule}
>
  {@render children()}
  <span
    class="bubble {side} {width}"
    class:open={shown}
    bind:this={bubble}
    style="left: {pos.left}px; top: {pos.top}px"
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
    /* fixed, а не absolute: иначе любой прокручиваемый предок срезает пузырь
       (см. объяснение вверху файла). Координаты приходят из place(). */
    position: fixed;
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
