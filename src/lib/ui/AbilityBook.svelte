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
  import { heroAbilities } from '../game'
  import { gameState, setAbilitySlot, swapAbilitySlots } from '../stores/game'
  import {
    carriedAbility,
    releaseAbility,
    takeAbility,
    toggleCarriedAbility,
  } from '../stores/ui'
  import { abilityDropStatus } from './abilityDrop'
  import { ABILITY_ROLE, abilityLines, comboState, comboText } from './abilityText'
  import { resourceWords } from './resource'
  import { Icon } from './icons'
  import { Panel, Tag, Tooltip } from './kit'

  const resource = $derived(resourceWords($gameState.classId))

  // Та же сборка, что в подсказке кнопки и в настройках автокаста. Связку
  // книга показывает ОТДЕЛЬНОЙ строкой (она красится и зависит от ряда),
  // поэтому имя связки сюда не передаётся — иначе строка была бы дважды.
  const describe = (ability: AbilityDef) =>
    abilityLines(ability, { resource, stats: $gameState.stats })
  // ЭФФЕКТИВНЫЕ УМЕНИЯ, А НЕ БАЗОВЫЕ: в книге видно, чем умение СТАЛО с
  // талантами, а не чем оно было. Описание собирается из тех же полей.
  const all = $derived(heroAbilities($gameState))
  const slots = $derived($gameState.abilitySlots)
  const level = $derived($gameState.level.toNumber())

  const inSlot = (id: string): number => slots.indexOf(id)
  const locked = (a: AbilityDef): boolean => level < a.unlockLevel

  // НЕСОМОЕ УМЕНИЕ — ОБЩЕЕ СОСТОЯНИЕ. Раньше книга носила своё, ряд действий
  // своё, и перенести из книги в ряд под сценой было нельзя: они друг о
  // друге не знали.
  const carry = $derived($carriedAbility)
  const dropCtx = $derived({ heroLevel: level, byId: ABILITY_BY_ID })
  const dropTo = (index: number) => abilityDropStatus(carry, { kind: 'slot', index }, dropCtx)
  const dropToBook = $derived(abilityDropStatus(carry, { kind: 'book' }, dropCtx))

  function put(index: number): void {
    if (carry === null) return
    if (dropTo(index).allowed) {
      if (carry.from === 'slot') swapAbilitySlots(carry.index, index)
      else setAbilitySlot(index, carry.abilityId)
    }
    releaseAbility()
  }

  /** Нажатие по занятому слоту с пустой рукой: берём умение из ряда. */
  function pickSlot(index: number, abilityId: string): void {
    toggleCarriedAbility({ from: 'slot', index, abilityId })
  }

  /** Нажатие по строке книги: взять умение или вернуть его обратно. */
  function pick(id: string): void {
    if (locked(ABILITY_BY_ID[id])) return
    toggleCarriedAbility({ from: 'book', abilityId: id })
  }

  /**
   * БРОСОК В КНИГУ ОСВОБОЖДАЕТ СЛОТ. Обратного пути не было вовсе: положить
   * умение в ряд можно было, а вынуть — нечем.
   */
  function returnToBook(): void {
    if (dropToBook.allowed && carry?.from === 'slot') setAbilitySlot(carry.index, null)
    releaseAbility()
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
        class:target={dropTo(i).fits}
        class:refused={dropTo(i).fits && !dropTo(i).allowed}
        draggable={ability !== null}
        aria-label="Слот {i + 1}: {ability ? ability.name : 'пусто'}"
        onclick={() => (carry === null && ability ? pickSlot(i, ability.id) : put(i))}
        ondragstart={(e: DragEvent) => {
          if (!ability) return
          e.dataTransfer?.setData('text/plain', ability.id)
          takeAbility({ from: 'slot', index: i, abilityId: ability.id })
        }}
        ondragover={(e: DragEvent) => dropTo(i).fits && e.preventDefault()}
        ondrop={(e: DragEvent) => {
          e.preventDefault()
          put(i)
        }}
        ondragend={() => releaseAbility()}
      >
        <span class="key">{i + 1}</span>
        {#if ability}<Icon name={ability.icon} size="lg" />{/if}
      </button>
    {/each}
  </div>
  {#if carry}
    <p class="carrying" data-book-carrying>
      Несёшь: <b>{ABILITY_BY_ID[carry.abilityId]?.name ?? '?'}</b> —
      {carry.from === 'slot' ? 'выбери другой слот или брось в список ниже.' : 'выбери слот.'}
    </p>
  {/if}

  <!-- КНИГА — СЕТКА, А НЕ ЛЕНТА.
       Одиннадцать строк по одной листались вниз, и выбор четвёрки шёл
       чтением: чтобы сравнить первое умение с последним, приходилось
       прокручивать. Сеткой все одиннадцать видны разом — три ряда по
       четыре, — и сравнение идёт взглядом.

       ЧТО ОСТАЛОСЬ В КЛЕТКЕ, А ЧТО УШЛО В ПОДСКАЗКУ. В клетке — значок,
       имя, роль словами, метка слота, предупреждение о связке и уровень
       открытия: всё, по чему ВЫБИРАЮТ, и всё, что обязано быть видно без
       наведения. Числа (цена, откат, урон, пороги) ушли в подсказку по
       наведению: их читают у ОДНОГО умения, а не у одиннадцати сразу, и
       именно они не помещались в клетку. Текст подсказки — та же сборка
       `abilityLines`, что и в ряду под сценой. -->
  <ul class="grid">
    {#each all as ability (ability.id)}
      {@const slot = inSlot(ability.id)}
      {@const isLocked = locked(ability)}
      {@const combo = comboState(ability, slots)}
      <!-- КЛЕТКА КНИГИ — ТОЖЕ ЦЕЛЬ. Умение, взятое из ряда, бросают сюда,
           и слот освобождается: обратного пути раньше не было вовсе. -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <li
        class="row"
        class:locked={isLocked}
        class:chosen={slot !== -1}
        class:carried={carry?.abilityId === ability.id}
        class:target={dropToBook.fits}
        data-ability={ability.id}
        ondragover={(e: DragEvent) => dropToBook.fits && e.preventDefault()}
        ondrop={(e: DragEvent) => {
          e.preventDefault()
          returnToBook()
        }}
      >
        <Tooltip text={[ability.name, ...describe(ability)].join('\n')} width="wide">
          <button
            type="button"
            class="grab"
            disabled={isLocked}
            draggable={!isLocked}
            aria-label={ability.name}
            onclick={() => (carry?.from === 'slot' ? returnToBook() : pick(ability.id))}
            ondragstart={(e: DragEvent) => {
              e.dataTransfer?.setData('text/plain', ability.id)
              takeAbility({ from: 'book', abilityId: ability.id })
            }}
            ondragend={() => releaseAbility()}
          >
            <Icon name={ability.icon} size="lg" />
          </button>
        </Tooltip>
        <span class="name">
          {ability.name}
          {#if slot !== -1}<Tag label="слот {slot + 1}" />{/if}
        </span>
        <!-- РОЛЬ СЛОВАМИ — первое, что читается, и единственное, по чему
             умения сравнивают между собой. Числа для этого бесполезны. -->
        <span class="role">{ABILITY_ROLE[ability.id] ?? ''}</span>
        <!-- СВЯЗКА ВИДНА БЕЗ НАВЕДЕНИЯ. Спрятать её в подсказку значило бы
             сделать «Разрыв без Рваной раны» невидимым ровно для того, кто
             ещё не знает, что связка вообще бывает. -->
        {#if combo !== 'none'}
          <span class="combo" class:ready={combo === 'ready'} data-combo={combo}>
            {comboText(combo, ABILITY_BY_ID[ability.combo!.needsAbilityId]?.name ?? '?')}
          </span>
        {/if}
        {#if isLocked}
          <span class="lock" data-lock>Откроется на {ability.unlockLevel} уровне</span>
        {/if}
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
  /* «Подходит» и «можно прямо сейчас» — разные вещи. Цель, куда бросок
     ничего не изменит (тот же слот) или запрещён уровнем, остаётся
     подсвеченной и получает рамку предупреждения. */
  .cell.refused {
    border-color: var(--c-warning);
  }
  /* СТРОКА КНИГИ КАК ЦЕЛЬ: сюда возвращают умение из ряда. */
  .row.target {
    outline: 1px dashed var(--c-accent);
    outline-offset: calc(-1 * var(--space-1));
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
  /* СЕТКА, А НЕ ЛЕНТА. Ширина клетки задана минимумом, а не числом колонок:
     на широком экране выходит четыре в ряд (одиннадцать умений — три ряда),
     на телефоне две. Жёсткие `repeat(4, 1fr)` дали бы на 390px колонку в
     77 пикселей, куда не помещается ни имя, ни роль. */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
    padding: var(--space-2);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    background: var(--c-surface-sunken);
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
  /* СТОЯЩЕЕ В СЛОТЕ ПОМЕЧЕНО ДВАЖДЫ: рамкой значка и ярлыком «слот N».
     Рамку видно боковым зрением при взгляде на сетку, ярлык отвечает на
     вопрос «в каком именно». */
  .row.chosen {
    border-color: var(--c-xp);
  }
  .row.chosen .grab {
    border-color: var(--c-xp);
  }
  .name {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-1);
    font-weight: var(--weight-bold);
    font-size: var(--text-sm);
  }
  .role {
    font-size: var(--text-xs);
    color: var(--c-text-muted);
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
