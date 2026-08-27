<script lang="ts">
  import { exportSaveString, importSaveString } from '../stores/game'
  import { Button } from './kit'

  let copied = $state(false)
  let copying = $state(false)

  async function onExport() {
    copying = true
    const save = exportSaveString()
    try {
      await navigator.clipboard.writeText(save)
      copied = true
      setTimeout(() => (copied = false), 2000)
    } catch {
      // Буфер обмена недоступен (например, без HTTPS) — даём скопировать руками.
      window.prompt('Скопируй строку сейва:', save)
    } finally {
      copying = false
    }
  }

  function onImport() {
    const input = window.prompt('Вставь строку сейва:')
    if (input) importSaveString(input)
  }
</script>

<div class="controls">
  <Button loading={copying} onclick={onExport}>
    {copied ? 'Скопировано ✓' : 'Экспорт сейва'}
  </Button>
  <Button onclick={onImport}>Импорт сейва</Button>
</div>

<style>
  .controls {
    display: flex;
    justify-content: center;
    gap: var(--space-3);
  }
</style>
