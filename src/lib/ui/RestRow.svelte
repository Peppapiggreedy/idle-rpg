<script lang="ts">
  // ПОРОГ ПРИВАЛА В ОДНУ СТРОКУ, в постоянной зоне рядом с полосками героя.
  //
  // Раньше это была коробка на треть экрана внутри раздела «Мир»: подпись,
  // ползунок с числом и две строки пояснений. Настройка при этом отвечает на
  // вопрос «когда мне уходить отдыхать», то есть стоит ровно рядом с
  // полоской здоровья, а не в разделе про зоны, куда за ней надо идти.
  //
  // Пояснения про «уйти можно только между боями» остались в разделе «Мир»:
  // они читаются один раз, а ползунок трогают часто.
  import { MAX_REST_THRESHOLD, REST_THRESHOLD_STEP, snapRestThreshold } from '../data/balance'
  import { restDurationMs } from '../game/rest'
  import { gameState, setRestHpThreshold } from '../stores/game'

  /**
   * ПОДПИСЬ ГОВОРИТ ДЕЙСТВУЮЩУЮ ДЛИНУ ПРИВАЛА, а не константу из данных:
   * таланты её режут, еда режет вдвое, и число из `data/balance.ts` было бы
   * неправдой ровно у того игрока, который эти таланты и вложил.
   * `restDurationMs` считает то же самое, что и сам привал.
   */
  const restSeconds = $derived(Math.round(restDurationMs($gameState) / 1000))
  const restPercent = $derived(Math.round($gameState.restHpThreshold * 100))

  /**
   * ДЕЙСТВУЮЩИЙ порог — тот, что реально считает конвейер. Таланты на порог
   * удалены (порог — настройка игрока, а не характеристика), но строка
   * осталась: конвейер по-прежнему единственный источник правды, и молчаливое
   * расхождение обязано быть видно, откуда бы оно ни взялось.
   */
  const effectiveRest = $derived(
    Math.abs($gameState.stats.restThreshold - $gameState.restHpThreshold) < 1e-9
      ? null
      : `${Math.round($gameState.stats.restThreshold * 100)}%`,
  )

  function onRestSlider(event: Event): void {
    const value = Number((event.currentTarget as HTMLInputElement).value)
    setRestHpThreshold(snapRestThreshold(value / 100))
  }
</script>

<div class="rest">
  <label class="label" for="rest-threshold">Привал ниже</label>
  <input
    id="rest-threshold"
    type="range"
    min="0"
    max={Math.round(MAX_REST_THRESHOLD * 100)}
    step={Math.round(REST_THRESHOLD_STEP * 100)}
    value={restPercent}
    oninput={onRestSlider}
    aria-valuetext={restPercent === 0 ? 'никогда' : `${restPercent} процентов`}
  />
  <b class="value">
    {#if restPercent === 0}никогда{:else}{restPercent}%{/if}
  </b>
  <span class="hint">
    {#if restPercent === 0}
      герой дерётся, пока не погибнет
    {:else}
      привал {restSeconds} с
    {/if}
    {#if effectiveRest !== null}<span class="effective"
        >&nbsp;· конвейер считает {effectiveRest}</span
      >{/if}
  </span>
</div>

<style>
  .rest {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    padding: 0 var(--space-3);
  }
  .label {
    flex: 0 0 auto;
    font-size: var(--text-xs);
    color: var(--c-text-muted);
    white-space: nowrap;
  }
  input {
    flex: 1 1 auto;
    min-width: 0;
    /* Область нажатия на мобильном: ползунок обязан ловить палец. */
    min-height: 44px;
    accent-color: var(--c-accent);
  }
  .value {
    flex: 0 0 auto;
    min-width: 4.5rem;
    text-align: right;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }
  /* Подсказка — последней и первой же уходит: на телефоне ширины на неё нет,
     а ползунок и число нужны всегда. */
  .hint {
    display: none;
    flex: 0 0 auto;
    font-size: var(--text-xs);
    color: var(--c-text-dim);
    white-space: nowrap;
  }
  .effective {
    color: var(--c-text-dim);
  }
  @media (min-width: 720px) {
    .hint {
      display: inline;
    }
  }
</style>
