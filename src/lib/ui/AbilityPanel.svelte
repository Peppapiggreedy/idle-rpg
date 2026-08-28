<script lang="ts">
  // Настройки умений: что автокаст жмёт сам и в каком порядке.
  // Сами КНОПКИ умений живут в ActionBar рядом со сценой — они нужны в бою,
  // а бой идёт в любом разделе. Здесь только то, что настраивают редко.
  import {
    abilitiesByPriority,
    abilityStatus,
    expectedAbilityDamage,
    formatNumber,
  } from '../game'
  import { AUTOCAST_DELAY_MS, REGEN_DELAY_S, RESERVE_PRESETS } from '../data/balance'
  import {
    gameState,
    moveAbilityPriority,
    setAbilityAutocast,
    setAbilityReserve,
  } from '../stores/game'
  import { ABILITY_REASON_TEXT } from './abilityText'
  import { Button, NumberText, Panel, Tag } from './kit'

  // Порядок в списке = порядок приоритета: сверху то, что автокаст жмёт первым.
  const ordered = $derived(abilitiesByPriority($gameState.abilitySettings, false))
  const statuses = $derived(ordered.map((a) => abilityStatus($gameState, a)))
</script>

<Panel title="Умения" subtitle="порядок в списке — это и есть приоритет автокаста">
  <ul class="list">
    {#each ordered as ability, i (ability.id)}
      {@const status = statuses[i]}
      <li>
        <div class="head">
          <span class="order">{i + 1}.</span>
          <span class="name">{ability.name}</span>
          <Tag tone="xp" label="{formatNumber(ability.manaCost)} маны" />
          <Tag label="кулдаун {ability.cooldownSec}с" />
          <span class="arrows">
            <Button
              size="sm"
              title="Выше по приоритету"
              disabled={i === 0}
              onclick={() => moveAbilityPriority(ability.id, -1)}
            >
              ↑
            </Button>
            <Button
              size="sm"
              title="Ниже по приоритету"
              disabled={i === ordered.length - 1}
              onclick={() => moveAbilityPriority(ability.id, 1)}
            >
              ↓
            </Button>
          </span>
        </div>
        <p class="effect">
          {Math.round(ability.weaponDamagePercent.toNumber() * 100)}% удара оружия ≈
          <NumberText
            value={expectedAbilityDamage($gameState.stats, ability.weaponDamagePercent)}
          />
          {#if ability.effect}
            · затем {ability.effect.ticks} раз по
            {Math.round(ability.effect.weaponDamagePercent.toNumber() * 100)}% каждые
            {ability.effect.tickIntervalSec}с
          {/if}
        </p>
        <p class="kind">
          {ability.type === 'onNextSwing'
            ? 'Заменяет следующую автоатаку; мана спишется в момент удара.'
            : 'Бьёт сразу, тратит общую задержку. Замах автоатаки не сбивает.'}
        </p>
        <label class="auto">
          <input
            type="checkbox"
            checked={$gameState.abilitySettings[ability.id]?.autocast ?? false}
            onchange={(e) => setAbilityAutocast(ability.id, e.currentTarget.checked)}
          />
          Использовать автоматически
        </label>
        {#if ability.manaCost.gt(0)}
          {@const reserve = $gameState.abilitySettings[ability.id]?.reserve ?? 0}
          <div class="reserve">
            <span class="label">Беречь ману:</span>
            {#each RESERVE_PRESETS as preset (preset)}
              <Button
                size="sm"
                variant={reserve === preset ? 'primary' : 'ghost'}
                onclick={() => setAbilityReserve(ability.id, preset)}
              >
                {preset === 0 ? 'нет' : `${Math.round(preset * 100)}%`}
              </Button>
            {/each}
          </div>
        {/if}
        {#if status.reason}
          <p class="reason">Сейчас недоступно: {ABILITY_REASON_TEXT[status.reason]}</p>
        {/if}
      </li>
    {/each}
  </ul>

  {#snippet footer()}
    <p class="hint">
      Автокаст жмёт первое доступное сверху вниз, но реагирует на
      {(AUTOCAST_DELAY_MS / 1000).toFixed(1)}с медленнее тебя и не придерживает кулдауны.
      Сами кнопки умений — под сценой, они видны в любом разделе.
    </p>
    <p class="hint">
      Мана не восстанавливается {REGEN_DELAY_S}с после каждой траты. «Беречь ману» —
      это выбор: нулевой резерв даёт больше урона сейчас, высокий оставляет окна
      под восстановление и умение, готовое к нужному моменту.
    </p>
  {/snippet}
</Panel>

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .list li {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
  }
  .reserve {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
  }
  .reserve .label {
    font-size: var(--text-sm);
    color: var(--c-text-muted);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .order {
    color: var(--c-text-faint);
    font-size: var(--text-xs);
    min-width: 1.2em;
  }
  .name {
    font-weight: var(--weight-bold);
  }
  .arrows {
    display: flex;
    gap: var(--space-1);
    margin-left: auto;
  }
  .effect,
  .kind,
  .reason,
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--c-text-muted);
  }
  .kind {
    color: var(--c-text-faint);
  }
  .reason {
    color: var(--c-warning);
  }
  .auto {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    cursor: pointer;
    /* Область нажатия не меньше --tap-min: по галке надо попадать пальцем. */
    min-height: var(--tap-min);
  }
</style>
