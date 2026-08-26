<script lang="ts">
  import { formatNumber } from '../game'
  import { dismissOfflineReport, offlineReport } from '../stores/game'

  function formatElapsed(ms: number): string {
    const totalMinutes = Math.floor(ms / 60_000)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    if (hours > 0) return `${hours} ч ${minutes} мин`
    return `${minutes} мин`
  }
</script>

{#if $offlineReport}
  <div class="backdrop">
    <div class="modal" role="dialog" aria-labelledby="offline-title">
      <h2 id="offline-title">Пока тебя не было…</h2>
      <p class="elapsed">({formatElapsed($offlineReport.elapsedMs)})</p>
      <ul>
        <li>Убито врагов: <b>{formatNumber($offlineReport.kills)}</b></li>
        <li>Золото: <b class="gold">+{formatNumber($offlineReport.gold)}</b></li>
        <li>Опыт: <b class="xp">+{formatNumber($offlineReport.xp)}</b></li>
      </ul>
      <button type="button" onclick={dismissOfflineReport}>Продолжить</button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
  }
  .modal {
    min-width: 16rem;
    max-width: 90vw;
    padding: 1.5rem 2rem;
    border: 1px solid #8886;
    border-radius: 12px;
    background: canvas;
    text-align: center;
  }
  .modal h2 {
    margin: 0;
  }
  .elapsed {
    margin: 0.25rem 0 1rem;
    opacity: 0.7;
    font-size: 0.9rem;
  }
  ul {
    list-style: none;
    margin: 0 0 1.25rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .gold {
    color: var(--color-gold);
  }
  .xp {
    color: var(--color-xp);
  }
  button {
    font: inherit;
    padding: 0.5em 1.5em;
    border: 1px solid #8886;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  button:hover {
    border-color: var(--color-gold);
  }
</style>
