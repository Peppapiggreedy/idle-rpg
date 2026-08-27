<script lang="ts">
  import { estimateCombatRate, formatNumber } from '../game'
  import { gameState } from '../stores/game'
  import { ABILITY_BY_ID } from '../data/abilities'
  import { NumberText, Panel, StatBar, Tooltip, rarityName } from './kit'
  import type { CombatEvent } from '../types'

  // Весь текст боевого лога живёт здесь: логика отдаёт только события.
  function eventText(e: CombatEvent): string {
    switch (e.type) {
      case 'hit':
        return e.isCrit
          ? `КРИТ! ${formatNumber(e.damage)} урона`
          : `Удар: ${formatNumber(e.damage)} урона`
      case 'ability': {
        const name = ABILITY_BY_ID[e.abilityId]?.name ?? 'Умение'
        return e.isCrit
          ? `КРИТ! ${name}: ${formatNumber(e.damage)} урона`
          : `${name}: ${formatNumber(e.damage)} урона`
      }
      case 'effect':
        return `${ABILITY_BY_ID[e.abilityId]?.name ?? 'Эффект'} жжёт: ${formatNumber(e.damage)} урона`
      case 'kill':
        return `${e.monsterName} повержен! +${formatNumber(e.gold)} золота, +${formatNumber(e.xp)} опыта`
      case 'levelup':
        return `Новый уровень: ${formatNumber(e.level)}!`
      case 'loot':
        return `Выпало: ${e.item.name} [${rarityName(e.item.rarity)}]`
      case 'spawn':
        return `Появился ${e.monsterName}`
      case 'hurt':
        return `${e.monsterName} бьёт: −${formatNumber(e.damage)} здоровья`
      case 'death':
        return 'Ты пал в бою! Воскрешение через 30 с…'
      case 'revive':
        return 'Ты воскрес — полный запас сил'
      case 'zone':
        return e.reason === 'travel'
          ? `Ты отправился в зону «${e.zoneName}»`
          : `Тебя отбросило в зону «${e.zoneName}»`
      case 'boss':
        return `Босс ${e.index} из ${e.total}: ${e.bossName}`
      case 'enrage':
        return `Ярость! ${e.bossName} бьёт на ${Math.round((e.multiplier - 1) * 100)}% сильнее`
      case 'dungeon-exit':
        return e.defeated ? 'Тебя вынесли из данжа — цепочка сброшена' : 'Ты вышел из данжа'
      case 'dungeon-clear':
        return e.firstClear
          ? `«${e.dungeonName}» пройден впервые! Достижение: +5% опыта навсегда`
          : `«${e.dungeonName}» пройден`
    }
  }

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

</script>

<Panel title={$gameState.monster.name} subtitle="{$gameState.monster.level} уровень">
  {#snippet header()}
    <div class="totals">
      <div class="stat">
        <span class="label">Золото</span>
        <NumberText value={$gameState.gold} tone="gold" size="xl" />
      </div>
      <div class="stat">
        <span class="label">Сила атаки</span>
        <NumberText value={$gameState.stats.attackPower} size="xl" />
      </div>
    </div>
  {/snippet}

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

  <div class="dps">
    <span class="label">Урон в секунду</span>
    <span class="dps-values">
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
        <span class="manual">
          сейчас <NumberText value={manualRate.damagePerSecond} tone="xp" bold />
        </span>
      </Tooltip>
    </span>
    {#if attentionGain > 0}
      <span class="attention">внимание даёт +{attentionGain}%</span>
    {/if}
  </div>

  <ul class="log">
    {#each $gameState.combatLog as event}
      <li
        class:crit={event.type === 'hit' && event.isCrit}
        class:hurt={event.type === 'hurt' || event.type === 'death'}
      >
        {eventText(event)}
      </li>
    {/each}
  </ul>
</Panel>

<style>
  .totals {
    display: flex;
    gap: var(--space-5);
    flex-wrap: wrap;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .label {
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }

  .dps {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
    font-size: var(--text-sm);
  }
  .dps-values {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-1);
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

  .log {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
    /* Высота под восемь строк лога: без неё панель прыгает, пока лог копится. */
    min-height: calc(8 * var(--leading-normal) * var(--text-sm));
  }
  .log li {
    color: var(--c-text-muted);
  }
  .log li:first-child {
    color: var(--c-text);
  }
  .log li.crit {
    color: var(--c-gold);
    font-weight: var(--weight-bold);
  }
  .log li.hurt {
    color: var(--c-damage);
  }
</style>
