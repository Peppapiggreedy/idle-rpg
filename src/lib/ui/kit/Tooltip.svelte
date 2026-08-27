<script lang="ts">
  // Подсказка на наведении и на фокусе. Позиционируется чистым CSS: никакого
  // измерения на JS, поэтому подсказка не может «поехать» на ретике.
  // Текст многострочный — переносы по \n сохраняются.
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
</script>

<span class="host" class:block>
  {@render children()}
  <span class="bubble {placement} {width}" class:open role="tooltip">{text}</span>
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
  .bubble {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    z-index: 50;
    width: max-content;
    max-width: 18rem;
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
    max-width: 24rem;
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
  /* На узком экране подсказка на наведении бесполезна и только мешает
     попасть пальцем по кнопке под ней. */
  @media (max-width: 719px) {
    .bubble:not(.open) {
      display: none;
    }
  }
</style>
