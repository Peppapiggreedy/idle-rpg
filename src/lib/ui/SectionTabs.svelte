<script lang="ts">
  // Переключатель разделов. На десктопе — строка под сценой, на мобильном
  // прилипает к низу экрана: большой палец достаёт до низа, а не до верха.
  import { activeSection, SECTION_IDS, setSection, type SectionId } from '../stores/ui'

  interface Props {
    /** Сколько предметов в сумке — единственный счётчик, который стоит
     *  показывать на вкладке: игрок должен видеть, что она заполняется. */
    bagCount?: number
    bagLimit?: number
    /** Есть ли свободные очки талантов — точка на «Развитии». */
    hasPoints?: boolean
    /** Лежит ли в сумке апгрейд — точка на «Сумке». Выпадение вещи лучше
     *  надетой должно быть заметно и из другого раздела: ради этого
     *  мгновения лут и существует. */
    hasUpgrade?: boolean
  }
  let { bagCount = 0, bagLimit = 0, hasPoints = false, hasUpgrade = false }: Props = $props()

  const LABEL: Record<SectionId, string> = {
    progress: 'Развитие',
    bag: 'Сумка',
    world: 'Мир',
    settings: 'Настройки',
  }
</script>

<nav class="tabs" aria-label="Разделы">
  {#each SECTION_IDS as id (id)}
    <button
      type="button"
      class="tab"
      class:active={$activeSection === id}
      aria-current={$activeSection === id ? 'page' : undefined}
      onclick={() => setSection(id)}
    >
      <span class="label">{LABEL[id]}</span>
      {#if id === 'bag' && bagLimit > 0}
        <span class="badge" class:upgrade={hasUpgrade}>{bagCount}/{bagLimit}</span>
      {:else if id === 'progress' && hasPoints}
        <span class="dot" aria-label="есть свободные очки"></span>
      {/if}
    </button>
  {/each}
</nav>

<style>
  .tabs {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-1);
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    padding: var(--space-1);
  }
  .tab {
    position: relative;
    font: inherit;
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--c-text-muted);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    min-height: var(--tap-min);
    padding: var(--space-1);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    transition:
      background var(--dur-fast) ease,
      color var(--dur-fast) ease;
  }
  .tab:hover:not(.active) {
    color: var(--c-text);
    background: var(--c-surface-raised);
  }
  .tab.active {
    color: var(--c-bg);
    background: var(--c-accent);
  }
  .label {
    /* Длинные названия на узком экране переносить нельзя — вкладки поедут. */
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .badge {
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }
  .badge.upgrade {
    color: var(--c-heal);
    font-weight: var(--weight-bold);
    opacity: 1;
  }
  .tab.active .badge.upgrade {
    color: var(--c-bg);
  }
  .dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--c-xp);
  }
  .tab.active .dot {
    background: var(--c-bg);
  }

  @media (max-width: 719px) {
    /* Прибиваем к низу экрана: разделы переключаются нижними вкладками,
       и до них достаёт большой палец. Именно fixed, а не sticky: у sticky
       с bottom:0 полоса уезжает вверх, как только под ней кончается
       содержимое, — на длинном разделе она пропадала бы из виду.
       Место в конце страницы под неё резервирует App.svelte. */
    .tabs {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 20;
      height: var(--tabbar-height);
      border-radius: var(--radius-md) var(--radius-md) 0 0;
      border-bottom: none;
      box-shadow: var(--shadow-lg);
    }
  }
</style>
