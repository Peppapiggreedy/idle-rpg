<script lang="ts">
  // Строка зачарования на предмете. Одна на всю игру: и панель экипировки,
  // и подсказка предмета показывают зачарование ОДИНАКОВО, иначе игрок
  // читал бы два разных ответа на один вопрос «что на этой вещи стоит».
  //
  // Незачарованный предмет строку не показывает ВОВСЕ — не «Зачарование:
  // нет». Пустая строка занимает место и ничего не сообщает.
  import { enchantOf } from '../game'
  import type { Item } from '../types'
  import { Icon } from './icons'

  interface Props {
    item: Item
    /** В подсказке строка отделена чертой от базовых характеристик. */
    separated?: boolean
  }
  let { item, separated = false }: Props = $props()

  const enchant = $derived(enchantOf(item))
</script>

{#if enchant}
  <span class="enchant" class:separated>
    <Icon name={enchant.icon} />
    <span class="name">{enchant.name}</span>
    <span class="effect">{enchant.tagline}</span>
  </span>
{/if}

<style>
  /* Цвет — токен прокачки: зачарование это вложение в вещь, того же рода,
     что таланты и умения. Хардкода здесь нет намеренно (см. tokens.css). */
  .enchant {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--space-1);
    font-size: var(--text-xs);
    color: var(--c-xp);
  }
  .enchant.separated {
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
</style>
