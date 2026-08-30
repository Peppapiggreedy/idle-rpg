<script lang="ts">
  // Боевой HUD храма: он идёт вместе с боем, поэтому висит под сценой, а не
  // во вкладке «Мир». Показывает то, чего у обычного моба нет: номер этажа,
  // личный рекорд и выход.
  import { activeTemple } from '../game'
  import { gameState, leaveTempleRun } from '../stores/game'
  import { Button, Tag } from './kit'

  const temple = $derived(activeTemple($gameState))
  const run = $derived($gameState.templeRun)
</script>

{#if temple && run}
  <div class="hud">
    <Tag tone="damage" size="md" label="{temple.name}: этаж {run.wave} из {temple.floors}" />
    <span class="best">лучшее: {$gameState.templeBestWave}</span>
    <Button size="sm" variant="danger" onclick={() => leaveTempleRun()}>Выйти из храма</Button>
    <p class="hint">Выход и смерть одинаково заканчивают забег — попытка уже потрачена.</p>
  </div>
{/if}

<style>
  .hud {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    padding: var(--space-2) var(--space-3);
    border: 1px solid color-mix(in srgb, var(--c-xp) 45%, transparent);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--c-xp) var(--tint-weak), transparent);
  }
  .best {
    font-weight: var(--weight-bold);
    font-size: var(--text-sm);
    color: var(--c-xp);
  }
  .hint {
    margin: 0;
    width: 100%;
    font-size: var(--text-xs);
    color: var(--c-text-muted);
  }
</style>
