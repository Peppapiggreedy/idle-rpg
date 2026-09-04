<script lang="ts">
  // Текстовая боевая панель. В графическом режиме то же самое показывает
  // сцена; здесь — словами и полосками, чтобы игра оставалась полностью
  // играбельной без картинки. Занимает место сцены в текстовом режиме и при
  // ?scene=off.
  import { activeDungeon, currentBoss, estimateCombatRate, formatNumber, secondsToEnrage, enrageMultiplier } from '../game'
  import { gameState } from '../stores/game'
  import { NumberText, StatBar, Tag, Tooltip } from './kit'

  interface Props {
    /**
     * СТРОКА-СВОДКА вместо сцены. На телефоне открытое меню занимает экран
     * целиком, и уменьшать сцену там некуда: угол шириной в треть узкого
     * экрана — это уже не сцена. Вместо неё встаёт одна строка, и берётся
     * она ЗДЕСЬ ЖЕ, а не пишется второй раз: это тот же вид, что несёт
     * текстовый режим, только свёрнутый до имени, уровня и здоровья.
     */
    compact?: boolean
  }
  let { compact = false }: Props = $props()

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

<div class="battle" class:compact data-compact={compact ? '1' : undefined}>
  <div class="head">
    <span class="name">{$gameState.monster.name}</span>
    <span class="level">{$gameState.monster.level} ур.</span>
    {#if dungeon && boss && run}
      <Tag tone="damage" label="босс {run.bossIndex + 1} из {dungeon.bosses.length}" />
    {/if}
    <!-- МЕТКИ НА ЦЕЛИ ВИДНЫ. Кровотечение — не только урон, но и ЗАРЯД для
         детонатора, а ослабление объясняет, почему следующий удар мягче.
         Спрятанная метка превращает связку в тайное знание. -->
    {#if $gameState.activeEffects.length > 0}
      <Tag tone="damage" label="кровотечение" />
    {/if}
    {#if $gameState.monsterWeaken}
      <Tag label="ослаблен" />
    {/if}
  </div>

  <StatBar
    value={$gameState.monster.currentHp.toNumber()}
    max={$gameState.monster.maxHp.toNumber()}
    tone="damage"
    size="lg"
    label={compact ? '' : 'Здоровье'}
    valueLabel="{formatNumber($gameState.monster.currentHp)} / {formatNumber(
      $gameState.monster.maxHp,
    )}"
  />

  {#if boss && run && !compact}
    <p class="enrage" class:angry={enrage > 1}>
      {#if enrage > 1}
        Ярость ×{enrage.toFixed(1)} — следующий рывок через {toEnrage.toFixed(1)}с
      {:else}
        До ярости: {toEnrage.toFixed(1)}с
      {/if}
    </p>
  {/if}

  {#if !compact}
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
  {/if}
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
  /* Сводка — ОДНА СТРОКА: имя, уровень и полоска здоровья в ряд. Ни урона
     в секунду, ни таймера ярости: на них смотрят, когда смотрят на бой, а
     сводку читают краем глаза поверх открытого меню. */
  .battle.compact {
    flex-direction: row;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }
  .battle.compact .head {
    flex: 0 0 auto;
    flex-wrap: nowrap;
  }
  .battle.compact .name {
    font-size: var(--text-sm);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    max-width: 9rem;
  }
  /* Полоска занимает остаток строки. Селектор смотрит внутрь примитива,
     потому что растягивать надо именно его корень: своей обёртки у StatBar
     в этой строке нет, а лишняя схлопнула бы отступы в обычном режиме. */
  .battle.compact :global(.wrap) {
    flex: 1 1 auto;
    min-width: 0;
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
