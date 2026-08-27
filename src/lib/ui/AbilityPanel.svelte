<script lang="ts">
  // Панель умений: три кнопки с заливкой кулдауна, стоимостью маны и хоткеями.
  // Весь текст (включая причины недоступности) живёт здесь.
  import {
    abilitiesByPriority,
    abilityStatus,
    expectedAbilityDamage,
    formatNumber,
    type AbilityBlockReason,
    type AbilityDef,
  } from '../game'
  import { AUTOCAST_DELAY_MS } from '../data/balance'
  import {
    activateAbility,
    gameState,
    moveAbilityPriority,
    setAbilityAutocast,
  } from '../stores/game'
  import { Button, NumberText, Panel, Tooltip } from './kit'

  // Порядок в панели = порядок приоритета: сверху то, что автокаст жмёт первым.
  const ordered = $derived(abilitiesByPriority($gameState.abilitySettings, false))

  const REASON_TEXT: Record<AbilityBlockReason, string> = {
    dead: 'Ты мёртв — умения недоступны',
    cooldown: 'Ещё не восстановилось',
    gcd: 'Общая задержка после прошлого умения',
    'no-mana': 'Не хватает маны',
  }

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
    else if (status.reason) parts.push(REASON_TEXT[status.reason])
    return parts.join('\n')
  }

  const seconds = (ms: number) => (ms / 1000).toFixed(1)
</script>

<svelte:window onkeydown={onKey} />

<Panel title="Умения" subtitle="порядок в списке — это и есть приоритет автокаста">
  <div class="row">
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
          <span class="key">{hotkey(i)}</span>
          <span class="name">{ability.name}</span>
          <span class="cost"><NumberText value={ability.manaCost} tone="mana" size="sm" /> маны</span>
          {#if status.cooldownMsLeft > 0}
            <span class="timer">{seconds(status.cooldownMsLeft)}с</span>
          {:else if status.queued}
            <span class="timer">в очереди</span>
          {:else if status.reason}
            <span class="timer reason">{REASON_TEXT[status.reason]}</span>
          {/if}
        </button>
      </Tooltip>
    {/each}
  </div>

  <ul class="settings">
    {#each ordered as ability, i (ability.id)}
      <li>
        <span class="order">{i + 1}.</span>
        <label>
          <input
            type="checkbox"
            checked={$gameState.abilitySettings[ability.id]?.autocast ?? false}
            onchange={(e) => setAbilityAutocast(ability.id, e.currentTarget.checked)}
          />
          {ability.name} — использовать автоматически
        </label>
        <span class="arrows">
          <Button
            size="sm"
            title="Выше по приоритету"
            disabled={i === 0}
            onclick={() => moveAbilityPriority(ability.id, -1)}
          >
            ▲
          </Button>
          <Button
            size="sm"
            title="Ниже по приоритету"
            disabled={i === ordered.length - 1}
            onclick={() => moveAbilityPriority(ability.id, 1)}
          >
            ▼
          </Button>
        </span>
      </li>
    {/each}
  </ul>

  {#snippet footer()}
    <p class="gcd">
      Автокаст жмёт первое доступное сверху вниз, но реагирует на
      {(AUTOCAST_DELAY_MS / 1000).toFixed(1)}с медленнее тебя и не придерживает кулдауны.
    </p>
    <p class="gcd" class:idle={$gameState.gcdMsLeft <= 0}>
      {#if $gameState.gcdMsLeft > 0}
        Общая задержка: {seconds($gameState.gcdMsLeft)}с
      {:else}
        Общая задержка свободна
      {/if}
    </p>
  {/snippet}
</Panel>

<style>
  .row {
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
    min-height: 5rem;
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

  .settings {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-xs);
  }
  .settings li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .settings label {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    cursor: pointer;
    flex: 1;
  }
  .settings .order {
    color: var(--c-text-faint);
    min-width: 1.2em;
  }
  .arrows {
    display: flex;
    gap: var(--space-1);
  }
  .gcd {
    margin: 0;
  }
  .gcd.idle {
    opacity: 0.6;
  }

  @media (max-width: 719px) {
    .row {
      grid-template-columns: 1fr;
    }
  }
</style>
