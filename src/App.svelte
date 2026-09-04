<script lang="ts">
  // Экран собран вокруг боевой сцены.
  //
  // ПОСТОЯННАЯ ЗОНА — ТРИ ПОЛОСЫ, и больше в ней нет ничего:
  //   1. СЦЕНА С КНОПКАМИ МЕНЮ ПО БОКАМ: слева пять «где меняешь», справа
  //      два «где читаешь», между ними сцена во всю оставшуюся ширину;
  //   2. РЯД ДЕЙСТВИЙ: слева «Автокаст» под столбцом меню, затем квадраты
  //      умений и зелий, справа порог привала одной строкой;
  //   3. полоски героя: уровень, здоровье, ресурс, опыт — с числами.
  // Она видна всегда, при любом открытом меню, и ничем не перекрывается.
  //
  // КНОПКИ СТОЯТ ПО БОКАМ СЦЕНЫ, А НЕ ПОД ВСЕЙ ЗОНОЙ. Сцена — главный
  // элемент экрана, и кнопки, которые её обрамляют, читаются как рамка
  // вокруг главного; те же кнопки, отодвинутые под полоски героя, читались
  // как ещё один ряд среди прочих. Столбцы и ряд действий делят ОДНУ сетку
  // (`.permanent` — grid `auto 1fr auto`), поэтому «Автокаст» встаёт ровно
  // под левым столбцом, а ряд умений — ровно под левым краем сцены.
  import { availablePoints, inventorySize, upgradeShare } from './lib/game'
  import { gameStarted, gameState } from './lib/stores/game'
  import { placeTitle } from './lib/ui/placeText'
  import {
    carriedAbility,
    carriedItem,
    closeMenu,
    openMenu,
    releaseAbility,
    releaseItem,
  } from './lib/stores/ui'
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
  import AutocastButton from './lib/ui/AutocastButton.svelte'
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
  // поймать клавишу, а плодить по подписке на каждое из восьми меню значило
  // бы семь слушателей вместо одного.
  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    if ($carriedItem !== null) {
      releaseItem()
      return
    }
    // УМЕНИЕ В РУКЕ — ТО ЖЕ САМОЕ, ЧТО ВЕЩЬ. Esc снимает ближайшее: сперва
    // то, что несут, и только если руки пусты — меню.
    if ($carriedAbility !== null) {
      releaseAbility()
      return
    }
    if ($openMenu !== null) closeMenu()
  }
  const place = $derived(placeTitle($gameState))
  // Апгрейд в сумке видно из любого раздела: точка на вкладке.
  const hasUpgrade = $derived(
    $gameState.inventory.some((item) => upgradeShare($gameState, item) !== null),
  )
  // ВМЕСТИМОСТЬ БЕРЁТСЯ ТАМ ЖЕ, ГДЕ ЕЁ БЕРЁТ ЛОГИКА. Здесь стояла БАЗА, и
  // после первой же покупки расширения кнопка показывала «28/24»: вещи
  // лежали сверх знаменателя, потому что знаменатель был не тот.
  const bagNote = $derived({ bag: `${$gameState.inventory.length}/${inventorySize($gameState)}` })
  // Кнопка меню, до которой герой не дорос, не показывается вовсе — то же
  // правило, что и у панелей внутри. Уровень идёт в MenuButtons числом:
  // сам компонент про игровое состояние не знает.
  const heroLevel = $derived($gameState.level.toNumber())
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

    <!-- ПОСТОЯННАЯ ЗОНА: три полосы и ничего больше. Одна сетка на всю зону,
         чтобы столбцы кнопок и ряд действий стояли по одним колонкам.

         СЕМЬ КНОПОК ДВУМЯ СТОЛБЦАМИ ПО БОКАМ СЦЕНЫ, восьмая — в ряду
         действий. Слева — где меняешь (герой, сумка, мир, таланты, крафт),
         справа — где читаешь (журнал, настройки), а «Автокаст» со стороной
         `'row'` стоит вплотную к ряду, который настраивает. Сторона берётся
         из данных (`MENU_SIDE`), а не из порядка в этой разметке: иначе
         следующая кнопка встанет наугад.

         На узком экране столбцов нет — кнопки уезжают в нижнюю панель,
         прибитую к низу окна: держать по краям сцены два столбца шириной
         в кнопку значило бы отдать им треть ширины. -->
    <div class="permanent" data-permanent>
      <MenuButtons
        side="left"
        level={heroLevel}
        marks={{ talents: points > 0, bag: hasUpgrade }}
        notes={bagNote}
      />

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

      <MenuButtons side="right" level={heroLevel} />

      <!-- ВТОРАЯ ПОЛОСА. «Автокаст» встаёт в колонку левого столбца — он не
           действие, а переключатель того, кто действия жмёт, и разведены они
           МЕСТОМ, а не чертой внутри одного ряда. Дальше квадраты умений и
           зелий, справа от них — порог привала одной строкой. -->
      <div class="autocast"><AutocastButton /></div>
      <div class="controls">
        <div class="acts"><ActionBar /></div>
        <div class="rest"><RestRow /></div>
      </div>

      <VitalsBar />
    </div>

    <div class="menus">
      <div class="pane" class:empty={$openMenu === null}>
        {#if $openMenu === 'hero'}
          <!-- ИСКЛЮЧЕНИЕ, И ОНО ОСОЗНАННОЕ: «Герой» открывает куклу И СУМКУ
               рядом. Иначе перетаскивать предмет из сумки на слот некуда:
               два меню одновременно не открываются. «Сумка» при этом
               открывает только сумку — продать и распылить можно, не
               разворачивая куклу. -->
          <StatsPanel />
          <!-- ПЕРЕОДЕВАНИЕ — ОДНО ДЕЙСТВИЕ, И ОБА ЕГО КОНЦА ОБЯЗАНЫ БЫТЬ НА
               ЭКРАНЕ РАЗОМ. Кукла и сумка стояли друг под другом, и на любом
               экране уже сумка уезжала под сгиб: игрок выбирал находку,
               прокручивал вверх, терял её из виду и целился в слот по
               памяти. Кукла стала сеткой значков шириной в ладонь — и рядом
               с ней хватает места на всю сумку. -->
          <div class="dressing">
            <EquipmentPanel />
            <InventoryPanel />
          </div>
        {:else if $openMenu === 'bag'}
          <InventoryPanel />
        {:else if $openMenu === 'world'}
          <ZonePanel />
          <TemplePanel />
          <ProgressionPanel />
        {:else if $openMenu === 'talents'}
          <!-- ТОЛЬКО ТРИ ВЕТКИ. Умения и настройки автокаста уехали в своё
               меню — их открывает кнопка рядом с рядом умений, которую они
               и настраивают. Лестница открытий уехала в «Мир»: она про то,
               что откроется дальше В МИРЕ, и место ей рядом с картой зон. -->
          <TalentPanel />
          <QuestPanel />
        {:else if $openMenu === 'autocast'}
          <AbilityPanel />
        {:else if $openMenu === 'craft'}
          <CraftPanel />
          <EnchantPanel />
        {:else if $openMenu === 'log'}
          <CombatLog />
        {:else if $openMenu === 'settings'}
          <SettingsPanel />
        {/if}
      </div>
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
  /* ПОСТОЯННАЯ ЗОНА — ОДНА СЕТКА НА ТРИ ПОЛОСЫ.
       строка 1: [столбец меню] [сцена] [столбец меню]
       строка 2: [Автокаст]     [ряд действий + порог привала]
       строка 3: [полоски героя во всю ширину]

     Сетка ОДНА, а не три отдельных ряда, ровно ради выравнивания: боковые
     колонки шириной `auto` подстраиваются под самую широкую подпись, и
     «Автокаст» встаёт под левым столбцом сам, без подбора чисел. Разложи
     это двумя независимыми рядами — и ширины разъедутся на первой же
     кнопке с длинным словом.

     Трёх колонок «герой / сцена / умения» здесь по-прежнему нет: панели со
     сценой ширину не делят, делят только кнопки шириной в кнопку. */
  .permanent {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--space-2);
    min-width: 0;
  }
  /* Ячейки расставлены ЯВНО, а не автопотоком. На узком экране столбцы
     кнопок уходят в `position: fixed` — то есть выпадают из потока, — и
     автопоток тут же перекладывает сцену в первую колонку. Явные адреса
     переживают это без единой правки. */
  .permanent > :global(nav.left) {
    grid-column: 1;
    grid-row: 1;
  }
  .permanent > :global(nav.right) {
    grid-column: 3;
    grid-row: 1;
  }
  /* Полоски героя — во всю ширину зоны: числа «текущее / максимум» должны
     стоять на одной прямой, а не жаться в среднюю колонку. */
  .permanent > :global(.vitals) {
    grid-column: 1 / -1;
    grid-row: 3;
  }
  .autocast {
    grid-column: 1;
    grid-row: 2;
    display: flex;
  }
  /* Ряд действий и порог привала — одна ячейка: они делят полосу, а не
     стоят друг под другом. На узком экране порог переносится под ряд. */
  .controls {
    grid-column: 2 / -1;
    grid-row: 2;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    flex-wrap: wrap;
  }
  /* Ряд умений держит свою ширину, порог привала забирает остаток. */
  .acts {
    flex: 0 1 auto;
    min-width: 0;
  }
  .rest {
    flex: 1 1 16rem;
    min-width: 0;
  }
  .stage {
    grid-column: 2;
    grid-row: 1;
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
  /* ОТКРЫТОЕ МЕНЮ ЛОЖИТСЯ ПОД ПОСТОЯННОЙ ЗОНОЙ ВО ВСЮ ШИРИНУ. Между
     столбцами кнопок ему места нет: там стоит сцена, а она видна всегда. */
  .menus {
    display: flex;
    min-width: 0;
  }
  .pane {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  /* СЦЕНА ПОД ОТКРЫТЫМ МЕНЮ СЖИМАЕТСЯ НА МЕСТЕ, а не уезжает в угол.
     Угол был выбран, пока кнопки стояли ПОД зоной и сцена, уходя из потока,
     ничего за собой не оставляла. Теперь кнопки стоят по её бокам: уведи
     сцену из потока — и между столбцами останется дыра в полтысячи
     пикселей, а сами столбцы разъедутся по краям пустой полосы. Поэтому
     сцена остаётся между ними и просто становится уже; ширина — та же
     доля окна из данных, что была у угла. */
  .stage.mini {
    width: var(--mini-width);
    max-width: 100%;
  }
  .tabbar-space {
    height: var(--tabbar-height);
  }
  /* Кукла и сумка. На узком экране — друг под другом: две колонки по
     190 пикселей не сетка, а два столбика. */
  .dressing {
    display: grid;
    gap: var(--space-3);
    align-items: start;
  }

  /* НА УЗКОМ ЭКРАНЕ СТОЛБЦОВ НЕТ: кнопки уехали в полосу у низа окна, и
     колонки под них держать не для кого. Остаются две — «Автокаст» и всё
     остальное; сцена и полоски идут во всю ширину. */
  @media (max-width: 719px) {
    .permanent {
      grid-template-columns: auto minmax(0, 1fr);
    }
    .stage {
      grid-column: 1 / -1;
    }
    .controls {
      grid-column: 2;
    }
  }

  @media (min-width: 720px) {
    .dressing {
      grid-template-columns: 19rem minmax(0, 1fr);
    }
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
