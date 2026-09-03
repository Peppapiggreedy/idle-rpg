<script lang="ts">
  // Боевой HUD храма: он идёт вместе с боем, поэтому висит под сценой, а не
  // во вкладке «Мир». Показывает то, чего у обычного моба нет: номер этажа,
  // личный рекорд и выход.
  import { activeTemple, formatNumber, pendingTempleReward } from '../game'
  import { gameState, leaveTempleRun } from '../stores/game'
  import { Button, Tag } from './kit'

  const temple = $derived(activeTemple($gameState))
  const run = $derived($gameState.templeRun)
  /**
   * СКОЛЬКО УЖЕ ЗАРАБОТАНО ЗАБЕГОМ. Раньше HUD показывал только номер этажа,
   * и игрок, дошедший до четырнадцатого, не видел ни одной цифры за спиной —
   * а награду он получал молча, одной строкой в логе после смерти. Теперь
   * копилка на виду: это то, что он потеряет, если закроет вкладку, и то,
   * что заберёт, если выйдет сам.
   */
  const earned = $derived(run && temple ? pendingTempleReward($gameState) : null)
</script>

{#if temple && run}
  <div class="hud">
    <Tag tone="damage" size="md" label="{temple.name}: этаж {run.wave} из {temple.floors}" />
    <span class="best">лучшее: {$gameState.templeBestWave}</span>
    <Button size="sm" variant="danger" onclick={() => leaveTempleRun()}>Выйти из храма</Button>
    {#if earned && earned.floors > 0}
      <p class="earned">
        Заработано за забег: <b class="dust">+{earned.dust} пыли</b> и
        <b class="gold">+{formatNumber(earned.gold)} золота</b>
        (этажи {earned.from}–{earned.to}).
      </p>
    {:else}
      <p class="hint">
        Пока ничего не заработано: платят только этажи выше рекорда ({$gameState
          .templeBestWave}).
      </p>
    {/if}
    <!-- ЧЕСТНЫЙ ТЕКСТ. Стояло «попытка уже потрачена» — описание игры с
         ограниченным числом попыток. Их нет: кулдауна у храма нет, зайти
         можно сразу снова. Разница между выходом и закрытой вкладкой при
         этом РЕАЛЬНАЯ, и назвать её обязательно. -->
    <p class="hint">
      Выход и смерть засчитывают дошедшие этажи. Закрытая вкладка — нет:
      забег расформируется, и награды не будет.
    </p>
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
  .earned {
    margin: 0;
    width: 100%;
    font-size: var(--text-sm);
  }
  .dust {
    color: var(--c-xp);
  }
  .gold {
    color: var(--c-gold);
  }
  .hint {
    margin: 0;
    width: 100%;
    font-size: var(--text-xs);
    color: var(--c-text-muted);
  }
</style>
