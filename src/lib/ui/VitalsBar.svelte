<script lang="ts">
  // Одна компактная строка постоянной зоны: уровень и три полоски с числами.
  //
  // Больше в постоянной зоне нет ничего, и это правило, а не экономия места.
  // Всё остальное про героя — характеристики, экипировка, лог — живёт за
  // кнопками выдвижек: их открывают, когда спросили, а бой идёт всегда.
  import { formatNumber } from '../game'
  import { LEVEL_CAP, REVIVE_DELAY_MS } from '../data/balance'
  import { classById } from '../data/classes'
  import { restProgress } from '../game/rest'
  import { gameState, interruptRest } from '../stores/game'
  import { resourceWords } from './resource'
  import { Button, StatBar } from './kit'

  const hero = $derived(classById($gameState.classId))
  const resource = $derived(resourceWords($gameState.classId))
  const atCap = $derived($gameState.level.gte(LEVEL_CAP))

  const pair = (a: unknown, b: unknown) => `${a} / ${b}`
</script>

<div class="vitals">
  <div class="who">
    <span class="klass">{hero.name}</span>
    <span class="level">{formatNumber($gameState.level)}</span>
  </div>

  {#if $gameState.heroState === 'resting'}
    <div class="bars">
      <StatBar
        value={restProgress($gameState)}
        max={1}
        tone="hp"
        size="sm"
        label="Привал"
        valueLabel="{Math.ceil($gameState.restMsLeft / 1000)} с"
      />
    </div>
    <Button size="sm" onclick={interruptRest}>Прервать</Button>
  {:else if $gameState.heroState === 'dead'}
    <div class="bars">
      <StatBar
        value={REVIVE_DELAY_MS - $gameState.reviveMsLeft}
        max={REVIVE_DELAY_MS}
        tone="neutral"
        size="sm"
        label="Воскрешение"
        valueLabel="{Math.ceil($gameState.reviveMsLeft / 1000)} с"
      />
    </div>
  {:else}
    <div class="bars">
      <StatBar
        value={$gameState.currentHp.toNumber()}
        max={$gameState.stats.maxHp.toNumber()}
        tone="hp"
        size="sm"
        label="Здоровье"
        valueLabel={pair(
          formatNumber($gameState.currentHp),
          formatNumber($gameState.stats.maxHp),
        )}
      />
      <StatBar
        value={$gameState.currentMana.toNumber()}
        max={$gameState.stats.maxMana.toNumber()}
        tone="mana"
        size="sm"
        label={resource.name}
        valueLabel={pair(
          formatNumber($gameState.currentMana),
          formatNumber($gameState.stats.maxMana),
        )}
      />
      <!-- На потолке полоска опыта врала бы: она копилась бы до конца и
           замирала. Вместо неё — прямая строка о том, что уровень последний. -->
      {#if atCap}
        <p class="capped">Максимальный уровень</p>
      {:else}
        <StatBar
          value={$gameState.currentXp.toNumber()}
          max={$gameState.xpToNext.toNumber()}
          tone="xp"
          size="sm"
          label="Опыт"
          valueLabel={pair(
            formatNumber($gameState.currentXp),
            formatNumber($gameState.xpToNext),
          )}
        />
      {/if}
    </div>
  {/if}
</div>

<style>
  .vitals {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    min-width: 0;
  }
  .who {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    flex: none;
  }
  .klass {
    font-size: var(--text-2xs);
    color: var(--c-text-faint);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    white-space: nowrap;
  }
  .level {
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
    line-height: var(--leading-tight);
    font-variant-numeric: tabular-nums;
    color: var(--c-xp);
  }
  .bars {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-1);
    flex: 1;
    min-width: 0;
  }
  .capped {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--c-xp);
  }

  @media (min-width: 720px) {
    /* На широком экране три полоски встают в ряд: строка остаётся одной
       строкой, а не колонкой на треть высоты сцены. */
    .bars {
      grid-template-columns: repeat(3, 1fr);
      gap: var(--space-3);
      align-items: center;
    }
  }
</style>
