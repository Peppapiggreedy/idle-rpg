<script lang="ts">
  // КУКЛА ГЕРОЯ — АНАТОМИЧЕСКАЯ СЕТКА ЗНАЧКОВ, а не столбик карточек.
  //
  // Карточек было семь, и в каждой лежало полное описание вещи: имя, ярлык
  // редкости, хват, зачарование и список модификаторов. На телефоне это
  // четыре десятка строк — сумка уезжала под сгиб, и переодевание, ради
  // которого кукла и существует, шло вслепую: надетое видно, находку нет.
  // Теперь в ячейке значок слота и уровень вещи, а описание приходит
  // всплывающим окном (`ItemTip`) — ровно как в сумке приходит сравнение.
  //
  // МЕСТО ЯЧЕЙКИ — ДАННЫМИ (`SLOT_CELL` в `data/slots.ts`): голова сверху,
  // талисман сбоку от неё, вниз по центру грудь и ноги, кисти сбоку, обе
  // руки в нижнем ряду. Компонент чисел раскладки не знает.
  //
  // ПУТЕЙ РОВНО ТРИ, И ЭТО НЕ ИЗБЫТОК:
  //   1. перетаскивание мышью — привычное и самое быстрое;
  //   2. «нажал вещь → нажал слот» — единственный путь на тач-экране, где
  //      HTML5-перетаскивания нет вовсе;
  //   3. долгое нажатие или двойной щелчок — «надеть немедленно», без выбора
  //      слота: у находки он всё равно один.
  // Решает «можно ли сюда» ОДНА функция на все три (`ui/dropTarget.ts`),
  // иначе пути разъедутся на первой же правке правил хвата.
  import { compareItem, formatNumber, unequipStatus } from '../game'
  import { OFFHAND_PENALTY, UNARMED } from '../data/balance'
  import { LONG_PRESS_MS } from '../data/render'
  import { DOLL_COLS, SLOT_CELL, SLOT_ICONS, SLOT_IDS, SLOT_NAMES, type SlotId } from '../data/slots'
  import { gameState, equipInventoryItem, unequipSlot } from '../stores/game'
  import { carriedItem, releaseItem, takeItem, toggleCarried } from '../stores/ui'
  import { carriedOf, slotOutcome } from './dropTarget'
  import { axisRows } from './axisText'
  import ItemTip from './ItemTip.svelte'
  import { EQUIP_BLOCK_TEXT, UNEQUIP_BLOCK_TEXT } from './itemText'
  import { IconSlot, Panel } from './kit'
  import { Icon } from './icons'

  // Двуручное занимает обе руки: левая не пуста, она ЗАНЯТА — и разницу
  // между «надень что-нибудь» и «сюда нельзя» игрок должен видеть. Видит он
  // её СЦЕПКОЙ ЯЧЕЕК: пара рисуется одним широким блоком в цвете оружия.
  const twoHanded = $derived($gameState.equipment.mainHand?.grip === 'two')

  const carriedItemOf = $derived(carriedOf($gameState, $carriedItem))
  const outcomes = $derived(
    new Map(SLOT_IDS.map((slot) => [slot, slotOutcome($gameState, $carriedItem, slot)])),
  )

  /** Слот, над которым сейчас курсор: по нему считается подсказка осей. */
  let hovered = $state<SlotId | null>(null)
  /** Описание надетого: слот и якорь окна. Мышь и клавиатура, не палец. */
  let tip = $state<{ slot: SlotId; x: number; y: number } | null>(null)
  const tipItem = $derived(tip ? $gameState.equipment[tip.slot] : null)

  // ПОДСКАЗКА ПОКАЗЫВАЕТ ОБЕ ОСИ И ТЕМИ ЖЕ ЧИСЛАМИ, что окно сравнения:
  // и там, и здесь считает `compareItem`, а строки собирает общий
  // `axisText.ts`. Второй формулы «насколько лучше» в игре нет.
  const hint = $derived.by(() => {
    if (hovered === null || carriedItemOf === null) return null
    if (!outcomes.get(hovered)?.fits) return null
    const cmp = compareItem($gameState, carriedItemOf)
    return { item: carriedItemOf, slot: hovered, rows: axisRows(cmp.axes, cmp.markedAxes) }
  })

  // ОТКАЗ — СТРОКОЙ И ЗАРАНЕЕ, но уже НЕ В ЯЧЕЙКЕ: в квадрат со значком
  // предложение не помещается. Строка встаёт под куклой, называет слот и
  // остаётся тем же обещанием — игрок читает причину ДО попытки, а не после.
  const denials = $derived(
    SLOT_IDS.map((slot) => ({ slot, outcome: outcomes.get(slot)! })).filter(
      (row) => row.outcome.fits && !row.outcome.allowed && row.outcome.reason !== null,
    ),
  )
  // Снять мешает только полная сумка, и мешает она ВСЕМУ надетому сразу:
  // семь одинаковых строк — это не семь причин, а одна.
  const unequipDenial = $derived.by(() => {
    for (const slot of SLOT_IDS) {
      if (!$gameState.equipment[slot]) continue
      const reason = unequipStatus($gameState, slot).reason
      if (reason !== null) return reason
    }
    return null
  })

  /** Положить несомое в слот. Отказ показан строкой и без того. */
  function place(slot: SlotId): void {
    const outcome = outcomes.get(slot)
    if (!outcome?.allowed || $carriedItem?.from !== 'bag') return
    equipInventoryItem($carriedItem.itemId)
    releaseItem()
  }

  function onSlotClick(slot: SlotId): void {
    // Несём находку — нажатие по слоту КЛАДЁТ её. Иначе нажатие берёт в руку
    // то, что в слоте лежит: снять перетаскиванием в сумку.
    if ($carriedItem?.from === 'bag') {
      place(slot)
      return
    }
    if ($gameState.equipment[slot]) toggleCarried({ from: 'slot', slot })
  }

  function onSlotKey(event: KeyboardEvent, slot: SlotId): void {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSlotClick(slot)
  }

  // Долгое нажатие и двойной щелчок на надетом — снять немедленно.
  let pressTimer: ReturnType<typeof setTimeout> | null = null
  function startPress(slot: SlotId): void {
    cancelPress()
    pressTimer = setTimeout(() => {
      pressTimer = null
      if ($gameState.equipment[slot]) unequipSlot(slot)
    }, LONG_PRESS_MS)
  }
  function cancelPress(): void {
    if (pressTimer !== null) clearTimeout(pressTimer)
    pressTimer = null
  }

  function onDragStart(event: DragEvent, slot: SlotId): void {
    if (!$gameState.equipment[slot]) return
    takeItem({ from: 'slot', slot })
    event.dataTransfer?.setData('text/plain', slot)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }
  function onDragOver(event: DragEvent, slot: SlotId): void {
    if (!outcomes.get(slot)?.fits) return
    // preventDefault здесь — это и есть «сюда можно бросить»: без него
    // браузер не отдаст drop вовсе.
    event.preventDefault()
    hovered = slot
  }

  /** Наведение: и подсказка осей, и описание надетого — от одной точки. */
  function onEnter(event: MouseEvent, slot: SlotId): void {
    hovered = slot
    tip = $gameState.equipment[slot] ? { slot, x: event.clientX, y: event.clientY } : null
  }
  function onLeave(slot: SlotId): void {
    if (hovered === slot) hovered = null
    if (tip?.slot === slot) tip = null
  }
  /** Клавиатура: описание встаёт у самой ячейки — курсора у неё нет. */
  function onFocus(event: FocusEvent, slot: SlotId): void {
    const box = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect()
    hovered = slot
    tip = box && $gameState.equipment[slot] ? { slot, x: box.right, y: box.bottom } : null
  }
