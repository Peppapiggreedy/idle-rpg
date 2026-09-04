<script lang="ts">
  // Столбец кнопок меню. Один столбец — один вызов: слева «где меняешь»,
  // справа «где читаешь». Какая кнопка на какой стороне, решают ДАННЫЕ
  // (`MENU_SIDE` в stores/ui.ts), а не порядок в разметке.
  //
  // Кнопки одинаковы по виду и размеру: иконка плюс короткая подпись.
  // Высота — тот же токен `--action-slot`, что у кнопок действий: размеров
  // кнопки на экране ровно один, и подбирать его на глаз не приходится.
  // Ширину задаёт самая длинная подпись столбца, а не число: семь кнопок
  // фиксированной ширины съели бы ту ширину, которая нужна сцене.
  import { MENU_LOOK } from './menuText'
  import { menusOn, openMenu, toggleMenu, type MenuId, type MenuSide } from '../stores/ui'
  import { Icon } from './icons'

  interface Props {
    side: MenuSide
    /** Уровень героя: кнопка, до которой он не дорос, не показывается. */
    level?: number
    /** Точка на кнопке: есть что посмотреть. Ключ — id меню. */
    marks?: Partial<Record<MenuId, boolean>>
    /** Приписка под названием: счётчик сумки и такое же. */
    notes?: Partial<Record<MenuId, string>>
  }
  let { side, level = Number.POSITIVE_INFINITY, marks = {}, notes = {} }: Props = $props()

  // ЗАКРЫТОЕ НЕ ВИДНО ВОВСЕ — И ЭТО ОТНОСИТСЯ К КНОПКАМ, а не только к
  // панелям за ними. Порог берёт `menusOn` из данных меню; своих чисел
  // здесь нет.
  const ids = $derived(menusOn(side, level))
</script>

<nav class="menus {side}" aria-label={side === 'left' ? 'Меню: где меняешь' : 'Меню: где читаешь'}>
  {#each ids as id (id)}
    <button
      type="button"
      class="menu"
      class:open={$openMenu === id}
      aria-pressed={$openMenu === id}
      onclick={() => toggleMenu(id)}
    >
      <Icon name={MENU_LOOK[id].icon} size="md" />
      <span class="title">{MENU_LOOK[id].title}</span>
      {#if notes[id]}<span class="note">{notes[id]}</span>{/if}
      {#if marks[id]}<span class="mark" aria-hidden="true"></span>{/if}
    </button>
  {/each}
</nav>

<style>
  .menus {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: 0 0 auto;
  }
  .menu {
    position: relative;
    min-height: var(--action-slot);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    padding: var(--space-1);
    font: inherit;
    color: var(--c-text-muted);
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
      border-color var(--dur-fast) ease,
      color var(--dur-fast) ease;
  }
  .menu:hover {
    border-color: var(--c-accent);
    color: var(--c-text);
  }
  .menu.open {
    border-color: var(--c-accent);
    color: var(--c-accent);
    background: var(--c-surface-raised);
  }
  .title {
    font-size: var(--text-2xs);
    line-height: 1;
    text-align: center;
  }
  .note {
    font-size: var(--text-2xs);
    line-height: 1;
    color: var(--c-text-faint);
    font-variant-numeric: tabular-nums;
  }
  /* Точка «есть что посмотреть»: свободные очки, апгрейд в сумке. */
  .mark {
    position: absolute;
    top: var(--space-1);
    right: var(--space-1);
    width: var(--space-2);
    height: var(--space-2);
    border-radius: 50%;
    background: var(--c-xp);
  }

  /* Столбец ЛИПНЕТ К ВЕРХУ ОКНА. Меню бывают длинными — дерево талантов
     на десять экранов, — и кнопка «закрыть это и открыть то» не должна
     уезжать за край вместе с содержимым. Заодно столбец не доезжает до
     правого нижнего угла: там при открытом меню стоит уменьшенная сцена. */
  @media (min-width: 720px) {
    .menus {
      position: sticky;
      top: var(--space-3);
    }
  }

  /* НА УЗКОМ ЭКРАНЕ СТОЛБЦОВ НЕТ: обе стороны сливаются в одну панель,
     прибитую к низу экрана, и кнопки идут в ряд. Держать по краям сцены
     два столбца шириной в кнопку значило бы отдать им треть ширины. */
  @media (max-width: 719px) {
    /* Панель прибита к НИЗУ ОКНА, а не стоит в потоке: до низа достаёт
       большой палец, и полоса не уезжает вместе с содержимым. Именно fixed,
       а не sticky: у sticky с bottom:0 полоса пропадает, как только под ней
       кончается страница. Место в конце страницы под неё резервирует App.

       Ширины сторон делят полосу по числу кнопок — пять слева и две
       справа, — поэтому все семь выходят одинаковыми. Правило «слева
       меняешь, справа читаешь» держится и лёжа. */
    .menus {
      position: fixed;
      bottom: 0;
      z-index: 80;
      flex-direction: row;
      gap: var(--space-1);
      height: var(--tabbar-height);
      padding: var(--space-1);
      background: var(--c-surface);
      border-top: 1px solid var(--c-border);
    }
    .menus.left {
      left: 0;
      right: 28.57%;
    }
    .menus.right {
      left: 71.43%;
      right: 0;
    }
    .menu {
      flex: 1 1 0;
      min-width: 0;
      min-height: 44px;
    }
    /* Подписи на телефоне мельче: семь штук в полосе, и место есть только
       под иконку и одно слово. */
    .title {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      max-width: 100%;
    }
  }
</style>
