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
  import { carriedItem, closeMenu, openMenu, releaseItem } from './lib/stores/ui'
  import { isTextMode, uiSettings } from './lib/stores/ui'
  import { isSceneDisabled } from './lib/ui/route'
  import {
    MOBILE_BREAKPOINT,
    SCENE_MINI_MAX_PX,
    SCENE_MINI_MIN_PX,
    SCENE_MINI_SHARE,
  } from './lib/data/render'

  import BattleScene from './lib/ui/BattleScene.svelte'
  import BattlePanel from './lib/ui/BattlePanel.svelte'
  import CombatLog from './lib/ui/CombatLog.svelte'
  import ActionBar from './lib/ui/ActionBar.svelte'
  import DungeonHud from './lib/ui/DungeonHud.svelte'
  import TempleHud from './lib/ui/TempleHud.svelte'
  import VitalsBar from './lib/ui/VitalsBar.svelte'
  import RestRow from './lib/ui/RestRow.svelte'
  import MenuButtons from './lib/ui/MenuButtons.svelte'
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
  // но по выбору игрока, а не параметра адреса. Третьей причины нет:
  // двумерная сцена рисуется обычными элементами и не может не завестись.
  const sceneOff = isSceneDisabled()
  const textMode = $derived(sceneOff || isTextMode($uiSettings))
  const points = $derived(availablePoints($gameState))

  // СЦЕНА УЕЗЖАЕТ В УГОЛ, КОГДА ОТКРЫТО МЕНЮ. Меню занимает основную
  // площадь, но бой не прекращается — и прятать его нельзя: сцена видна
  // ВСЕГДА, это правило проекта. Уменьшенная сцена стоит в правом нижнем
  // углу поверх меню и держит те же пропорции 16:9.
  //
  // НА УЗКОМ ЭКРАНЕ УГЛА НЕТ. Треть от 390px — это 130 пикселей: силуэты
  // сливаются, табличка с именем не помещается, а места меню всё равно не
  // остаётся. Вместо сцены там встаёт ОДНА СТРОКА-СВОДКА, и берётся она из
  // того же вида, что несёт текстовый режим (BattlePanel), а не пишется
  // второй раз.
  //
  // Ширину окна берём подпиской, а не медиазапросом: медиазапрос умеет
  // спрятать элемент, но не умеет ПОДМЕНИТЬ компонент, а сводка — другой
  // компонент, а не сцена в другом размере.
  let viewportWidth = $state(globalThis.innerWidth ?? MOBILE_BREAKPOINT)
  const narrow = $derived(viewportWidth < MOBILE_BREAKPOINT)
  const menuOpen = $derived($openMenu !== null)
  const miniScene = $derived(menuOpen && !narrow)
  const summary = $derived(menuOpen && narrow)
  // Ширина угла: доля окна, зажатая между минимумом и потолком из данных.
  const miniWidth = `clamp(${SCENE_MINI_MIN_PX}px, ${Math.round(SCENE_MINI_SHARE * 100)}vw, ${SCENE_MINI_MAX_PX}px)`
  // Esc СНИМАЕТ БЛИЖАЙШЕЕ, а не всё разом: сперва вещь из руки, и только
  // если рук пусты — меню. Иначе одно нажатие и роняло бы находку, и
  // закрывало экран, на котором игрок её выбирал, — а вернуть её оттуда
  // нечем, кроме как открыть меню заново и найти вещь среди двух десятков.
  //
  // Слушатель один и висит здесь: у меню нет своего корня, который мог бы
  // поймать клавишу, а плодить по подписке на каждое из семи меню значило
  // бы семь слушателей вместо одного.
  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    if ($carriedItem !== null) {
      releaseItem()
      return
    }
    if ($openMenu !== null) closeMenu()
  }
  const place = $derived(placeTitle($gameState))
  // Апгрейд в сумке видно из любого раздела: точка на вкладке.
  const hasUpgrade = $derived(
    $gameState.inventory.some((item) => upgradeShare($gameState, item) !== null),
  )
  const bagNote = $derived({ bag: `${$gameState.inventory.length}/${INVENTORY_SIZE}` })
</script>

<!-- Спрайт иконок: один раз на страницу, до всего остального. -->
<IconSprite />

<svelte:window onkeydown={onKeydown} bind:innerWidth={viewportWidth} />

