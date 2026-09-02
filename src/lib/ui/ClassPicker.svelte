<script lang="ts">
  // Выбор класса при новой игре. Показывается ровно один раз: класс не
  // меняется никогда, и спрашивать о нём надо до того, как накопился
  // прогресс, а не после.
  //
  // Весь текст живёт здесь; данные отдают id, имя, иконку, одну строку
  // о том, как в класс играют, и готовность (`status`). Класс в превью
  // ВИДЕН и выбирается — но игроку честно сказано, что баланс на нём
  // не настроен: контракты игры считаются по готовому классу.
  import { CLASSES, type ClassDef } from '../data/classes'
  import { ABILITY_BY_ID } from '../data/abilities'
  import { startNewGame } from '../stores/game'
  import { resourceKindName } from './resource'
  import { Button, Panel, Tag } from './kit'
  import { Icon } from './icons'

  /** Пометка превью-класса: одна строка, без прятанья карточки. */
  const PREVIEW_LABEL = 'В разработке'
  const PREVIEW_NOTE = 'Баланс не настроен: темп, цена боя и путь до сотого уровня выверены на другом классе.'

  function abilityNames(hero: ClassDef): string {
    return hero.abilityIds.map((id) => ABILITY_BY_ID[id]?.name ?? id).join(', ')
  }
</script>

<div class="veil">
  <Panel title="С кем ты играешь">
    <p class="hint">
      Класс выбирается один раз и не меняется. Разница — в ритме: чем ты
      платишь за умения и когда. Класс с пометкой «{PREVIEW_LABEL}» играется
      целиком, но его баланс ещё не выверен.
    </p>
    <div class="grid">
      {#each CLASSES as hero (hero.id)}
        <section class="card" data-class-status={hero.status}>
          <h3>
            <Icon name={hero.icon} size="lg" />{hero.name}
            {#if hero.status === 'preview'}
              <Tag tone="warning" label={PREVIEW_LABEL} />
            {/if}
          </h3>
          <p class="tagline">{hero.tagline}</p>
          {#if hero.status === 'preview'}
            <p class="preview-note">{PREVIEW_NOTE}</p>
          {/if}
          <dl>
            <dt>Ресурс</dt>
            <dd>{resourceKindName(hero.resource.kind)}</dd>
            <dt>Умения</dt>
            <dd>{abilityNames(hero)}</dd>
          </dl>
          <Button variant="primary" block onclick={() => startNewGame(hero.id)}>
            Играть за {hero.name.toLowerCase()}а
          </Button>
        </section>
      {/each}
    </div>
  </Panel>
</div>

<style>
  .veil {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    padding: var(--space-4);
    background: var(--c-bg);
    overflow-y: auto;
  }
  .hint {
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--text-sm);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    background: var(--c-surface-raised);
  }
  h3 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--text-lg);
  }
  .tagline {
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--text-sm);
  }
  .preview-note {
    margin: 0;
    color: var(--c-warning);
    font-size: var(--text-sm);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    font-size: var(--text-sm);
  }
  dt {
    color: var(--c-text-faint);
  }
  dd {
    margin: 0;
  }
  @media (min-width: 720px) {
    .grid {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
