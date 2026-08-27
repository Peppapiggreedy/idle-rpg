<script lang="ts">
  // Панель действий: кнопки умений с заливкой кулдауна и хоткеями 1 / 2 / 3.
  //
  // Живёт рядом со сценой и видна ВСЕГДА, в любом разделе, и это не украшение:
  // здесь единственный на всю игру глобальный слушатель клавиатуры. Спрячь её
  // в неактивную вкладку — Svelte размонтирует компонент, и хоткеи умрут
  // по всей игре. Настройки автокаста живут отдельно, в разделе «Развитие».
  import {
    abilitiesByPriority,
    abilityStatus,
    expectedAbilityDamage,
    formatNumber,
    type AbilityDef,
  } from '../game'
  import { GCD_MS } from '../data/balance'
  import { activateAbility, gameState } from '../stores/game'
  import { ABILITY_REASON_TEXT } from './abilityText'
  import { NumberText, Tooltip } from './kit'
  import { Icon } from './icons'

  // Порядок кнопок = порядок приоритета: слева то, что автокаст жмёт первым.
  const ordered = $derived(abilitiesByPriority($gameState.abilitySettings, false))
  const statuses = $derived(ordered.map((a) => abilityStatus($gameState, a)))

  // Хоткеи 1 / 2 / 3 по порядку умений.
  function hotkey(index: number): string {
    return String(index + 1)
  }

  function onKey(event: KeyboardEvent) {
    // Не перехватываем набор текста в полях ввода (импорт сейва).
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const index = ordered.findIndex((_, i) => event.key === hotkey(i))
    if (index === -1) return
    event.preventDefault()
    activateAbility(ordered[index].id)
  }

  function tooltip(ability: AbilityDef, index: number): string {
    const status = statuses[index]
    const parts = [
      `${ability.name} (${hotkey(index)})`,
      `${formatNumber(ability.manaCost)} маны · кулдаун ${ability.cooldownSec}с`,
      `Урон: ${Math.round(ability.weaponDamagePercent.toNumber() * 100)}% удара оружия ≈ ${formatNumber(expectedAbilityDamage($gameState.stats, ability.weaponDamagePercent))}`,
      ability.type === 'onNextSwing'
        ? 'Заменяет следующую автоатаку; мана спишется в момент удара. Нажми ещё раз — снимется.'
        : 'Бьёт сразу, тратит общую задержку. Замах автоатаки не сбивает.',
    ]
    if (ability.effect) {
      parts.push(
        `Затем ${ability.effect.ticks} раз по ${Math.round(ability.effect.weaponDamagePercent.toNumber() * 100)}% каждые ${ability.effect.tickIntervalSec}с`,
      )
    }
    if (status.queued) parts.push('В очереди на следующий замах — нажми, чтобы снять')
    else if (status.reason) parts.push(ABILITY_REASON_TEXT[status.reason])
    return parts.join('\n')
  }

  const seconds = (ms: number) => (ms / 1000).toFixed(1)

  // Общая задержка — ОТДЕЛЬНАЯ полоска, а не часть заливки кулдауна:
  // она короче и общая на все умения, и слитая с кулдауном шкала врала бы
  // про то, когда именно умение освободится.
  const gcdFraction = $derived(GCD_MS > 0 ? Math.max(0, $gameState.gcdMsLeft) / GCD_MS : 0)
</script>

<svelte:window onkeydown={onKey} />

<div class="bar" role="group" aria-label="Умения">
  {#each ordered as ability, i (ability.id)}
    {@const status = statuses[i]}
    <Tooltip text={tooltip(ability, i)} block width="wide">
      <button
        type="button"
        class="ability"
        class:queued={status.queued}
        class:blocked={!status.usable}
        disabled={!status.usable}
        onclick={() => activateAbility(ability.id)}
      >
        <span class="fill" style="height: {Math.min(100, status.cooldownFraction * 100)}%"></span>
        {#if ability.triggersGcd && gcdFraction > 0 && status.cooldownMsLeft <= 0}
          <span class="gcd" style="width: {gcdFraction * 100}%"></span>
        {/if}
        <span class="key">{hotkey(i)}</span>
        <Icon name={ability.icon} size="lg" />
        <span class="name">{ability.name}</span>
        <span class="cost"><NumberText value={ability.manaCost} tone="mana" size="sm" /> маны</span>
        {#if status.cooldownMsLeft > 0}
          <span class="timer">{seconds(status.cooldownMsLeft)}с</span>
        {:else if status.queued}
          <span class="timer">в очереди</span>
        {:else if status.reason}
          <span class="timer reason">{ABILITY_REASON_TEXT[status.reason]}</span>
        {:else}
          <span class="timer ready">готово</span>
        {/if}
      </button>
    </Tooltip>
  {/each}
</div>

<style>
  .bar {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
  }
  /* Кнопка умения — не примитив Button: у неё заливка кулдауна под текстом
     и четыре строки внутри. Цвета и отступы всё равно из токенов. */
  .ability {
    position: relative;
    overflow: hidden;
    isolation: isolate;
    width: 100%;
    font: inherit;
    color: inherit;
    background: var(--c-surface-sunken);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-md);
    padding: var(--space-2);
    /* Заметно выше --tap-min: под кнопкой умения помещаются имя, стоимость
       и кулдаун, и промахнуться по ней в бою нельзя. */
    min-height: 4.5rem;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    text-align: center;
    transition: border-color var(--dur-fast) ease;
  }
  .ability:hover:not(:disabled) {
    border-color: var(--c-xp);
  }
  .ability:disabled {
    cursor: not-allowed;
  }
  .ability.blocked {
    opacity: 0.55;
  }
  .ability.queued {
    border-color: var(--c-xp);
    box-shadow: inset 0 0 var(--space-2) color-mix(in srgb, var(--c-xp) var(--tint-strong), transparent);
  }
  /* Общая задержка: тонкая полоска у нижнего края, отдельным цветом.
     Показывается, только когда СВОЙ кулдаун уже вышел, — иначе игрок видел
     бы две шкалы и не понимал, какая из них его держит. */
  .gcd {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    background: var(--c-xp);
    z-index: 1;
  }
  /* Заливка кулдауна: растёт снизу, под текстом. */
  .fill {
    position: absolute;
    inset: auto 0 0 0;
    background: color-mix(in srgb, var(--c-xp) var(--tint), transparent);
    z-index: -1;
    transition: height var(--dur-tick) linear;
  }
  .key {
    position: absolute;
    top: var(--space-1);
    left: var(--space-1);
    font-size: var(--text-2xs);
    color: var(--c-text-faint);
  }
  .name {
    font-weight: var(--weight-bold);
    font-size: var(--text-sm);
  }
  .cost {
    font-size: var(--text-xs);
    color: var(--c-mana);
  }
  .timer {
    font-size: var(--text-2xs);
    color: var(--c-text-muted);
  }
  .timer.reason {
    color: var(--c-text-faint);
  }
  .timer.ready {
    color: var(--c-accent);
  }
</style>
