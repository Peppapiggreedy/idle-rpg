<script lang="ts">
  // КАРТА-ПУТЬ вместо списков и вкладок.
  //
  // Что было не так. Зоны были сложены вкладками ПО ДЕСЯТКАМ УРОВНЯ ВХОДА, а
  // полосы мобов идут по пять — и во вкладке «Уровни 1–10» лежали зоны с
  // мобами 1–5, 6–10, 11–15 и 16–20. Группировка не просто неудобная, она
  // НЕВЕРНАЯ: она обещала связь, которой нет.
  //
  // Что вместо. Двадцать узлов подряд, от первой полосы к последней, одной
  // линией. Порядок берётся ИЗ ДАННЫХ — по нижнему краю полосы мобов, — и
  // отдельного списка нигде не лежит: добавили зону в data/zones.ts, узел
  // появился сам, на своём месте.
  import { forecastAllZones, isZoneUnlocked, type ZoneForecast } from '../game'
  import { combatKey, createMemo } from './memo'
  import { ZONES } from '../data/zones'
  import { ALL_DUNGEONS, dungeonOpening } from '../data/dungeons'
  import { TEMPLES } from '../data/temple'
  import { gameState } from '../stores/game'
  import { NumberText } from './kit'
  import { Icon } from './icons'

  interface Props {
    selectedId: string
    onselect: (zoneId: string) => void
  }
  let { selectedId, onselect }: Props = $props()

  // ВТОРОЙ полный прогон прогноза на том же экране: карта считала его сама,
  // рядом с панелью зон. Оба — по всем мобам всех двадцати зон, оба каждый
  // тик. Мемо (см. ui/memo.ts) оставляет от них по одному пересчёту на
  // изменение входов.
  const forecastMemo = createMemo<Map<string, ZoneForecast>>()
  const forecasts = $derived(
    forecastMemo(combatKey($gameState), () =>
      new Map(forecastAllZones($gameState).map((f) => [f.zoneId, f])),
    ),
  )
  const heroLevel = $derived($gameState.level.toNumber())

  // Порядок пути — по полосе мобов, а не по порядку записи в файле.
  const path = $derived(
    [...ZONES].sort((a, b) => a.monsterLevelRange.min - b.monsterLevelRange.min),
  )

  // Отметки входов: данж и храм принадлежат зоне, а не отдельному списку.
  // Собираются обходом ВСЕХ инстансов — новый инстанс появится на карте сам.
  const marksByZone = $derived.by(() => {
    const map = new Map<string, { dungeons: number; temples: number }>()
    const bump = (zoneId: string, key: 'dungeons' | 'temples') => {
      const entry = map.get(zoneId) ?? { dungeons: 0, temples: 0 }
      entry[key] += 1
      map.set(zoneId, entry)
    }
    for (const d of ALL_DUNGEONS) if (d.difficulty === 'normal') bump(d.zoneId, 'dungeons')
    for (const t of TEMPLES) bump(t.zoneId, 'temples')
    return map
  })

  type NodeState = 'passed' | 'open' | 'locked'
  function nodeState(zone: (typeof ZONES)[number]): NodeState {
    if (!isZoneUnlocked($gameState, zone)) return 'locked'
    // «Пройдено» — герой перерос ВСЮ полосу: даже её верхний моб ниже него.
    return heroLevel > zone.monsterLevelRange.max ? 'passed' : 'open'
  }

  /** Чем открывается закрытая зона: именем данжа. */
  function lockReason(zoneId: string): string {
    const opener = dungeonOpening(zoneId)
    return opener ? `пройди «${opener.name}»` : 'закрыта'
  }

  /** Доля опыта словами: она решает, есть ли смысл сюда идти. */
  function xpLabel(f: ZoneForecast): string {
    if (f.xpShare >= 1) return 'опыт полный'
    if (f.xpShare > 0) return 'опыт ½'
    return 'опыта нет'
  }

  // Текущая зона должна быть видна СРАЗУ: карта на двадцать узлов шире
  // экрана, и открывать её на первом узле значило бы прятать героя.
  let scroller = $state<HTMLElement | null>(null)
  let scrolled = false
  $effect(() => {
    if (!scroller || scrolled) return
    const here = scroller.querySelector<HTMLElement>('[data-here="true"]')
    if (!here) return
    scroller.scrollLeft = here.offsetLeft - scroller.clientWidth / 2 + here.clientWidth / 2
    scrolled = true
  })
