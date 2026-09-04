<script lang="ts">
  // ОПИСАНИЕ НАДЕТОЙ ВЕЩИ — всплывающим окном у курсора.
  //
  // Кукла стала сеткой значков, и списки модификаторов ушли из ячеек: семь
  // карточек со статами занимали весь экран «Героя», а переодевание из-за
  // этого шло вслепую — сумка уезжала под сгиб. Но выкинуть описание совсем
  // нельзя: надетое надо с чем-то сравнивать. Оно и переехало сюда.
  //
  // ЭТО НЕ `ItemCompare`, И СЛИВАТЬ ИХ НЕ НАДО. То окно отвечает на вопрос
  // «что изменится, если надеть», и у надетой вещи ответ на него — нули.
  // Здесь вопрос другой: «что на мне сейчас».
  import { RARITY_BY_ID } from '../data/rarity'
  import { SLOT_NAMES, type SlotId } from '../data/slots'
  import { GRIP_TEXT } from './itemText'
  import EnchantLine from './EnchantLine.svelte'
  import ItemMods from './ItemMods.svelte'
  import { rarityStyle } from './kit'
  import { placeTip } from './tipPlace'
  import type { Item } from '../types'

  interface Props {
    item: Item
    slot: SlotId
    /** Координаты якоря в окне (курсор или центр ячейки на тач-экране). */
    x: number
    y: number
  }
  let { item, slot, x, y }: Props = $props()

  // Границы экрана считает общая `placeTip` — та же, что у окна сравнения:
  // два окна у одного курсора обязаны переворачиваться одинаково.
  let box = $state<HTMLElement | null>(null)
  let size = $state({ w: 260, h: 180 })
  $effect(() => {
    if (!box) return
    const rect = box.getBoundingClientRect()
    if (rect.width !== size.w || rect.height !== size.h) size = { w: rect.width, h: rect.height }
  })
  const pos = $derived(
    placeTip(x, y, size, { width: window.innerWidth, height: window.innerHeight }),
  )
</script>

<div
  class="tip"
  bind:this={box}
  style="left: {pos.left}px; top: {pos.top}px; {rarityStyle(item.rarity)}"
  role="tooltip"
  data-item-tip
>
  <div class="head">
    <span class="name">{item.name}</span>
    <span class="tier">{RARITY_BY_ID[item.rarity].name} · {item.level} ур.</span>
  </div>
  <!-- ХВАТ НАЗЫВАЕТСЯ СЛОВОМ. Одноручное оружие от двуручного отличается
       вдвое большим уроном и вдвое меньшей частотой — то есть всем, — а
       узнать это можно было только надев. -->
  <div class="where">
    {SLOT_NAMES[slot]}{#if item.grip} · {GRIP_TEXT[item.grip]}{/if}
  </div>
  <ItemMods mods={item.mods} />
  <EnchantLine {item} separated />
</div>

<style>
  .tip {
    position: fixed;
    z-index: 90;
    /* Мышь окно НЕ ловит: под ним лежит сама ячейка, и она обязана
       нажиматься — иначе с куклы ничего не снять. */
    pointer-events: none;
    width: min(18rem, calc(100vw - var(--space-4)));
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
    padding-bottom: var(--space-1);
    border-bottom: 1px solid var(--c-border);
  }
</style>
