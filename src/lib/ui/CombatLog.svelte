<script lang="ts">
  // Боевой лог компактной лентой под сценой. Виден всегда, в любом разделе:
  // это единственное место, где игрок видит, что вообще происходит в бою.
  import { untrack } from 'svelte'
  import { formatNumber } from '../game'
  import { gameState } from '../stores/game'
  import { ABILITY_BY_ID } from '../data/abilities'
  import { MATERIAL_BY_ID } from '../data/materials'
  import { RECIPE_BY_ID } from '../data/recipes'
  import { ENCHANT_BY_ID } from '../data/enchants'
  import { rarityName, rarityStyle } from './kit'
  import { Icon } from './icons'
  import type { IconName } from './icons'
  import {
    emptyLogView,
    filterRows,
    isAggregated,
    LOG_FILTERS,
    pushEvents,
    type LogFilterId,
    type LogRow,
  } from './logView'
  import type { CombatEvent } from '../types'

  // Лента набирает историю САМА из короткого хвоста в состоянии: растить
  // состояние ради показа нельзя, оно попало бы в golden и в сейв.
  let view = $state(emptyLogView())
  let filter = $state<LogFilterId>('all')
  $effect(() => {
    // untrack обязателен: без него чтение view внутри эффекта делает его
    // же зависимостью, эффект переподписывается на собственную запись и
    // Svelte падает с effect_update_depth_exceeded. Зависимость здесь
    // ровно одна — хвост лога в состоянии.
    const tail = $gameState.combatLog
    view = untrack(() => pushEvents(view, tail))
  })
  const rows = $derived(filterRows(view.rows, filter))

  // Весь текст боевого лога живёт здесь: логика отдаёт только события.
  function eventText(e: CombatEvent): string {
    switch (e.type) {
      case 'hit':
        return e.isCrit
          ? `КРИТ! ${formatNumber(e.damage)} урона`
          : `Удар: ${formatNumber(e.damage)} урона`
      case 'ability': {
        const name = ABILITY_BY_ID[e.abilityId]?.name ?? 'Умение'
        return e.isCrit
          ? `КРИТ! ${name}: ${formatNumber(e.damage)} урона`
          : `${name}: ${formatNumber(e.damage)} урона`
      }
      case 'material':
        return `Собрано: ${MATERIAL_BY_ID[e.materialId]?.name ?? e.materialId}`
      case 'craft':
        return `Готово: ${RECIPE_BY_ID[e.recipeId]?.name ?? e.recipeId}`
      case 'disenchant':
        return `Распылено: ${e.item.name} → ${formatNumber(e.dust)} пыли`
      case 'enchant':
        return `Зачаровано: ${e.itemName} — ${ENCHANT_BY_ID[e.enchantId]?.name ?? e.enchantId}`
      case 'potion':
        return `Выпито: ${RECIPE_BY_ID[e.recipeId]?.name ?? e.recipeId}`
      case 'potion-expired':
        return `${RECIPE_BY_ID[e.recipeId]?.name ?? e.recipeId} выдохся`
      case 'rest-start':
        return 'Привал: восстанавливаешься'
      case 'rest-end':
        return e.interrupted ? 'Привал прерван' : 'Привал окончен, запас полон'
      case 'effect':
        return `${ABILITY_BY_ID[e.abilityId]?.name ?? 'Эффект'} жжёт: ${formatNumber(e.damage)} урона`
      case 'kill':
        return `${e.monsterName} повержен! +${formatNumber(e.gold)} золота, +${formatNumber(e.xp)} опыта`
      case 'levelup':
        return `Новый уровень: ${formatNumber(e.level)}!`
      case 'loot':
        return `Выпало: ${e.item.name} [${rarityName(e.item.rarity)}]`
      case 'autosell':
        // Игрок этого не выбирал — значит, обязан об этом узнать.
        return `Сумка полна: ${e.item.name} продан сам за ${formatNumber(e.gold)}`
      case 'loot-swap':
        return `${e.item.name} лучше надетого — освободил место, продав ${e.dropped.name} за ${formatNumber(e.gold)}`
      case 'spawn':
        return `Появился ${e.monsterName}`
      case 'hurt':
        return `${e.monsterName} бьёт: −${formatNumber(e.damage)} здоровья`
      case 'block':
        return `Блок! ${e.monsterName} бьёт: −${formatNumber(e.damage)} здоровья (щит снял ${formatNumber(e.blocked)})`
      case 'death':
        return 'Ты пал в бою! Воскрешение через 30 с…'
      case 'revive':
        return 'Ты воскрес — полный запас сил'
      case 'zone':
        return e.reason === 'travel'
          ? `Ты отправился в зону «${e.zoneName}»`
          : `Тебя отбросило в зону «${e.zoneName}»`
      case 'boss':
        return `Босс ${e.index} из ${e.total}: ${e.bossName}`
      case 'enrage':
        return `Ярость! ${e.bossName} бьёт на ${Math.round((e.multiplier - 1) * 100)}% сильнее`
      case 'dungeon-exit':
        return e.defeated ? 'Тебя вынесли из данжа — цепочка сброшена' : 'Ты вышел из данжа'
      case 'dungeon-clear':
        return e.firstClear
          ? `«${e.dungeonName}» пройден впервые! Достижение: +5% опыта навсегда`
          : `«${e.dungeonName}» пройден`
    }
  }
  // Иконка типа события: строку видно боковым зрением ещё до чтения.
  const EVENT_ICON: Record<CombatEvent['type'], IconName> = {
    hit: 'stat-attackPower',
    ability: 'ability-quick-strike',
    effect: 'ability-rending-wound',
    kill: 'xp',
    levelup: 'xp',
    loot: 'slot-trinket',
    autosell: 'gold',
    'loot-swap': 'slot-trinket',
    spawn: 'zone-mirefen-hollows',
    hurt: 'stat-maxHp',
    block: 'slot-offhand',
    death: 'stat-maxHp',
    revive: 'talent-swift-return',
    zone: 'zone-shepherds-meadow',
    boss: 'dungeon-sunken-barrow',
    'dungeon-exit': 'dungeon-sunken-barrow',
    'dungeon-clear': 'dungeon-sunken-barrow',
    enrage: 'stat-critMultiplier',
    // Костёр уже есть в реестре — это иконка регенерации вне боя, и привал
    // ровно про неё. Заводить вторую такую же незачем.
    material: 'material-ore',
    craft: 'profession-smithing',
    disenchant: 'action-disenchant',
    enchant: 'profession-enchanting',
    potion: 'potion-fury',
    'potion-expired': 'potion-fury',
    'rest-start': 'stat-hpRegenOutOfCombat',
    'rest-end': 'stat-hpRegenOutOfCombat',
  }

  /** Свёрнутая строка: «12 ударов, 1.2K урона» вместо двенадцати строк. */
  function rowText(row: LogRow): string {
    if (!isAggregated(row)) return eventText(row.event)
    const total = row.total ? `, ${formatNumber(row.total)} урона` : ''
    switch (row.event.type) {
      case 'hurt':
        return `${row.count} ударов по тебе${total}`
      case 'block':
        return `${row.count} ударов по тебе${total}, часть в щит`
      case 'effect':
        return `${row.count} тиков эффекта${total}`
      default:
        return `${row.count} ударов${total}`
    }
  }

  // Тон строки: лог должен читаться боковым зрением, поэтому важное — цветом.
  function tone(e: CombatEvent): string {
    if (e.type === 'hit' && e.isCrit) return 'crit'
    if (e.type === 'hurt' || e.type === 'death') return 'hurt'
    if (e.type === 'block') return 'block'
    if (e.type === 'kill') return 'kill'
    if (e.type === 'levelup' || e.type === 'dungeon-clear') return 'good'
    if (e.type === 'loot') return 'loot'
    return ''
  }
