<script lang="ts">
  import { onMount } from 'svelte'
  import { formatNumber, subscribeAttacks } from '../game'
  import {
    debugAddGold,
    debugAddLevel,
    debugKillMonster,
    debugResetSave,
    debugSimulateOffline,
    gameState,
    sessionStartPlaytimeMs,
    setSimulationSpeed,
    simSpeed,
  } from '../stores/game'

  // Панель существует только с ?debug=1 — без него не рендерится вообще.
  const enabled = new URLSearchParams(window.location.search).get('debug') === '1'

  const SPEEDS = [1, 10, 100]
  let offlineHours = $state(8)

  // Удары в минуту: скользящее окно по реальному времени через шину событий.
  let hitTimes: number[] = []
  let hitsPerMinute = $state(0)

  onMount(() => {
    if (!enabled) return
    const unsubscribe = subscribeAttacks(() => {
      const now = Date.now()
      hitTimes.push(now)
      hitTimes = hitTimes.filter((t) => now - t <= 60_000)
      hitsPerMinute = hitTimes.length
    })
    // Косметический таймер устаревания окна (не игровая логика).
    const prune = setInterval(() => {
      const now = Date.now()
      hitTimes = hitTimes.filter((t) => now - t <= 60_000)
      hitsPerMinute = hitTimes.length
    }, 1000)
    return () => {
      unsubscribe()
      clearInterval(prune)
    }
  })

  const sessionMs = $derived(
    Math.max(0, $gameState.playtimeMs.toNumber() - $sessionStartPlaytimeMs),
  )

  function formatDuration(ms: number): string {
    const totalSec = Math.floor(ms / 1000)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  function onReset() {
    if (window.confirm('Точно стереть сейв и начать заново?')) debugResetSave()
  }
</script>

{#if enabled}
  <aside class="panel">
    <div class="title">debug</div>

    <div class="row speeds">
      {#each SPEEDS as speed (speed)}
        <button
          type="button"
          class:active={$simSpeed === speed}
          onclick={() => setSimulationSpeed(speed)}
        >
          ×{speed}
        </button>
      {/each}
    </div>

    <div class="row info">
      <div>множитель: ×{$simSpeed}</div>
      <div>время сессии (игровое): {formatDuration(sessionMs)}</div>
      <div>ударов в минуту: {hitsPerMinute}</div>
      <div>сид rng: {$gameState.rngSeed}</div>
    </div>

    <div class="row actions">
      <button type="button" onclick={debugAddLevel}>+1 уровень</button>
      <button type="button" onclick={() => debugAddGold(1000)}>+1000 золота</button>
      <button type="button" onclick={debugKillMonster}>убить моба</button>
      <button type="button" class="danger" onclick={onReset}>сброс сейва</button>
    </div>

    <div class="row offline">
      <input type="number" min="0.1" step="0.5" bind:value={offlineHours} aria-label="Часов оффлайна" />
      <button type="button" onclick={() => debugSimulateOffline(offlineHours)}>
        симулировать {offlineHours} ч оффлайна
      </button>
    </div>
  </aside>
{/if}

<style>
  .panel {
    position: fixed;
    left: 0.5rem;
    bottom: 0.5rem;
    z-index: 90;
    width: 15rem;
    padding: 0.6rem 0.7rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font: 12px/1.5 ui-monospace, Consolas, monospace;
    text-align: left;
    color: #cfc;
    background: rgba(0, 0, 0, 0.8);
    border: 1px solid #4a4;
    border-radius: 8px;
  }
  .title {
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    opacity: 0.7;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .info {
    flex-direction: column;
    gap: 0.1rem;
  }
  button {
    font: inherit;
    padding: 0.2em 0.6em;
    border: 1px solid #4a4;
    border-radius: 5px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  button:hover {
    background: rgba(80, 200, 80, 0.15);
  }
  button.active {
    background: rgba(80, 200, 80, 0.3);
    font-weight: 700;
  }
  button.danger {
    border-color: #a44;
    color: #fbb;
  }
  input {
    font: inherit;
    width: 4.5rem;
    padding: 0.2em 0.4em;
    border: 1px solid #4a4;
    border-radius: 5px;
    background: transparent;
    color: inherit;
  }
</style>
