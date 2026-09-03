<script lang="ts">
  // Ряд действий под сценой: ОДИНАКОВЫЕ КВАДРАТНЫЕ ИКОНКИ, номер хоткея
  // в углу, заливка кулдауна поверх иконки.
  //
  // Одинаковый размер — не косметика: глаз находит нужную кнопку по месту
  // и рисунку, а разъезжающиеся по ширине подписи заставляют читать. Текст
  // ушёл в подсказку, на кнопке остались иконка, хоткей и таймер.
  //
  // В этот же ряд встают зелья: они такие же кнопки с кулдауном, и стоять
  // им положено рядом с умениями, а не в отдельном углу экрана. А вот
  // автокаст ИЗ РЯДА УБРАН (ui/AutocastButton.svelte): он не действие, а
  // переключатель того, кто действия жмёт, и место ему рядом, но не внутри.
  //
  // Бар живёт рядом со сценой и СМОНТИРОВАН ВСЕГДА, в любом разделе: здесь
  // единственный на всю игру глобальный слушатель клавиатуры. Спрячь его
  // в неактивную вкладку — Svelte размонтирует компонент, и хоткеи умрут
  // по всей игре.
  import {
    abilitiesByPriority,
    abilityStatus,
    expectedAbilityDamage,
    formatNumber,
    potionSlots,
    type AbilityDef,
    type PotionSlot,
  } from '../game'
  import { GCD_MS } from '../data/balance'
  import { activateAbility, drinkPotion, gameState } from '../stores/game'
  import { abilityReasonText } from './abilityText'
  import { potionEffectText, potionReasonText } from './potionText'
  import { resourceWords } from './resource'
  import { Tooltip } from './kit'
  import { Icon } from './icons'

  const resource = $derived(resourceWords($gameState.classId))

  // Порядок кнопок = порядок приоритета: слева то, что автокаст жмёт первым.
  const ordered = $derived(abilitiesByPriority($gameState.abilitySettings, false))
  const statuses = $derived(ordered.map((a) => abilityStatus($gameState, a)))

  const potions = $derived(potionSlots($gameState))

  // Хоткеи: умения — 1..N, зелья продолжают ТОТ ЖЕ счёт. Ряд один, значит и
  // нумерация одна; сдвигать её при появлении зелий нельзя — игрок помнит
  // клавиши пальцами.
  function hotkey(index: number): string {
    return String(index + 1)
  }
  function potionKey(index: number): string {
    return String(ordered.length + index + 1)
  }

  function onKey(event: KeyboardEvent) {
    // Не перехватываем набор текста в полях ввода (импорт сейва).
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const index = ordered.findIndex((_, i) => event.key === hotkey(i))
    if (index !== -1) {
      event.preventDefault()
      activateAbility(ordered[index].id)
      return
    }
    const potion = potions.findIndex((_, i) => event.key === potionKey(i))
    if (potion === -1) return
    event.preventDefault()
    drinkPotion(potions[potion].recipe.output.id)
  }

  function potionTooltip(slot: PotionSlot, index: number): string {
    const parts = [
      `${slot.recipe.output.name} (${potionKey(index)})`,
      `${potionEffectText(slot.recipe)} на ${Math.round(slot.recipe.output.durationSec / 60)} мин`,
      `Склянок в мешке: ${formatNumber(slot.count)}`,
      'Зелья пьются только руками: ни автокаст, ни оффлайн их не трогают.',
    ]
    if (slot.reason) parts.push(potionReasonText(slot.reason))
    return parts.join('\n')
  }

  function abilityTooltip(ability: AbilityDef, index: number): string {
    const status = statuses[index]
    const parts = [
      `${ability.name} (${hotkey(index)})`,
      `${formatNumber(ability.manaCost)} ${resource.genitive} · кулдаун ${ability.cooldownSec}с`,
      ability.heal
        ? `Лечит: ${Math.round(ability.heal.maxHpShare.toNumber() * 100)}% запаса ≈ ${formatNumber($gameState.stats.maxHp.times(ability.heal.maxHpShare))} здоровья. Автокаст жмёт при здоровье ниже ${Math.round(ability.heal.autocastBelowHpShare * 100)}%.`
        : `Урон: ${Math.round(ability.weaponDamagePercent.toNumber() * 100)}% удара оружия ≈ ${formatNumber(expectedAbilityDamage($gameState.stats, ability.weaponDamagePercent))}`,
      ability.type === 'onNextSwing'
        ? `Заменяет следующую автоатаку; ${resource.genitive} спишется в момент удара. Нажми ещё раз — снимется.`
        : 'Бьёт сразу, тратит общую задержку. Замах автоатаки не сбивает.',
    ]
    if (ability.effect) {
      parts.push(
        `Затем ${ability.effect.ticks} раз по ${Math.round(ability.effect.weaponDamagePercent.toNumber() * 100)}% каждые ${ability.effect.tickIntervalSec}с`,
      )
    }
    if (status.queued) parts.push('В очереди на следующий замах — нажми, чтобы снять')
    else if (status.reason) {
      parts.push(abilityReasonText(status.reason, resource, ability.unlockLevel))
    }
    return parts.join('\n')
  }

  const seconds = (ms: number) => (ms / 1000).toFixed(1)

  // Общая задержка — ОТДЕЛЬНАЯ полоска, а не часть заливки кулдауна:
  // она короче и общая на все умения, и слитая с кулдауном шкала врала бы
  // про то, когда именно умение освободится.
  const gcdFraction = $derived(GCD_MS > 0 ? Math.max(0, $gameState.gcdMsLeft) / GCD_MS : 0)

