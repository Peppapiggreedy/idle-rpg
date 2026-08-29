<script lang="ts">
  // Выдвижка поверх нижней части экрана. Их две на игру: «Герой» и «Журнал».
  //
  // ПОЧЕМУ ИМЕННО ПОВЕРХ, а не в потоке. Боевая сцена — главный элемент
  // экрана, и открытие панели не должно её ни сдвигать, ни ужимать: игрок
  // смотрит в бой, а не в вёрстку. Поэтому лист прибит к низу окна
  // (position: fixed) и растёт вверх, а не раздвигает страницу. Закреплено
  // тестом, который меряет бокс сцены до и после открытия.
  import type { Snippet } from 'svelte'
  import { Icon, type IconName } from './icons'

  interface Props {
    title: string
    icon: IconName
    open: boolean
    onToggle: () => void
    /** Короткая приписка на кнопке: сколько очков, сколько строк. */
    badge?: string
    children: Snippet
  }
  let { title, icon, open, onToggle, badge, children }: Props = $props()
</script>

<button
  type="button"
  class="handle"
  class:open
  aria-expanded={open}
  onclick={onToggle}
>
  <Icon name={icon} size="sm" />
  <span class="label">{title}</span>
  {#if badge}<span class="badge">{badge}</span>{/if}
</button>

{#if open}
  <!-- Содержимое рендерится ТОЛЬКО открытым: свёрнутая выдвижка не должна
       стоить ни узлов DOM, ни подписок на стор. Бюджет узлов за полчаса
       игры проверяется тестом, и постоянно живой скрытый журнал в него
       не влез бы. -->
  <div class="sheet" role="region" aria-label={title}>
    <div class="head">
      <h2>{title}</h2>
      <button type="button" class="close" onclick={onToggle} aria-label="Закрыть">×</button>
    </div>
    <div class="body">
      {@render children()}
    </div>
  </div>
{/if}

<style>
  .handle {
    font: inherit;
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--c-text-muted);
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    min-height: var(--tap-min);
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    transition:
      background var(--dur-fast) ease,
      color var(--dur-fast) ease;
  }
  .handle:hover {
    color: var(--c-text);
    background: var(--c-surface-raised);
  }
  .handle.open {
    color: var(--c-bg);
    background: var(--c-accent);
    border-color: var(--c-accent);
  }
  .badge {
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    /* Над нижней панелью вкладок: на мобильном она прибита к низу окна. */
    bottom: var(--tabbar-height);
    z-index: 30;
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    background: var(--c-surface);
    border-top: 1px solid var(--c-border-strong);
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    box-shadow: var(--shadow-lg);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--c-border);
  }
  h2 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-bold);
    color: var(--c-text);
  }
  .close {
    font: inherit;
    font-size: var(--text-lg);
    line-height: 1;
    color: var(--c-text-muted);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    min-width: var(--tap-min);
    min-height: var(--tap-min);
    cursor: pointer;
  }
  .close:hover {
    color: var(--c-text);
  }
  .body {
    overflow-y: auto;
    padding: var(--space-3);
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
    align-items: start;
    min-width: 0;
  }

  @media (min-width: 720px) {
    .sheet {
      /* На десктопе вкладки стоят в потоке — резервировать под них нечего. */
      bottom: 0;
      /* Лист держится ширины основной колонки, а не всего монитора. */
      left: 50%;
      right: auto;
      transform: translateX(-50%);
      width: min(72rem, 100vw);
    }
    .body {
      grid-template-columns: 1fr 1fr;
      gap: var(--space-4);
    }
  }
</style>
