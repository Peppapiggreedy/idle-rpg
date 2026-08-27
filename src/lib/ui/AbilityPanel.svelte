<script lang="ts">
  // Панель умений: три кнопки с заливкой кулдауна, стоимостью маны и хоткеями.
  // Весь текст (включая причины недоступности) живёт здесь.
  import {
    ABILITIES,
    abilityStatus,
    expectedAbilityDamage,
    formatNumber,
    type AbilityBlockReason,
    type AbilityDef,
  } from '../game'
  import { activateAbility, gameState } from '../stores/game'

  const REASON_TEXT: Record<AbilityBlockReason, string> = {
    dead: 'Ты мёртв — умения недоступны',
    cooldown: 'Ещё не восстановилось',
    gcd: 'Общая задержка после прошлого умения',
    'no-mana': 'Не хватает маны',
  }

  const statuses = $derived(ABILITIES.map((a) => abilityStatus($gameState, a)))

  // Хоткеи 1 / 2 / 3 по порядку умений.
  function hotkey(index: number): string {
    return String(index + 1)
  }

  function onKey(event: KeyboardEvent) {
    // Не перехватываем набор текста в полях ввода (импорт сейва).
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const index = ABILITIES.findIndex((_, i) => event.key === hotkey(i))
    if (index === -1) return
    event.preventDefault()
    activateAbility(ABILITIES[index].id)
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
    else if (status.reason) parts.push(REASON_TEXT[status.reason])
    return parts.join('\n')
  }

  const seconds = (ms: number) => (ms / 1000).toFixed(1)
</script>

<svelte:window onkeydown={onKey} />

<section class="abilities">
  <h2>Умения</h2>
  <div class="row">
    {#each ABILITIES as ability, i (ability.id)}
      {@const status = statuses[i]}
      <button
        type="button"
        class="ability"
        class:queued={status.queued}
        class:blocked={!status.usable}
        disabled={!status.usable}
        title={tooltip(ability, i)}
        onclick={() => activateAbility(ability.id)}
      >
        <span class="fill" style="height: {Math.min(100, status.cooldownFraction * 100)}%"></span>
        <span class="key">{hotkey(i)}</span>
        <span class="name">{ability.name}</span>
        <span class="cost">{formatNumber(ability.manaCost)} маны</span>
        {#if status.cooldownMsLeft > 0}
          <span class="timer">{seconds(status.cooldownMsLeft)}с</span>
        {:else if status.queued}
          <span class="timer">в очереди</span>
        {:else if status.reason}
          <span class="timer reason">{REASON_TEXT[status.reason]}</span>
        {/if}
      </button>
    {/each}
  </div>
  {#if $gameState.gcdMsLeft > 0}
    <p class="gcd">Общая задержка: {seconds($gameState.gcdMsLeft)}с</p>
  {:else}
    <p class="gcd idle">Общая задержка свободна</p>
  {/if}
</section>

<style>
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
  }
  .row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }
  .ability {
    position: relative;
    overflow: hidden;
    isolation: isolate;
    font: inherit;
    color: inherit;
    background: transparent;
    border: 1px solid #8886;
    border-radius: 8px;
    padding: 0.55rem 0.5rem;
    min-height: 5rem;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.15rem;
    text-align: center;
  }
  .ability:hover:not(:disabled) {
    border-color: var(--color-xp);
  }
  .ability:disabled {
    cursor: not-allowed;
  }
  .ability.blocked {
    opacity: 0.55;
  }
  .ability.queued {
    border-color: var(--color-xp);
    box-shadow: inset 0 0 0.6rem color-mix(in srgb, var(--color-xp) 35%, transparent);
  }
  /* Заливка кулдауна: растёт снизу, под текстом. */
  .fill {
    position: absolute;
    inset: auto 0 0 0;
    background: color-mix(in srgb, var(--color-xp) 22%, transparent);
    z-index: -1;
    transition: height 100ms linear;
  }
  .key {
    position: absolute;
    top: 0.25rem;
    left: 0.4rem;
    font-size: 0.7rem;
    opacity: 0.5;
  }
  .name {
    font-weight: 600;
    font-size: 0.85rem;
  }
  .cost {
    font-size: 0.75rem;
    color: var(--color-xp);
  }
  .timer {
    font-size: 0.72rem;
    opacity: 0.75;
  }
  .timer.reason {
    opacity: 0.6;
  }
  .gcd {
    margin: 0.5rem 0 0;
    font-size: 0.75rem;
    opacity: 0.6;
  }
  .gcd.idle {
    opacity: 0.35;
  }
</style>
