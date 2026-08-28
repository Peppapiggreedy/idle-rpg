<script lang="ts">
  // Вспышка находки: второе кодирование редкости, теперь визуальное.
  //
  // Показывается ТОЛЬКО для тиров с reveal в data/rarity.ts. Это не украшение
  // и не «удержание»: игра идёт в фоне, лут капает постоянно, и без отдельного
  // сигнала легендарная находка проходит незамеченной ровно так же, как
  // сотая обычная. Цвет и звук уже сообщили тир — вспышка сообщает его тем,
  // кто в этот момент смотрит на экран.
  //
  // Ничего не отнимает и никуда не торопит: таймера обратного отсчёта нет,
  // закрывается сама и не мешает нажимать что угодно (pointer-events: none).
  import { untrack } from 'svelte'
  import { gameState } from '../stores/game'
  import { freshEvents } from './logView'
  import { RARITY_BY_ID } from '../data/rarity'
  import { rarityName, rarityStyle } from './kit'
  import { Icon } from './icons'
  import { SLOT_ICONS } from '../data/slots'
  import type { CombatEvent, Item } from '../types'

  // Сколько вспышка висит. Не «успей посмотреть»: за это время её видно, а
  // сама находка никуда не денется — она уже в сумке.
  const REVEAL_MS = 2600

  let shown = $state<{ item: Item; key: number } | null>(null)
  let seen = $state<CombatEvent | null>(null)
  let key = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  $effect(() => {
    const tail = $gameState.combatLog
    untrack(() => {
      const fresh = freshEvents(tail, seen)
      seen = tail[0] ?? seen
      // Из пачки берём ПОСЛЕДНЮЮ подходящую: две легендарки в один тик —
      // случай теоретический, но мигать двумя вспышками сразу незачем.
      const worthy = fresh.filter(
        (e) => e.type === 'loot' && RARITY_BY_ID[e.item.rarity].reveal,
      )
      const last = worthy[worthy.length - 1]
      if (!last || last.type !== 'loot') return
      key += 1
      shown = { item: last.item, key }
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => (shown = null), REVEAL_MS)
    })
  })

  $effect(() => () => {
    if (timer) clearTimeout(timer)
  })
</script>

{#if shown}
  {#key shown.key}
    <div class="reveal" style={rarityStyle(shown.item.rarity)} aria-live="polite">
      <Icon name={SLOT_ICONS[shown.item.slot]} size="lg" />
      <div class="text">
        <span class="tier">{rarityName(shown.item.rarity)}</span>
        <span class="name">{shown.item.name}</span>
      </div>
    </div>
  {/key}
{/if}

<style>
  .reveal {
    position: fixed;
    left: 50%;
    top: var(--space-6);
    transform: translateX(-50%);
    z-index: 80;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--rarity-color);
    border-radius: var(--radius-md);
    background: var(--c-surface-raised);
    box-shadow: var(--shadow-lg);
    color: var(--rarity-color);
    /* Вспышка ничего не перехватывает: игрок в этот момент может целиться
       в кнопку умения, и отнимать у него нажатие ради красоты нельзя. */
    pointer-events: none;
    animation: reveal-in var(--dur-slow) ease-out;
  }
  .text {
    display: flex;
    flex-direction: column;
  }
  .tier {
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
  }
  .name {
    font-size: var(--text-md);
    font-weight: var(--weight-bold);
    color: var(--c-text);
  }
  @keyframes reveal-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(calc(-1 * var(--space-3)));
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }
  /* Съёмка идёт с prefers-reduced-motion, и анимация там замирает сама. */
  @media (prefers-reduced-motion: reduce) {
    .reveal {
      animation: none;
    }
  }
</style>
