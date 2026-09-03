<script lang="ts">
  // АВТОКАСТ — ЭТО МЕНЮ, А НЕ ПЕРЕКЛЮЧАТЕЛЬ.
  //
  // Кнопка называлась «Автокаст» и делала одно: включала и выключала всю
  // ротацию. Настройки — какое умение жмётся, в каком порядке, сколько
  // ресурса беречь — лежали в «Талантах», то есть за кнопкой, которая про
  // другое. Теперь кнопка ОТКРЫВАЕТ настройки того ряда, рядом с которым
  // стоит, а общий выключатель стал строкой внутри них.
  //
  // Меню ведёт себя как остальные шесть: одно за раз, Esc закрывает,
  // повторное нажатие закрывает. Отличается только местом — оно не в
  // столбце, а в ряду действий (`MENU_SIDE.autocast === 'row'`).
  //
  // Состояние ротации кнопка ПОКАЗЫВАЕТ, но не заводит: «включён» — когда
  // хотя бы одно умение на автокасте. Полувключённого состояния у кнопки
  // нет, а полувключённая ротация есть, и честнее показать её включённой,
  // чем врать выключенной.
  import { abilitiesByPriority } from '../game'
  import { gameState } from '../stores/game'
  import { openMenu, toggleMenu } from '../stores/ui'
  import { Tooltip } from './kit'
  import { Icon } from './icons'

  const ordered = $derived(abilitiesByPriority($gameState.abilitySettings, false))
  const autocastOn = $derived(
    ordered.some((a) => $gameState.abilitySettings[a.id]?.autocast ?? false),
  )
  const open = $derived($openMenu === 'autocast')
</script>

<Tooltip
  text={autocastOn
    ? 'Автокаст включён: игра жмёт умения сама. Нажми — откроются настройки: что жать, в каком порядке и сколько ресурса беречь.'
    : 'Автокаст выключен: умения жмёшь ты. Нажми — откроются настройки ротации.'}
  width="wide"
>
  <button
    type="button"
    class="auto"
    class:on={autocastOn}
    class:open
    aria-pressed={open}
    aria-label="Автокаст"
    onclick={() => toggleMenu('autocast')}
  >
    <Icon name={autocastOn ? 'autocast-on' : 'autocast-off'} size="lg" />
    <span class="caption">Автокаст</span>
  </button>
</Tooltip>

<style>
  /* Тот же квадрат того же размера, что кнопки действий и кнопки меню:
     размеров кнопки на экране ровно один. Состояние ротации показано
     цветом значка, открытое меню — рамкой, как у остальных кнопок меню. */
  .auto {
    width: 100%;
    min-height: var(--action-slot);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    padding: var(--space-1);
    font: inherit;
    color: var(--c-text-muted);
    background: var(--c-surface-sunken);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
      border-color var(--dur-fast) ease,
      color var(--dur-fast) ease;
  }
  .auto:hover {
    border-color: var(--c-accent);
    color: var(--c-text);
  }
  .auto.on {
    color: var(--c-accent);
  }
  .auto.open {
    border-color: var(--c-accent);
    background: var(--c-surface-raised);
  }
  .caption {
    font-size: var(--text-2xs);
    line-height: 1;
    letter-spacing: var(--tracking-wide);
  }
</style>
