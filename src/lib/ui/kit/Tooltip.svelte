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
  // ПОДСКАЗКА ПРИЛИПАЛА, И ПРИЧИН БЫЛО ДВЕ. Обе чинятся здесь, и чинить надо
  // ОБЕ: правка одной оставила бы находку живой.
  //
  //  1. `onclick` на обёртке безусловно делал `pinned = !pinned`. Механика
  //     нажатия заведена ради тач-экранов, где наведения нет вовсе, — но
  //     применялась и к обычному клику мышью. Игрок применял умение мышкой,
  //     и описание оставалось висеть над рядом действий.
  //  2. Видимость держал CSS-селектор `:focus-within`, а обработчика
  //     `focusout` не было вовсе. Chrome фокусирует кнопку на mousedown, и
  //     пузырь жил, пока фокус не уйдёт. У умения, ушедшего в откат, это
  //     самоустранялось (`disabled` снимает фокус), у зелья и кнопки
  //     автокаста — нет.
  //
  // ТЕПЕРЬ ВИДИМОСТЬ — СОСТОЯНИЕ, А НЕ СЕЛЕКТОР. CSS умеет показать пузырь
  // по `:hover`, но не умеет его СНЯТЬ по нашему правилу: закрыть надо и по
  // применению умения, и по прокрутке, и по Escape. Три источника
  // (наведение, фокус, тач-прикрепление) сведены в три флага, и каждый
  // гасится своим событием.
  //
  // ПРИКРЕПЛЕНИЕ ОСТАЛОСЬ, НО ТОЛЬКО ДЛЯ ТАЧ-УКАЗАТЕЛЯ. На телефоне это
  // ЕДИНСТВЕННЫЙ способ прочитать подсказку — наведения там не существует.
  // Мышь его больше не включает: клик мышью, наоборот, гасит подсказку,
  // потому что клик мышью по кнопке умения — это применение умения.
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
  /** Прикреплена тач-нажатием: живёт до Esc, нажатия вне или повторного тапа. */
  let pinned = $state(false)
  /** Курсор над хостом. Раньше это знал только CSS, и снять было нечем. */
  let hovered = $state(false)
  /**
   * Фокус пришёл С КЛАВИАТУРЫ. Не «фокус вообще»: кнопка получает фокус и от
   * мыши, и именно это держало пузырь после применения умения.
   */
  let keyboard = $state(false)
  /** Место пузыря в координатах окна: считает JS, потому что позиция fixed. */
  let pos = $state({ left: 0, top: 0 })
  /** Пузырь не влез со своей стороны — показываем с противоположной. */
  let flipped = $state(false)

  const shown = $derived(open || pinned || hovered || keyboard)
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

  /** Погасить все три источника разом: одно правило закрытия на все пути. */
  function dismiss(): void {
    pinned = false
    hovered = false
    keyboard = false
  }

  function onPointerUp(event: PointerEvent): void {
    // ТАЧ — ЕДИНСТВЕННЫЙ, КТО ПРИКРЕПЛЯЕТ. Наведения на телефоне нет, и без
    // прикрепления подсказка там не существовала бы вовсе. Перо считаем
    // тачем: у него тоже нет устойчивого наведения.
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      pinned = !pinned
      if (pinned) schedule()
      return
    }
    // МЫШЬ ГАСИТ. Клик мышью по кнопке умения — это применение умения, и
    // описание над рядом действий после него висеть не должно.
    dismiss()
  }

  function onEnter(): void {
    hovered = true
    schedule()
  }

  function onLeave(): void {
    hovered = false
  }

  function onFocusIn(event: FocusEvent): void {
    // ТОЛЬКО КЛАВИАТУРНЫЙ ФОКУС. `:focus-visible` — ровно то различие,
    // которого не хватало: Tab подсказку открывает, клик мышью нет.
    const target = event.target as Element | null
    if (!target || typeof target.matches !== 'function') return
    if (!target.matches(':focus-visible')) return
    keyboard = true
    schedule()
  }

  function onFocusOut(): void {
    keyboard = false
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && (pinned || hovered || keyboard)) {
      dismiss()
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

  // ПРОКРУТКА ГАСИТ ПОДСКАЗКУ, А НЕ ПЕРЕСТАВЛЯЕТ ЕЁ. Пузырь `fixed`, то есть
  // за хостом он не едет; раньше место пересчитывалось на каждый скролл, и
  // подсказка ползла по экрану за уехавшей кнопкой. Игрок, который начал
  // прокручивать, читает уже другое — закрыть честнее, чем догонять.
  // Поворот телефона (`resize`) — то же самое.
  $effect(() => {
    if (!shown || open) return
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
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
  onpointerup={onPointerUp}
  onmouseenter={onEnter}
  onmouseleave={onLeave}
  onfocusin={onFocusIn}
  onfocusout={onFocusOut}
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
  /* ВИДИМОСТЬ — ТОЛЬКО ПО СОСТОЯНИЮ. Селекторов `:hover` и `:focus-within`
     здесь больше нет намеренно: CSS умеет пузырь показать, но не умеет снять
     его по нашему правилу — закрыть надо и по применению умения, и по
     прокрутке, и по Escape. Пока показ шёл селектором, а снятие состоянием,
     они спорили, и подсказка переживала клик мышью.
     Медиазапрос про узкий экран тоже ушёл: наведения на телефоне не бывает,
     и гасить нечего — `hovered` там просто не включается. */
  .bubble.open {
    opacity: 1;
    visibility: visible;
  }
</style>