</script>

<!-- Автонадевания больше нет: предметы надевает только игрок. Оно съедало
     то самое ощущение, ради которого лут и существует, — апгрейд проходил
     незамеченным. Что нашлось и насколько оно лучше, показывает сумка. -->
<Panel title="Экипировка">
  <div
    class="grid"
    data-doll
    style="grid-template-columns: repeat({DOLL_COLS}, minmax(0, 1fr));"
  >
    {#each SLOT_IDS as slot (slot)}
      {@const cell = SLOT_CELL[slot]}
      {@const item = $gameState.equipment[slot]}
      <!-- ЛЕВАЯ РУКА ПОД ДВУРУЧНЫМ НЕ ПУСТА, А ЗАНЯТА: ячейка берёт цвет
           того самого оружия и сцепляется с его половиной в один блок. -->
      {@const held = slot === 'offHand' && twoHanded ? $gameState.equipment.mainHand : null}
      {@const outcome = outcomes.get(slot)!}
      <div
        class="cell"
        class:join-start={twoHanded && slot === 'mainHand'}
        class:join-end={held !== null}
        style="grid-column: {cell.col}; grid-row: {cell.row};"
      >
        <IconSlot
          compact
          join={twoHanded && slot === 'mainHand'
            ? 'start'
            : held !== null
              ? 'end'
              : undefined}
          rarity={item?.rarity ?? held?.rarity}
          active={item !== null}
          interactive
          draggable={item !== null}
          drop={$carriedItem === null
            ? undefined
            : $carriedItem.from === 'slot' && $carriedItem.slot === slot
              ? 'carried'
              : outcome.fits
                ? 'target'
                : 'dim'}
          ariaLabel="{SLOT_NAMES[slot]}: {item
            ? item.name
            : held
              ? 'занята двуручным'
              : 'пусто'}"
          emptyText=""
          onclick={() => onSlotClick(slot)}
          ondblclick={() => item && unequipSlot(slot)}
          onkeydown={(e: KeyboardEvent) => onSlotKey(e, slot)}
          onpointerdown={() => item && startPress(slot)}
          onpointerup={cancelPress}
          onpointercancel={cancelPress}
          onmouseenter={(e: MouseEvent) => onEnter(e, slot)}
          onmouseleave={() => onLeave(slot)}
          onfocusin={(e: FocusEvent) => onFocus(e, slot)}
          ondragstart={(e: DragEvent) => onDragStart(e, slot)}
          ondragover={(e: DragEvent) => onDragOver(e, slot)}
          ondrop={(e: DragEvent) => {
            e.preventDefault()
            place(slot)
          }}
          ondragend={() => releaseItem()}
        >
          <!-- ЗНАЧОК СЛОТА — ВСЁ СОДЕРЖИМОЕ ЯЧЕЙКИ, как и в сумке: что за
               вещь, говорит значок, редкость — рамка, силу — уровень числом.
               Имя, статы и зачарование показывает окно под курсором. -->
          {#snippet badge()}
            {#if !item && !held}<Icon name={SLOT_ICONS[slot]} size="lg" />{/if}
          {/snippet}
          {#if item}
            <Icon name={SLOT_ICONS[slot]} size="lg" />
            <span class="lvl">{item.level}</span>
          {/if}
        </IconSlot>
      </div>
    {/each}
  </div>

  <!-- ВСЁ, ЧТО ПОЯВЛЯЕТСЯ И ПРОПАДАЕТ, СТОИТ ПОД СЕТКОЙ, А НЕ НАД НЕЙ.
       Строка «несёшь» жила выше куклы и двигала её ровно в тот момент, когда
       игрок брал вещь в руку: сетка съезжала на высоту строки, и второе
       нажатие приходилось уже мимо ячейки — двойной щелчок по надетому
       переставал работать вовсе. Ячейка стала мелкой, и промах в тридцать
       пикселей теперь стоит целого слота. Ниже сетки то же появление не
       двигает ничего.

       ЧТО СЕЙЧАС В РУКЕ. Строка появляется, только пока вещь несут: без неё
       выбранная находка отличалась бы от невыбранной одной рамкой в сумке,
       а на телефоне сумка в этот момент уже уехала под палец. -->
  {#if carriedItemOf}
    <p class="carrying" data-carrying>
      <Icon name="slot-weapon" size="sm" />
      Несёшь: <b>{carriedItemOf.name}</b> — выбери подсвеченный слот
      {#if $carriedItem?.from === 'slot'}или брось в сумку, чтобы снять{/if}.
    </p>
  {/if}

  <!-- ПОЧЕМУ ЛЕВАЯ РУКА ПУСТА — СЛОВАМИ И БЕЗ НАВЕДЕНИЯ. Сцепка ячеек
       показывает это цветом, но цвет ничего не называет, а пальцем окно
       описания не открыть. Строка короткая и стоит ровно тогда, когда
       двуручное надето. -->
  {#if twoHanded}
    <p class="note" data-two-handed>Двуручное занимает обе руки.</p>
  {/if}

  {#each denials as row (row.slot)}
    <p class="deny" data-deny>
      {SLOT_NAMES[row.slot]}: {EQUIP_BLOCK_TEXT[row.outcome.reason!]}
    </p>
  {/each}
  {#if unequipDenial !== null}
    <p class="deny" data-deny>{UNEQUIP_BLOCK_TEXT[unequipDenial]}</p>
  {/if}

  <!-- ОБЕ ОСИ, ОДНОЙ СТРОКОЙ И БЕЗ ПРЫЖКОВ РАСКЛАДКИ. Внутри ячейки эти две
       строки меняли бы её высоту на каждом наведении, и кукла дёргалась бы
       под курсором. -->
  {#if hint}
    <p class="axes" data-axes>
      <b>{hint.item.name}</b> → {SLOT_NAMES[hint.slot]}:
      {#each hint.rows as row (row.axis)}
        <span class="axis" class:marked={row.marked} class:up={(row.value ?? 0) > 0}>
          {row.name} {row.text}
        </span>
      {/each}
    </p>
  {/if}

  {#if tip && tipItem}
    <ItemTip item={tipItem} slot={tip.slot} x={tip.x} y={tip.y} />
  {/if}

  {#snippet footer()}
    <!-- ТРИ АБЗАЦА СТАЛИ ДВУМЯ. Кукла ужалась до фигуры размером с ладонь, и
         подпись под ней оказалась выше самой куклы: на телефоне между ней и
         сумкой лежало полтора экрана текста — ровно та беда, от которой
         правка и затевалась. Ни одного факта при этом не потеряно. -->
    <p class="unarmed">
      Пустые руки — бой голыми руками:
      {formatNumber(UNARMED.weaponDamageMin)}–{formatNumber(UNARMED.weaponDamageMax)}
      урона раз в {UNARMED.weaponSpeed.toFixed(2)}с; надетое оружие заменяет эти
      значения целиком. Три стиля примерно равны по урону: два одноручных бьют
      чаще (левая рука наносит {Math.round(OFFHAND_PENALTY * 100)}% своего
      урона), двуручное реже и сильнее, щит меняет часть урона на блок.
    </p>
    <p class="unarmed">
      Надеть: перетащить из сумки, нажать находку и затем подсвеченный слот
      либо задержать на ней нажатие. Снять: двойной щелчок, долгое нажатие или
      бросок в сумку. С клавиатуры — Tab до ячейки и Enter.
    </p>
  {/snippet}
</Panel>

<style>
  .deny {
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--c-warning);
  }
  .note {
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--c-text-faint);
  }
  /* КУКЛА — ФИГУРА, А НЕ РЯД. Колонок ровно столько, сколько их в данных
     раскладки, и сетка не растягивается на всю ширину панели: семь значков
     в фигуру размером с ладонь читаются одним взглядом, а растянутые на
     тысячу пикселей — уже нет. */
  .grid {
    display: grid;
    gap: 0;
    width: min(100%, 15rem);
  }
  /* ЗАЗОР МЕЖДУ ЯЧЕЙКАМИ ДАЁТ ОБЁРТКА, А НЕ `gap` СЕТКИ, и это единственный
     способ сцепить пару рук: `gap` нельзя погасить для одной пары соседей,
     а поле обёртки — можно. Половинки двуручного смыкаются вплотную и
     читаются одним широким блоком. */
  .cell {
    padding: var(--space-1);
  }
  .cell.join-start {
    padding-right: 0;
  }
  .cell.join-end {
    padding-left: 0;
  }
  /* Уровень вещи — единственное число на значке: без него «Редкий» третьего
     уровня выглядел бы равным «Редкому» шестидесятого. */
  .lvl {
    position: absolute;
    right: var(--space-1);
    bottom: 0;
    font-size: var(--text-2xs);
    color: var(--c-text-faint);
  }
  .carrying {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    color: var(--c-accent);
  }
  .axes {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    color: var(--c-text-muted);
  }
  .axis.marked {
    font-weight: var(--weight-bold);
    color: var(--c-text);
  }
  .axis.up {
    color: var(--c-heal);
  }
  .unarmed {
    margin: 0;
  }
</style>
