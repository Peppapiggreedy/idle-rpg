<script lang="ts">
  // Экран выбора зоны. Весь текст — здесь; логика отдаёт только числа и вердикт.
  import { formatNumber, forecastAllZones, type ZoneForecast, type ZoneVerdict } from '../game'
  import { ZONES, ZONE_BY_ID } from '../data/zones'
  import { REST_DURATION_S, REST_HP_PRESETS } from '../data/balance'
  import { zoneSafety } from '../game/rest'
  import { gameState, setRestHpThreshold, travelToZone } from '../stores/game'
  import { Button, NumberText, Panel, Tag } from './kit'
  import { Icon } from './icons'

  const forecasts = $derived(forecastAllZones($gameState))
  const byId = $derived(new Map(forecasts.map((f) => [f.zoneId, f])))
  // Показываем ЭФФЕКТИВНЫЙ порог из конвейера: настройка плюс таланты.
  // Сырое поле состояния соврало бы всем, кто вложил очки в «Походную перевязку».
  const restShare = $derived(Math.round($gameState.stats.restThreshold * 100))

  const VERDICT_LABEL: Record<ZoneVerdict, string> = {
    safe: 'по силам',
    risky: 'рискованно',
    deadly: 'смертельно',
    hopeless: 'не по зубам',
  }

  // Честное предупреждение: собирается из расчёта, а не лежит текстом в данных.
  function warning(f: ZoneForecast): string {
    const gap = Math.round(f.levelGap)
    const above = gap > 0 ? `мобы здесь на ${gap} ${levels(gap)} выше тебя` : null
    switch (f.verdict) {
      case 'safe':
        return above
          ? `${capitalize(above)}, но ты держишь удар — умирать не будешь`
          : 'Мобы тебе по зубам — умирать не будешь'
      case 'risky':
        return `${capitalize(above ?? 'Мобы здесь под стать тебе')} — будешь изредка умирать (${percent(f.uptime)} времени на ногах)`
      case 'deadly':
        return `${capitalize(above ?? 'Мобы здесь опасны')} — ты будешь умирать, живым остаёшься ${percent(f.uptime)} времени`
      case 'hopeless':
        return `${capitalize(above ?? 'Мобы здесь сильнее тебя')} — ты будешь умирать почти без остановки, фарма тут нет`
    }
  }

  function levels(n: number): string {
    const tail = n % 10
    const teen = n % 100 >= 11 && n % 100 <= 14
    if (!teen && tail === 1) return 'уровень'
    if (!teen && tail >= 2 && tail <= 4) return 'уровня'
    return 'уровней'
  }

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const percent = (v: number) => `${Math.round(v * 100)}%`

  // Штраф опыта за отставание. Долю считает логика (forecast.xpShare),
  // здесь только слова — и слова про то, что золото при этом ЦЕЛОЕ: без
  // этого игрок решит, что зона сломалась вся.
  function xpGapText(f: ZoneForecast): string {
    const gap = Math.round(f.levelGap)
    const behind = gap < 0 ? `Ты обогнал эту полосу на ${-gap} ${levels(-gap)}` : 'Ты перерос эту полосу'
    if (f.xpShare <= 0) return `${behind}: опыта здесь больше нет. Золото и материалы — полные.`
    return `${behind}: опыта здесь ${percent(f.xpShare)} от полного. Золото и материалы — полные.`
  }

  // Сколько ударов держит герой — бесконечность у мирных мобов не показываем.
  function toughness(f: ZoneForecast): string {
    if (!Number.isFinite(f.hitsSurvived)) return 'урона не получаешь'
    return `держишь ${f.hitsSurvived.toFixed(1)} ударов`
  }

  // Двадцать зон одним списком читаются как простыня, поэтому они сложены
  // ДЕСЯТКАМИ УРОВНЕЙ ВХОДА. Раскрыта та группа, где герой стоит сейчас:
  // список открывается на том месте, где игрок и находится.
  interface ZoneGroup {
    decade: number
    label: string
    zones: typeof ZONES
  }
  const groups = $derived.by((): ZoneGroup[] => {
    const map = new Map<number, ZoneGroup>()
    for (const zone of ZONES) {
      const decade = Math.floor((zone.unlockRequirement - 1) / 10) * 10
      let group = map.get(decade)
      if (!group) {
        group = { decade, label: `Уровни ${decade + 1}–${decade + 10}`, zones: [] }
        map.set(decade, group)
      }
      group.zones.push(zone)
    }
    return [...map.values()].sort((a, b) => a.decade - b.decade)
  })
  const currentDecade = $derived(
    Math.floor(((ZONE_BY_ID[$gameState.currentZoneId]?.unlockRequirement ?? 1) - 1) / 10) * 10,
  )
</script>

