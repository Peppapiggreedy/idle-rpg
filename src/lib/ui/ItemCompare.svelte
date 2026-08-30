<script lang="ts">
  // СРАВНЕНИЕ ПРЕДМЕТА С НАДЕТЫМ — отдельным всплывающим окном у курсора.
  //
  // Раньше оно раскрывалось ВНУТРИ карточки и раздвигало её: карточка росла,
  // а кнопки «Продать» и «Распылить» уезжали из-под курсора ровно в тот
  // момент, когда игрок к ним тянулся. Поэтому окно вынесено наружу, живёт
  // в позиции fixed и не трогает раскладку сумки вовсе.
  //
  // pointer-events: none — обязательное свойство, а не украшение: окно висит
  // над карточкой, и без него оно перехватывало бы нажатия кнопок под собой.
  import { Decimal, STAT_IDS, compareItem, type StatId } from '../game'
  import { gameState } from '../stores/game'
  import { formatStatDelta, isImprovement, statNames } from './statFormat'
  import { RARITY_BY_ID } from '../data/rarity'
  import EnchantLine from './EnchantLine.svelte'
  import ItemMods from './ItemMods.svelte'
  import { rarityStyle } from './kit'
  import type { Item } from '../types'

  interface Props {
    item: Item
    /** Координаты якоря в окне (курсор или центр иконки на тач-экране). */
    x: number
    y: number
  }
  let { item, x, y }: Props = $props()

  const names = $derived(statNames($gameState.classId))
  const cmp = $derived(compareItem($gameState, item))

  /**
   * Изменившиеся характеристики. Список НЕ перечисляется здесь руками: он
   * обходит общий реестр STAT_IDS, поэтому новая характеристика попадает в
   * сравнение сама. Специального случая для живучести нет — производные
   * (здоровье от живучести, шанс крита от ловкости) приходят тем же обходом,
   * потому что конвейер уже развернул атрибуты в них.
   */
  const num = (v: Decimal | number): number => (typeof v === 'number' ? v : v.toNumber())
  const changed = $derived(
    STAT_IDS.filter(
      (stat: StatId) => Math.abs(num(cmp.after[stat]) - num(cmp.before[stat])) > 1e-9,
    ).map((stat: StatId) => ({
      stat,
      text: formatStatDelta(stat, cmp.before[stat], cmp.after[stat]),
      up: isImprovement(stat, cmp.before[stat], cmp.after[stat]),
    })),
  )

  // swingTime — производная, её нет среди StatId (модификатор на неё выдать
  // нельзя). Но игроку она говорит больше, чем «скорость оружия» и haste
  // порознь, поэтому идёт отдельной строкой.
  const swing = $derived(
    cmp.current.swingTime.toFixed(2) === cmp.withItem.swingTime.toFixed(2)
      ? null
      : {
          text: `${cmp.withItem.swingTime < cmp.current.swingTime ? '−' : '+'}${Math.abs(
            cmp.withItem.swingTime - cmp.current.swingTime,
          ).toFixed(2)}с`,
          up: cmp.withItem.swingTime < cmp.current.swingTime,
        },
  )

  const combat = $derived(
    cmp.combatDelta === null || Math.abs(cmp.combatDelta) < 0.0005
      ? null
      : `${cmp.combatDelta > 0 ? '+' : '−'}${(Math.abs(cmp.combatDelta) * 100)
          .toFixed(1)
          .replace('.', ',')} %`,
  )

  // Границы экрана: не хватает места справа — открываемся слева, не хватает
  // снизу — выше курсора. Проверка идёт по РЕАЛЬНОМУ размеру окна после
  // отрисовки, а не по догадке о нём.
  const GAP = 14
  let box = $state<HTMLElement | null>(null)
  let size = $state({ w: 320, h: 240 })
  $effect(() => {
    if (!box) return
    const rect = box.getBoundingClientRect()
    if (rect.width !== size.w || rect.height !== size.h) size = { w: rect.width, h: rect.height }
  })
  const left = $derived(
    x + GAP + size.w > window.innerWidth ? Math.max(4, x - GAP - size.w) : x + GAP,
  )
  const top = $derived(
    y + GAP + size.h > window.innerHeight ? Math.max(4, y - GAP - size.h) : y + GAP,
  )
</script>

<div
  class="compare"
  bind:this={box}
  style="left: {left}px; top: {top}px; {rarityStyle(item.rarity)}"
  role="tooltip"
>
  <div class="head">
    <span class="name">{item.name}</span>
    <span class="tier">{RARITY_BY_ID[item.rarity].name} · {item.level} ур.</span>
  </div>

  <!-- ПЕРВОЙ СТРОКОЙ — боевая эффективность целиком. Она считается через
       estimateCombatRate на обоих состояниях, поэтому в неё входят и аптайм,
       и проки: по голой формуле урона броня никогда не была бы апгрейдом. -->
  <div class="combat" class:up={(cmp.combatDelta ?? 0) > 0} class:down={(cmp.combatDelta ?? 0) < 0}>
    Боевая эффективность: {combat ?? 'без изменений'}
  </div>

  {#if cmp.currentItem}
    <div class="against">вместо «{cmp.currentItem.name}»</div>
  {:else}
    <div class="against">слот сейчас пуст</div>
  {/if}

  {#if changed.length > 0 || swing}
    <ul class="stats">
      {#each changed as row (row.stat)}
        <li><span class="stat">{names[row.stat]}</span><b class:up={row.up} class:down={!row.up}>{row.text}</b></li>
      {/each}
      {#if swing}
        <li><span class="stat">Время удара</span><b class:up={swing.up} class:down={!swing.up}>{swing.text}</b></li>
      {/if}
    </ul>
  {:else}
    <div class="against">характеристики не меняются</div>
  {/if}

  <div class="own">
    <ItemMods mods={item.mods} />
    <EnchantLine {item} separated />
  </div>
</div>

<style>
  .compare {
    position: fixed;
    z-index: 90;
    /* Мышь окно НЕ ловит: под ним лежат кнопки, и они обязаны нажиматься. */
    pointer-events: none;
    width: min(20rem, calc(100vw - var(--space-4)));
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    background: var(--c-surface-raised);
    border: 1px solid var(--rarity-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    font-size: var(--text-xs);
  }
  .head {
    display: flex;
    flex-direction: column;
  }
  .name {
    color: var(--rarity-color);
    font-weight: 600;
    font-size: var(--text-sm);
  }
  .tier {
    color: var(--c-text-faint);
  }
  .combat {
    font-weight: 600;
    color: var(--c-text-muted);
  }
  .combat.up,
  b.up {
    color: var(--c-heal);
  }
  .combat.down,
  b.down {
    color: var(--c-damage);
  }
  .against {
    color: var(--c-text-faint);
  }
  .stats {
    list-style: none;
    margin: 0;
    padding: var(--space-1) 0 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    border-top: 1px solid var(--c-border);
  }
  .stats li {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .stat {
    color: var(--c-text-muted);
  }
  .own {
    padding-top: var(--space-1);
    border-top: 1px solid var(--c-border);
  }
</style>
