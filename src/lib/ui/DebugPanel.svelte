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
  import { Button } from './kit'

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
        <span class="speed" class:active={$simSpeed === speed}>
          <Button size="sm" onclick={() => setSimulationSpeed(speed)}>×{speed}</Button>
        </span>
      {/each}
    </div>

    <div class="row info">
      <div>множитель: ×{$simSpeed}</div>
      <div>время сессии (игровое): {formatDuration(sessionMs)}</div>
      <div>ударов в минуту: {hitsPerMinute}</div>
      <div>сид rng: {$gameState.rngSeed}</div>
    </div>

    <div class="row actions">
      <Button size="sm" onclick={debugAddLevel}>+1 уровень</Button>
      <Button size="sm" onclick={() => debugAddGold(1000)}>+1000 золота</Button>
      <Button size="sm" onclick={debugKillMonster}>убить моба</Button>
      <Button size="sm" variant="danger" onclick={onReset}>сброс сейва</Button>
    </div>

    <div class="row offline">
      <input type="number" min="0.1" step="0.5" bind:value={offlineHours} aria-label="Часов оффлайна" />
      <Button size="sm" onclick={() => debugSimulateOffline(offlineHours)}>
        симулировать {offlineHours} ч оффлайна
      </Button>
    </div>

    <div class="row links">
      <a href="./balance?debug=1">прогон баланса →</a>
      <a href="./ui?debug=1">витрина интерфейса →</a>
    </div>
  </aside>
{/if}

<style>
  /* Отладочная панель намеренно выглядит как терминал: моноширинный шрифт
     и акцентный цвет. Все величины — из токенов, своих чисел нет. */
  .panel {
    position: fixed;
    left: var(--space-2);
    bottom: var(--space-2);
    z-index: 90;
    width: 16rem;
    padding: var(--space-2) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    text-align: left;
    color: var(--c-text);
    background: var(--c-surface-sunken);
    border: 1px solid color-mix(in srgb, var(--c-accent) 45%, transparent);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }
  .title {
    font-weight: var(--weight-bold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--c-accent);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .info {
    flex-direction: column;
    gap: 0;
    color: var(--c-text-muted);
  }
  .links {
    flex-direction: column;
    gap: var(--space-1);
  }
  /* Активная скорость подсвечивается вокруг кнопки: сам примитив Button
     про «выбран» не знает и знать не должен. */
  .speed.active {
    border-radius: var(--radius-sm);
    box-shadow: 0 0 0 1px var(--c-accent);
  }
  input {
    font: inherit;
    width: 4.5rem;
    padding: var(--space-1);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
  }

  /* На узком экране панель занимала бы пол-экрана поверх игры. */
  @media (max-width: 719px) {
    .panel {
      right: var(--space-2);
      width: auto;
    }
  }
</style>
