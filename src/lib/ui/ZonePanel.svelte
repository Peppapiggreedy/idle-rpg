<script lang="ts">
  // Экран выбора зоны. Весь текст — здесь; логика отдаёт только числа и вердикт.
  import { formatNumber, forecastAllZones, type ZoneForecast, type ZoneVerdict } from '../game'
  import { ZONES, ZONE_BY_ID } from '../data/zones'
  import { gameState, travelToZone } from '../stores/game'
  import { Button, NumberText, Panel, Tag } from './kit'

  const forecasts = $derived(forecastAllZones($gameState))
  const byId = $derived(new Map(forecasts.map((f) => [f.zoneId, f])))

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

  // Сколько ударов держит герой — бесконечность у мирных мобов не показываем.
  function toughness(f: ZoneForecast): string {
    if (!Number.isFinite(f.hitsSurvived)) return 'урона не получаешь'
    return `держишь ${f.hitsSurvived.toFixed(1)} ударов`
  }
</script>

<Panel title="Зоны">
  <ul>
    {#each ZONES as zone (zone.id)}
      {@const f = byId.get(zone.id)}
      {#if f}
        <li
          class="zone {f.verdict}"
          class:current={zone.id === $gameState.currentZoneId}
          class:locked={!f.unlocked}
        >
          <div class="head">
            <span class="name">{zone.name}</span>
            <span class="verdict">{VERDICT_LABEL[f.verdict]}</span>
          </div>
          <div class="facts">
            Мобы {zone.monsterLevelRange.min}–{zone.monsterLevelRange.max} ур. · награда ×{zone.rewardMultiplier.toFixed(
              1,
            )} · <NumberText value={f.goldPerHour} tone="gold" /> золота/ч ·
            <NumberText value={f.xpPerHour} tone="xp" /> опыта/ч
          </div>
          <div class="warning">{warning(f)}, {toughness(f)}.</div>
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

  {#snippet footer()}
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
  .name {
    font-weight: var(--weight-bold);
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
