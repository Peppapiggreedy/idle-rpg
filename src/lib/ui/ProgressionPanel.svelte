<script lang="ts">
  // Лестница открытий: что уже есть и что будет дальше.
  //
  // ГЛАВНОЕ ЗДЕСЬ — ЧЕГО НЕТ В РАЗМЕТКЕ. У закрытой ступени не рендерится
  // ни название, ни описание: они не приглушены стилями и не спрятаны
  // display:none, их просто нет в DOM. Спрятанное стилями живёт до первого
  // открытия инспектора, а интрига — единственное, ради чего лестница
  // показывает будущие ступени вообще. Закреплено Playwright-тестом,
  // который ищет названия закрытых ступеней в разметке страницы.
  import { PROGRESSION } from '../data/progression'
  import { progressionGateOpen } from '../game'
  import { gameState } from '../stores/game'
  import { Panel } from './kit'
  import { levelWord } from './plural'
  import { Icon } from './icons'

  const level = $derived($gameState.level.toNumber())
  const nextStep = $derived(PROGRESSION.find((s) => s.level > level) ?? null)
  // Ступень может быть заперта не только уровнем: цепочка преквестов держит
  // врата рейда. Какую именно ступень она держит, знают ДАННЫЕ цепочки —
  // ветвления по id ступени здесь нет.
  const isOpen = (stepId: string, stepLevel: number) =>
    level >= stepLevel && progressionGateOpen($gameState, stepId)
</script>

<Panel title="Лестница открытий">
  <ul>
    {#each PROGRESSION as step (step.id)}
      {@const open = isOpen(step.id, step.level)}
      <li class="step" class:open class:next={step === nextStep}>
        <span class="level">{step.level}</span>
        {#if open}
          <Icon name={step.icon} size="lg" />
          <span class="text">
            <span class="name">{step.name}</span>
            <span class="desc">{step.description}</span>
            {#if step.placeholder}
              <span class="soon">Врата открыты — сам рейд появится следующим обновлением.</span>
            {/if}
          </span>
        {:else}
          <!-- Ни имени, ни описания: закрытая ступень в разметке немая. -->
          <span class="lock" aria-hidden="true">🔒</span>
          <span class="text">
            <span class="name unknown">???</span>
            <span class="desc">
              {#if level >= step.level}
                Нужно пройти цепочку заданий
              {:else if step === nextStep}
                Осталось {step.level - level} {levelWord(step.level - level)}
              {:else}
                Откроется на {step.level} уровне
              {/if}
            </span>
          </span>
        {/if}
      </li>
    {/each}
  </ul>

  {#snippet footer()}
    <p class="hint">
      Каждые десять уровней открывается что-то новое — данж, механика или и то,
      и другое сразу. Что именно, узнаешь, когда дойдёшь: половина интереса в
      том, чтобы не знать заранее.
    </p>
  {/snippet}
</Panel>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .step {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    opacity: 0.55;
  }
  .step.open {
    opacity: 1;
  }
  /* Ближайшая ступень выделена: это то, к чему игрок идёт прямо сейчас. */
  .step.next {
    opacity: 1;
    border-color: var(--c-accent);
    background: color-mix(in srgb, var(--c-accent) var(--tint-weak), transparent);
  }
  .level {
    flex: none;
    width: 2.5rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-bold);
    color: var(--c-xp);
  }
  .lock {
    flex: none;
    width: var(--space-6);
    text-align: center;
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    font-weight: var(--weight-bold);
  }
  .name.unknown {
    color: var(--c-text-faint);
    letter-spacing: var(--tracking-wide);
  }
  .desc {
    font-size: var(--text-xs);
    color: var(--c-text-muted);
  }
  .soon {
    font-size: var(--text-xs);
    color: var(--c-warning);
  }
  .hint {
    margin: 0;
  }
</style>