</script>

<div class="map" bind:this={scroller} role="list" aria-label="Карта пути">
  {#each path as zone (zone.id)}
    {@const f = forecasts.get(zone.id)}
    {@const state = nodeState(zone)}
    {@const marks = marksByZone.get(zone.id)}
    {@const here = zone.id === $gameState.currentZoneId}
    <div class="step" role="listitem">
      <button
        type="button"
        class="node {state}"
        class:here
        class:selected={zone.id === selectedId}
        data-here={here}
        aria-current={here ? 'location' : undefined}
        onclick={() => onselect(zone.id)}
      >
        <span class="band">{zone.monsterLevelRange.min}–{zone.monsterLevelRange.max}</span>
        <span class="title"><Icon name={zone.icon} /><span class="name">{zone.name}</span></span>
        {#if state === 'locked'}
          <!-- ЧТО ИМЕННО ОТКРОЕТ ЗОНУ. Раньше здесь стоял уровень, и «с 58
               уровня» ничего не говорило игроку о том, что делать. Данж —
               говорит: это место, куда можно пойти прямо сейчас. -->
          <span class="need">{lockReason(zone.id)}</span>
        {:else if f}
          <!-- ВЕРДИКТА («по силам» / «смерть») ЗДЕСЬ НЕТ НАМЕРЕННО: игра
               называет, что сделать нельзя (замок выше), и молчит о том,
               чем кончится попытка. На узле — только факты: полоса, доля
               опыта, золото в час. -->
          <span class="xp" class:none={f.xpShare <= 0}>{xpLabel(f)}</span>
          <span class="gold"><NumberText value={f.goldPerHour} tone="gold" />/ч</span>
        {/if}
        {#if marks}
          <span class="marks">
            {#if marks.dungeons > 0}
              <span class="mark" title="Вход в данж"><Icon name="dungeon-heroic" /></span>
            {/if}
            {#if marks.temples > 0}
              <span class="mark" title="Вход в храм"><Icon name="temple" /></span>
            {/if}
          </span>
        {/if}
        {#if here}<span class="you">ты здесь</span>{/if}
      </button>
    </div>
  {/each}
</div>

<style>
  /* Путь скроллится по горизонтали: двадцать узлов в ширину экрана не лезут
     ни при каком размере, а ломать их в сетку значило бы снова потерять
     порядок — а порядок здесь и есть содержание. */
  .map {
    display: flex;
    align-items: stretch;
    gap: 0;
    overflow-x: auto;
    padding-bottom: var(--space-2);
  }
  .step {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
  }
  /* Линия между узлами — это и есть «путь». Рисуется у самого узла, поэтому
     не зависит ни от числа зон, ни от их ширины. */
  .step + .step::before {
    content: '';
    width: var(--space-3);
    height: 2px;
    background: var(--c-border);
  }
  .node {
    /* 44px по нажатию — нижняя граница для пальца. Здесь узел заметно выше,
       но правило записано числом, чтобы его нельзя было потерять правкой. */
    min-height: 44px;
    min-width: 9.5rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    text-align: left;
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    color: var(--c-text);
    cursor: pointer;
    font: inherit;
  }
  .node:hover,
  .node:focus-visible {
    border-color: var(--c-border-strong);
  }
  .node.selected {
    border-color: var(--c-accent);
  }
  .node.here {
    box-shadow: inset 0 0 0 1px var(--c-accent);
  }
  .node.locked {
    opacity: 0.55;
  }
  .node.passed .name {
    color: var(--c-text-muted);
  }
  .band {
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
  .title {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-weight: 600;
  }
  .name {
    font-size: var(--text-sm);
  }
  .need,
  .xp,
  .gold {
    font-size: var(--text-xs);
  }
  .need {
    color: var(--c-text-faint);
  }
  .xp {
    color: var(--c-xp);
  }
  .xp.none {
    color: var(--c-text-faint);
  }
  .marks {
    display: flex;
    gap: var(--space-1);
  }
  .mark {
    color: var(--c-gold);
  }
  .you {
    font-size: var(--text-xs);
    color: var(--c-accent);
    font-weight: 600;
  }
</style>
