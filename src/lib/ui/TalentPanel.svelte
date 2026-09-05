<script lang="ts">
  // ДЕРЕВО ТАЛАНТОВ — СЕТКА ЗНАЧКОВ, А НЕ СПИСОК КАРТОЧЕК.
  //
  // Три ветки переключаются вкладками; открытая ветка — сетка в ЧЕТЫРЕ
  // столбца и тринадцать этажей, как у классических деревьев: узел — квадрат
  // размером в палец со значком и рангом, порог этажа подписан один раз слева,
  // стрелка-предпосылка нарисована прямой линией от опоры к зависимому и
  // тускла, пока опора не набрана. Всё, что читается словами — имя, эффект,
  // причина отказа, — живёт в подсказке у курсора, а не в узле: карточки с
  // текстом занимали по экрану на этаж, и дерево не читалось как дерево.
  //
  // МЕСТО УЗЛА В РЯДУ — ДАННЫМИ (`col` у таланта), как место слота на кукле:
  // стрелка идёт вертикально только если опора и зависимый стоят в одном
  // столбце, и решать это должен автор ветки, а не порядок в файле. Ветка без
  // столбцов (лестница из одного таланта на этаж) центрируется сама.
  //
  // Весь текст для игрока — в `talentText.ts` и в подсказке; логика отдаёт
  // ранги, коды причин и структурированные эффекты.
  import {
    Decimal,
    availablePoints,
    formatNumber,
    heroBranches,
    resetStatus,
    spentInBranch,
    talentStatus,
    takeBackStatus,
    type ResetBlockReason,
  } from '../game'
  import {
    BRANCH_ROW_STEP,
    CONCEPT_ROWS,
    TALENT_BY_ID,
    groupHolder,
    rankOf,
    talentsInBranch,
    type BranchId,
    type TalentDef,
  } from '../data/talents'
  import { floorsOf, type TalentFloor } from './talentFloors'
  import { LEVEL_CAP, TALENT_FIRST_LEVEL } from '../data/balance'
  import {
    gameState,
    investTalentPoint,
    resetTalentTree,
    takeBackTalentPoint,
  } from '../stores/game'
  import { talentDraft } from '../stores/ui'
  import { resourceWords } from './resource'
  import { pluralRu } from './talentText'
  import { Button, NumberText, Panel, Tag } from './kit'
  import { Icon } from './icons'
  import TalentTip from './TalentTip.svelte'

  const points = $derived(availablePoints($gameState))
  const reset = $derived(resetStatus($gameState))
  const resource = $derived(resourceWords($gameState.classId))

  // Почему кнопка сброса заперта. Заперта молча она читалась как сломанная.
  // СКОЛЬКО НЕ ХВАТАЕТ — ЧИСЛОМ. «Не хватает золота» не говорит, сколько ещё
  // копить, и цель превращается в стену без расстояния до неё. Число берётся
  // из логики (`resetStatus.short`), а не считается здесь второй раз.
  const RESET_REASON: Record<ResetBlockReason, (short: Decimal) => string> = {
    'nothing-spent': () => 'Сбрасывать нечего — очки не вложены',
    gold: (short) => `Не хватает ${formatNumber(short)} золота на сброс`,
  }

  // КАКАЯ ВЕТКА ОТКРЫТА — «где я сейчас». В сейв ему не место, и переживать
  // перезагрузку он не должен; локальной переменной компонента достаточно.
  let openBranch = $state<BranchId>(heroBranches($gameState)[0]?.id ?? 'warden-wrath')

  // ДО СЛЕДУЮЩЕГО КЛЮЧЕВОГО — ЧИСЛОМ. Ключевые этажи — то, ради чего ветку
  // берут; расстояние до ближайшего стоит в шапке ветки, а не вычисляется
  // игроком по порогам слева.
  function nextKeyText(spent: number): string {
    const next = CONCEPT_ROWS.map((row) => (row - 1) * BRANCH_ROW_STEP).find((req) => req > spent)
    if (next === undefined) return 'все ключевые этажи открыты'
    const left = next - spent
    return `до следующего ключевого — ${left} ${pluralRu(left, 'очко', 'очка', 'очков')}`
  }

  // СТРЕЛКИ ВЕТКИ: от опоры к зависимому, в столбце зависимого. Линия
  // тускла, пока опора не набрана до нужного ранга.
  interface Arrow {
    id: string
    from: TalentDef
    to: TalentDef
    met: boolean
  }
  function arrowsOf(branch: BranchId, ranks: Readonly<Record<string, number>>): Arrow[] {
    return talentsInBranch(branch).flatMap((to) => {
      const need = to.requires
      const from = need ? TALENT_BY_ID[need.talentId] : undefined
      if (!need || !from) return []
      return [{ id: to.id, from, to, met: rankOf(ranks, need.talentId) >= (need.minRank ?? 1) }]
    })
  }

  const isKey = (talent: TalentDef): boolean => CONCEPT_ROWS.includes(talent.row)

  /** Столбец сетки: первый занят порогом этажа, узлы идут со второго. */
  function cellOf(talent: TalentDef, floor: TalentFloor): string {
    if (talent.col !== undefined) return `${talent.col + 1}`
    // Лестница без столбцов: единственный узел этажа стоит по центру.
    if (floor.talents.length === 1) return '2 / -1'
    return `${floor.talents.indexOf(talent) + 2}`
  }

  /** Пять состояний рамки — и ровно они, каждое читается издали. */
  function stateOf(status: ReturnType<typeof talentStatus>): string {
    if (status.reason === 'group-taken') return 'barred'
    if (status.rank >= status.maxRank) return 'full'
    if (status.rank > 0) return 'partial'
    if (status.canInvest) return 'open'
    return 'locked'
  }

  // ПОДСКАЗКА НЕ ПРИЛИПАЕТ. Видимость — состояние, а не селектор: закрыть
  // надо и по нажатию, и по уходу курсора, и по потере фокуса, и по Esc, и по
  // прокрутке, а CSS умеет только показать. Якорь — правый верхний угол узла.
  let tip = $state<{ id: string; x: number; y: number } | null>(null)
  /** Тач: первое нажатие открывает подсказку, второе по тому же узлу вкладывает. */
  let armed = $state<string | null>(null)
  let touch = $state(false)

  function show(talent: TalentDef, node: Element): void {
    const rect = node.getBoundingClientRect()
    tip = { id: talent.id, x: rect.right, y: rect.top }
  }
  function hide(): void {
    tip = null
    armed = null
  }

  function onPointerUp(event: PointerEvent, talent: TalentDef): void {
    const node = event.currentTarget as Element
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      // ТАП-ТАП. Наведения на телефоне нет: первое нажатие показывает, что это
      // за талант, второе — вкладывает. Иначе очко ложилось бы вслепую.
      touch = true
      if (armed !== talent.id) {
        armed = talent.id
        show(talent, node)
        return
      }
      investTalentPoint(talent.id)
      hide()
      return
    }
    touch = false
    // ЛКМ ВКЛАДЫВАЕТ, ПКМ СНИМАЕТ — как у классических деревьев. Снять можно
    // только вложенное в этот заход: логика откажет сама, экран не спорит.
    if (event.button === 2) takeBackTalentPoint(talent.id)
    else if (event.button === 0) investTalentPoint(talent.id)
    hide()
  }
  // Клавиатура: Enter/пробел приходят click'ом с detail 0; мышь и тач уже
  // обработаны в pointerup и сюда не должны попадать вторым разом.
  function onClick(event: MouseEvent, talent: TalentDef): void {
    if (event.detail !== 0) return
    investTalentPoint(talent.id)
    hide()
  }
  function onKeydown(event: KeyboardEvent, talent: TalentDef): void {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      takeBackTalentPoint(talent.id)
    }
  }
  function onEnter(event: MouseEvent, talent: TalentDef): void {
    touch = false
    show(talent, event.currentTarget as Element)
  }
  function onLeave(): void {
    if (armed === null) hide()
  }
  function onFocusIn(event: FocusEvent, talent: TalentDef): void {
    // ТОЛЬКО КЛАВИАТУРНЫЙ ФОКУС: мышь фокусирует кнопку на mousedown, и это
    // держало бы подсказку после нажатия.
    const node = event.currentTarget as Element
    if (!node.matches(':focus-visible')) return
    show(talent, node)
  }
  function onFocusOut(): void {
    if (armed === null) hide()
  }

  // Esc снимает ближайшее: сперва подсказку, и только если её нет — меню
  // (слушатель меню висит в App.svelte и получает событие вторым). Прокрутка
  // и поворот гасят окно, а не переставляют его.
  $effect(() => {
    if (!tip) return
    const onEsc = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      hide()
      event.stopPropagation()
    }
    const onOutside = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (armed !== null && !target?.closest('[data-talent]')) hide()
    }
    window.addEventListener('keydown', onEsc, true)
    window.addEventListener('resize', hide)
    document.addEventListener('pointerdown', onOutside, true)
    // ПРОКРУТКА СЛУШАЕТСЯ СО СЛЕДУЮЩЕГО КАДРА. Событие scroll браузер
    // отдаёт отложенно, на ближайшем кадре; узел, к которому доскроллили,
    // чтобы навести, успевает открыть подсказку раньше — и та же прокрутка
    // тут же её гасила. Шаги прокрутки кадра идут ДО колбэков rAF, поэтому
    // слушатель, повешенный из rAF, застаёт уже только настоящую прокрутку.
    const raf = requestAnimationFrame(() => window.addEventListener('scroll', hide, true))
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onEsc, true)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      document.removeEventListener('pointerdown', onOutside, true)
    }
  })

  const tipTalent = $derived(tip ? TALENT_BY_ID[tip.id] : undefined)
