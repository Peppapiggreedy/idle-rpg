<script lang="ts">
  // Кнопка игры. Про состояние не знает — только пропсы.
  // disabled и loading разведены: loading тоже не даёт нажать, но говорит
  // «идёт работа», а не «нельзя».
  import type { Snippet } from 'svelte'

  interface Props {
    variant?: 'primary' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
    disabled?: boolean
    loading?: boolean
    title?: string
    type?: 'button' | 'submit'
    // Растянуть на всю доступную ширину — для колонок и мобильной раскладки.
    block?: boolean
    onclick?: (event: MouseEvent) => void
    children: Snippet
  }
  let {
    variant = 'ghost',
    size = 'md',
    disabled = false,
    loading = false,
    title,
    type = 'button',
    block = false,
    onclick,
    children,
  }: Props = $props()

  const inert = $derived(disabled || loading)
</script>

<button
  {type}
  {title}
  class="btn {variant} {size}"
  class:block
  class:loading
  disabled={inert}
  aria-busy={loading}
  {onclick}
>
  {#if loading}<span class="spinner" aria-hidden="true"></span>{/if}
  <span class="label">{@render children()}</span>
</button>

<style>
  .btn {
    --btn-color: var(--c-text);
    --btn-border: var(--c-border-strong);
    --btn-bg: transparent;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    font: inherit;
    font-weight: var(--weight-medium);
    line-height: var(--leading-tight);
    color: var(--btn-color);
    background: var(--btn-bg);
    border: 1px solid var(--btn-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
      background var(--dur-fast) ease,
      border-color var(--dur-fast) ease,
      color var(--dur-fast) ease;
  }
  .btn.md {
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
  }
  .btn.sm {
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    border-radius: var(--radius-sm);
  }
  .btn.block {
    width: 100%;
  }

  .btn.primary {
    --btn-color: var(--c-bg);
    --btn-border: var(--c-accent);
    --btn-bg: var(--c-accent);
  }
  .btn.primary:hover:not(:disabled) {
    --btn-border: var(--c-accent-strong);
    --btn-bg: var(--c-accent-strong);
  }
  .btn.ghost:hover:not(:disabled) {
    --btn-border: var(--c-accent);
    --btn-color: var(--c-accent);
    --btn-bg: color-mix(in srgb, var(--c-accent) var(--tint-weak), transparent);
  }
  .btn.danger {
    --btn-color: var(--c-damage);
    --btn-border: color-mix(in srgb, var(--c-damage) 55%, transparent);
  }
  .btn.danger:hover:not(:disabled) {
    --btn-border: var(--c-damage);
    --btn-bg: color-mix(in srgb, var(--c-damage) var(--tint-weak), transparent);
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .btn.loading {
    /* Работа идёт — курсор ожидания, а не запрета. */
    cursor: progress;
    opacity: 0.8;
  }

  .spinner {
    width: 1em;
    height: 1em;
    flex: none;
    border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
    border-top-color: currentColor;
    border-radius: var(--radius-pill);
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  /* Уважаем системную настройку «меньше движения». */
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation-duration: 2s;
    }
  }
</style>
