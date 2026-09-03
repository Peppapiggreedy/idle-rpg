<script lang="ts">
  // Храм испытаний: вход и рубежи. То, что происходит ВНУТРИ забега (номер
  // волны, рекорд, выход), — в TempleHud под сценой: это часть боя и должно
  // быть видно из любого раздела.
  //
  // Весь текст здесь; логика отдаёт коды причин, номера волн и id рецептов.
  import { TEMPLE, recipeUnlockWave, templeStatus, type TempleBlockReason } from '../game'
  import { MATERIAL_BY_ID } from '../data/materials'
  import { RECIPE_BY_ID } from '../data/recipes'
  import { ZONE_BY_ID } from '../data/zones'
  import { enterTempleRun, gameState } from '../stores/game'
  import { formatNumber } from '../game'
  import { Button, Panel, Tag } from './kit'
  import { Icon } from './icons'
  import { CLOSED_RUN_WARNING } from './runText'

  const status = $derived(templeStatus($gameState))

  // Кулдауна больше нет, и кода 'cooldown' среди причин тоже: ходить в храм
  // можно сколько угодно. Фарм закрыт не запретом, а тем, что платят только
  // этажи выше рекорда.
  const REASON_TEXT: Record<TempleBlockReason, () => string> = {
    level: () => `Откроется с ${TEMPLE.unlockRequirement} уровня`,
    'wrong-zone': () => 'Сначала перейди в эту зону',
    dead: () => 'Сначала воскресни',
    'already-inside': () => 'Ты уже внутри',
  }
</script>

<!-- ЗАКРЫТО ЗНАЧИТ НЕ ВИДНО: до уровня входа панели храма нет вовсе.
     «Откроется с 70 уровня» — тот же обратный отсчёт до контента, о
     котором игрок ещё не должен знать; о том, что на семидесятом что-то
     будет, говорит лестница открытий. Код отказа `level` при этом остаётся:
     он нужен логике и тестам, просто ни один экран его больше не рисует. -->
{#if $gameState.level.gte(TEMPLE.unlockRequirement)}
<Panel title={TEMPLE.name}>
  {#snippet header()}
    <Tag tone="xp" size="md" label="рекорд: {status.bestWave} из {status.floors}" />
  {/snippet}

  <p class="facts">
    Этажи идут, пока ты жив. Заходить можно сколько угодно · вход из зоны
    «{ZONE_BY_ID[TEMPLE.zoneId]?.name ?? TEMPLE.zoneId}»
  </p>
  <!-- НАГРАДА ЗА СЛЕДУЮЩИЙ ЭТАЖ — до входа, а не после: игрок должен знать,
       ради чего идёт. Когда рекорд на потолке, вход остаётся открытым, но
       честно помечен: заходить вслепую не за чем. -->
  {#if status.nextReward}
    <p class="next">
      За следующий этаж ({status.nextReward.floor}):
      <b class="dust">+{status.nextReward.dust} пыли</b> и
      <b class="gold">+{formatNumber(status.nextReward.gold)} золота</b>.
      Платят только этажи выше рекорда — пройденное второй раз не платит.
    </p>
  {:else}
    <p class="next exhausted">
      Все {status.floors} этажей взяты — награды исчерпаны. Заходить можно,
      но платить больше нечем.
    </p>
  {/if}
  <p class="closed-run">{CLOSED_RUN_WARNING}</p>

  {#if status.canEnter}
    <Button size="sm" variant="primary" onclick={() => enterTempleRun()}>Войти</Button>
  {:else}
    <span class="reason">{REASON_TEXT[status.reason ?? 'level']()}</span>
  {/if}

  <ul>
    {#each TEMPLE.milestones as milestone (milestone.recipeId)}
      {@const open = status.bestWave >= milestone.wave}
      <li class="milestone" class:open>
        <Icon name="temple-wave" />
        <span class="text">
          Волна {milestone.wave} — рецепт «{RECIPE_BY_ID[milestone.recipeId]?.name ??
            milestone.recipeId}»
        </span>
        {#if open}
          <Tag tone="gold" label="открыт" />
        {:else}
          <span class="left">осталось {milestone.wave - status.bestWave}</span>
        {/if}
      </li>
    {/each}
    <!-- ПОЛНАЯ ЗАЧИСТКА — ТОЖЕ РУБЕЖ, и до этой ночи её не было в списке
         вовсе: рецепт «Венец испытаний» существовал в данных, реагент
         «Обетный знак» тоже, связаны они были через clearReward — и игрок
         не знал ни о том, ни о другом. Идти на двадцатый этаж было не за
         чем: игра не называла, что там. Строка называет обе половины
         награды и то, что одна нужна другой. -->
    <li class="milestone" class:open={$gameState.templeCleared}>
      <Icon name="temple-wave" />
      <span class="text">
        Все {TEMPLE.floors} этажей — «{MATERIAL_BY_ID[TEMPLE.clearReward.materialId]?.name ??
          TEMPLE.clearReward.materialId}» и рецепт «{RECIPE_BY_ID[TEMPLE.clearReward.recipeId]
          ?.name ?? TEMPLE.clearReward.recipeId}»
        <span class="sub">
          Знак нужен самому рецепту: без полной зачистки венец не собрать.
        </span>
      </span>
      {#if $gameState.templeCleared}
        <Tag tone="gold" label="взято" />
      {:else}
        <span class="left">осталось {TEMPLE.floors - status.bestWave}</span>
      {/if}
    </li>
  </ul>

  {#snippet footer()}
    <p class="hint">
      В храме нет ни привала, ни оффлайна: забег кончается смертью или выходом.
      Рубеж отпирает рецепт навсегда — собирать его можно сколько угодно раз.
    </p>
  {/snippet}
</Panel>
{/if}

<style>
  .facts,
  /* Предупреждение про закрытую вкладку: приглушённое, но читаемое —
     оно снимает страх, а не пугает. */
  .closed-run {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
  .next {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--c-text-muted);
  }
  .next.exhausted {
    color: var(--c-text-faint);
  }
  .dust {
    color: var(--c-xp);
  }
  .gold {
    color: var(--c-gold);
  }
  .reason {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--c-text-muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .milestone {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    opacity: 0.55;
  }
  .milestone.open {
    opacity: 1;
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .sub {
    display: block;
    font-size: var(--text-xs);
    color: var(--c-text-dim);
  }
  .left {
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
  .hint {
    margin: 0;
  }
</style>
