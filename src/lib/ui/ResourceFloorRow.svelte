<script lang="ts">
  // ПОЛ РЕСУРСА В ОДНУ СТРОКУ: «не тратить ниже N %», один на класс.
  //
  // Резерв у каждого умения был и остался — он отвечает на вопрос «сколько
  // держать под ЭТУ кнопку». Пол отвечает на другой: «ниже чего автокаст не
  // тратит ВООБЩЕ», и задавать его четырьмя резервами порознь значило бы
  // четыре раза ответить на один вопрос. По образцу ползунка привала
  // (`RestRow.svelte`): тот же шаг, тот же потолок, та же прижимка к шагу в
  // экшене стора, а не в разметке.
  //
  // Руками игрок волен тратить всё: это порог автокаста, а не запрет игры.
  import { MAX_RESOURCE_FLOOR, REST_THRESHOLD_STEP, snapResourceFloor } from '../data/balance'
  import { formatNumber } from '../game'
  import { gameState, setResourceFloor } from '../stores/game'
  import { resourceWords } from './resource'

  const resource = $derived(resourceWords($gameState.classId))
  const percent = $derived(Math.round($gameState.resourceFloor * 100))
  /**
   * ПОДПИСЬ ГОВОРИТ ДЕЙСТВУЮЩЕЕ ЧИСЛО, а не процент: запас поднимают таланты,
   * и «30 %» у героя с полоской на 130 — это 39, а не 30. Считается от того
   * же `stats.maxMana`, от которого считает и сам автокаст (`passesReserve`).
   */
  const effective = $derived(formatNumber($gameState.stats.maxMana.times($gameState.resourceFloor)))
  const capacity = $derived(formatNumber($gameState.stats.maxMana))

  function onSlider(event: Event): void {
    const value = Number((event.currentTarget as HTMLInputElement).value)
    setResourceFloor(snapResourceFloor(value / 100))
  }
</script>

<div class="floor" data-resource-floor>
  <label class="label" for="resource-floor">Не тратить {resource.accusative} ниже</label>
  <input
    id="resource-floor"
    type="range"
    min="0"
    max={Math.round(MAX_RESOURCE_FLOOR * 100)}
    step={Math.round(REST_THRESHOLD_STEP * 100)}
    value={percent}
    oninput={onSlider}
    aria-valuetext={percent === 0 ? 'до дна' : `${percent} процентов`}
  />
  <b class="value">
    {#if percent === 0}до дна{:else}{percent}%{/if}
  </b>
  <span class="hint" data-resource-floor-effective>
    {#if percent === 0}
      автокаст жмёт до пустой полоски
    {:else}
      это {effective} из {capacity} {resource.genitive}
    {/if}
  </span>
</div>

<style>
  .floor {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    flex-wrap: wrap;
  }
  .label {
    flex: 0 0 auto;
    font-size: var(--text-sm);
    color: var(--c-text-muted);
    white-space: nowrap;
  }
  input {
    flex: 1 1 8rem;
    min-width: 0;
    /* Область нажатия на мобильном: ползунок обязан ловить палец. */
    min-height: var(--tap-min);
    accent-color: var(--c-accent);
  }
  .value {
    flex: 0 0 auto;
    min-width: 4.5rem;
    text-align: right;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }
  .hint {
    flex: 1 0 100%;
    font-size: var(--text-xs);
    color: var(--c-text-dim);
  }
</style>