<!-- Пока класс не выбран, экран игры не спрятан под шторкой — его нет вовсе.
     Разница не косметическая: смонтированный под шторкой экран оставлял
     живыми хоткеи умений (слушатель висит на window, и никакой inert его не
     гасит), пускал Tab на невидимые кнопки и рисовал сцену боя герою,
     которого игрок ещё не выбрал. Тик и сейв остановлены той же проверкой —
     см. startGameLoop и persistNow. -->
{#if $gameStarted}
  <main>
    <!-- ЗАГОЛОВКА ИГРЫ ЗДЕСЬ БОЛЬШЕ НЕТ. «Idle RPG» стояло строкой над сценой
         на каждом экране и на каждой ширине: игрок и так знает, во что
         играет, а строка стоила сцене вертикали — самого дорогого, что есть
         на телефоне. Название осталось там, где оно нужно, — в заголовке
         вкладки. Уведомление остаётся: оно появляется редко и по делу. -->
    <NoticeBar />

    <!-- ПОСТОЯННАЯ ЗОНА: три блока и ничего больше. Одна колонка на любой
         ширине — сцена главный элемент экрана и делить её место не с чем. -->
    <div class="permanent" data-permanent>
      <div class="stage" class:mini={miniScene} style:--mini-width={miniWidth}>
        {#if summary}
          <!-- СТРОКА-СВОДКА вместо сцены: имя, уровень и здоровье моба.
               Заголовок места и полоса замаха уходят вместе со сценой —
               «одна строка» значит одна строка. -->
          <BattlePanel compact />
        {:else}
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
            <BattleScene mini={miniScene} />
          {/if}
          <SwingIndicator />
          <DungeonHud />
          <TempleHud />
        {/if}
      </div>
      <ActionBar />
      <VitalsBar />
      <RestRow />
    </div>

    <!-- СЕМЬ КНОПОК ДВУМЯ СТОЛБЦАМИ ПО БОКАМ СЦЕНЫ. Слева — где меняешь
         (герой, сумка, мир, таланты, крафт), справа — где читаешь (журнал,
         настройки). Сторона берётся из данных (`MENU_SIDE`), а не из
         порядка в этой разметке: иначе следующая кнопка встанет наугад.

         На узком экране столбцов нет — кнопки уезжают в нижнюю панель,
         прибитую к низу окна: держать по краям сцены два столбца шириной
         в кнопку значило бы отдать им треть ширины. -->
    <div class="menus">
      <MenuButtons side="left" marks={{ talents: points > 0, bag: hasUpgrade }} notes={bagNote} />
      <div class="pane" class:empty={$openMenu === null}>
        {#if $openMenu === 'hero'}
          <!-- ИСКЛЮЧЕНИЕ, И ОНО ОСОЗНАННОЕ: «Герой» открывает куклу И СУМКУ
               рядом. Иначе перетаскивать предмет из сумки на слот некуда:
               два меню одновременно не открываются. «Сумка» при этом
               открывает только сумку — продать и распылить можно, не
               разворачивая куклу. -->
          <StatsPanel />
          <EquipmentPanel />
          <InventoryPanel />
        {:else if $openMenu === 'bag'}
          <InventoryPanel />
        {:else if $openMenu === 'world'}
          <ZonePanel />
          <TemplePanel />
        {:else if $openMenu === 'talents'}
          <TalentPanel />
          <AbilityPanel />
          <ProgressionPanel />
          <QuestPanel />
        {:else if $openMenu === 'craft'}
          <CraftPanel />
          <EnchantPanel />
        {:else if $openMenu === 'log'}
          <CombatLog />
        {:else if $openMenu === 'settings'}
          <SettingsPanel />
        {/if}
      </div>
      <MenuButtons side="right" />
    </div>

    <!-- Место под нижнюю панель меню: на мобильном она прибита к низу
         экрана и иначе накрыла бы последнюю строку открытого меню. -->
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
    font-weight: var(--weight-bold);
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
    font-weight: var(--weight-regular);
  }
  /* Три колонки: кнопки слева, меню посередине, кнопки справа. Панель
     меню растёт своей высотой; когда меню закрыто, её нет вовсе, и
     столбцы кнопок стоят по бокам сцены. */
  .menus {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    min-width: 0;
  }
  .pane {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  /* ПУСТАЯ ПАНЕЛЬ ОСТАЁТСЯ В РАСКЛАДКЕ РАСПОРКОЙ, а не исчезает. Убранная
     через `display: none`, она схлопывала строку, и правый столбец кнопок
     переезжал вплотную к левому — к середине экрана, поверх отладочной
     панели, которая его и перехватывала. Кнопки обязаны стоять по КРАЯМ
     сцены и когда меню закрыто. */
  .pane.empty {
    min-height: 0;
  }
  /* СЦЕНА В УГЛУ. Уходит из потока целиком — иначе на её месте осталась бы
     дыра в половину экрана, а меню ради этого ужалось бы в полоску. Правый
     нижний угол выбран потому, что левый занят отладочной панелью, а верх
     экрана — постоянной зоной: полоски и ряд действий остаются на месте,
     уезжает только сцена. */
  .stage.mini {
    position: fixed;
    right: var(--space-3);
    bottom: var(--space-3);
    width: var(--mini-width);
    z-index: 70;
    padding: var(--space-2);
    border-radius: var(--radius-lg);
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    box-shadow: var(--shadow-lg);
  }
  .tabbar-space {
    height: var(--tabbar-height);
  }

  @media (min-width: 720px) {
    main {
      padding: var(--space-5) var(--space-4);
      gap: var(--space-4);
    }
    .permanent {
      gap: var(--space-3);
    }
    /* На десктопе кнопки стоят столбцами в потоке — резервировать место
       под нижнюю панель нечего. */
    .tabbar-space {
      display: none;
    }
  }
</style>