</script>

<!-- ЗАКРЫТО ЗНАЧИТ НЕ ВИДНО: до первого очка дерева нет в разметке вовсе.
     Пустое дерево с подписью «первое очко на десятом уровне» показывало
     игроку всю будущую прокачку заранее — то есть ровно то, что лестница
     открытий держит закрытым. -->
{#if $gameState.level.gte(TALENT_FIRST_LEVEL)}
<Panel title="Таланты">
  {#snippet header()}
    {#if points > 0}
      <Tag tone="xp" size="md" label="свободных очков: {points}" />
    {:else if $gameState.level.gte(LEVEL_CAP)}
      <!--
        НА ПОТОЛКЕ ОБЕЩАТЬ НЕЧЕГО. «Следующее с уровнем» — правда ровно до
        сотого: дальше уровней не будет, и обещание превращается в ожидание
        того, что не наступит. Всё, что можно, уже вложено; поменять выбор
        можно только сбросом, и подпись говорит именно это.
      -->
      <Tag size="md" label="очки кончились: все вложены, дальше только сброс" />
    {:else}
      <Tag size="md" label="очков нет — следующее с уровнем" />
    {/if}
  {/snippet}

  <!-- ТРИ ВЕТКИ ПЕРЕКЛЮЧАЮТСЯ, И ОЧКИ ВИДНЫ В КАЖДОЙ. Выбор ветки — главное
       решение игрока: он обязан видеть, сколько уже вложено в каждую, не
       переключаясь. -->
  <div class="tabs" role="tablist" data-branch-tabs>
    {#each heroBranches($gameState) as branch (branch.id)}
      {@const spent = spentInBranch($gameState.talents, branch.id)}
      <button
        type="button"
        role="tab"
        class="tab"
        class:active={branch.id === openBranch}
        aria-selected={branch.id === openBranch}
        onclick={() => (openBranch = branch.id)}
      >
        {branch.name}
        <span class="spent" class:some={spent > 0}>{spent}</span>
      </button>
    {/each}
  </div>

  {#each heroBranches($gameState).filter((b) => b.id === openBranch) as branch (branch.id)}
    {@const spent = spentInBranch($gameState.talents, branch.id)}
    <div class="branch" data-branch={branch.id}>
      <!-- ШАПКА ВЕТКИ: вложено и сколько до ключевого. -->
      <div class="branch-head" data-next-key>
        <span class="branch-name">{branch.name}</span>
        <span class="branch-spent">вложено {spent}</span>
        <span class="branch-next">{nextKeyText(spent)}</span>
      </div>
      <!-- ПРОКРУТКА — СВОЯ. Дерево в тринадцать этажей длиннее телефона, и
           листать его надо внутри панели, а не вместе со сценой. -->
      <div class="scroll">
        <div class="tree">
          {#each floorsOf(branch.id) as floor (floor.row)}
            <!-- ЭТАЖ — РЯД С ОБЩИМ ПОРОГОМ, подписан один раз слева. Сам ряд в
                 потоке не участвует (display: contents): узлы стоят в общей
                 сетке по своим столбцам, а стрелки идут сквозь этажи. -->
            <div class="floor" data-floor={floor.row}>
              <span class="gate" class:met={spent >= floor.required} style="grid-row: {floor.row}">
                {floor.required}
              </span>
              {#each floor.talents as talent (talent.id)}
                {@const status = talentStatus($gameState, talent)}
                {@const state = stateOf(status)}
                <button
                  type="button"
                  class="node {state}"
                  class:key={isKey(talent)}
                  style="grid-column: {cellOf(talent, floor)}; grid-row: {floor.row}"
                  data-talent={talent.id}
                  data-state={state}
                  data-key={isKey(talent) ? '' : undefined}
                  data-group-locked={status.reason === 'group-taken' ? '' : undefined}
                  aria-label="{talent.name}, ранг {status.rank} из {status.maxRank}"
                  onpointerup={(e) => onPointerUp(e, talent)}
                  oncontextmenu={(e) => e.preventDefault()}
                  onclick={(e) => onClick(e, talent)}
                  onkeydown={(e) => onKeydown(e, talent)}
                  onmouseenter={(e) => onEnter(e, talent)}
                  onmouseleave={onLeave}
                  onfocusin={(e) => onFocusIn(e, talent)}
                  onfocusout={onFocusOut}
                >
                  <Icon name={talent.icon} size="lg" />
                  <span class="rank" class:full={status.rank >= status.maxRank} data-rank>
                    {status.rank}/{status.maxRank}
                  </span>
                </button>
              {/each}
            </div>
          {/each}
          <!-- СТРЕЛКИ — ПРЯМЫЕ ЛИНИИ под узлами, в столбце зависимого. Линия
               тускла, пока опора не набрана; узлы лежат поверх, и там, где
               столбец занят чужим узлом, линия проходит за ним. -->
          {#each arrowsOf(branch.id, $gameState.talents) as arrow (arrow.id)}
            <span
              class="arrow"
              class:met={arrow.met}
              class:from-key={isKey(arrow.from)}
              class:to-key={isKey(arrow.to)}
              data-arrow={arrow.id}
              data-met={arrow.met ? '' : undefined}
              style="grid-column: {(arrow.to.col ?? 1) + 1}; grid-row: {arrow.from.row} / {arrow.to.row + 1}"
            ></span>
          {/each}
        </div>
      </div>
    </div>
  {/each}

  {#snippet footer()}
    <Button disabled={!reset.canReset} onclick={() => resetTalentTree()}>
      Сбросить таланты за <NumberText value={reset.cost} tone="gold" />
    </Button>
    <span class="hint">
      {#if reset.reason}
        {RESET_REASON[reset.reason](reset.short)}.
      {:else if $gameState.talentResets > 0}
        Сбросов было {$gameState.talentResets} — каждый следующий дороже.
      {:else}
        Первый сброс по базовой цене; каждый следующий дороже.
      {/if}
    </span>
  {/snippet}
</Panel>

{#if tipTalent}
  <TalentTip
    talent={tipTalent}
    status={talentStatus($gameState, tipTalent)}
    back={takeBackStatus($gameState, tipTalent, $talentDraft)}
    holder={groupHolder($gameState.talents, tipTalent)}
    {resource}
    {touch}
    x={tip?.x ?? 0}
    y={tip?.y ?? 0}
  />
{/if}
{/if}

<style>
  /* ПЕРЕКЛЮЧАТЕЛЬ ВЕТОК. Три дерева рядом не помещаются на телефон, а число
     вложенных очков видно у каждой вкладки: выбор ветки — главное решение,
     и делать его вслепую нельзя. */
  .tabs {
    display: flex;
    gap: var(--space-1);
    margin-bottom: var(--space-3);
  }
  .tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-height: var(--tap-min);
    padding: var(--space-2);
    font: inherit;
    color: var(--c-text-muted);
    background: var(--c-surface-sunken);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    cursor: pointer;
  }
  .tab.active {
    color: var(--c-text);
    border-color: var(--c-accent);
    background: color-mix(in srgb, var(--c-accent) var(--tint-weak), var(--c-surface-sunken));
  }
  .spent {
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
  .spent.some {
    color: var(--c-xp);
  }
  .branch {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .branch-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    color: var(--c-text-muted);
  }
  .branch-name {
    color: var(--c-text);
    font-weight: var(--weight-medium);
  }
  .branch-next {
    color: var(--c-xp);
  }
  .scroll {
    max-height: min(70vh, 52rem);
    overflow: auto;
    padding: var(--space-1);
  }
  /* СЕТКА: порог слева, четыре столбца узлов, этаж — ряд. Ячейка размером
     с ключевой узел, чтобы обычный и ключевой стояли на одной оси. Всё в
     токенах: узел — минимальная область нажатия, ключевой — на шаг больше. */
  .tree {
    --node: var(--tap-min);
    --node-key: calc(var(--tap-min) + var(--space-3));
    --cell: calc(var(--node-key) + var(--space-2));
    position: relative;
    display: grid;
    grid-template-columns: auto repeat(4, var(--cell));
    grid-auto-rows: var(--cell);
    column-gap: var(--space-1);
    align-items: center;
    justify-items: center;
    width: max-content;
    margin: 0 auto;
  }
  .floor {
    display: contents;
  }
  .gate {
    grid-column: 1;
    justify-self: end;
    min-width: 2ch;
    padding-right: var(--space-1);
    font-size: var(--text-xs);
    color: var(--c-text-faint);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .gate.met {
    color: var(--c-xp);
  }
  /* УЗЕЛ — КВАДРАТ В ПАЛЕЦ. Пять состояний рамки, и различаются они рамкой
     и яркостью, а не текстом: текст живёт в подсказке. */
  .node {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--node);
    height: var(--node);
    padding: 0;
    font: inherit;
    color: var(--c-text);
    background: var(--c-surface-sunken);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    touch-action: manipulation;
  }
  .node.key {
    width: var(--node-key);
    height: var(--node-key);
    border-radius: var(--radius-lg);
  }
  .node.locked {
    opacity: 0.5;
  }
  .node.open {
    border-color: var(--c-accent);
  }
  .node.partial {
    border-color: color-mix(in srgb, var(--c-xp) 60%, transparent);
    background: color-mix(in srgb, var(--c-xp) var(--tint-weak), var(--c-surface-sunken));
  }
  .node.full {
    border-color: var(--c-xp);
    background: color-mix(in srgb, var(--c-xp) var(--tint), var(--c-surface-sunken));
  }
  /* ЗАПЕРТ ВЫБОРОМ — не «ещё не открыт», а «уже не будет»: пунктир цветом
     предупреждения, чтобы не путать с порогом. */
  .node.barred {
    border-style: dashed;
    border-color: var(--c-warning);
    opacity: 0.45;
  }
  .node:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .node:hover {
    border-color: var(--c-border-strong);
  }
  .node.open:hover {
    border-color: var(--c-accent-strong);
  }
  .rank {
    position: absolute;
    right: 0;
    bottom: 0;
    padding: 0 var(--space-1);
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    color: var(--c-text-muted);
    background: var(--c-surface-raised);
    border-top-left-radius: var(--radius-sm);
    border-bottom-right-radius: var(--radius-md);
    font-variant-numeric: tabular-nums;
  }
  .rank.full {
    color: var(--c-xp);
  }
  /* СТРЕЛКА: линия от центра опоры к верху зависимого, под узлами. Тусклая,
     пока опора не набрана; наконечник — треугольник у зависимого. Концы
     отступают на половину узла, чтобы линия начиналась и кончалась под ним:
     задаются top/bottom, а не отступами — отступы у нас только из шкалы. */
  .arrow {
    position: relative;
    z-index: 0;
    align-self: stretch;
    justify-self: center;
    width: var(--space-2);
    --from: var(--node);
    --to: var(--node);
    pointer-events: none;
  }
  .arrow.from-key {
    --from: var(--node-key);
  }
  .arrow.to-key {
    --to: var(--node-key);
  }
  .arrow::before {
    content: '';
    position: absolute;
    left: 50%;
    top: calc(var(--from) / 2);
    bottom: calc(var(--to) / 2);
    width: var(--space-1);
    transform: translateX(-50%);
    background: var(--c-border);
    border-radius: var(--radius-pill);
  }
  .arrow::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: calc(var(--to) / 2);
    transform: translateX(-50%);
    border-left: var(--space-2) solid transparent;
    border-right: var(--space-2) solid transparent;
    border-top: var(--space-2) solid var(--c-border);
  }
  .arrow.met::before {
    background: var(--c-accent);
  }
  .arrow.met::after {
    border-top-color: var(--c-accent);
  }
  .hint {
    font-size: var(--text-xs);
    color: var(--c-text-muted);
  }
</style>
