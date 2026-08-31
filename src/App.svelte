<script lang="ts">
  // Экран собран вокруг боевой сцены.
  //
  // ПОСТОЯННАЯ ЗОНА — ровно три блока, и больше в ней нет ничего:
  //   1. боевая сцена во всю ширину колонки;
  //   2. ряд одинаковых квадратных иконок действий (умения, дальше зелья);
  //   3. одна строка: уровень и полоски здоровья, ресурса и опыта.
  // Она видна всегда, в любом разделе, и ничем не перекрывается.
  //
  // Всё остальное про героя убрано за две кнопки-выдвижки: «Герой»
  // (характеристики и экипировка) и «Журнал» (лог боя, свёрнут по
  // умолчанию). Выдвижка открывается ПОВЕРХ нижней части экрана и не
  // трогает сцену — ни размер, ни положение.
  import { INVENTORY_SIZE, availablePoints, upgradeShare } from './lib/game'
  import { gameStarted, gameState } from './lib/stores/game'
  import { placeTitle } from './lib/ui/placeText'
  import { activeSection } from './lib/stores/ui'
  import { isTextMode, sceneUnavailable, toggleDrawer, uiSettings } from './lib/stores/ui'
  import { isSceneDisabled } from './lib/ui/route'

  import BattleScene from './lib/ui/BattleScene.svelte'
  import BattlePanel from './lib/ui/BattlePanel.svelte'
  import CombatLog from './lib/ui/CombatLog.svelte'
  import ActionBar from './lib/ui/ActionBar.svelte'
  import DungeonHud from './lib/ui/DungeonHud.svelte'
  import TempleHud from './lib/ui/TempleHud.svelte'
  import VitalsBar from './lib/ui/VitalsBar.svelte'
  import Drawer from './lib/ui/Drawer.svelte'
  import SectionTabs from './lib/ui/SectionTabs.svelte'
  import SwingIndicator from './lib/ui/SwingIndicator.svelte'
  import { IconSprite } from './lib/ui/icons'

  import StatsPanel from './lib/ui/StatsPanel.svelte'
  import EquipmentPanel from './lib/ui/EquipmentPanel.svelte'
  import AbilityPanel from './lib/ui/AbilityPanel.svelte'
  import QuestPanel from './lib/ui/QuestPanel.svelte'
  import TalentPanel from './lib/ui/TalentPanel.svelte'
  import ProgressionPanel from './lib/ui/ProgressionPanel.svelte'
  import InventoryPanel from './lib/ui/InventoryPanel.svelte'
  import CraftPanel from './lib/ui/CraftPanel.svelte'
  import EnchantPanel from './lib/ui/EnchantPanel.svelte'
  import ZonePanel from './lib/ui/ZonePanel.svelte'
  import TemplePanel from './lib/ui/TemplePanel.svelte'
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
  const place = $derived(placeTitle($gameState))
  const drawers = $derived($uiSettings.drawers)
  // Апгрейд в сумке видно из любого раздела: точка на вкладке.
  const hasUpgrade = $derived(
    $gameState.inventory.some((item) => upgradeShare($gameState, item) !== null),
  )
</script>

<!-- Спрайт иконок: один раз на страницу, до всего остального. -->
<IconSprite />

