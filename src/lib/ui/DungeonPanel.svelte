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

<section class="dungeon">
  {#if dungeon && boss && run}
    <h2>{dungeon.name}</h2>
    <p class="chain">
      Босс {run.bossIndex + 1} из {dungeon.bosses.length}: <strong>{boss.name}</strong>
    </p>
    <div class="hp-bar" role="progressbar" aria-valuenow={bossHpPercent} aria-valuemin="0" aria-valuemax="100">
      <div class="hp-fill" style="width: {bossHpPercent}%"></div>
    </div>
    <div class="hp-text">
      {formatNumber($gameState.monster.currentHp)} / {formatNumber($gameState.monster.maxHp)}
    </div>

    <p class="enrage" class:angry={enrage > 1}>
      {#if enrage > 1}
        Ярость ×{enrage.toFixed(1)} — следующий рывок через {toEnrage.toFixed(1)}с
      {:else}
        До ярости: {toEnrage.toFixed(1)}с
      {/if}
    </p>

    <button type="button" onclick={() => leaveDungeonRun()}>Выйти из данжа</button>
    <p class="hint">Выход и смерть одинаково сбрасывают цепочку — лут остаётся.</p>
  {:else}
    <h2>Данжи</h2>
    <ul>
      {#each DUNGEONS as d (d.id)}
        {@const status = statuses.get(d.id)}
        {#if status}
          <li class="entry" class:locked={!status.canEnter}>
            <div class="head">
              <span class="name">{d.name}</span>
              {#if status.cleared}<span class="badge">пройден</span>{/if}
            </div>
            <div class="facts">
              {d.bosses.length} босса подряд · вход из зоны «{ZONE_BY_ID[d.zoneId]?.name ?? d.zoneId}»
            </div>
            {#if status.canEnter}
              <button type="button" onclick={() => enterDungeonRun(d.id)}>Войти</button>
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
  {/if}
</section>

<style>
  h2 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
  }
  .chain {
    margin: 0 0 0.4rem;
    font-size: 0.9rem;
  }
  .hp-bar {
    height: 0.9rem;
    border-radius: 999px;
    background: #8883;
    overflow: hidden;
  }
  .hp-fill {
    height: 100%;
    background: #b71c1c;
    transition: width 100ms linear;
  }
  .hp-text {
    font-size: 0.78rem;
    opacity: 0.75;
    margin-top: 0.2rem;
  }
  .enrage {
    margin: 0.5rem 0;
    font-size: 0.85rem;
    opacity: 0.75;
  }
  .enrage.angry {
    color: #e57373;
    opacity: 1;
    font-weight: 600;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .entry {
    border: 1px solid #8884;
    border-radius: 8px;
    padding: 0.6rem 0.7rem;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
  }
  .entry.locked {
    opacity: 0.55;
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .name {
    font-weight: 600;
    font-size: 0.95rem;
  }
  .badge {
    font-size: 0.72rem;
    color: var(--color-gold);
    border: 1px solid currentColor;
    border-radius: 4px;
    padding: 0 0.3em;
  }
  .facts,
  .reason,
  .reward {
    font-size: 0.78rem;
    opacity: 0.7;
  }
  .reward {
    opacity: 0.55;
  }
  .hint {
    margin: 0.4rem 0 0;
    font-size: 0.75rem;
    opacity: 0.55;
  }
  button {
    font: inherit;
    font-size: 0.78rem;
    align-self: flex-start;
    margin-top: 0.2rem;
    padding: 0.25em 0.7em;
    border: 1px solid #8886;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  button:hover {
    border-color: var(--color-gold);
  }
</style>
