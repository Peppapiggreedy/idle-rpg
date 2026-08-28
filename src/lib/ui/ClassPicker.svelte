<script lang="ts">
  // Выбор класса при новой игре. Показывается ровно один раз: класс не
  // меняется никогда, и спрашивать о нём надо до того, как накопился
  // прогресс, а не после.
  //
  // Весь текст живёт здесь; данные отдают id, имя, иконку и одну строку
  // о том, как в класс играют.
  import { CLASSES, type ClassDef } from '../data/classes'
  import { ABILITY_BY_ID } from '../data/abilities'
  import { startNewGame } from '../stores/game'
  import { Button, Panel } from './kit'
  import { Icon } from './icons'

  // Названия ресурсов — тоже текст, поэтому здесь, а не в данных.
  const RESOURCE_NAME: Record<string, string> = { mana: 'Мана', rage: 'Ярость' }

  function abilityNames(hero: ClassDef): string {
    return hero.abilityIds.map((id) => ABILITY_BY_ID[id]?.name ?? id).join(', ')
  }
</script>

<div class="veil">
  <Panel title="С кем ты играешь">
    <p class="hint">
      Класс выбирается один раз и не меняется. Разница не в силе — оба доходят
      одинаково далеко, — а в ритме: чем ты платишь за умения и когда.
    </p>
    <div class="grid">
      {#each CLASSES as hero (hero.id)}
        <section class="card">
          <h3><Icon name={hero.icon} size="lg" />{hero.name}</h3>
          <p class="tagline">{hero.tagline}</p>
          <dl>
            <dt>Ресурс</dt>
            <dd>{RESOURCE_NAME[hero.resource.kind] ?? hero.resource.kind}</dd>
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
