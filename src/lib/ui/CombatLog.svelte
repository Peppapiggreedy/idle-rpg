<script lang="ts">
  // Боевой лог компактной лентой под сценой. Виден всегда, в любом разделе:
  // это единственное место, где игрок видит, что вообще происходит в бою.
  import { formatNumber } from '../game'
  import { gameState } from '../stores/game'
  import { ABILITY_BY_ID } from '../data/abilities'
  import { rarityName } from './kit'
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
  // Тон строки: лог должен читаться боковым зрением, поэтому важное — цветом.
  function tone(e: CombatEvent): string {
    if (e.type === 'hit' && e.isCrit) return 'crit'
    if (e.type === 'hurt' || e.type === 'death') return 'hurt'
    if (e.type === 'kill') return 'kill'
    if (e.type === 'levelup' || e.type === 'dungeon-clear') return 'good'
    if (e.type === 'loot') return 'loot'
    return ''
  }
</script>

<ul class="log" aria-label="Боевой лог" aria-live="polite">
  {#each $gameState.combatLog as event}
    <li class={tone(event)}>{eventText(event)}</li>
  {/each}
</ul>

<style>
  .log {
    list-style: none;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    background: var(--c-surface-sunken);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    /* Высота под восемь строк: столько держит COMBAT_LOG_SIZE. Без резерва
       лента прыгает, пока лог наполняется, и дёргает всё под собой. */
    min-height: calc(8 * var(--leading-normal) * var(--text-xs) + 2 * var(--space-2));
    overflow: hidden;
  }
  .log li {
    color: var(--c-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
  .log li.kill {
    color: var(--c-heal);
  }
  .log li.good {
    color: var(--c-xp);
  }
  .log li.loot {
    color: var(--c-accent);
  }
</style>
