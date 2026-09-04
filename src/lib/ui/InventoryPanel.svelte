<script lang="ts">
  import {
    Decimal,
    disenchantStatus,
    equipStatus,
    enchantModifiers,
    enchantOf,
    formatNumber,
    sellPrice,
    upgradeShare,
    type DisenchantBlockReason,
  } from '../game'
  import { EQUIP_BLOCK_TEXT, GRIP_TEXT, UNEQUIP_BLOCK_TEXT } from './itemText'
  import { ENCHANT_UNLOCK_LEVEL } from '../data/balance'
  import { LONG_PRESS_MS } from '../data/render'
  import { carriedItem, releaseItem, takeItem, toggleCarried } from '../stores/ui'
  import { bagOutcome } from './dropTarget'
  import { itemSlotLabel } from './itemText'
  import {
    disenchantInventoryItem,
    equipInventoryItem,
    gameState,
    sellInventoryItem,
    setUpgradePriority,
    buyGoldUpgrade,
    setLootPolicy,
    unequipSlot,
  } from '../stores/game'
  import ItemMods from './ItemMods.svelte'
  import EnchantLine from './EnchantLine.svelte'
  import ItemCompare from './ItemCompare.svelte'
  import { RARITY_BY_ID } from '../data/rarity'
  import { SLOT_ICONS } from '../data/slots'
  import { UPGRADE_PRIORITIES, type UpgradePriority } from '../data/upgrade'
  import type { GoldUpgradeDef, LootPolicy } from '../data/upgrades'
  import { plural } from './plural'
  import { availableLootPolicies, availableUpgrades, inventorySize, lootPolicyOf } from '../game/upgrades'
  import type { UpgradeBlockReason } from '../game/upgrades'
  import { Button, IconSlot, NumberText, Panel, Tag, rarityStyle } from './kit'
  import { combatKey, createMemo } from './memo'
  import { Icon } from './icons'

  // РАЗМЕР СУМКИ ПРОИЗВОДЕН от покупок: константа осталась базой, а сколько
  // мест у ЭТОГО героя, считает game/upgrades.ts.
  const bagSize = $derived(inventorySize($gameState))
  const emptySlots = $derived(Math.max(0, bagSize - $gameState.inventory.length))

  // МЕТКА АПГРЕЙДА — то, ради чего снесено автонадевание. Видно не только
  // «лучше», но и НА СКОЛЬКО: доля прироста урона в секунду. Считается тем
  // же estimateCombatRate, что и сравнение под курсором, — двух мер
  // «хорошести» в игре нет.
  // Считается ТОЛЬКО когда меняются входы (см. ui/memo.ts): статы, экипировка,
  // сумка, зона. Каждый тик — это две боевые оценки на каждую вещь, то есть
  // полсотни на полной сумке десять раз в секунду; ровно из-за этого игра и
  // начинала дёргаться при открытой сумке.
  const sharesMemo = createMemo<Map<string, number | null>>()
  // Приоритет входит в ключ мемо: сменил игрок положение переключателя —
  // метки обязаны пересчитаться, а статы при этом не менялись.
  const shares = $derived(
    sharesMemo([...combatKey($gameState), $gameState.upgradePriority], () =>
      new Map($gameState.inventory.map((i) => [i.id, upgradeShare($gameState, i)])),
    ),
  )
  // Сортировка одна и по делу: сверху то, что сильнее всего поднимет урон.
  const sorted = $derived(
    [...$gameState.inventory].sort(
      (a, b) => (shares.get(b.id) ?? -1) - (shares.get(a.id) ?? -1),
    ),
  )
  function upgradeLabel(share: number | null | undefined): string | null {
    if (share === null || share === undefined) return null
    if (!Number.isFinite(share)) return 'слот пуст'
    return `+${Math.round(share * 100)}%`
  }

  // ПЕРЕКЛЮЧАТЕЛЬ ПРИОРИТЕТА. Названия положений и пояснение к ним — текст
  // для игрока, поэтому живут здесь, а не в данных: в `data/upgrade.ts`
  // лежат сами правила («какие оси смотреть»), и они молчат.
  const PRIORITY_NAME: Record<UpgradePriority, string> = {
    damage: 'Урон',
    survival: 'Живучесть',
    balance: 'Баланс',
  }
  // ПОКУПКИ И РАЗБОР. Названия положений и причины отказов — текст для
  // игрока, поэтому здесь; сама лестница и её числа лежат в data/upgrades.ts.
  const upgrades = $derived(availableUpgrades($gameState))
  const policies = $derived(availableLootPolicies($gameState))
  const policy = $derived(lootPolicyOf($gameState))
  const POLICY_NAME: Record<LootPolicy, string> = {
    keep: 'Не трогать',
    sell: 'Продавать',
    dust: 'Распылять',
  }
  const POLICY_HINT: Record<LootPolicy, string> = {
    keep: 'Всё падает в сумку — разбираешь сам.',
    sell: 'Лишнее уходит в золото сразу. Лучшее хоть по одной оси остаётся.',
    dust: 'Лишнее уходит в пыль сразу. Лучшее хоть по одной оси остаётся.',
  }
  /**
   * ОПИСАНИЕ ПОКУПКИ СТРОИТСЯ ИЗ ДАННЫХ там, где в нём есть ЧИСЛО. В
   * data/upgrades.ts у пяти ступеней стояло «Ещё четыре места в сумке»
   * словом, а число мест лежало рядом в `effect.slots` — две правды об одном,
   * и разъехаться им ничто не мешало. Число теперь одно, и берётся оно из
   * эффекта; всё остальное описание — как записано в данных.
   */
  function upgradeText(def: GoldUpgradeDef): string {
    if (def.effect.kind !== 'bag') return def.description
    const n = def.effect.slots
    return `Ещё ${n} ${plural(n, 'место', 'места', 'мест')} в сумке.`
  }

  const UPGRADE_REASON: Record<UpgradeBlockReason, string> = {
    owned: 'Уже куплено',
    level: 'Откроется позже',
    gold: 'Не хватает золота',
  }

  const PRIORITY_HINT: Record<UpgradePriority, string> = {
    damage: 'Апгрейд — то, что поднимает урон в секунду. Остальное разбирается.',
    survival: 'Апгрейд — то, что поднимает живучесть. Остальное разбирается.',
    balance: 'Апгрейд — то, что лучше хоть по одной оси. Лишнее — только хуже по обеим.',
  }

  // Распыление живёт ЗДЕСЬ, рядом с продажей: это две половины одного
  // решения — «что делать с находкой», — и разносить их по экранам нельзя.
  const DISENCHANT_REASON: Record<DisenchantBlockReason, string> = {
    // Число берётся из данных, а не переписывается сюда: логика запирает
    // распыление тем же ENCHANT_UNLOCK_LEVEL, и разъедься они — текст начнёт
    // врать молча, ровно как врал «0 шанс блока».
    locked: `Распыление откроется на ${ENCHANT_UNLOCK_LEVEL} уровне`,
    equipped: 'Сперва сними предмет',
    missing: 'Предмета больше нет',
  }
  // Подтверждение спрашивается ТОЛЬКО у зачарованной вещи: лишний клик на
  // каждую находку убил бы разбор сумки.
  let confirming = $state<string | null>(null)

  /**
   * ОКНО СРАВНЕНИЯ. Живёт отдельно от карточки и позиционируется по курсору.
   *
   * Раньше сравнение раскрывалось внутри карточки: она росла, и кнопки
   * «Продать» и «Распылить» уезжали из-под курсора ровно тогда, когда игрок
   * к ним тянулся. Теперь карточка при наведении не меняет ни высоту, ни
   * содержимое — двигается только это окно.
   *
   * `pinned` — тач: наведения там нет вовсе, поэтому окно открывается
   * нажатием по иконке и закрывается нажатием вне или по Esc.
   */
  let compare = $state<{ id: string; x: number; y: number } | null>(null)
  let pinned = $state(false)
  const compareItemOf = $derived(
    compare ? ($gameState.inventory.find((i) => i.id === compare!.id) ?? null) : null,
  )

  function track(event: MouseEvent, id: string) {
    if (pinned) return
    compare = { id, x: event.clientX, y: event.clientY }
  }
  function unhover(id: string) {
    if (pinned) return
    if (compare?.id === id) compare = null
  }
  /**
   * Нажатие по иконке ДЕЛАЕТ ДВА ДЕЛА СРАЗУ, и это не совмещение ради
   * экономии: игрок, выбирающий вещь для слота, обязан в этот же момент
   * видеть, что она даёт. Поэтому нажатие и берёт вещь в руку, и открывает
   * окно сравнения — на тач-экране это вообще единственный способ его
   * открыть. Повторное нажатие по той же вещи отменяет и то, и другое.
   */
  function toggle(event: MouseEvent, id: string) {
    if (longFired) {
      longFired = false
      return
    }
    if (pinned && compare?.id === id) {
      pinned = false
      compare = null
      releaseItem()
      return
    }
    pinned = true
    compare = { id, x: event.clientX, y: event.clientY }
    toggleCarried({ from: 'bag', itemId: id })
  }
  /** Только окно сравнения: вещь из руки Esc роняет НЕ ЗДЕСЬ, а в App —
   *  порядок «сперва вещь, потом меню» держится в одном месте. */
  function unpinCompare() {
    pinned = false
    compare = null
  }

  function dismiss() {
    unpinCompare()
    releaseItem()
  }

  // --- ТРИ ПУТИ НАДЕТЬ НАХОДКУ ------------------------------------------
  //
  // Сумка — начало каждого из них: отсюда вещь берут перетаскиванием, отсюда
  // же её выбирают нажатием и отсюда надевают долгим нажатием. Куда её можно
  // положить, решает `ui/dropTarget.ts` — та же функция, что и у куклы.

  /** Сумка как цель броска: надетое, брошенное сюда, снимается. */
  const bagDrop = $derived(bagOutcome($gameState, $carriedItem))

  /**
   * ВЫБРАННАЯ НАХОДКА — та самая, что сейчас в руке и взята из сумки.
   *
   * Второго состояния «выбрано» не заводится: выбор вещи в сумке И есть
   * «взять в руку». Иначе их стало бы два — подсвеченные слоты у одного,
   * раскрытая карточка у другого, — и игрок читал бы про одну вещь, а нёс
   * другую.
   */
  const carried = $derived(
    $carriedItem?.from === 'bag'
      ? ($gameState.inventory.find((i) => i.id === $carriedItem.itemId) ?? null)
      : null,
  )

  function equipNow(id: string): void {
    const item = $gameState.inventory.find((i) => i.id === id)
    if (item && equipStatus($gameState, item).canEquip) equipInventoryItem(id)
    dismiss()
  }

  // Долгое нажатие = «надеть немедленно». На тач-экране это третий путь:
  // ни перетаскивания, ни двойного щелчка пальцем там нет.
  let pressTimer: ReturnType<typeof setTimeout> | null = null
  // Сработавшее долгое нажатие обязано СЪЕСТЬ следующий клик: иначе вещь
  // надевается и тут же берётся в руку призраком того же нажатия.
  let longFired = false
  function startPress(id: string): void {
    cancelPress()
    longFired = false
    pressTimer = setTimeout(() => {
      pressTimer = null
      longFired = true
      equipNow(id)
    }, LONG_PRESS_MS)
  }
  function cancelPress(): void {
    if (pressTimer !== null) clearTimeout(pressTimer)
    pressTimer = null
  }

  /**
   * ДЕЙСТВИЕ НАД ПРЕДМЕТОМ СНИМАЕТ ПРИКРЕПЛЕНИЕ.
   *
   * Без этого получался тупик, из которого не было видимого выхода: игрок
   * кликал по иконке (карточка выглядит нажимаемой), окно сравнения
   * прикреплялось, он жал «Надеть» — предмет уходил в слот, окно исчезало
   * вместе с ним, а флаг `pinned` оставался поднятым. Дальше наведение на
   * ЛЮБОЙ другой предмет не показывало ничего, и на экране не было ни одной
   * подсказки, что нужен Esc или щелчок мимо сетки.
   */
  function act(event: MouseEvent, run: () => void) {
    // ОСТАНАВЛИВАЕМ ВСПЛЫТИЕ. Кнопки лежат ВНУТРИ карточки, у которой свой
    // onclick (он и прикрепляет окно). Без этого нажатие на «Продать»
    // доходило до карточки уже после dismiss() и прикрепляло окно заново —
    // то есть починка не работала бы вовсе.
    event.stopPropagation()
    run()
    dismiss()
  }
