<script lang="ts">
  import { dismissNotice, saveNotice, type NoticeCode } from '../stores/game'

  // Весь текст уведомлений живёт здесь: стор и логика оперируют кодами.
  const MESSAGES: Record<NoticeCode, string> = {
    'save-corrupted': 'Сохранение повреждено и не читается — игра начата заново. Прости!',
    'save-newer-version':
      'Сохранение из более новой версии игры не читается — игра начата заново.',
    'save-load-failed': 'Не удалось загрузить сохранение — игра начата заново.',
    'import-invalid': 'Не удалось прочитать строку сейва — проверь, что скопирована целиком.',
    'import-success': 'Сейв импортирован.',
  }
</script>

{#if $saveNotice}
  <div class="notice" role="status">
    <span>{MESSAGES[$saveNotice]}</span>
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
    border: 1px solid color-mix(in srgb, var(--color-gold) 40%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--color-gold) 12%, transparent);
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