<!-- Пока класс не выбран, экран игры не спрятан под шторкой — его нет вовсе.
     Разница не косметическая: смонтированный под шторкой экран оставлял
     живыми хоткеи умений (слушатель висит на window, и никакой inert его не
     гасит), пускал Tab на невидимые кнопки и поднимал контекст WebGL герою,
     которого игрок ещё не выбрал. Тик и сейв остановлены той же проверкой —
     см. startGameLoop и persistNow. -->
{#if $gameStarted}
  <main>
    <header class="top">
      <h1>Idle RPG</h1>
      <NoticeBar />
    </header>

    <!-- ПОСТОЯННАЯ ЗОНА: три блока и ничего больше. Одна колонка на любой
         ширине — сцена главный элемент экрана и делить её место не с чем. -->
    <div class="permanent" data-permanent>
      <div class="stage">
        <!-- ГДЕ ГЕРОЙ СЕЙЧАС. Строку собирает placeTitle из ДАННЫХ места,
             поэтому новая зона, данж или будущий рейд попадают в заголовок
             сами, без правки этого файла. -->
        <h2 class="place" aria-live="polite">
          <span class="place-name">{place.name}</span>
          {#if place.detail}
            <span class="place-detail"
              >{place.join === 'parens' ? `(${place.detail})` : `· ${place.detail}`}</span
            >
          {/if}
        </h2>
        {#if textMode}
          <BattlePanel />
        {:else}
          <BattleScene />
        {/if}
        <SwingIndicator />
        <DungeonHud />
        <TempleHud />
      </div>
      <ActionBar />
      <VitalsBar />
    </div>

    <!-- Ручки выдвижек стоят сразу под полосками: «что со мной» и «что
         происходит» — два вопроса, на которые отвечают в одном месте. -->
    <div class="handles">
      <Drawer
        title="Герой"
        icon="stat-strength"
        open={drawers.hero}
        onToggle={() => toggleDrawer('hero')}
      >
        <StatsPanel />
        <EquipmentPanel />
      </Drawer>
      <Drawer
        title="Журнал"
        icon="log"
        open={drawers.log}
        onToggle={() => toggleDrawer('log')}
      >
        <CombatLog />
      </Drawer>
    </div>

    <SectionTabs
      bagCount={$gameState.inventory.length}
      bagLimit={INVENTORY_SIZE}
      hasPoints={points > 0}
      {hasUpgrade}
    />

    <!-- Разделы из одной панели ведут себя иначе, чем из двух: сумке нужна
         вся ширина под сетку предметов, а настройкам — узкая колонка, иначе
         строки пояснений растянет через весь экран и их станет не прочесть.

         Две колонки собраны РУКАМИ, а не сеткой из плоского списка панелей.
         Сетка кладёт панели построчно и равняет строку по самой высокой:
         дерево талантов в две тысячи пикселей рядом с панелькой задания
         оставляло под заданием пустоту во весь экран. Колонка растёт своей
         высотой, поэтому панели распределены по ним так, чтобы итоговые
         высоты сошлись. На мобильном колонки исчезают (`display: contents`)
         и панели идут одним столбцом в порядке разметки. -->
    <div
      class="section"
      class:full={$activeSection === 'bag'}
      class:solo={$activeSection === 'settings'}
    >
      {#if $activeSection === 'progress'}
        <div class="col">
          <TalentPanel />
        </div>
        <div class="col">
          <QuestPanel />
          <ProgressionPanel />
          <AbilityPanel />
        </div>
      {:else if $activeSection === 'bag'}
        <InventoryPanel />
        <CraftPanel />
        <EnchantPanel />
      {:else if $activeSection === 'world'}
        <!-- Карта — один широкий блок, а не колонка: путь из двадцати узлов
             скроллится по горизонтали и делить его пополам нечем. Данжи
             живут ВНУТРИ карты, у своих зон; отдельного списка больше нет. -->
        <div class="col">
          <ZonePanel />
        </div>
        <div class="col">
          <TemplePanel />
        </div>
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
{:else}
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

  /* Постоянная зона: три блока сверху вниз, одна колонка на любой ширине.
     Раньше здесь было три колонки (герой / сцена / умения) — от них
     отказались: сцена главный элемент экрана, и делить с ней ширину
     панелями значило показывать бой в трети окна. */
  .permanent {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .stage {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  /* Заголовок места. В ОДНУ строку на любой ширине: перенос сдвинул бы сцену
     вниз и на телефоне съел бы её верх. Длинное название обрезается
     многоточием, полоса уровней не обрезается никогда — она короткая и
     отвечает на вопрос «по зубам ли мне тут». */
  .place {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: var(--space-2);
    margin: 0;
    min-width: 0;
    font-size: var(--text-md);
    font-weight: 600;
    line-height: var(--leading-tight);
  }
  .place-name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .place-detail {
    flex: 0 0 auto;
    color: var(--c-text-muted);
    font-size: var(--text-sm);
    font-weight: 400;
  }
  .handles {
    display: flex;
    flex-wrap: wrap;
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
  /* На узком экране колонок нет вовсе: обёртки растворяются, и панели
     становятся прямыми детьми сетки в порядке разметки. */
  .col {
    display: contents;
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
    .permanent {
      gap: var(--space-3);
    }
    .section {
      grid-template-columns: 1fr 1fr;
      gap: var(--space-4);
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      min-width: 0;
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
