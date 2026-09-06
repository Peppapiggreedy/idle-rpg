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
  import { Decimal, compareItem, type StatId } from '../game'
  import { axisRows } from './axisText'
  import { placeTip } from './tipPlace'
  import { gameState } from '../stores/game'
  import { formatStatDelta, isImprovement, SHOWN_STAT_IDS, statNames } from './statFormat'
  import { RARITY_BY_ID } from '../data/rarity'
  import { itemSlotLabel } from './itemText'
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
   * обходит общий реестр SHOWN_STAT_IDS, поэтому новая характеристика попадает в
   * сравнение сама. Специального случая для выносливости нет — производные
   * (здоровье от выносливости, шанс крита от ловкости) приходят тем же обходом,
   * потому что конвейер уже развернул атрибуты в них.
   */
  const num = (v: Decimal | number): number => (typeof v === 'number' ? v : v.toNumber())
  const changed = $derived(
    SHOWN_STAT_IDS.filter(
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

  // ДВЕ ОСИ, ОБЕ ВСЕГДА. Приоритет игрока решает, что ПОДСВЕТИТЬ меткой
  // «Апгрейд», но не что показать: игрок, поставивший «урон», обязан видеть,
  // что находка вдвое дешевле по цене боя, — иначе ось выживания не помогла
  // бы ему ни разу.
  //
  // Строки собирает ОБЩИЙ `axisText.ts`: те же две оси показывает кукла при
  // перетаскивании, и числа там обязаны совпадать до знака. Своей копии
  // форматирования здесь быть не должно.
  const rows = $derived(axisRows(cmp.axes, cmp.markedAxes))

  // Границы экрана считает ОБЩАЯ `placeTip` — та же, что у окна надетого на
  // кукле и у подсказки дерева талантов. Здесь лежала её побуквенная копия
  // (свой `GAP = 14` и своя пара тернарников), хотя правило записано прямо:
  // «два окна у одного курсора обязаны переворачиваться одинаково». Копия
  // считала то же самое ДО ЗНАКА — и именно поэтому расхождение никто бы не
  // заметил до первой правки одной из двух формул.
  //
  // Проверка идёт по РЕАЛЬНОМУ размеру окна после отрисовки, а не по догадке.
  let box = $state<HTMLElement | null>(null)
  let size = $state({ w: 320, h: 240 })
  $effect(() => {
    if (!box) return
    const rect = box.getBoundingClientRect()
    if (rect.width !== size.w || rect.height !== size.h) size = { w: rect.width, h: rect.height }
  })
  const pos = $derived(
    placeTip(x, y, size, { width: window.innerWidth, height: window.innerHeight }),
  )
  const left = $derived(pos.left)
  const top = $derived(pos.top)
</script>

<div
  class="compare"
  bind:this={box}
  style="left: {left}px; top: {top}px; {rarityStyle(item.rarity)}"
  role="tooltip"
  data-item-compare
>
  <div class="head">
    <span class="name">{item.name}</span>
    <span class="tier">{RARITY_BY_ID[item.rarity].name} · {item.level} ур.</span>
    <!-- КУДА ЭТО НАДЕВАЕТСЯ — И ХВАТ СЛОВОМ. Окно называло всё, кроме
         главного про оружие: одноручное оно или двуручное. А разница между
         ними — это вся сборка целиком: со вторым клинком, со щитом или без
         второй руки вовсе. Узнать её можно было только надев.
         Подпись строит общий `itemSlotLabel`, тот же, что подписывает
         находку в сумке: двух ответов на один вопрос быть не должно. -->
    <span class="where">{itemSlotLabel(item)}</span>
  </div>

  <!-- ПЕРВЫМИ СТРОКАМИ — обе оси. Обе считаются через estimateCombatRate на
       одной и той же паре состояний: в урон входят аптайм и проки, в
       выживание — цена схватки долей запаса. По голой формуле урона броня
       никогда не была бы апгрейдом — за этим ось выживания и заведена. -->
  <ul class="axes">
    {#each rows as row (row.axis)}
      <li class:marked={row.marked}>
        <span class="axis">{row.name}</span>
        <b class:up={(row.value ?? 0) > 0} class:down={(row.value ?? 0) < 0}>{row.text}</b>
      </li>
    {/each}
  </ul>

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
    font-weight: var(--weight-bold);
    font-size: var(--text-sm);
  }
  .tier {
    color: var(--c-text-faint);
  }
  .where {
    color: var(--c-text-muted);
  }
  .axes {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0 0 var(--space-2);
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
  }
  .axes li {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    color: var(--c-text-dim);
  }
  /* Ось, по которой сейчас ставится метка «Апгрейд», — ярче остальных.
     Не «важнее»: вторая строка на месте и читается, просто игрок выбрал,
     по какой из них игра будет подсвечивать находки. */
  .axes li.marked {
    color: var(--c-text);
  }
  b.up {
    color: var(--c-heal);
  }
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
