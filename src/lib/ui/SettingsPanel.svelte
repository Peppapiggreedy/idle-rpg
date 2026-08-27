<script lang="ts">
  // Настройки: сейв, режим отображения, кадры и ссылки наружу.
  // Настройки экрана НЕ лежат в сейве — это свойства машины, а не прогресс
  // (подробнее в stores/ui.ts).
  import { exportSaveString, importSaveString } from '../stores/game'
  import {
    FPS_LIMITS,
    hasWebgl,
    isTextMode,
    setFpsLimit,
    sceneUnavailable,
    setTextMode,
    uiSettings,
    type FpsLimit,
    type TextModeSetting,
  } from '../stores/ui'
  import { Button, Panel, Tag } from './kit'
  import { isSceneDisabled } from './route'

  const ISSUES_URL = 'https://github.com/Peppapiggreedy/idle-rpg/issues'
  const CREDITS_URL = 'https://github.com/Peppapiggreedy/idle-rpg/blob/main/CREDITS.md'

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

  // ?scene=off перекрывает настройку: панель должна показывать то, что
  // игрок видит на экране, а не то, что записано в настройках.
  const sceneOff = isSceneDisabled()
  const webgl = hasWebgl()
  const textNow = $derived(sceneOff || $sceneUnavailable || isTextMode($uiSettings))

  const TEXT_MODE_LABEL: Record<TextModeSetting, string> = {
    auto: 'Как получится',
    on: 'Всегда текст',
    off: 'Всегда сцена',
  }
  const TEXT_MODES: TextModeSetting[] = ['auto', 'off', 'on']

  const fpsLabel = (limit: FpsLimit) => (limit === null ? 'Без лимита' : `${limit} кадров`)
</script>

<Panel title="Настройки">
  <section class="group">
    <h3>Сохранение</h3>
    <p class="hint">
      Строка сейва — весь прогресс целиком. Настройки с этого экрана в неё
      НЕ попадают: лимит кадров и текстовый режим у каждой машины свои.
    </p>
    <div class="row">
      <Button loading={copying} onclick={onExport}>
        {copied ? 'Скопировано ✓' : 'Экспорт сейва'}
      </Button>
      <Button onclick={onImport}>Импорт сейва</Button>
    </div>
  </section>

  <section class="group">
    <h3>Отображение</h3>
    <p class="hint">
      Текстовый режим — полноценный: в нём вместо сцены боевая панель, и играть
      можно целиком без 3D.
      {#if sceneOff}
        Сейчас сцена выключена параметром адреса <code>?scene=off</code>, и он
        сильнее любой настройки.
      {:else if $sceneUnavailable}
        Сцена не запустилась в этом браузере, поэтому идёт текст. Перезагрузка
        страницы попробует ещё раз.
      {:else if webgl}
        WebGL в этом браузере есть.
      {:else}
        WebGL в этом браузере недоступен — «как получится» означает текст.
      {/if}
    </p>
    <div class="row">
      {#each TEXT_MODES as mode (mode)}
        <Button
          variant={$uiSettings.textMode === mode ? 'primary' : 'ghost'}
          onclick={() => setTextMode(mode)}
        >
          {TEXT_MODE_LABEL[mode]}
        </Button>
      {/each}
      <Tag tone={textNow ? 'warning' : 'accent'} size="md" label={textNow ? 'сейчас: текст' : 'сейчас: сцена'} />
    </div>
  </section>

  <section class="group">
    <h3>Кадры</h3>
    <p class="hint">
      Лимит бережёт батарею и слабые машины. На скорость игры он не влияет:
      игровое время идёт фиксированным шагом и от частоты кадров не зависит.
      По умолчанию 30 — боевой сцене больше и не нужно.
    </p>
    <div class="row">
      {#each FPS_LIMITS as limit (String(limit))}
        <Button
          variant={$uiSettings.fpsLimit === limit ? 'primary' : 'ghost'}
          onclick={() => setFpsLimit(limit)}
        >
          {fpsLabel(limit)}
        </Button>
      {/each}
    </div>
  </section>

  <section class="group">
    <h3>Об игре</h3>
    <div class="row">
      <a class="link" href={CREDITS_URL} target="_blank" rel="noopener noreferrer">
        Благодарности и лицензии
      </a>
      <a class="link" href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
        Сообщить о проблеме
      </a>
    </div>
  </section>
</Panel>

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  h3 {
    margin: 0;
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-faint);
  }
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--c-text-muted);
  }
  /* Технический латинский кусок — тот самый случай, под который заведён
     --font-mono (см. tokens.css). */
  .hint code {
    font-family: var(--font-mono);
    color: var(--c-text);
  }
  .row {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    align-items: center;
  }
  /* Ссылка выглядит и нажимается как кнопка: на мобильном по ней надо попасть. */
  .link {
    display: inline-flex;
    align-items: center;
    min-height: var(--tap-min);
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--c-accent);
    text-decoration: none;
  }
  .link:hover {
    border-color: var(--c-accent);
    background: color-mix(in srgb, var(--c-accent) var(--tint-weak), transparent);
  }
</style>
