<script lang="ts">
  // Текстовая боевая панель. В графическом режиме то же самое показывает
  // сцена; здесь — словами и полосками, чтобы игра оставалась полностью
  // играбельной без картинки. Занимает место сцены в текстовом режиме и при
  // ?scene=off.
  import { activeDungeon, currentBoss, estimateCombatRate, formatNumber, secondsToEnrage, enrageMultiplier } from '../game'
  import { gameState } from '../stores/game'
  import { NumberText, StatBar, Tag, Tooltip } from './kit'

  // Обе цифры честно: что герой выдаёт сам и что выйдет, если играть руками.
  const autoRate = $derived(estimateCombatRate($gameState, 'auto'))
  const manualRate = $derived(estimateCombatRate($gameState, 'manual'))
  const attentionGain = $derived(
    autoRate.damagePerSecond.lte(0)
      ? 0
      : Math.round(
          manualRate.damagePerSecond.div(autoRate.damagePerSecond).minus(1).times(100).toNumber(),
        ),
  )

  // Данж — тот же бой, только у моба есть номер в цепочке и таймер ярости.
  const dungeon = $derived(activeDungeon($gameState))
  const boss = $derived(currentBoss($gameState))
  const run = $derived($gameState.dungeonRun)
  const enrage = $derived(boss && run ? enrageMultiplier(boss, run.fightMs) : 1)
  const toEnrage = $derived(boss && run ? secondsToEnrage(boss, run.fightMs) : 0)
</script>

<div class="battle">
  <div class="head">
    <span class="name">{$gameState.monster.name}</span>
    <span class="level">{$gameState.monster.level} ур.</span>
    {#if dungeon && boss && run}
      <Tag tone="damage" label="босс {run.bossIndex + 1} из {dungeon.bosses.length}" />
    {/if}
  </div>

  <StatBar
    value={$gameState.monster.currentHp.toNumber()}
    max={$gameState.monster.maxHp.toNumber()}
    tone="damage"
    size="lg"
    label="Здоровье"
    valueLabel="{formatNumber($gameState.monster.currentHp)} / {formatNumber(
      $gameState.monster.maxHp,
    )}"
  />

  {#if boss && run}
    <p class="enrage" class:angry={enrage > 1}>
      {#if enrage > 1}
        Ярость ×{enrage.toFixed(1)} — следующий рывок через {toEnrage.toFixed(1)}с
      {:else}
        До ярости: {toEnrage.toFixed(1)}с
      {/if}
    </p>
  {/if}

  <div class="dps">
    <span class="label">Урон в секунду</span>
    <Tooltip
      text={'Столько герой выдаёт сам, автокастом: он реагирует на полсекунды позже и не придерживает кулдауны.'}
      width="wide"
    >
      <span class="auto">авто <NumberText value={autoRate.damagePerSecond} /></span>
    </Tooltip>
    <span class="sep">·</span>
    <Tooltip
      text={'Столько выходит, если жать умения самому: без задержки реакции и придерживая бурст.'}
      width="wide"
    >
      <span>сейчас <NumberText value={manualRate.damagePerSecond} tone="xp" bold /></span>
    </Tooltip>
    {#if attentionGain > 0}
      <span class="attention">внимание даёт +{attentionGain}%</span>
    {/if}
  </div>
</div>

<style>
  .battle {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-lg);
    background: var(--c-surface);
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .name {
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
    line-height: var(--leading-tight);
  }
  .level {
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
  .enrage {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--c-text-muted);
  }
  .enrage.angry {
    color: var(--c-damage);
    font-weight: var(--weight-bold);
  }
  .dps {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
    font-size: var(--text-sm);
  }
  .label {
    color: var(--c-text-faint);
    font-size: var(--text-xs);
  }
  .auto {
    color: var(--c-text-muted);
  }
  .sep {
    color: var(--c-text-faint);
  }
  .attention {
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
</style>
