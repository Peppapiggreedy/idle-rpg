<script lang="ts">
  // Настройки: сейв, режим отображения, звук и ссылки наружу.
  // Настройки экрана НЕ лежат в сейве — это свойства машины, а не прогресс
  // (подробнее в stores/ui.ts).
  import {
    currentSavePreview,
    exportSaveString,
    importSaveString,
    previewSaveString,
    type SavePreview,
  } from '../stores/game'
  import {
    isTextMode,
    setTextMode,
    setVolume,
    soundUnlocked,
    uiSettings,
    VOLUME_IDS,
    type TextModeSetting,
    type VolumeId,
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

  /**
   * ИМПОРТ ПЕРЕСПРАШИВАЕТ, и вопрос НАЗЫВАЕТ ОБОИХ ГЕРОЕВ.
   *
   * Раньше здесь были window.prompt и сразу замена: самое разрушительное
   * действие в игре не задавало ни одного вопроса. Игрок, решивший проверить,
   * что экспортированная строка рабочая, вставлял её — и молча менял героя
   * семидесятого уровня на героя недельной давности, без пути назад.
   *
   * Строка разбирается ДО замены: нечитаемая отвергается, пока текущий герой
   * ещё на месте.
   */
  let pending = $state<{ input: string; from: SavePreview | null; to: SavePreview } | null>(null)

  function onImport() {
    const input = window.prompt('Вставь строку сейва:')
    if (!input) return
    const to = previewSaveString(input)
    if (!to) {
      // Отказ ДО замены, а не после: герой на месте, терять нечего.
      importSaveString(input)
      return
    }
    pending = { input, from: currentSavePreview(), to }
  }

  function confirmImport() {
    if (!pending) return
    importSaveString(pending.input)
    pending = null
  }

  // ?scene=off перекрывает настройку: панель должна показывать то, что
  // игрок видит на экране, а не то, что записано в настройках.
  const sceneOff = isSceneDisabled()
  const textNow = $derived(sceneOff || isTextMode($uiSettings))

  const TEXT_MODE_LABEL: Record<TextModeSetting, string> = {
    auto: 'Как получится',
    on: 'Всегда текст',
    off: 'Всегда сцена',
  }
  const TEXT_MODES: TextModeSetting[] = ['auto', 'off', 'on']

  // Весь текст про звук живёт здесь: реестр отдаёт только id категорий.
  const VOLUME_LABEL: Record<VolumeId, string> = {
    master: 'Общая',
    combat: 'Бой',
    loot: 'Находки',
    ui: 'Интерфейс',
  }
</script>

<Panel title="Настройки">
  <section class="group">
    <h3>Сохранение</h3>
    <p class="hint">
      Строка сейва — весь прогресс целиком. Настройки с этого экрана в неё
      НЕ попадают: текстовый режим и громкость у каждой машины свои.
    </p>
    <div class="row">
      <Button loading={copying} onclick={onExport}>
        {copied ? 'Скопировано ✓' : 'Экспорт сейва'}
      </Button>
      <Button onclick={onImport}>Импорт сейва</Button>
    </div>

    {#if pending}
      <!-- Вопрос называет ОБОИХ вслух. «Заменить сейв?» без имён — это тот же
           молчаливый импорт, только с лишним нажатием. -->
      <div class="confirm" role="alertdialog" aria-label="Подтверждение импорта">
        <p class="what">
          {#if pending.from}
            Заменить <b>{pending.from.className}, {pending.from.level} ур.</b> на
            <b>{pending.to.className}, {pending.to.level} ур.</b>?
          {:else}
            Загрузить <b>{pending.to.className}, {pending.to.level} ур.</b>?
          {/if}
        </p>
        <p class="hint">
          Прежний герой уйдёт в запасную копию — вернуть его можно будет строкой
          из уведомления сразу после импорта.
        </p>
        <div class="row">
          <Button variant="primary" onclick={confirmImport}>Заменить</Button>
          <Button onclick={() => (pending = null)}>Отмена</Button>
        </div>
      </div>
    {/if}
  </section>

  <section class="group">
    <h3>Отображение</h3>
    <p class="hint">
      Текстовый режим — полноценный: в нём вместо сцены боевая панель, и играть
      можно целиком без картинки. Другой настройки производительности нет:
      слабой машине хватает его.
      {#if sceneOff}
        Сейчас сцена выключена параметром адреса <code>?scene=off</code>, и он
        сильнее любой настройки.
      {:else}
        Сцена рисуется обычными элементами страницы и работает в любом браузере.
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
    <h3>Звук</h3>
    <p class="hint">
      Звук молчит до первого нажатия — игра не начинает шуметь сама.
      {#if $soundUnlocked}
        Сейчас он включён.
      {:else}
        Нажми в любом месте страницы, чтобы включить.
      {/if}
      Молчит он и на ускорении отладки, в спрятанной вкладке и в текстовом
      режиме. Редкость находки закодирована дважды: цветом и звуком — верхние
      тиры слышно, не глядя на экран.
    </p>
    {#each VOLUME_IDS as id (id)}
      <label class="volume">
        <span class="volume-name">{VOLUME_LABEL[id]}</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={$uiSettings.volumes[id]}
          oninput={(e) => setVolume(id, Number(e.currentTarget.value))}
        />
        <span class="volume-value">{Math.round($uiSettings.volumes[id] * 100)}%</span>
      </label>
    {/each}
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
  .confirm {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px solid color-mix(in srgb, var(--c-warning) 45%, transparent);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--c-warning) var(--tint-weak), var(--c-surface));
  }
  .what {
    margin: 0;
    font-size: var(--text-sm);
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
  .volume {
    display: grid;
    grid-template-columns: 7rem 1fr 3rem;
    gap: var(--space-2);
    align-items: center;
    min-height: var(--tap-min);
    font-size: var(--text-sm);
  }
  .volume-name {
    color: var(--c-text-muted);
  }
  .volume-value {
    text-align: right;
    color: var(--c-text-faint);
  }
  .volume input {
    accent-color: var(--c-accent);
    width: 100%;
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