</script>

<svelte:window
  onkeydown={(e) => e.key === 'Escape' && unpinCompare()}
  onpointerdown={(e) => {
    // НАЖАТИЕ МИМО СНИМАЕТ ВЫБОР — но «мимо» надо понимать точно, и это не
    // придирка. Слоты куклы лежат ВНЕ сумки, и нажатие по ним приходит сюда
    // РАНЬШЕ, чем к самому слоту: роняя здесь несомое, мы отменяли бы ровно
    // то действие, ради которого игрок на слот и нажал. Поэтому «своими»
    // считаются три места — сетка сумки, карточка выбранного и кукла, — а
    // всё остальное снимает и окно сравнения, и вещь из руки.
    const el = e.target as HTMLElement | null
    if (el?.closest?.('[data-item-card], [data-chosen], [data-doll]')) {
      if (pinned && !el.closest('[data-item-card]')) unpinCompare()
      return
    }
    dismiss()
  }}
/>

<Panel
  title="Инвентарь"
  subtitle="{$gameState.inventory.length} из {bagSize} слотов{$gameState.enchantDust.gt(0)
    ? ` · ${formatNumber($gameState.enchantDust)} пыли`
    : ''}"
>
  <!-- КОШЕЛЁК. Золото копится с каждого убийства и тратится на крафт, сброс
       талантов и зачарования, а посмотреть на него было негде: цену покупки
       игра называла, а остатка не показывала нигде. Место здесь: сумка — то,
       что у героя с собой. -->
  <div class="purse">
    <Icon name="gold" size="sm" />
    <NumberText value={$gameState.gold} tone="gold" bold />
    <span class="purse-label">золота</span>
  </div>

  <!-- ЧТО СЧИТАТЬ АПГРЕЙДОМ. Две оси у находки разные — урон и цена боя, — и
       какая из них важнее, решает не игра. Переключатель называет ТОЛЬКО
       правило («что подсветится и что уйдёт в золото»), но никогда не
       обещает исхода: игрок имеет право одеться как хочет. -->
  <div class="priority">
    <span class="priority-label" id="upgrade-priority-label">Апгрейд — это</span>
    <div class="priority-row" role="group" aria-labelledby="upgrade-priority-label">
      {#each UPGRADE_PRIORITIES as p (p)}
        <Button
          size="sm"
          variant={$gameState.upgradePriority === p ? 'primary' : 'ghost'}
          onclick={() => setUpgradePriority(p)}
        >
          {PRIORITY_NAME[p]}
        </Button>
      {/each}
    </div>
    <p class="priority-hint">{PRIORITY_HINT[$gameState.upgradePriority]}</p>
  </div>

  <!-- ЧТО ДЕЛАТЬ С ЛИШНИМ. Положения открываются покупками: пока ничего не
       куплено, ряда нет вовсе — закрытое не показывается, как и везде. -->
  {#if policies.length > 1}
    <div class="priority">
      <span class="priority-label" id="loot-policy-label">С лишним</span>
      <div class="priority-row" role="group" aria-labelledby="loot-policy-label">
        {#each policies as p (p)}
          <Button
            size="sm"
            variant={policy === p ? 'primary' : 'ghost'}
            onclick={() => setLootPolicy(p)}
          >
            {POLICY_NAME[p]}
          </Button>
        {/each}
      </div>
      <p class="priority-hint">{POLICY_HINT[policy]}</p>
    </div>
  {/if}

  <!-- ЛЕСТНИЦА ПОКУПОК. Показываются только доступные и ещё не купленные:
       закрытая ступень — та же запертая кнопка с ценой, до которой сорок
       уровней, а купленная в списке «что можно взять» уже не нужна. -->
  {#if upgrades.length > 0}
    <section class="shop">
      <h3>Купить за золото</h3>
      <ul class="shop-list">
        {#each upgrades as row (row.def.id)}
          <li class="shop-row" class:blocked={!row.canBuy}>
            <Icon name={row.def.icon} />
            <div class="shop-text">
              <b>{row.def.name}</b>
              <span class="shop-desc">{upgradeText(row.def)}</span>
            </div>
            <!-- ЦЕНА ВИДНА ВСЕГДА, И ОСОБЕННО КОГДА ЗОЛОТА НЕ ХВАТАЕТ.
                 Раньше на месте цены появлялось «Не хватает золота», и
                 покупка, к которой игрок идёт, переставала называть, СКОЛЬКО
                 до неё идти: цену он видел только в тот момент, когда она уже
                 не нужна. Теперь цена на кнопке всегда, а нехватка — строкой
                 рядом и числом. -->
            <div class="shop-buy">
              <Button
                size="sm"
                variant={row.canBuy ? 'primary' : 'ghost'}
                disabled={!row.canBuy}
                onclick={() => buyGoldUpgrade(row.def.id)}
              >
                {formatNumber(row.cost)} золота
              </Button>
              {#if !row.canBuy}
                <span class="deny" data-deny>
                  {row.reason === 'gold'
                    ? `Не хватает ${formatNumber(row.short)}`
                    : UPGRADE_REASON[row.reason!]}
                </span>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <!-- СУМКА — ТОЖЕ ЦЕЛЬ БРОСКА: надетое, брошенное сюда, снимается. Иначе
       перетаскивание работало бы в одну сторону, а снимать пришлось бы
       кнопкой — два разных жеста на одно и то же действие. -->
  {#if bagDrop.fits && !bagDrop.allowed && bagDrop.reason}
    <p class="deny" data-deny>{UNEQUIP_BLOCK_TEXT[bagDrop.reason]}</p>
  {/if}
  <div
    class="grid"
    class:target={bagDrop.allowed}
    data-item-card
    role="list"
    ondragover={(e: DragEvent) => {
      if (bagDrop.allowed) e.preventDefault()
    }}
    ondrop={(e: DragEvent) => {
      e.preventDefault()
      if (bagDrop.allowed && $carriedItem?.from === 'slot') unequipSlot($carriedItem.slot)
      releaseItem()
    }}
  >
    {#each sorted as item (item.id)}
      {@const share = shares.get(item.id)}
      <IconSlot
        compact
        rarity={item.rarity}
        active={carried?.id === item.id}
        interactive
        draggable
        drop={$carriedItem?.from === 'bag' && $carriedItem.itemId === item.id
          ? 'carried'
          : undefined}
        ariaLabel="{item.name}: {itemSlotLabel(item)}, {RARITY_BY_ID[item.rarity].name}, {item.level} ур."
        onmouseenter={(e: MouseEvent) => track(e, item.id)}
        onmousemove={(e: MouseEvent) => track(e, item.id)}
        onmouseleave={() => unhover(item.id)}
        onclick={(e: MouseEvent) => toggle(e, item.id)}
        ondblclick={() => equipNow(item.id)}
        onkeydown={(e: KeyboardEvent) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          toggleCarried({ from: 'bag', itemId: item.id })
        }}
        onpointerdown={() => startPress(item.id)}
        onpointerup={cancelPress}
        onpointercancel={cancelPress}
        ondragstart={(e: DragEvent) => {
          takeItem({ from: 'bag', itemId: item.id })
          e.dataTransfer?.setData('text/plain', item.id)
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
        }}
        ondragend={() => releaseItem()}
      >
        <!-- ЗНАЧОК ПРЕДМЕТА — ВСЯ ЯЧЕЙКА. Что это за вещь, говорит сам значок
             (он же значок слота), редкость — рамка, а насколько она сильна —
             уровень числом. Всё остальное про находку показывается ВЫБРАННОЙ:
             сравнение под курсором и карточка выбранного ниже. -->
        <Icon name={SLOT_ICONS[item.slot]} size="lg" />
        <span class="lvl">{item.level}</span>
        {#if upgradeLabel(share)}
          <span class="upgrade" data-upgrade title="Апгрейд {upgradeLabel(share)}">
            {upgradeLabel(share)}
          </span>
        {/if}
      </IconSlot>
    {/each}
    {#each Array(emptySlots) as _, i (i)}
      <IconSlot emptyText="—" />
    {/each}
  </div>

  <!-- КАРТОЧКА ВЫБРАННОГО. Нажал находку — тут её описание, и в ту же
       секунду на кукле подсвечен её слот. Место постоянное, а не под
       курсором: на телефоне наведения нет вовсе, а кнопки «Продать» и
       «Распылить» обязаны быть там, куда можно попасть пальцем.
       Окно сравнения под курсором рядом осталось — оно про мышь и про
       быстрый взгляд, а не про действие. -->
  {#if carried}
    {@const dis = disenchantStatus($gameState, carried.id)}
    {@const eq = equipStatus($gameState, carried)}
    <section class="chosen" data-chosen style={rarityStyle(carried.rarity)}>
      <header class="chosen-head">
        <Icon name={SLOT_ICONS[carried.slot]} size="lg" />
        <div class="chosen-title">
          <b>{carried.name}</b>
          <Tag
            rarity={carried.rarity}
            label="{RARITY_BY_ID[carried.rarity].name} · {carried.level} ур."
          />
        </div>
        <span class="chosen-slot">{itemSlotLabel(carried)}</span>
      </header>
      {#if carried.grip}<span class="grip">{GRIP_TEXT[carried.grip]}</span>{/if}
      <ItemMods mods={carried.mods} />
      <EnchantLine item={carried} />
      <!-- ОТКАЗ — СЛОВАМИ И ЗАРАНЕЕ, ровно как у слота куклы: игрок читает
           причину до попытки, а не после неё. -->
      {#if eq.reason}
        <span class="deny" data-deny>{EQUIP_BLOCK_TEXT[eq.reason]}</span>
      {/if}
      <div class="chosen-actions">
        {#if confirming === carried.id}
          <span class="warn">
            На вещи «{enchantOf(carried)?.name}» — она исчезнет вместе с ней.
          </span>
          <Button
            size="sm"
            variant="primary"
            onclick={(e: MouseEvent) => {
              act(e, () => disenchantInventoryItem(carried.id))
              confirming = null
            }}
          >
            Всё равно распылить
          </Button>
          <Button size="sm" onclick={() => (confirming = null)}>Отмена</Button>
        {:else}
          <Button size="sm" onclick={(e: MouseEvent) => act(e, () => sellInventoryItem(carried.id))}>
            Продать за {formatNumber(sellPrice(carried))}
          </Button>
          {#if dis.reason !== 'locked'}
            <Button
              size="sm"
              disabled={!dis.canDisenchant}
              title={dis.reason ? DISENCHANT_REASON[dis.reason] : 'Предмет исчезнет навсегда'}
              onclick={(e: MouseEvent) =>
                carried.enchantId
                  ? (confirming = carried.id)
                  : act(e, () => disenchantInventoryItem(carried.id))}
            >
              Распылить · {formatNumber(dis.dust)} пыли
            </Button>
          {/if}
        {/if}
      </div>
    </section>
  {/if}

  {#if compareItemOf && compare}
    <ItemCompare item={compareItemOf} x={compare.x} y={compare.y} />
  {/if}

  {#snippet footer()}
    <p class="hint">Надетый предмет продать нельзя — сперва сними его в «Экипировке».</p>
    <p class="hint">
      Находку можно перетащить на слот куклы, нажать её и затем нажать
      подсвеченный слот либо задержать на ней нажатие — наденется сразу.
      Надетое, брошенное обратно в сумку, снимается. Кнопки «Надеть» нет:
      её заменяет подсвеченный слот.
    </p>
  {/snippet}
</Panel>

<style>
  /* Переключатель приоритета: своя строка над сеткой находок, потому что
     он меняет то, как читается КАЖДАЯ карточка ниже. */
  .priority {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .priority-label {
    font-size: var(--text-sm);
    color: var(--c-text-dim);
  }
  .priority-row {
    display: flex;
    gap: var(--space-2);
  }
  .shop {
    margin-bottom: var(--space-3);
  }
  .shop h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    color: var(--c-text-dim);
  }
  .shop-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .shop-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .shop-row.blocked {
    opacity: 0.6;
  }
  .shop-text {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    font-size: var(--text-sm);
  }
  .shop-desc {
    font-size: var(--text-xs);
    color: var(--c-text-dim);
  }
  .priority-hint {
    flex-basis: 100%;
    margin: 0;
    font-size: var(--text-xs);
    color: var(--c-text-dim);
  }

  .purse {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-bottom: var(--space-2);
  }
  .purse-label {
    color: var(--c-text-dim);
    font-size: var(--text-xs);
  }
  /* СЕТКА ИКОНОК. Колонка узкая — по значку, а не по карточке: полтора
     десятка карточек со списком статов не помещались ни на телефон, ни в
     ширину меню, и находку приходилось искать чтением, а не взглядом. */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(3.5rem, 1fr));
    gap: var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
  }
  /* Сюда можно бросить надетое. Рамка появляется только на время броска —
     в покое у сетки её нет, иначе сумка выглядела бы ещё одной панелью. */
  .grid.target {
    border-color: var(--c-accent);
  }
  .grip {
    font-size: var(--text-2xs);
    color: var(--c-text-faint);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
  }
  .deny {
    font-size: var(--text-2xs);
    color: var(--c-warning);
  }
  .warn {
    font-size: var(--text-xs);
    color: var(--c-warning);
  }
  /* Апгрейд обязан быть виден без наведения: ради этого мгновения лут
     и существует. Цвет — здоровья: «стало лучше», а не «тут урон». */
  /* Уровень вещи — единственное число на значке: без него «Редкий» третьего
     уровня выглядел бы равным «Редкому» шестидесятого. */
  .lvl {
    position: absolute;
    right: var(--space-1);
    bottom: 0;
    font-size: var(--text-2xs);
    color: var(--c-text-faint);
  }
  /* Цена и нехватка — столбиком: строка «не хватает N» встаёт под кнопкой,
     а не растягивает ряд покупки в ширину. */
  .shop-buy {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-1);
  }
  .chosen {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-top: var(--space-2);
    padding: var(--space-2);
    border: 1px solid color-mix(in srgb, var(--rarity-color) 70%, transparent);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--rarity-color) var(--tint-weak), var(--c-surface-sunken));
  }
  .chosen-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .chosen-title {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    align-items: flex-start;
  }
  .chosen-slot {
    margin-left: auto;
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--c-text-faint);
  }
  .chosen-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  /* Метка апгрейда на значке — угловой ярлычок: в компактной ячейке слов
     нет вовсе, а «на сколько лучше» остаётся числом. */
  .upgrade {
    position: absolute;
    left: var(--space-1);
    top: 0;
    font-size: var(--text-2xs);
    font-weight: var(--weight-bold);
    color: var(--c-heal);
  }
  .hint {
    margin: 0;
  }
</style>
