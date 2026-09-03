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
    INVENTORY_SIZE,
    type DisenchantBlockReason,
  } from '../game'
  import { EQUIP_BLOCK_TEXT, GRIP_TEXT } from './itemText'
  import { ENCHANT_UNLOCK_LEVEL } from '../data/balance'
  import { itemSlotLabel } from './itemText'
  import {
    disenchantInventoryItem,
    equipInventoryItem,
    gameState,
    sellInventoryItem,
    setUpgradePriority,
  } from '../stores/game'
  import ItemMods from './ItemMods.svelte'
  import EnchantLine from './EnchantLine.svelte'
  import ItemCompare from './ItemCompare.svelte'
  import { RARITY_BY_ID } from '../data/rarity'
  import { UPGRADE_PRIORITIES, type UpgradePriority } from '../data/upgrade'
  import { Button, IconSlot, NumberText, Panel, Tag } from './kit'
  import { combatKey, createMemo } from './memo'
  import { Icon } from './icons'

  const emptySlots = $derived(Math.max(0, INVENTORY_SIZE - $gameState.inventory.length))

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
    survival: 'Выживание',
    balance: 'Баланс',
  }
  const PRIORITY_HINT: Record<UpgradePriority, string> = {
    damage: 'Апгрейд — то, что поднимает убийства в секунду. Остальное разбирается.',
    survival: 'Апгрейд — то, что удешевляет бой. Остальное разбирается.',
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
  /** Нажатие по иконке: на тач-экране это единственный способ открыть окно. */
  function toggle(event: MouseEvent, id: string) {
    if (pinned && compare?.id === id) {
      pinned = false
      compare = null
      return
    }
    pinned = true
    compare = { id, x: event.clientX, y: event.clientY }
  }
  function dismiss() {
    pinned = false
    compare = null
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
  onkeydown={(e) => e.key === 'Escape' && dismiss()}
  onpointerdown={(e) => {
    // Клик ВНЕ карточки закрывает прикреплённое окно. Кнопки внутри
    // карточки остаются своими целями нажатия — окно мышь не ловит.
    if (pinned && !(e.target as HTMLElement)?.closest?.('[data-item-card]')) dismiss()
  }}
/>

<Panel
  title="Инвентарь"
  subtitle="{$gameState.inventory.length} из {INVENTORY_SIZE} слотов{$gameState.enchantDust.gt(0)
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

  <div class="grid" data-item-card>
    {#each sorted as item (item.id)}
      {@const share = shares.get(item.id)}
      <IconSlot
        slotLabel={itemSlotLabel(item)}
        rarity={item.rarity}
        active={compare?.id === item.id}
        interactive
        onmouseenter={(e: MouseEvent) => track(e, item.id)}
        onmousemove={(e: MouseEvent) => track(e, item.id)}
        onmouseleave={() => unhover(item.id)}
        onclick={(e: MouseEvent) => toggle(e, item.id)}
      >
        <span class="name">{item.name}</span>
        <!-- Уровень вещи — её главная сила: без него «Редкий» 3-го уровня
             выглядел бы равным «Редкому» 60-го. -->
        <Tag rarity={item.rarity} label="{RARITY_BY_ID[item.rarity].name} · {item.level} ур." />
        {#if upgradeLabel(share)}
          <span class="upgrade" data-upgrade>Апгрейд {upgradeLabel(share)}</span>
        {/if}
        {#if item.grip}
          <span class="grip">{GRIP_TEXT[item.grip]}</span>
        {/if}
        <ItemMods mods={item.mods} />
        <EnchantLine {item} />

        {#snippet footer()}
          {@const dis = disenchantStatus($gameState, item.id)}
          {#if confirming === item.id}
            <span class="warn">
              На вещи «{enchantOf(item)?.name}» — она исчезнет вместе с ней.
            </span>
            <Button
              size="sm"
              variant="primary"
              onclick={(e: MouseEvent) => {
                act(e, () => disenchantInventoryItem(item.id))
                confirming = null
              }}
            >
              Всё равно распылить
            </Button>
            <Button size="sm" onclick={() => (confirming = null)}>Отмена</Button>
          {:else}
            {@const eq = equipStatus($gameState, item)}
            <Button
              size="sm"
              variant="primary"
              disabled={!eq.canEquip}
              title={eq.reason ? EQUIP_BLOCK_TEXT[eq.reason] : ''}
              onclick={(e: MouseEvent) => act(e, () => equipInventoryItem(item.id))}
            >
              Надеть
            </Button>
            <Button size="sm" onclick={(e: MouseEvent) => act(e, () => sellInventoryItem(item.id))}>
              Продать за {formatNumber(sellPrice(item))}
            </Button>
            {#if dis.reason !== 'locked'}
              <Button
                size="sm"
                disabled={!dis.canDisenchant}
                title={dis.reason ? DISENCHANT_REASON[dis.reason] : 'Предмет исчезнет навсегда'}
                onclick={(e: MouseEvent) =>
                  item.enchantId
                    ? (confirming = item.id)
                    : act(e, () => disenchantInventoryItem(item.id))}
              >
                Распылить · {formatNumber(dis.dust)} пыли
              </Button>
            {/if}
            <!-- Причина СТРОКОЙ, а не только подсказкой кнопки: на телефоне
                 наведения нет вовсе, и выключенная кнопка без объяснения
                 читается как поломка. -->
            {#if eq.reason}
              <span class="deny">{EQUIP_BLOCK_TEXT[eq.reason]}</span>
            {/if}
          {/if}
        {/snippet}
      </IconSlot>
    {/each}
    {#each Array(emptySlots) as _, i (i)}
      <IconSlot emptyText="—" />
    {/each}
  </div>

  {#if compareItemOf && compare}
    <ItemCompare item={compareItemOf} x={compare.x} y={compare.y} />
  {/if}

  {#snippet footer()}
    <p class="hint">Надетый предмет продать нельзя — сперва сними его в «Экипировке».</p>
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
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: var(--space-2);
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
  .name {
    font-weight: var(--weight-bold);
  }
  /* Апгрейд обязан быть виден без наведения: ради этого мгновения лут
     и существует. Цвет — здоровья: «стало лучше», а не «тут урон». */
  .upgrade {
    align-self: flex-start;
    font-size: var(--text-2xs);
    font-weight: var(--weight-bold);
    color: var(--c-heal);
    border: 1px solid var(--c-heal);
    border-radius: var(--radius-sm);
    padding: 0 var(--space-1);
  }
  .hint {
    margin: 0;
  }
</style>
