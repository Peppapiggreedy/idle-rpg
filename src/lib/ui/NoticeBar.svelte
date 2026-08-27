<script lang="ts">
  import { dismissNotice, saveNotice, type NoticeCode } from '../stores/game'
  import { Button } from './kit'

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
    <Button size="sm" title="Закрыть" onclick={dismissNotice}>×</Button>
  </div>
{/if}

<style>
  .notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-3);
    border: 1px solid color-mix(in srgb, var(--c-warning) 45%, transparent);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--c-warning) var(--tint-weak), var(--c-surface));
    font-size: var(--text-sm);
    text-align: left;
  }
</style>
