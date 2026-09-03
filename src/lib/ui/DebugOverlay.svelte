<script lang="ts">
  import { onMount } from 'svelte'
  import { formatNumber, subscribeAttacks } from '../game'
  import { gameState, loopMetrics } from '../stores/game'
  import { isDebugMode, isScreenshotMode } from './route'
  import { DECISION_WINDOW, refreshTelemetry, telemetry } from '../stores/telemetry'
  import type { AttackEvent } from '../types'

  // ОВЕРЛЕЙ ЕСТЬ ТОЛЬКО ПРИ ?debug=1, как и отладочная панель рядом.
  //
  // Было наоборот: он показывался ВСЕГДА и прятался через ?debug=0 — то есть
  // обычный игрок видел в углу fps, tps, счётчик тиков и время сборки. Это
  // приборы разработчика, а не часть игры: игроку они ничего не говорят и
  // занимают угол экрана на каждом кадре.
  //
  // В режиме съёмки скрыт и при ?debug=1: время сборки и счётчик кадров от
  // снимка к снимку разные, и эталон не сошёлся бы никогда.
  const visible = isDebugMode() && !isScreenshotMode()

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
    // Один таймер на оверлей — это не игровая логика, а часы отладки:
    // «сколько прошло с прошлого решения» иначе стоит на месте.
    const ticker = setInterval(() => refreshTelemetry(), 1000)
    return () => {
      unsubscribe()
      clearInterval(ticker)
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
    <div class:alarm={$telemetry.alert}>
      решения: {$telemetry.count} · медиана
      {$telemetry.medianSec === null ? '—' : `${$telemetry.medianSec.toFixed(0)}с`} · без решения
      {$telemetry.sinceLastSec === null ? '—' : `${$telemetry.sinceLastSec.toFixed(0)}с`}
      (окно {DECISION_WINDOW.min}-{DECISION_WINDOW.max}с)
    </div>
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
  /* Тревога интервала решений: реже трёх минут — уже не idle, а пустой
     экран. Красим тем же цветом, что и ошибку: это тоже поломка. */
  .alarm {
    color: var(--c-damage);
  }
  .error {
    color: var(--c-damage);
    max-width: 22rem;
    word-break: break-word;
  }
</style>
