<script lang="ts">
  // Строка СВОЙСТВА СБОРКИ на предмете. Одна на всю игру — по тому же доводу,
  // что и строка зачарования рядом: два разных ответа на вопрос «что эта вещь
  // делает» игрок прочитал бы как две разные механики.
  //
  // ТЕКСТ СОБИРАЕТСЯ ИЗ ДАННЫХ, а не выписан словами в свойстве: правка числа
  // в data/boons.ts обязана менять и то, что читает игрок. Иначе карточка
  // разъедется с боем на первой же правке — ровно как разъезжались описания
  // умений, пока их писали руками.
  //
  // ПЛАТА НАЗЫВАЕТСЯ ВСЛУХ. «Свойство» без цены читается как чистая прибавка,
  // и игрок справедливо ждёт, что легендарка сильнее редкой вещи. Она не
  // сильнее — она другая, и это надо сказать, а не спрятать.
  import { BOON_BY_ID } from '../data/boons'
  import { ABILITY_BY_ID } from '../data/abilities'
  import { tuneText } from './boonText'
  import type { Item } from '../types'
  import { Icon } from './icons'

  interface Props {
    item: Item
    /** В подсказке строка отделена чертой от базовых характеристик. */
    separated?: boolean
  }
  let { item, separated = false }: Props = $props()

  const boon = $derived(item.boonId ? BOON_BY_ID[item.boonId] : undefined)
  const ability = $derived(boon ? ABILITY_BY_ID[boon.abilityId] : undefined)
</script>

{#if boon && ability}
  <span class="boon" class:separated>
    <Icon name={ability.icon} />
    <span class="name">{boon.name}</span>
    <span class="effect">
      {ability.name}: {boon.tune.map((t) => tuneText(t)).join(', ')}
    </span>
    <span class="cost">взамен статов на {Math.round(boon.statShare * 100)} % меньше</span>
  </span>
{/if}

<style>
  /* Цвет — токен прокачки, как у зачарования: и то и другое про вложение в
     вещь, а не про урон или запас. */
  .boon {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--space-1);
    font-size: var(--text-xs);
    color: var(--c-xp);
  }
  .boon.separated {
    margin-top: var(--space-1);
    padding-top: var(--space-1);
    border-top: 1px solid var(--c-border);
  }
  .name {
    font-weight: var(--weight-bold);
  }
  .effect {
    color: var(--c-text-muted);
  }
  .cost {
    color: var(--c-warning);
  }
</style>
