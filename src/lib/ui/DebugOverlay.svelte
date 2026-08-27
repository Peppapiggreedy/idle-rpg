<script lang="ts">
  import { onMount } from 'svelte'
  import { formatNumber, subscribeAttacks } from '../game'
  import { gameState, loopMetrics } from '../stores/game'
  import { isScreenshotMode } from './route'
  import type { AttackEvent } from '../types'

  // Оверлей нужен для отладки вслепую на живой странице; прячется через ?debug=0.
  // В режиме съёмки скрыт всегда: в нём время сборки и счётчик кадров —
  // от снимка к снимку они разные, и эталон не сойдётся никогда.
  const visible =
    new URLSearchParams(window.location.search).get('debug') !== '0' && !isScreenshotMode()

  let lastError = $state('')
  let lastAttack = $state<AttackEvent | null>(null)

  onMount(() => {
    const unsubscribe = subscribeAttacks((e) => {
      lastAttack = e
    })
    const onError = (e: ErrorEvent) => {
      lastError = e.message
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      lastError = String(e.reason)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      unsubscribe()
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  })
</script>

{#if visible}
  <div class="overlay">
    <div>fps: {$loopMetrics.fps} · tps: {$loopMetrics.tps}</div>
    <div>ticks: {$gameState.totalTicks.toFixed(0)}</div>
    {#if lastAttack}
      <div>hit: {formatNumber(lastAttack.amount)}{lastAttack.isCrit ? ' crit' : ''}</div>
    {/if}
    <div>build: {__BUILD_TIME__}</div>
    {#if lastError}
      <div class="error">err: {lastError}</div>
    {/if}
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    right: var(--space-2);
    bottom: var(--space-2);
    z-index: 9999;
    padding: var(--space-1) var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    text-align: right;
    color: var(--c-accent);
    background: var(--c-surface-sunken);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-sm);
    pointer-events: none;
  }
  .error {
    color: var(--c-damage);
    max-width: 22rem;
    word-break: break-word;
  }
</style>
