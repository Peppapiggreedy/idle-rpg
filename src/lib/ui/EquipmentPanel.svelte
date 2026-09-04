<script lang="ts">
  // КУКЛА ГЕРОЯ: семь слотов из `data/slots.ts` и три пути положить в них
  // находку. Весь текст для игрока — здесь.
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
  import { SLOT_ICONS, SLOT_IDS, SLOT_NAMES, type SlotId } from '../data/slots'
  import { gameState, equipInventoryItem, unequipSlot } from '../stores/game'
  import { carriedItem, releaseItem, takeItem, toggleCarried } from '../stores/ui'
  import { carriedOf, slotOutcome } from './dropTarget'
  import { axisRows } from './axisText'
  import ItemMods from './ItemMods.svelte'
  import EnchantLine from './EnchantLine.svelte'
  import { EQUIP_BLOCK_TEXT, GRIP_TEXT, UNEQUIP_BLOCK_TEXT } from './itemText'
  import { RARITY_BY_ID } from '../data/rarity'
  import { IconSlot, Panel, Tag } from './kit'
  import { Icon } from './icons'

  // Двуручное занимает обе руки: левая не пуста, она ЗАНЯТА — и разницу
  // между «надень что-нибудь» и «сюда нельзя» игрок должен видеть.
  const twoHanded = $derived($gameState.equipment.mainHand?.grip === 'two')

  const carriedItemOf = $derived(carriedOf($gameState, $carriedItem))
  const outcomes = $derived(
    new Map(SLOT_IDS.map((slot) => [slot, slotOutcome($gameState, $carriedItem, slot)])),
  )

  /** Слот, над которым сейчас курсор: по нему считается подсказка осей. */
  let hovered = $state<SlotId | null>(null)

  // ПОДСКАЗКА ПОКАЗЫВАЕТ ОБЕ ОСИ И ТЕМИ ЖЕ ЧИСЛАМИ, что окно сравнения:
  // и там, и здесь считает `compareItem`, а строки собирает общий
  // `axisText.ts`. Второй формулы «насколько лучше» в игре нет.
  const hint = $derived.by(() => {
    if (hovered === null || carriedItemOf === null) return null
    if (!outcomes.get(hovered)?.fits) return null
    const cmp = compareItem($gameState, carriedItemOf)
    return { item: carriedItemOf, slot: hovered, rows: axisRows(cmp.axes, cmp.markedAxes) }
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
</script>

<!-- Автонадевания больше нет: предметы надевает только игрок. Оно съедало
     то самое ощущение, ради которого лут и существует, — апгрейд проходил
     незамеченным. Что нашлось и насколько оно лучше, показывает сумка. -->
<Panel title="Экипировка">
  <!-- ЧТО СЕЙЧАС В РУКЕ. Строка появляется, только пока вещь несут: без неё
       выбранная находка отличалась бы от невыбранной одной рамкой в сумке,
       а на телефоне сумка в этот момент уже уехала под палец. -->
  {#if carriedItemOf}
    <p class="carrying" data-carrying>
      <Icon name="slot-weapon" size="sm" />
      Несёшь: <b>{carriedItemOf.name}</b> — выбери подсвеченный слот
      {#if $carriedItem?.from === 'slot'}или брось в сумку, чтобы снять{/if}.
    </p>
  {/if}

  <div class="grid" data-doll>
    {#each SLOT_IDS as slot (slot)}
      {@const item = $gameState.equipment[slot]}
      {@const outcome = outcomes.get(slot)!}
      <IconSlot
        slotLabel={SLOT_NAMES[slot]}
        rarity={item?.rarity}
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
        ariaLabel="{SLOT_NAMES[slot]}: {item ? item.name : 'пусто'}"
        emptyText={slot === 'offHand' && twoHanded ? 'Занята двуручным' : 'пусто'}
        onclick={() => onSlotClick(slot)}
        ondblclick={() => item && unequipSlot(slot)}
        onkeydown={(e: KeyboardEvent) => onSlotKey(e, slot)}
        onpointerdown={() => item && startPress(slot)}
        onpointerup={cancelPress}
        onpointercancel={cancelPress}
        onmouseenter={() => (hovered = slot)}
        onmouseleave={() => hovered === slot && (hovered = null)}
        ondragstart={(e: DragEvent) => onDragStart(e, slot)}
        ondragover={(e: DragEvent) => onDragOver(e, slot)}
        ondrop={(e: DragEvent) => {
          e.preventDefault()
          place(slot)
        }}
        ondragend={() => releaseItem()}
      >
        {#snippet badge()}<Icon name={SLOT_ICONS[slot]} size="lg" />{/snippet}
        {#if item}
          <span class="name">{item.name}</span>
          <Tag rarity={item.rarity} label="{RARITY_BY_ID[item.rarity].name} · {item.level} ур." />
          {#if item.grip}<span class="grip">{GRIP_TEXT[item.grip]}</span>{/if}
          <!-- Зачарование НАДЕТОЙ вещи. Раньше здесь рисовались только
               item.mods, и наложенное зачарование работало (оно приходит в
               конвейер вместе с предметом), но нигде не было видно. -->
          <EnchantLine {item} />
          <ItemMods mods={item.mods} />
        {/if}
        {#snippet footer()}
          <!-- ОТКАЗ — СТРОКОЙ И ЗАРАНЕЕ. Слот подходит находке, но правило
               хвата запрещает — игрок читает причину до попытки, а не после
               неё. Коды приходят из логики, слова живут здесь. -->
          {#if outcome.fits && !outcome.allowed && outcome.reason}
            <span class="deny" data-deny>{EQUIP_BLOCK_TEXT[outcome.reason]}</span>
          {/if}
          <!-- КНОПКИ «СНЯТЬ» ЗДЕСЬ НЕТ, и это не забывчивость. Снять вещь
               можно тремя жестами — двойным щелчком, долгим нажатием и
               броском в сумку, — и все три проверены браузерными тестами.
               Кнопка была четвёртым способом сделать то же самое и занимала
               место в каждой из семи ячеек; вместе с ней ушла и причина, по
               которой кукла выглядела списком кнопок, а не куклой.
               ОТКАЗ ПРИ ЭТОМ ОСТАЛСЯ СЛОВАМИ: полная сумка по-прежнему
               объясняет себя строкой. -->
          {#if item}
            {@const un = unequipStatus($gameState, slot)}
            {#if un.reason}
              <span class="deny" data-deny>{UNEQUIP_BLOCK_TEXT[un.reason]}</span>
            {/if}
          {/if}
        {/snippet}
      </IconSlot>
    {/each}
  </div>

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

  {#snippet footer()}
    <p class="unarmed">
      Пустые руки — бой голыми руками:
      {formatNumber(UNARMED.weaponDamageMin)}–{formatNumber(UNARMED.weaponDamageMax)}
      урона раз в {UNARMED.weaponSpeed.toFixed(2)}с. Надетое оружие заменяет эти
      значения целиком, снятое — возвращает.
    </p>
    <p class="unarmed">
      Три стиля примерно равны по урону: два одноручных бьют чаще (левая рука
      наносит {Math.round(OFFHAND_PENALTY * 100)}% своего урона), двуручное бьёт
      реже, но сильнее, а щит меняет часть урона на блок. Метка «Апгрейд» в
      сумке сравнивает по итоговому урону в секунду ВСЕЙ связки, а не
      отдельного предмета.
    </p>
    <p class="unarmed">
      Надеть находку можно тремя способами: перетащить из сумки, нажать её и
      затем нажать подсвеченный слот, либо задержать нажатие на ней. С
      клавиатуры — Tab до слота и Enter. Снять — двойным щелчком, долгим
      нажатием или броском в сумку. Кнопок «Надеть» и «Снять» нет: каждая из
      них была четвёртым способом сделать то же самое.
    </p>
  {/snippet}
</Panel>

<style>
  .deny {
    font-size: var(--text-2xs);
    color: var(--c-warning);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    gap: var(--space-2);
  }
  .name {
    font-weight: var(--weight-bold);
  }
  .grip {
    font-size: var(--text-2xs);
    color: var(--c-text-faint);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
  }
  .carrying {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0 0 var(--space-2);
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
