<script lang="ts">
  // КНИГА УМЕНИЙ: все умения класса и выбор четырёх из них.
  //
  // Умений больше, чем слотов, и это ровно то место, где решение принимается.
  // Поэтому книга показывает не только числа, но и РОЛЬ СЛОВАМИ: «1.8 урона
  // оружия» не отвечает на вопрос, зачем умение нужно, а выбор идёт именно
  // по нему.
  //
  // ЗАКРЫТЫЕ ВИДНЫ ТОЖЕ, с уровнем открытия. Это исключение из правила
  // «закрыто значит не видно», и оно осознанное: список умений — обещание,
  // ради которого играют дальше, а не спрятанный контент. То же исключение
  // уже действует у запертой кнопки в ряду действий.
  //
  // СОСТАВ МЕНЯЕТСЯ В ЛЮБОЙ МОМЕНТ. Никакого «только вне боя»: герой почти
  // всегда в бою, и такой запрет был бы запретом навсегда.
  import { ABILITY_BY_ID } from '../data/abilities'
  import type { AbilityDef } from '../game'
  import { abilitiesOf, expectedAbilityDamage, formatNumber } from '../game'
  import { gameState, setAbilitySlot } from '../stores/game'
  import { ABILITY_ROLE, comboState, comboText } from './abilityText'
  import { resourceWords } from './resource'
  import { Icon } from './icons'
  import { Panel, Tag } from './kit'

  const resource = $derived(resourceWords($gameState.classId))
  const all = $derived(abilitiesOf($gameState.classId))
  const slots = $derived($gameState.abilitySlots)
  const level = $derived($gameState.level.toNumber())

  const inSlot = (id: string): number => slots.indexOf(id)
  const locked = (a: AbilityDef): boolean => level < a.unlockLevel

  /** Что несут в руке из книги; null — ничего. */
  let carried = $state<string | null>(null)

  function put(index: number): void {
    if (carried === null) return
    setAbilitySlot(index, carried)
    carried = null
  }

  /** Нажатие по строке книги: взять умение или вернуть его обратно. */
  function pick(id: string): void {
    if (locked(ABILITY_BY_ID[id])) return
    carried = carried === id ? null : id
  }
</script>

<Panel title="Книга умений" subtitle="{all.length} умений, {slots.length} слота — выбирай">
  <!-- РЯД СЛОТОВ ПРЯМО ЗДЕСЬ, а не только под сценой: выбор идёт «из книги в
       ряд», и оба конца обязаны быть на одном экране. -->
  <div class="slots" data-book-slots>
    {#each slots as id, i (i)}
      {@const ability = id === null ? null : ABILITY_BY_ID[id]}
      <button
        type="button"
        class="cell"
        class:filled={ability !== null}
        class:target={carried !== null}
        aria-label="Слот {i + 1}: {ability ? ability.name : 'пусто'}"
        onclick={() => put(i)}
        ondragover={(e: DragEvent) => carried !== null && e.preventDefault()}
        ondrop={(e: DragEvent) => {
          e.preventDefault()
          put(i)
        }}
      >
        <span class="key">{i + 1}</span>
        {#if ability}<Icon name={ability.icon} size="lg" />{/if}
      </button>
    {/each}
  </div>
  {#if carried}
    <p class="carrying" data-book-carrying>
      Несёшь: <b>{ABILITY_BY_ID[carried].name}</b> — выбери слот.
    </p>
  {/if}

  <ul class="list">
    {#each all as ability (ability.id)}
      {@const slot = inSlot(ability.id)}
      {@const isLocked = locked(ability)}
      {@const combo = comboState(ability, slots)}
      <li
        class="row"
        class:locked={isLocked}
        class:chosen={slot !== -1}
        class:carried={carried === ability.id}
        data-ability={ability.id}
      >
        <button
          type="button"
          class="grab"
          disabled={isLocked}
          draggable={!isLocked}
          aria-label={ability.name}
          onclick={() => pick(ability.id)}
          ondragstart={() => (carried = ability.id)}
          ondragend={() => (carried = null)}
        >
          <Icon name={ability.icon} size="lg" />
        </button>
        <div class="text">
          <span class="name">
            {ability.name}
            {#if slot !== -1}<Tag label="слот {slot + 1}" />{/if}
          </span>
          <!-- РОЛЬ СЛОВАМИ — первое, что читается. -->
          <span class="role">{ABILITY_ROLE[ability.id] ?? ''}</span>
          <span class="numbers">
            {formatNumber(ability.manaCost)}
            {resource.genitive} · откат {ability.cooldownSec}с ·
            {#if ability.heal}
              лечит {Math.round(ability.heal.maxHpShare.toNumber() * 100)}% запаса
            {:else}
              ≈ {formatNumber(expectedAbilityDamage($gameState.stats, ability.weaponDamagePercent))}
            {/if}
          </span>
          <!-- СВЯЗКА НАЗВАНА ПРЯМО. Без этой строки игрок выясняет её опытом. -->
          {#if combo !== 'none'}
            <span class="combo" class:ready={combo === 'ready'} data-combo={combo}>
              {comboText(combo, ABILITY_BY_ID[ability.combo!.needsAbilityId]?.name ?? '?')}
            </span>
          {/if}
          {#if isLocked}
            <span class="lock" data-lock>Откроется на {ability.unlockLevel} уровне</span>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
</Panel>

<style>
  .slots {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .cell {
    position: relative;
    width: var(--action-slot);
    height: var(--action-slot);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: inherit;
    background: var(--c-surface-sunken);
    border: 1px dashed var(--c-border-strong);
    border-radius: var(--radius-md);
    cursor: pointer;
  }
  .cell.filled {
    border-style: solid;
  }
  /* Сюда можно положить то, что несут. Подсветка рамкой и фоном — её видно
     боковым зрением, а именно им и ищут слот, глядя в список. */
  .cell.target {
    border-color: var(--c-accent);
    background: color-mix(in srgb, var(--c-accent) var(--tint-weak), var(--c-surface-sunken));
  }
  .key {
    position: absolute;
    top: var(--space-1);
    left: var(--space-1);
    font-size: var(--text-2xs);
    color: var(--c-text-faint);
  }
  .carrying {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    color: var(--c-accent);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .row {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
  }
  .row.locked {
    opacity: 0.55;
  }
  .row.carried .grab {
    border-color: var(--c-accent);
  }
  .grab {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--action-slot);
    height: var(--action-slot);
    padding: 0;
    color: inherit;
    background: var(--c-surface-sunken);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-md);
    cursor: grab;
  }
  .grab:disabled {
    cursor: not-allowed;
  }
  .row.chosen .grab {
    border-color: var(--c-xp);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .name {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: var(--weight-bold);
  }
  .role {
    font-size: var(--text-sm);
    color: var(--c-text-muted);
  }
  .numbers {
    font-size: var(--text-xs);
    color: var(--c-text-dim);
  }
  /* Неработающая связка — предупреждение, работающая — обычная подсказка.
     Цвет решает, а не значок: строка короткая и читается боковым зрением. */
  .combo {
    font-size: var(--text-xs);
    color: var(--c-warning);
  }
  .combo.ready {
    color: var(--c-heal);
  }
  .lock {
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
</style>
