<script lang="ts">
  import { backupSaveString, dismissNotice, saveNotice, type NoticeCode } from '../stores/game'
  import { Button } from './kit'

  // Весь текст уведомлений живёт здесь: стор и логика оперируют кодами.
  const MESSAGES: Record<NoticeCode, string> = {
    'save-corrupted': 'Сохранение повреждено и не читается — игра начата заново. Прости!',
    'save-newer-version':
      'Сохранение из более новой версии игры не читается — игра начата заново. Обнови страницу: возможно, у тебя открыта старая версия из кеша.',
    'save-unsupported-version':
      'Формат сохранения этой игре незнаком — игра начата заново. Это не «игра обновилась»: такой версии формата в релизах не было.',
    // САМОЕ ВАЖНОЕ СООБЩЕНИЕ ЗДЕСЬ. Игра идёт, выглядит здоровой и ничего не
    // сохраняет: без этой строки игрок узнавал бы об этом, только закрыв
    // вкладку и вернувшись к первому уровню.
    'save-storage-unavailable':
      'Браузер не даёт игре хранилище — прогресс НЕ сохраняется и пропадёт при закрытии вкладки. Обычно это запрет cookie и данных сайтов в настройках браузера или режим инкогнито.',
    'save-quota-exceeded':
      'В хранилище браузера кончилось место — прогресс НЕ сохраняется. Освободи место (данные сайтов) и перезагрузи страницу.',
    'save-write-failed':
      'Не удалось записать сохранение — прогресс НЕ сохраняется и пропадёт при закрытии вкладки.',
    'save-load-failed': 'Не удалось загрузить сохранение — игра начата заново.',
    'import-invalid': 'Не удалось прочитать строку сейва — проверь, что скопирована целиком.',
    'import-success': 'Сейв импортирован. Прежний герой сохранён — его можно вернуть строкой ниже.',
  }

  // Прежнее сохранение показываем ровно там, где оно ещё может пригодиться:
  // на экране отказа загрузки и сразу после импорта. Дальше игрок начнёт
  // заново, и эта строка станет единственным следом его прогресса.
  const RECOVERABLE: NoticeCode[] = [
    'save-corrupted',
    'save-newer-version',
    'save-unsupported-version',
    'import-success',
  ]
  const backup = $derived($saveNotice && RECOVERABLE.includes($saveNotice) ? backupSaveString() : null)

  let copied = $state(false)
  async function copyBackup() {
    if (!backup) return
    try {
      await navigator.clipboard.writeText(backup)
      copied = true
    } catch {
      // Буфер недоступен — показываем строку прямо на экране, чтобы её
      // можно было выделить руками. Отказ буфера не должен отнимать копию.
      shown = true
    }
  }
  let shown = $state(false)
</script>

{#if $saveNotice}
  <div class="notice" role="status">
    <div class="body">
      <span>{MESSAGES[$saveNotice]}</span>
      {#if backup}
        <div class="rescue">
          <span class="hint">Прежнее сохранение уцелело — сохрани строку, пока не начал заново.</span>
          <Button size="sm" onclick={copyBackup}>
            {copied ? 'Скопировано ✓' : 'Скопировать прежнее сохранение'}
          </Button>
        </div>
        {#if shown}
          <textarea class="raw" readonly rows="3" value={backup}></textarea>
        {/if}
      {/if}
    </div>
    <Button size="sm" title="Закрыть" onclick={dismissNotice}>×</Button>
  </div>
{/if}

<style>
  .notice {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-3);
    border: 1px solid color-mix(in srgb, var(--c-warning) 45%, transparent);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--c-warning) var(--tint-weak), var(--c-surface));
    font-size: var(--text-sm);
    text-align: left;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .rescue {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .hint {
    color: var(--c-text-muted);
    font-size: var(--text-xs);
  }
  .raw {
    width: 100%;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    background: var(--c-surface);
    color: var(--c-text-muted);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-sm);
    padding: var(--space-1);
    resize: vertical;
  }
</style>
