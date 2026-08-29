<script lang="ts">
  // Храм испытаний: вход и рубежи. То, что происходит ВНУТРИ забега (номер
  // волны, рекорд, выход), — в TempleHud под сценой: это часть боя и должно
  // быть видно из любого раздела.
  //
  // Весь текст здесь; логика отдаёт коды причин, номера волн и id рецептов.
  import { TEMPLE, recipeUnlockWave, templeStatus, type TempleBlockReason } from '../game'
  import { RECIPE_BY_ID } from '../data/recipes'
  import { ZONE_BY_ID } from '../data/zones'
  import { enterTempleRun, gameState } from '../stores/game'
  import { Button, Panel, Tag } from './kit'
  import { Icon } from './icons'

  // Счётчик до следующей попытки живой сам собой: стор обновляется каждым
  // тиком, и $derived пересчитывается вместе с ним. Своего setInterval здесь
  // быть не должно — таймеров в компонентах игра не заводит.
  const status = $derived(templeStatus($gameState))

  const REASON_TEXT: Record<TempleBlockReason, () => string> = {
    level: () => `Откроется с ${TEMPLE.unlockRequirement} уровня`,
    'wrong-zone': () => 'Сначала перейди в эту зону',
    dead: () => 'Сначала воскресни',
    'already-inside': () => 'Ты уже внутри',
    cooldown: () => `Следующая попытка через ${hhmm(status.msToNextAttempt)}`,
  }

  function hhmm(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 60000))
    const h = Math.floor(total / 60)
    const m = total % 60
    return h > 0 ? `${h} ч ${m} мин` : `${m} мин`
  }
</script>

<Panel title={TEMPLE.name}>
  {#snippet header()}
    <Tag tone="xp" size="md" label="рекорд: {status.bestWave} волн" />
  {/snippet}

  <p class="facts">
    Волны идут, пока ты жив. Одна попытка в сутки · вход из зоны «{ZONE_BY_ID[TEMPLE.zoneId]
      ?.name ?? TEMPLE.zoneId}»
  </p>

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
  </ul>

  {#snippet footer()}
    <p class="hint">
      В храме нет ни привала, ни оффлайна: забег кончается смертью или выходом.
      Рубеж отпирает рецепт навсегда — собирать его можно сколько угодно раз.
    </p>
  {/snippet}
</Panel>

<style>
  .facts,
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
  .left {
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
  .hint {
    margin: 0;
  }
</style>
