<script lang="ts">
  // Экран данжа. Снаружи — список входов с причиной отказа; внутри — номер
  // босса в цепочке, его HP, таймер до ярости и кнопка выхода.
  // Весь текст для игрока — здесь.
  import {
    activeDungeon,
    allDungeonStatuses,
    currentBoss,
    enrageMultiplier,
    formatNumber,
    secondsToEnrage,
    type DungeonBlockReason,
    type DungeonDef,
  } from '../game'
  import { DUNGEONS } from '../data/dungeons'
  import { ZONE_BY_ID } from '../data/zones'
  import { enterDungeonRun, gameState, leaveDungeonRun } from '../stores/game'
  import { Button, Panel, StatBar, Tag } from './kit'

  const statuses = $derived(new Map(allDungeonStatuses($gameState).map((s) => [s.dungeonId, s])))
  const dungeon = $derived(activeDungeon($gameState))
  const boss = $derived(currentBoss($gameState))
  const run = $derived($gameState.dungeonRun)

  const REASON_TEXT: Record<DungeonBlockReason, (d: DungeonDef) => string> = {
    level: (d) => `Откроется с ${d.unlockRequirement} уровня`,
    'wrong-zone': (d) => `Вход из зоны «${ZONE_BY_ID[d.zoneId]?.name ?? d.zoneId}»`,
    dead: () => 'Сначала воскресни',
    'already-inside': () => 'Ты уже внутри',
  }

  const bossHpPercent = $derived(
    Math.max(
      0,
      Math.min(
        100,
        $gameState.monster.currentHp.div($gameState.monster.maxHp).times(100).toNumber(),
      ),
    ),
  )
  const enrage = $derived(boss && run ? enrageMultiplier(boss, run.fightMs) : 1)
  const toEnrage = $derived(boss && run ? secondsToEnrage(boss, run.fightMs) : 0)
</script>

{#if dungeon && boss && run}
  <Panel
    title={dungeon.name}
    subtitle="Босс {run.bossIndex + 1} из {dungeon.bosses.length}: {boss.name}"
  >
    <StatBar
      value={$gameState.monster.currentHp.toNumber()}
      max={$gameState.monster.maxHp.toNumber()}
      tone="damage"
      size="lg"
      label="Здоровье босса"
      valueLabel="{formatNumber($gameState.monster.currentHp)} / {formatNumber(
        $gameState.monster.maxHp,
      )}"
    />

    <p class="enrage" class:angry={enrage > 1}>
      {#if enrage > 1}
        Ярость ×{enrage.toFixed(1)} — следующий рывок через {toEnrage.toFixed(1)}с
      {:else}
        До ярости: {toEnrage.toFixed(1)}с
      {/if}
    </p>

    <div>
      <Button variant="danger" onclick={() => leaveDungeonRun()}>Выйти из данжа</Button>
    </div>

    {#snippet footer()}
      <p class="hint">Выход и смерть одинаково сбрасывают цепочку — лут остаётся.</p>
    {/snippet}
  </Panel>
{:else}
  <Panel title="Данжи">
    <ul>
      {#each DUNGEONS as d (d.id)}
        {@const status = statuses.get(d.id)}
        {#if status}
          <li class="entry" class:locked={!status.canEnter}>
            <div class="head">
              <span class="name">{d.name}</span>
              {#if status.cleared}<Tag tone="gold" label="пройден" />{/if}
            </div>
            <div class="facts">
              {d.bosses.length} босса подряд · вход из зоны «{ZONE_BY_ID[d.zoneId]?.name ?? d.zoneId}»
            </div>
            {#if status.canEnter}
              <Button size="sm" variant="primary" onclick={() => enterDungeonRun(d.id)}>
                Войти
              </Button>
            {:else}
              <span class="reason">{REASON_TEXT[status.reason ?? 'level'](d)}</span>
            {/if}
            {#if !status.cleared}
              <span class="reward">За первое прохождение: +5% опыта навсегда</span>
            {/if}
          </li>
        {/if}
      {/each}
    </ul>
  </Panel>
{/if}

<style>
  .enrage {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--c-text-muted);
  }
  .enrage.angry {
    color: var(--c-damage);
    font-weight: var(--weight-bold);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .entry {
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
    font-size: var(--text-sm);
  }
  .entry.locked {
    opacity: 0.55;
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }
  .name {
    font-weight: var(--weight-bold);
  }
  .facts,
  .reason {
    font-size: var(--text-xs);
    color: var(--c-text-muted);
  }
  .reward {
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
  .hint {
    margin: 0;
  }
</style>
