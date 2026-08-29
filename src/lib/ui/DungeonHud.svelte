<script lang="ts">
  // Боевой HUD данжа: он идёт вместе с боем, поэтому висит под сценой, а не
  // во вкладке «Мир». Здоровье босса показывают сцена и боевая панель —
  // здесь то, чего у обычного моба нет: место в цепочке, ярость и выход.
  import { activeDungeon, bossFrenzyActive, currentBoss, currentBossAbility } from '../game'
  import { gameState, leaveDungeonRun } from '../stores/game'
  import { Button, Tag } from './kit'

  const dungeon = $derived(activeDungeon($gameState))
  const boss = $derived(currentBoss($gameState))
  const run = $derived($gameState.dungeonRun)
  const ability = $derived(currentBossAbility($gameState))
  const frenzy = $derived(bossFrenzyActive($gameState))

  // Что именно проверяет этот босс — текстом. В данных этого текста нет:
  // там только id способности и её числа.
  const ABILITY_TEXT: Record<string, string> = {
    'sundering-gust':
      'Смывающий порыв: раз в двенадцать секунд стряхивает наложенные эффекты ' +
      'и снимает умение с очереди',
    'last-breath-fury': 'Предсмертный раж: ниже трети здоровья бьёт заметно чаще',
    'spite-backlash': 'Злая отдача: каждая трата ресурса стоит здоровья',
  }
</script>

{#if dungeon && boss && run}
  <div class="hud">
    <Tag tone="damage" size="md" label="{dungeon.name}: босс {run.bossIndex + 1} из {dungeon.bosses.length}" />
    <span class="name">{boss.name}</span>
    {#if run.difficulty === 'heroic'}
      <Tag tone="gold" size="md" label="героика" />
    {/if}
    {#if frenzy}
      <Tag tone="damage" size="md" label="раж" />
    {/if}
    <Button size="sm" variant="danger" onclick={() => leaveDungeonRun()}>Выйти из данжа</Button>
    {#if ability}
      <p class="hint ability">{ABILITY_TEXT[ability.id] ?? ability.name}</p>
    {/if}
    <p class="hint">Выход и смерть одинаково сбрасывают цепочку — лут остаётся.</p>
  </div>
{/if}

<style>
  .hud {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    padding: var(--space-2) var(--space-3);
    border: 1px solid color-mix(in srgb, var(--c-damage) 45%, transparent);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--c-damage) var(--tint-weak), transparent);
  }
  .name {
    font-weight: var(--weight-bold);
    font-size: var(--text-sm);
  }
  .ability {
    color: var(--c-warning);
  }
  .hint {
    margin: 0;
    width: 100%;
    font-size: var(--text-2xs);
    color: var(--c-text-faint);
  }
</style>
