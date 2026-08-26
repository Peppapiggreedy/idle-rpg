<script lang="ts">
  import { exportSaveString, importSaveString } from '../stores/game'

  let copied = $state(false)

  async function onExport() {
    const save = exportSaveString()
    try {
      await navigator.clipboard.writeText(save)
      copied = true
      setTimeout(() => (copied = false), 2000)
    } catch {
      // Буфер обмена недоступен (например, без HTTPS) — даём скопировать руками.
      window.prompt('Скопируй строку сейва:', save)
    }
  }

  function onImport() {
    const input = window.prompt('Вставь строку сейва:')
    if (input) importSaveString(input)
  }
</script>

<div class="controls">
  <button type="button" onclick={onExport}>
    {copied ? 'Скопировано ✓' : 'Экспорт сейва'}
  </button>
  <button type="button" onclick={onImport}>Импорт сейва</button>
</div>

<style>
  .controls {
    display: flex;
    justify-content: center;
    gap: 0.75rem;
  }
  button {
    font: inherit;
    font-size: 0.85rem;
    padding: 0.4em 1em;
    border: 1px solid #8886;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    opacity: 0.85;
  }
  button:hover {
    border-color: var(--color-gold);
    opacity: 1;
  }
</style>
