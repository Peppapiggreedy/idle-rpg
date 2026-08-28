<script lang="ts">
  import { formatNumber } from '../game'
  import { REGEN_TICK_S, REVIVE_DELAY_MS } from '../data/balance'
  import { restProgress } from '../game/rest'
  import { gameState, interruptRest } from '../stores/game'
  import { Button, Panel, StatBar } from './kit'

  const hp = $derived($gameState.currentHp.toNumber())
  const maxHp = $derived($gameState.stats.maxHp.toNumber())
  const mana = $derived($gameState.currentMana.toNumber())
  const maxMana = $derived($gameState.stats.maxMana.toNumber())
  const xp = $derived($gameState.currentXp.toNumber())
  const xpToNext = $derived($gameState.xpToNext.toNumber())
  // Отсчёт воскрешения идёт вниз, полоска — вверх: видно, сколько осталось.
  const revive = $derived(REVIVE_DELAY_MS - $gameState.reviveMsLeft)
  // Правило задержки регенерации без подписи выглядит как поломка: мана стоит
  // на месте, и непонятно почему. Поэтому состояние всегда на экране.
  const regenWaitSec = $derived(Math.ceil($gameState.regenDelayMsLeft / 1000))
  const regenLabel = $derived(
    $gameState.currentMana.gte($gameState.stats.maxMana)
      ? 'запас полон'
      : regenWaitSec > 0
        ? `восстановление через ${regenWaitSec} с`
        : `восстанавливается, +${formatNumber($gameState.stats.manaRegen.times(REGEN_TICK_S))} каждые ${REGEN_TICK_S} с`,
  )

  const pair = (a: unknown, b: unknown) => `${a} / ${b}`
</script>

<Panel title="Воин · Уровень {formatNumber($gameState.level)}">
  {#if $gameState.heroState === 'resting'}
    <StatBar
      value={restProgress($gameState)}
      max={1}
      tone="hp"
      size="lg"
      label="Привал"
      valueLabel="{Math.ceil($gameState.restMsLeft / 1000)} с"
    />
    <p class="resting">
      Восстанавливаешься. Прервать можно в любой момент — вернётся ровно
      столько, сколько успел отсидеть.
    </p>
    <Button size="sm" onclick={interruptRest}>Прервать привал</Button>
  {:else if $gameState.heroState === 'dead'}
    <StatBar
      value={revive}
      max={REVIVE_DELAY_MS}
      tone="neutral"
      size="lg"
      label="Воскрешение"
      valueLabel="{Math.ceil($gameState.reviveMsLeft / 1000)} с"
    />
    <p class="dead">Ты пал…</p>
  {:else}
    <StatBar
      value={hp}
      max={maxHp}
      tone="hp"
      size="lg"
      label="Здоровье"
      valueLabel={pair(formatNumber($gameState.currentHp), formatNumber($gameState.stats.maxHp))}
    />
    <StatBar
      value={mana}
      max={maxMana}
      tone="mana"
      label="Мана"
      valueLabel={pair(
        formatNumber($gameState.currentMana),
        formatNumber($gameState.stats.maxMana),
      )}
    />
    <p class="regen" class:waiting={regenWaitSec > 0}>{regenLabel}</p>
  {/if}
  <StatBar
    value={xp}
    max={xpToNext}
    tone="xp"
    size="sm"
    label="Опыт"
    valueLabel={pair(formatNumber($gameState.currentXp), formatNumber($gameState.xpToNext))}
  />
</Panel>

<style>
  .resting {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--c-text-muted);
  }
  .regen {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
  .regen.waiting {
    color: var(--c-warning);
  }
  .dead {
    margin: 0;
    color: var(--c-damage);
    font-weight: var(--weight-bold);
    font-size: var(--text-sm);
  }
</style>
