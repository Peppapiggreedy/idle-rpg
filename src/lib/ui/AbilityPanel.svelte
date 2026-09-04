<script lang="ts">
  // Настройки умений: что автокаст жмёт сам и в каком порядке.
  // Сами КНОПКИ умений живут в ActionBar рядом со сценой — они нужны в бою,
  // а бой идёт в любом разделе. Здесь только то, что настраивают редко.
  import { abilitiesByPriority, rotationOf, abilityStatus, formatNumber } from '../game'
  import { ABILITY_BY_ID, type AbilityDef } from '../data/abilities'
  import { AUTOCAST_DELAY_MS, REGEN_DELAY_S, RESERVE_PRESETS } from '../data/balance'
  import {
    gameState,
    moveAbilityPriority,
    setAbilityAutocast,
    setAbilityReserve,
    setHoldManaForHeal,
  } from '../stores/game'
  import { abilityLines, abilityReasonText } from './abilityText'
  import { resourceWords } from './resource'
  import { Button, NumberText, Panel, Tag } from './kit'
  import AbilityBook from './AbilityBook.svelte'

  // Ресурс называется так, как у класса: у изувера умения стоят ярость.
  const resource = $derived(resourceWords($gameState.classId))

  // Одна сборка на всю игру: та же, что в книге и в подсказке кнопки.
  const describe = (ability: AbilityDef) =>
    abilityLines(ability, {
      resource,
      stats: $gameState.stats,
      comboName: ability.combo
        ? (ABILITY_BY_ID[ability.combo.needsAbilityId]?.name ?? '?')
        : undefined,
    })

  // Порядок в списке = порядок приоритета: сверху то, что автокаст жмёт первым.
  const ordered = $derived(abilitiesByPriority(rotationOf($gameState), false))
  const statuses = $derived(ordered.map((a) => abilityStatus($gameState, a)))
  // Есть ли у класса лечение — от этого зависит, показывать ли резерв под него.
  const healAbility = $derived(ordered.find((a) => a.heal) ?? null)

  // ОБЩИЙ ВЫКЛЮЧАТЕЛЬ — ОДНА СТРОКА ВНУТРИ НАСТРОЕК, а не отдельная кнопка
  // на экране. Кнопка в ряду действий теперь ОТКРЫВАЕТ эти настройки;
  // включать и выключать ротацию целиком — их первая строка. Своего
  // состояния она не заводит: жмёт те же галки тем же экшеном, все разом.
  const autocastOn = $derived(
    ordered.some((a) => $gameState.abilitySettings[a.id]?.autocast ?? false),
  )
  function toggleAll(): void {
    const next = !autocastOn
    for (const ability of ordered) setAbilityAutocast(ability.id, next)
  }
</script>

<!-- КНИГА ПЕРВОЙ, НАСТРОЙКИ ВТОРЫМИ. Сперва решают, ЧЕМ играть, и только
     потом — что из этого игра жмёт сама. Обратный порядок заставлял бы
     настраивать автокаст на умения, которые ещё не выбраны. -->
<AbilityBook />

<Panel title="Автокаст" subtitle="что игра жмёт сама, в каком порядке и сколько бережёт">
  <div class="master" data-autocast-master>
    <span class="master-state" class:on={autocastOn}>
      Автокаст {autocastOn ? 'включён' : 'выключен'}
    </span>
    <Button size="sm" variant={autocastOn ? 'ghost' : 'primary'} onclick={toggleAll}>
      {autocastOn ? 'Выключить все' : 'Включить все'}
    </Button>
  </div>

  <ul class="list">
    {#each ordered as ability, i (ability.id)}
      {@const status = statuses[i]}
      <li>
        <div class="head">
          <span class="order">{i + 1}.</span>
          <span class="name">{ability.name}</span>
          <Tag tone="xp" label="{formatNumber(ability.manaCost)} {resource.genitive}" />
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
        <!-- ОПИСАНИЕ — ОБЩЕЙ СБОРКОЙ. Здесь была одна из трёх независимых
             формулировок, и знала она четыре поля из шестнадцати. -->
        <p class="effect">{describe(ability).join(' · ')}</p>
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
            <span class="label">Беречь {resource.accusative}:</span>
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
          <p class="reason">
            Сейчас недоступно: {abilityReasonText(status.reason, resource, ability.unlockLevel)}
          </p>
        {/if}
      </li>
    {/each}
  </ul>

  {#snippet footer()}
    {#if healAbility}
      <label class="auto hold">
        <input
          type="checkbox"
          checked={$gameState.holdManaForHeal}
          onchange={(e) => setHoldManaForHeal(e.currentTarget.checked)}
        />
        Беречь {resource.accusative} на «{healAbility.name}»: боевые умения автокаста
        оставляют {formatNumber(healAbility.manaCost)} {resource.genitive} про запас
      </label>
    {/if}
    <p class="hint">
      Автокаст жмёт первое доступное сверху вниз, но реагирует на
      {(AUTOCAST_DELAY_MS / 1000).toFixed(1)}с медленнее тебя и не придерживает кулдауны.
      Сами кнопки умений — рядом, в ряду действий: они видны при любом
      открытом меню.
    </p>
    <p class="hint">
      {#if resource.fromCombat}
        Ярость копится от ударов и тает вне боя: копить её впрок не выйдет.
      {:else}
        Мана не восстанавливается {REGEN_DELAY_S}с после каждой траты.
      {/if}
      Резерв — это выбор: нулевой даёт больше урона сейчас, высокий оставляет
      окна и умение, готовое к нужному моменту.
    </p>
  {/snippet}
</Panel>

<style>
  /* Общий выключатель — первая строка настроек, отделённая от списка
     умений чертой: он про ротацию целиком, а ниже — про каждое умение. */
  .master {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding-bottom: var(--space-2);
    margin-bottom: var(--space-3);
    border-bottom: 1px solid var(--c-border);
  }
  .master-state {
    font-weight: var(--weight-bold);
    color: var(--c-text-muted);
  }
  .master-state.on {
    color: var(--c-accent);
  }
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
  .reason,
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--c-text-muted);
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