</script>

<div class="wrap">
  <div class="filters" role="group" aria-label="Фильтр лога">
    {#each Object.entries(LOG_FILTERS) as [id, f] (id)}
      <button
        type="button"
        class:active={filter === id}
        onclick={() => (filter = id as LogFilterId)}
      >
        {f.label}
      </button>
    {/each}
  </div>
  <ul class="log" aria-label="Боевой лог" aria-live="polite">
    {#each rows as row (row.id)}
      <li
        class={tone(row.event)}
        style={row.event.type === 'loot' ? rarityStyle(row.event.item.rarity) : undefined}
        class:rarity={row.event.type === 'loot'}
      >
        <Icon name={EVENT_ICON[row.event.type]} size="sm" />
        <span class="text">{rowText(row)}</span>
      </li>
    {:else}
      <li class="empty">Бой ещё не начался — подожди пару секунд.</li>
    {/each}
  </ul>
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .filters {
    display: flex;
    gap: var(--space-1);
  }
  .filters button {
    font: inherit;
    font-size: var(--text-2xs);
    color: var(--c-text-faint);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-2);
    cursor: pointer;
  }
  .filters button:hover {
    color: var(--c-text);
  }
  .filters button.active {
    color: var(--c-bg);
    background: var(--c-accent);
  }
  .log {
    list-style: none;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    background: var(--c-surface-sunken);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    /* Высота под восемь строк: столько держит COMBAT_LOG_SIZE. Без резерва
       лента прыгает, пока лог наполняется, и дёргает всё под собой. */
    min-height: calc(8 * var(--leading-normal) * var(--text-xs) + 2 * var(--space-2));
    overflow: hidden;
  }
  .log li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--c-text-muted);
  }
  .log .text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Лента прокручивается: держит 50 строк, показывает восемь. */
  .log {
    overflow-y: auto;
    max-height: calc(8 * var(--leading-normal) * var(--text-md) + 2 * var(--space-2));
  }
  .log li.rarity {
    color: var(--rarity-color);
  }
  .log li.empty {
    color: var(--c-text-faint);
  }
  .log li:first-child {
    color: var(--c-text);
  }
  .log li.crit {
    color: var(--c-gold);
    font-weight: var(--weight-bold);
  }
  .log li.hurt {
    color: var(--c-damage);
  }
  /* Блок — тот же урон, но смягчённый: второстепенный текст вместо цвета
     урона. Своей семантики у щита нет, и заводить её незачем. */
  .log li.block {
    color: var(--c-text-muted);
  }
  .log li.kill {
    color: var(--c-heal);
  }
  .log li.good {
    color: var(--c-xp);
  }
  .log li.loot {
    color: var(--c-accent);
  }
</style>
