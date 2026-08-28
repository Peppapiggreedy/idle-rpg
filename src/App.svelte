<script lang="ts">
  // Экран собран вокруг боевой сцены: она главный элемент и видна ВСЕГДА,
  // в каком бы разделе игрок ни находился. Панели разъехались по вкладкам,
  // но всё, что относится к бою, осталось наверху вместе со сценой.
  import { INVENTORY_SIZE, availablePoints } from './lib/game'
  import { gameStarted, gameState } from './lib/stores/game'
  import { activeSection } from './lib/stores/ui'
  import { isTextMode, sceneUnavailable, uiSettings } from './lib/stores/ui'
  import { isSceneDisabled } from './lib/ui/route'

  import BattleScene from './lib/ui/BattleScene.svelte'
  import BattlePanel from './lib/ui/BattlePanel.svelte'
  import CombatLog from './lib/ui/CombatLog.svelte'
  import ActionBar from './lib/ui/ActionBar.svelte'
  import DungeonHud from './lib/ui/DungeonHud.svelte'
  import HeroPanel from './lib/ui/HeroPanel.svelte'
  import SectionTabs from './lib/ui/SectionTabs.svelte'
  import SwingIndicator from './lib/ui/SwingIndicator.svelte'
  import { IconSprite } from './lib/ui/icons'

  import StatsPanel from './lib/ui/StatsPanel.svelte'
  import EquipmentPanel from './lib/ui/EquipmentPanel.svelte'
  import AbilityPanel from './lib/ui/AbilityPanel.svelte'
  import TalentPanel from './lib/ui/TalentPanel.svelte'
  import UpgradePanel from './lib/ui/UpgradePanel.svelte'
  import InventoryPanel from './lib/ui/InventoryPanel.svelte'
  import ZonePanel from './lib/ui/ZonePanel.svelte'
  import DungeonPanel from './lib/ui/DungeonPanel.svelte'
  import SettingsPanel from './lib/ui/SettingsPanel.svelte'

  import DebugOverlay from './lib/ui/DebugOverlay.svelte'
  import DebugPanel from './lib/ui/DebugPanel.svelte'
  import NoticeBar from './lib/ui/NoticeBar.svelte'
  import OfflineModal from './lib/ui/OfflineModal.svelte'
  import LootReveal from './lib/ui/LootReveal.svelte'
  import ClassPicker from './lib/ui/ClassPicker.svelte'

  // ?scene=off убирает сцену и оставляет только DOM — так снимаются
  // стабильные эталоны интерфейса. Текстовый режим приводит к тому же виду,
  // но по выбору игрока, а не параметра адреса.
  //
  // $sceneUnavailable — третья причина, и она не выбор: сцена попробовала
  // завестись и не смогла. Игра обязана продолжаться текстом, а не чёрным
  // прямоугольником, поэтому этот случай сильнее настройки «всегда сцена».
  const sceneOff = isSceneDisabled()
  const textMode = $derived(sceneOff || $sceneUnavailable || isTextMode($uiSettings))
  const points = $derived(availablePoints($gameState))
</script>

<!-- Спрайт иконок: один раз на страницу, до всего остального. -->
<IconSprite />

<main>
  <header class="top">
    <h1>Idle RPG</h1>
    <NoticeBar />
  </header>

  <!-- Боевая часть. Видна в любом разделе: бой идёт всегда.
       Порядок в разметке — десктопный (слева направо); на мобильном
       сцена поднимается наверх через order, см. стили. -->
  <div class="battle">
    <div class="side hero">
      <HeroPanel />
    </div>
    <div class="stage">
      {#if textMode}
        <BattlePanel />
      {:else}
        <BattleScene />
      {/if}
      <SwingIndicator />
      <DungeonHud />
      <CombatLog />
    </div>
    <div class="side actions">
      <ActionBar />
    </div>
  </div>

  <SectionTabs bagCount={$gameState.inventory.length} bagLimit={INVENTORY_SIZE} hasPoints={points > 0} />

  <!-- Разделы из одной панели ведут себя иначе, чем из двух: сумке нужна
       вся ширина под сетку предметов, а настройкам — узкая колонка, иначе
       строки пояснений растянет через весь экран и их станет не прочесть. -->
  <div
    class="section"
    class:full={$activeSection === 'bag'}
    class:solo={$activeSection === 'settings'}
  >
    {#if $activeSection === 'character'}
      <StatsPanel />
      <EquipmentPanel />
    {:else if $activeSection === 'progress'}
      <AbilityPanel />
      <TalentPanel />
      <UpgradePanel />
    {:else if $activeSection === 'bag'}
      <InventoryPanel />
    {:else if $activeSection === 'world'}
      <ZonePanel />
      <DungeonPanel />
    {:else}
      <SettingsPanel />
    {/if}
  </div>

  <!-- Место под нижнюю панель вкладок: на мобильном она прибита к низу
       экрана и иначе накрыла бы последнюю строку раздела. -->
  <div class="tabbar-space" aria-hidden="true"></div>
</main>

<OfflineModal />
<LootReveal />
{#if !$gameStarted}
  <!-- Игра идёт под ним: цикл уже крутится, но экран закрыт выбором класса. -->
  <ClassPicker />
{/if}

<DebugOverlay />

<DebugPanel />

<style>
  main {
    max-width: 72rem;
    margin: 0 auto;
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    /* Ничего не должно вылезать по горизонтали ни на одной ширине. */
    min-width: 0;
    overflow-x: clip;
  }
  .top {
    /* На мобильном шапка растворяется: заголовок скрыт, а уведомление
       появляется редко — пустая полоса не должна отъедать высоту у сцены. */
    display: contents;
  }
  h1 {
    /* На мобильном верх экрана отдан сцене целиком: название игры уже есть
       в заголовке вкладки, а строка под ним стоила бы сцене высоты. */
    display: none;
    margin: 0;
    font-size: var(--text-lg);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-faint);
    text-align: center;
  }

  /* Мобильный: сцена занимает верх экрана целиком, остальное под ней.
     В разметке она стоит второй (так задан порядок колонок на десктопе),
     поэтому здесь её поднимает order. */
  .battle {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
    align-items: start;
    min-width: 0;
  }
  .stage {
    order: 1;
  }
  .hero {
    order: 2;
  }
  .actions {
    order: 3;
  }
  .stage,
  .side {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .section {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
    align-items: start;
    min-width: 0;
  }
  .tabbar-space {
    height: var(--tabbar-height);
  }

  @media (min-width: 720px) {
    main {
      padding: var(--space-5) var(--space-4);
      gap: var(--space-4);
    }
    .top {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    h1 {
      display: block;
      font-size: var(--text-xl);
      text-transform: none;
      letter-spacing: normal;
      color: var(--c-text);
    }
    /* Десктоп: сцена крупным блоком по центру, панели вокруг неё. */
    .battle {
      grid-template-columns: minmax(0, 1fr) minmax(0, 2.2fr) minmax(0, 1fr);
      gap: var(--space-4);
    }
    /* Колонки идут в порядке разметки: герой, сцена, кнопки умений. */
    .stage,
    .hero,
    .actions {
      order: 0;
    }
    .section {
      grid-template-columns: 1fr 1fr;
      gap: var(--space-4);
    }
    .section.full {
      grid-template-columns: 1fr;
    }
    .section.solo {
      grid-template-columns: minmax(0, 42rem);
      justify-content: center;
    }
    /* На десктопе вкладки стоят в потоке — резервировать нечего. */
    .tabbar-space {
      display: none;
    }
  }
</style>
