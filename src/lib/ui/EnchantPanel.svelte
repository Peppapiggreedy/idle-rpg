<script lang="ts">
  // Зачарование: вторая жизнь находки. Панель стоит в «Сумке» рядом с
  // ремёслами не случайно — и то, и другое отвечает на вопрос «что сделать
  // с добытым», и оба живут на одном экране с инвентарём.
  //
  // Весь текст для игрока — здесь: логика отдаёт коды причин и модификаторы.
  import {
    enchantOf,
    enchantStatus,
    enchantsForSlot,
    formatNumber,
    type EnchantBlockReason,
    type EnchantDef,
  } from '../game'
  import { ENCHANT_UNLOCK_LEVEL } from '../data/balance'
  import type { Decimal } from '../game/numbers'
  import { SLOT_NAMES } from '../data/slots'
  import { enchantInventoryItem, gameState } from '../stores/game'
  import ItemMods from './ItemMods.svelte'
  import { Button, IconSlot, Panel, Tag, Tooltip } from './kit'
  import { Icon } from './icons'

  const unlocked = $derived($gameState.level.gte(ENCHANT_UNLOCK_LEVEL))
  const dust = $derived($gameState.enchantDust)

  // Зачаровывать можно и надетое, и лежащее в сумке: зачарование живёт на
  // самой вещи и ездит вместе с ней.
  const targets = $derived([
    ...Object.values($gameState.equipment).filter((i) => i !== null),
    ...$gameState.inventory,
  ])

  let selectedId = $state<string | null>(null)
  const selected = $derived(targets.find((i) => i.id === selectedId) ?? null)
  const options = $derived(selected ? enchantsForSlot(selected.slot) : [])

  // Сколько пыли НЕ ХВАТАЕТ — считается из цены рецепта и запаса героя,
  // а не пишется текстом: «не хватает пыли» не говорит, сколько ещё копить.
  const shortBy = (cost: Decimal) =>
    `Не хватает ${formatNumber(cost.minus(dust))} пыли: есть ${formatNumber(dust)} из ${formatNumber(cost)}`

  const REASON: Record<EnchantBlockReason, string> = {
    locked: `Зачарование откроется на ${ENCHANT_UNLOCK_LEVEL} уровне`,
    missing: 'Предмета больше нет',
    slot: 'Это зачарование не для такого слота',
    same: 'Оно уже стоит на вещи',
    dust: 'Не хватает пыли — распыли лишние находки',
  }

  function effectText(enchant: EnchantDef): string {
    return enchant.tagline
  }
</script>

<Panel title="Зачарование" subtitle="{formatNumber(dust)} пыли">
  {#if !unlocked}
    <p class="hint">
      Зачарование откроется на {ENCHANT_UNLOCK_LEVEL} уровне. До него находки продавай:
      пыль пока девать некуда.
    </p>
  {:else}
    <p class="hint">
      Пыль берётся только из распыления находок — с мобов она не падает. На вещи
      ровно одно зачарование: новое затирает старое.
    </p>

    <div class="targets">
      {#each targets as item (item.id)}
        <IconSlot
          slotLabel={SLOT_NAMES[item.slot]}
          rarity={item.rarity}
          active={selectedId === item.id}
          interactive
          onfocusin={() => (selectedId = item.id)}
        >
          <span class="name">{item.name}</span>
          {#if enchantOf(item)}
            <Tag tone="accent" label={enchantOf(item)?.name ?? ''} />
          {/if}
          {#snippet footer()}
            <Button
              size="sm"
              variant={selectedId === item.id ? 'primary' : 'ghost'}
              onclick={() => (selectedId = selectedId === item.id ? null : item.id)}
            >
              {selectedId === item.id ? 'Выбрано' : 'Выбрать'}
            </Button>
          {/snippet}
        </IconSlot>
      {/each}
    </div>

    {#if selected}
      <ul class="options">
        {#each options as enchant (enchant.id)}
          {@const status = enchantStatus($gameState, selected.id, enchant.id)}
          <li class="option" class:blocked={!status.canEnchant}>
            <Icon name={enchant.icon} size="lg" />
            <span class="text">
              <span class="name">{enchant.name}</span>
              <span class="desc">{effectText(enchant)}</span>
              <ItemMods
                mods={enchant.mods.map((m) => ({ ...m, source: `enchant:${selected.slot}` }))}
              />
            </span>
            <!-- ЦЕНА ВИДНА ВСЕГДА, а не только на доступной кнопке. Раньше
                 она пряталась внутрь надписи «Наложить · 120», и при нехватке
                 пыли исчезала вместе с кнопкой — ровно тогда, когда игроку и
                 надо знать, сколько копить. Число берётся из данных рецепта
                 (status.dustCost), здесь оно не считается. -->
            <span class="cost" class:short={status.reason === 'dust'}>
              <Icon name="material-dust" />
              {formatNumber(status.dustCost)}
            </span>
            {#if status.canEnchant}
              <Button
                size="sm"
                variant="primary"
                onclick={() => enchantInventoryItem(selected.id, enchant.id)}
              >
                {status.replaces ? 'Заменить' : 'Наложить'}
              </Button>
            {:else if status.reason === 'dust'}
              <Tooltip text={shortBy(status.dustCost)}>
                <Button size="sm" variant="primary" disabled>Наложить</Button>
              </Tooltip>
            {:else}
              <span class="reason">{REASON[status.reason ?? 'dust']}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="hint">Выбери предмет — надетый или из сумки.</p>
    {/if}
  {/if}
</Panel>

<style>
  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--c-text-muted);
  }
  .targets {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .options {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .option {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
  }
  .option.blocked {
    opacity: 0.55;
  }
  .text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .name {
    font-weight: var(--weight-bold);
  }
  .desc {
    font-size: var(--text-xs);
    color: var(--c-text-muted);
  }
  /* Цена рецепта. Не хватает пыли — она подсвечена, а не спрятана. */
  .cost {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--c-text-muted);
    white-space: nowrap;
  }
  .cost.short {
    color: var(--c-warning);
    font-weight: var(--weight-bold);
  }
  .reason {
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
</style>
