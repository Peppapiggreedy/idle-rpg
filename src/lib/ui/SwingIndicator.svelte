<script lang="ts">
  // Ритм боя одной полосой: сколько осталось до следующего удара.
  //
  // Прогресс берётся ДОЛЕЙ из состояния (swingProgress 0..1), а не считается
  // здесь по миллисекундам. Это принципиально: доля — та же величина, что
  // хранит игра, поэтому смена оружия или haste мгновенно меняет ПОДПИСЬ,
  // но не двигает саму полосу. Игрок видит ровно то, что произойдёт: удар
  // придёт раньше или позже, а замах не сбросится и не долетит мгновенно.
  import { abilitiesByPriority } from '../game'
  import { gameState } from '../stores/game'

  const stats = $derived($gameState.stats)
  const progress = $derived(Math.max(0, Math.min(1, $gameState.swingProgress)))
  const swingTime = $derived(stats.swingTime)
  const secondsLeft = $derived(Math.max(0, swingTime * (1 - progress)))

  // Умение, поставленное в очередь на следующий замах: игрок должен видеть,
  // что следующий удар будет ЗАМЕНЁН, а не просто «что-то нажато».
  const queued = $derived(
    $gameState.queuedAbilityId
      ? abilitiesByPriority($gameState.abilitySettings, false).find(
          (a) => a.id === $gameState.queuedAbilityId,
        )
      : undefined,
  )

  // ОБЩЕЙ ЗАДЕРЖКИ ЗДЕСЬ БОЛЬШЕ НЕТ, и это не упрощение.
  //
  // Полоска замаха — про ОРУЖИЕ: когда прилетит следующая автоатака. Общая
  // задержка — про УМЕНИЯ: когда снова можно нажать кнопку. Две разные вещи
  // на одной шкале читались как одна, и игрок ждал удара, глядя на задержку.
  // ГКД теперь виден там, где он и нужен, — заливкой на самих иконках умений
  // (ui/ActionBar.svelte), тем же приёмом, что и обычный кулдаун.

  const dead = $derived($gameState.heroState === 'dead')
</script>

<div class="swing" class:queued={queued !== undefined} class:dead>
  <div class="track" role="progressbar" aria-valuemin="0" aria-valuemax="100"
       aria-valuenow={Math.round(progress * 100)} aria-label="Замах">
    <div class="fill" style="width: {progress * 100}%"></div>
  </div>
  <div class="labels">
    {#if dead}
      <span class="muted">Герой повержен</span>
    {:else if queued}
      <span class="mark">⟶ {queued.name}</span>
      <span class="muted">заменит следующий удар</span>
    {:else}
      <span class="muted">Замах</span>
    {/if}
    <span class="time">
      {secondsLeft.toFixed(1)}с из {swingTime.toFixed(2)}с
    </span>
  </div>
</div>

<style>
  .swing {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .track {
    position: relative;
    height: var(--bar-md);
    border-radius: var(--radius-pill);
    background: var(--c-surface-sunken);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--c-accent);
    border-radius: var(--radius-pill);
    /* За игровым тиком, как и остальные полоски игры. */
    transition: width var(--dur-tick) linear;
  }
  .swing.queued .fill {
    background: var(--c-xp);
  }
  .swing.dead .fill {
    background: var(--c-text-faint);
  }
  .labels {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    font-size: var(--text-xs);
  }
  .muted {
    color: var(--c-text-muted);
  }
  .mark {
    color: var(--c-xp);
    font-weight: var(--weight-bold);
  }
  .time {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    color: var(--c-text-faint);
  }
</style>