<Panel title="Зоны">
  {#each groups as group (group.decade)}
  <details class="group" open={group.decade === currentDecade}>
    <summary>{group.label} <span class="count">{group.zones.length}</span></summary>
  <ul>
    {#each group.zones as zone (zone.id)}
      {@const f = byId.get(zone.id)}
      {@const safety = zoneSafety($gameState, zone)}
      {#if f}
        <li
          class="zone {f.verdict}"
          class:current={zone.id === $gameState.currentZoneId}
          class:locked={!f.unlocked}
        >
          <div class="head">
            <span class="title"><Icon name={zone.icon} /><span class="name">{zone.name}</span></span>
            <span class="verdict">{VERDICT_LABEL[f.verdict]}</span>
          </div>
          <div class="facts">
            Мобы {zone.monsterLevelRange.min}–{zone.monsterLevelRange.max} ур. · награда ×{zone.rewardMultiplier.toFixed(
              1,
            )} · <NumberText value={f.goldPerHour} tone="gold" /> золота/ч ·
            <NumberText value={f.xpPerHour} tone="xp" /> опыта/ч
          </div>
          {#if f.xpShare < 1}
            <!-- Штраф за отставание. Цифра золота выше остаётся полной
                 намеренно: штраф бьёт только по опыту, и строка обязана
                 сказать это вслух — иначе просевший опыт прочтётся как баг. -->
            <div class="xp-gap" class:none={f.xpShare <= 0}>
              {xpGapText(f)}
            </div>
          {/if}
          <div class="warning">{warning(f)}, {toughness(f)}.</div>
          <!-- Основание метки поменялось вместе с привалом: он теперь между
               боями, поэтому пережить надо ВСЮ схватку, а не один удар. -->
          <div class="safety" class:safe={safety.safe}>
            {#if safety.safe}
              Безопасно при пороге {restShare}%: тяжёлый бой здесь снимает
              <NumberText value={safety.worstFight} tone="damage" />, а на привал ты уходишь
              с <NumberText value={safety.thresholdHp} tone="hp" /> HP — запаса хватает,
              умереть нельзя.
            {:else if $gameState.stats.restThreshold <= 0}
              Порог привала снят — единственной паузой снова стала смерть.
            {:else}
              Опасно при пороге {restShare}%: тяжёлый бой здесь снимает
              <NumberText value={safety.worstFight} tone="damage" />, а входишь ты
              в него с <NumberText value={safety.thresholdHp} tone="hp" /> HP.
              Из боя ты выходишь только победителем или мёртвым — отдохнуть
              посреди схватки нельзя.
            {/if}
          </div>
          {#if zone.id === $gameState.currentZoneId}
            <Tag tone="accent" label="ты здесь" />
          {:else if f.unlocked}
            <Button size="sm" onclick={() => travelToZone(zone.id)}>Отправиться</Button>
          {:else}
            <span class="lock">Откроется с {zone.unlockRequirement} уровня</span>
          {/if}
        </li>
      {/if}
    {/each}
  </ul>
  </details>
  {/each}

  <div class="rest">
    <span class="label">Уходить на привал при HP ниже:</span>
    {#each REST_HP_PRESETS as preset (preset)}
      <Button
        size="sm"
        variant={$gameState.restHpThreshold === preset ? 'primary' : 'ghost'}
        onclick={() => setRestHpThreshold(preset)}
      >
        {preset === 0 ? 'никогда' : `${Math.round(preset * 100)}%`}
      </Button>
    {/each}
  </div>

  {#snippet footer()}
    <p class="hint">
      Привал длится {REST_DURATION_S} с и восстанавливает всё. Уйти на него
      можно ТОЛЬКО МЕЖДУ БОЯМИ: начатую схватку герой доводит до конца. Чем
      выше порог, тем безопаснее и тем больше времени уходит на отдых, —
      это и есть выбор.
    </p>
    <p class="hint">
      Смерть отбрасывает в последнюю зону, где ты выживал
      {#if $gameState.lastSurvivedZoneId}
        — сейчас это «{ZONE_BY_ID[$gameState.lastSurvivedZoneId]?.name}».
      {:else}
        ; пока ты нигде никого не убил, так что вернёшься на старт.
      {/if}
    </p>
  {/snippet}
</Panel>

<style>
  .group {
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-2);
  }
  summary {
    cursor: pointer;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--c-text-muted);
    min-height: var(--tap-min);
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .count {
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    color: var(--c-text-faint);
  }
  .group[open] summary {
    color: var(--c-text);
    border-bottom: 1px solid var(--c-border);
  }
  .group ul {
    padding: var(--space-2);
  }
  .safety {
    font-size: var(--text-sm);
    color: var(--c-warning);
  }
  .safety.safe {
    color: var(--c-heal);
  }
  .rest {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
    margin-top: var(--space-3);
  }
  .rest .label {
    font-size: var(--text-sm);
    color: var(--c-text-muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  /* Цвет вердикта — семантика: «по силам» зелёное, «смертельно» красное.
     Полоска слева красится им же, чтобы список читался одним взглядом. */
  .zone {
    border: 1px solid var(--c-border);
    border-left: var(--space-1) solid var(--verdict-color);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
  }
  .zone.safe {
    --verdict-color: var(--c-heal);
  }
  .zone.risky {
    --verdict-color: var(--c-warning);
  }
  .zone.deadly {
    --verdict-color: var(--c-damage);
  }
  /* «Не по зубам» — тот же красный, что и «смертельно»: затемнённый красный
     на тёмном фоне просто не читается. Разница передаётся заливкой всей
     карточки — зона плохая целиком, а не только её вердикт. */
  .zone.hopeless {
    --verdict-color: var(--c-damage);
    background: color-mix(in srgb, var(--c-damage) var(--tint-weak), transparent);
  }
  .zone.current {
    background: color-mix(in srgb, var(--verdict-color) var(--tint), transparent);
  }
  .zone.locked {
    opacity: 0.55;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-2);
    width: 100%;
  }
  /* Иконка и название — одна группа: иначе space-between растащил бы их
     по краям и название уехало бы в середину. */
  .title {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .name {
    font-weight: var(--weight-bold);
  }
  .xp-gap {
    font-size: var(--text-xs);
    color: var(--c-xp);
  }
  .xp-gap.none {
    color: var(--c-warning);
  }
  .verdict {
    color: var(--verdict-color);
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }
  .facts {
    color: var(--c-text-muted);
    font-size: var(--text-xs);
  }
  .warning {
    font-size: var(--text-sm);
  }
  .lock {
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
  .hint {
    margin: 0;
  }
</style>