</script>

<svelte:window onkeydown={onKey} />

<div class="bar" role="group" aria-label="Действия">
  {#each ordered as ability, i (ability.id)}
    {@const status = statuses[i]}
    <Tooltip text={abilityTooltip(ability, i)} width="wide">
      <button
        type="button"
        class="slot"
        class:queued={status.queued}
        class:blocked={!status.usable}
        disabled={!status.usable}
        aria-label={ability.name}
        onclick={() => activateAbility(ability.id)}
      >
        <span class="fill" style="height: {Math.min(100, status.cooldownFraction * 100)}%"></span>
        {#if ability.triggersGcd && gcdFraction > 0 && status.cooldownMsLeft <= 0}
          <span class="gcd" style="height: {Math.min(100, gcdFraction * 100)}%"></span>
        {/if}
        <span class="key">{hotkey(i)}</span>
        <Icon name={ability.icon} size="lg" />
        {#if status.cooldownMsLeft > 0}
          <span class="timer">{seconds(status.cooldownMsLeft)}</span>
        {:else if status.queued}
          <span class="timer queued-mark">▲</span>
        {:else if status.reason === 'locked'}
          <span class="timer">🔒{ability.unlockLevel}</span>
        {/if}
      </button>
    </Tooltip>
  {/each}

  <!-- Зелья — те же квадраты того же ряда. Отдельного угла экрана у них нет:
       это такое же действие, только его нельзя автоматизировать. -->
  {#each potions as slot, i (slot.recipe.id)}
    <Tooltip text={potionTooltip(slot, i)} width="wide">
      <button
        type="button"
        class="slot"
        class:queued={slot.active}
        class:blocked={!slot.usable}
        disabled={!slot.usable}
        aria-label={slot.recipe.output.name}
        onclick={() => drinkPotion(slot.recipe.output.id)}
      >
        <span class="fill" style="height: {Math.min(100, slot.fraction * 100)}%"></span>
        <span class="key">{potionKey(i)}</span>
        <Icon name={slot.recipe.output.icon} size="lg" />
        {#if slot.active}
          <span class="timer queued-mark">{seconds(slot.msLeft)}</span>
        {:else}
          <span class="timer">{formatNumber(slot.count)}</span>
        {/if}
      </button>
    </Tooltip>
  {/each}

</div>

<style>
  .bar {
    display: flex;
    flex-wrap: nowrap;
    gap: var(--space-2);
    /* На узком экране ряд скроллится вбок, а не переносится и не жмёт
       иконки: размер кнопки — константа, до которой должен доставать палец. */
    overflow-x: auto;
    overscroll-behavior-x: contain;
    padding-bottom: var(--space-1);
  }
  /* Квадрат со стороной не меньше области нажатия. Размер ОДИН на все
     кнопки ряда — и на умения, и на зелья; тест меряет боксы и падает
     при расхождении. */
  .slot {
    position: relative;
    overflow: hidden;
    isolation: isolate;
    flex: none;
    width: var(--action-slot);
    height: var(--action-slot);
    font: inherit;
    color: inherit;
    background: var(--c-surface-sunken);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-md);
    padding: 0;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    transition: border-color var(--dur-fast) ease;
  }
  .slot:hover:not(:disabled) {
    border-color: var(--c-accent);
  }
  .slot:disabled {
    cursor: not-allowed;
  }
  .slot.blocked {
    opacity: 0.55;
  }
  .slot.queued {
    border-color: var(--c-xp);
    box-shadow: inset 0 0 var(--space-2) color-mix(in srgb, var(--c-xp) var(--tint-strong), transparent);
  }
  /* Общая задержка: тонкая полоска у нижнего края, отдельным цветом.
     Показывается, только когда СВОЙ кулдаун уже вышел, — иначе игрок видел
     бы две шкалы и не понимал, какая из них его держит. */
  /* ОБЩАЯ ЗАДЕРЖКА — ТАКАЯ ЖЕ ЗАЛИВКА, как у кулдауна умения, только своим
     цветом и слабее. Раньше она была тонкой полоской внизу иконки и вдобавок
     дублировалась у полоски замаха — то есть жила в двух местах и ни в одном
     не читалась как «кнопку пока нельзя». Теперь язык один: иконка залита —
     значит ждём. */
  .gcd {
    position: absolute;
    inset: auto 0 0 0;
    background: color-mix(in srgb, var(--c-xp) var(--tint-weak), transparent);
    z-index: -1;
    transition: height var(--dur-tick) linear;
  }
  /* Заливка кулдауна: растёт снизу, под иконкой. */
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
  .timer {
    position: absolute;
    bottom: var(--space-1);
    right: var(--space-1);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    color: var(--c-text-muted);
  }
  .queued-mark {
    color: var(--c-xp);
  }
</style>
