<script lang="ts">
  // АВТОКАСТ ОДНОЙ КНОПКОЙ — ОТДЕЛЬНО ОТ РЯДА ДЕЙСТВИЙ.
  //
  // Раньше кнопка стояла последней в ряду умений, отделённая чертой. Черта
  // отделяла плохо: в ряду одинаковых квадратов глаз читает всё как «ещё
  // одно действие», а это не действие — это переключатель того, КТО действия
  // жмёт. Теперь она стоит своим блоком слева от ряда, под столбцом меню:
  // разного назначения кнопки разведены местом, а не линией.
  //
  // Своего состояния кнопка не заводит: переключает те же галки тем же
  // экшеном, что и меню «Таланты», просто все разом.
  //
  // «Включён» — когда хотя бы одно умение на автокасте: полувключённого
  // состояния у кнопки нет, а полувключённая ротация есть, и честнее
  // показать её включённой, чем врать выключенной.
  import { abilitiesByPriority } from '../game'
  import { gameState, setAbilityAutocast } from '../stores/game'
  import { Tooltip } from './kit'
  import { Icon } from './icons'

  const ordered = $derived(abilitiesByPriority($gameState.abilitySettings, false))
  const autocastOn = $derived(
    ordered.some((a) => $gameState.abilitySettings[a.id]?.autocast ?? false),
  )
  function toggleAutocast(): void {
    const next = !autocastOn
    for (const ability of ordered) setAbilityAutocast(ability.id, next)
  }
</script>

<Tooltip
  text={autocastOn
    ? 'Автокаст включён: игра жмёт умения сама, по приоритету из раздела умений. Нажми, чтобы играть руками.'
    : 'Автокаст выключен: умения жмёшь ты. Нажми, чтобы игра жала их сама.'}
  width="wide"
>
  <button
    type="button"
    class="auto"
    class:on={autocastOn}
    aria-pressed={autocastOn}
    aria-label="Автокаст"
    onclick={toggleAutocast}
  >
    <Icon name={autocastOn ? 'autocast-on' : 'autocast-off'} size="lg" />
    <span class="caption">Автокаст</span>
  </button>
</Tooltip>

<style>
  /* Тот же квадрат того же размера, что кнопки действий и кнопки меню:
     размеров кнопки на экране ровно один. Включённое состояние показано
     рамкой взаимодействия, а не заливкой: заливка в соседнем ряду занята
     кулдауном и читалась бы как «идёт откат». */
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
    border-color: var(--c-accent);
    color: var(--c-accent);
  }
  .caption {
    font-size: var(--text-2xs);
    line-height: 1;
    letter-spacing: var(--tracking-wide);
  }
</style>
