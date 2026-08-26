<script lang="ts">
  import { onMount } from 'svelte'
  import { gameState, loopMetrics } from '../stores/game'

  // Оверлей нужен для отладки вслепую на живой странице; прячется через ?debug=0.
  const visible =
    new URLSearchParams(window.location.search).get('debug') !== '0'

  let lastError = $state('')

  onMount(() => {
    const onError = (e: ErrorEvent) => {
      lastError = e.message
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      lastError = String(e.reason)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  })
</script>

{#if visible}
  <div class="overlay">
    <div>fps: {$loopMetrics.fps} · tps: {$loopMetrics.tps}</div>
    <div>ticks: {$gameState.totalTicks.toFixed(0)}</div>
    <div>build: {__BUILD_TIME__}</div>
    {#if lastError}
      <div class="error">err: {lastError}</div>
    {/if}
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    right: 0.5rem;
    bottom: 0.5rem;
    z-index: 9999;
    padding: 0.4em 0.6em;
    font: 12px/1.5 ui-monospace, Consolas, monospace;
    text-align: right;
    color: #9f9;
    background: rgba(0, 0, 0, 0.7);
    border-radius: 6px;
    pointer-events: none;
  }
  .error {
    color: #f77;
    max-width: 22rem;
    word-break: break-word;
  }
</style>
