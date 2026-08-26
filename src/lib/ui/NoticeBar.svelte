<script lang="ts">
  import { dismissNotice, saveNotice } from '../stores/game'
</script>

{#if $saveNotice}
  <div class="notice" role="status">
    <span>{$saveNotice}</span>
    <button type="button" aria-label="Закрыть" onclick={dismissNotice}>×</button>
  </div>
{/if}

<style>
  .notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5em 0.9em;
    border: 1px solid #d4a01766;
    border-radius: 8px;
    background: rgba(212, 160, 23, 0.12);
    font-size: 0.9rem;
    text-align: left;
  }
  button {
    font: inherit;
    border: none;
    background: none;
    color: inherit;
    cursor: pointer;
    font-size: 1.1rem;
    line-height: 1;
    padding: 0 0.2em;
  }
</style>
