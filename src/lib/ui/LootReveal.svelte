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
  //
  // Очередь показов живёт в ui/lootReveal.ts и покрыта тестами: N находок
  // подряд дают ровно N показов, и каждый снимается сам по времени.
  import { untrack } from 'svelte'
  import { gameState } from '../stores/game'
  import { freshEvents } from './logView'
  import { emptyRevealQueue, enqueueReveals, showNext } from './lootReveal'
  import { rarityName, rarityStyle } from './kit'
  import { Icon } from './icons'
  import { SLOT_ICONS } from '../data/slots'
  import type { CombatEvent } from '../types'

  // Сколько вспышка висит. Не «успей посмотреть»: за это время её видно, а
  // сама находка никуда не денется — она уже в сумке.
  const REVEAL_MS = 2600

  /**
   * ОТМЕТКА ПРОЧИТАННОГО — ОБЫЧНАЯ ПЕРЕМЕННАЯ, И ЭТО НЕ НЕДОСМОТР.
   *
   * `freshEvents` ищет отметку через `indexOf`, то есть по ТОЖДЕСТВУ объекта,
   * а `$state` в Svelte 5 оборачивает присвоенный объект в прокси. Прокси не
   * равен оригиналу, `indexOf` не находит его никогда и возвращает ВЕСЬ
   * журнал как свежий — то есть находка считается новой в каждом кадре.
   *
   * Замер на живой игре (×100, наблюдение за вставками узла): одна эпическая
   * находка дала ШЕСТЬ вспышек за 82 мс, по одной на кадр, пока событие не
   * уехало из буфера журнала. Игрок видел это как «всплывает много раз
   * подряд»; курсор тут ни при чём — останавливало вытеснение, а не наведение.
   *
   * Отметка нигде не рисуется, поэтому реактивность ей не нужна вовсе.
   */
  let seen: CombatEvent | null = null

  let queue = $state(emptyRevealQueue())

  $effect(() => {
    const tail = $gameState.combatLog
    untrack(() => {
      const fresh = freshEvents(tail, seen)
      seen = tail[0] ?? seen
      queue = enqueueReveals(queue, fresh)
    })
  })

  // Очередь движется ВРЕМЕНЕМ. Каждому показу — свой полный срок: таймер
  // заводится на номер показа, а не на факт «что-то показывается».
  $effect(() => {
    const key = queue.current?.key
    if (key === undefined) return
    const timer = setTimeout(() => untrack(() => (queue = showNext(queue))), REVEAL_MS)
    return () => clearTimeout(timer)
  })
</script>

{#if queue.current}
  {#key queue.current.key}
    <div class="reveal" style={rarityStyle(queue.current.item.rarity)} aria-live="polite">
      <Icon name={SLOT_ICONS[queue.current.item.slot]} size="lg" />
      <div class="text">
        <span class="tier">{rarityName(queue.current.item.rarity)}</span>
        <span class="name">{queue.current.item.name}</span>
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
