<script lang="ts">
  // Экран выбора зоны. Весь текст — здесь; логика отдаёт только числа и вердикт.
  import { formatNumber, forecastAllZones, type ZoneForecast, type ZoneVerdict } from '../game'
  import { ZONES, ZONE_BY_ID } from '../data/zones'
  import { gameState, travelToZone } from '../stores/game'

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

<section class="zones">
  <h2>Зоны</h2>
  <ul>
    {#each ZONES as zone (zone.id)}
      {@const f = byId.get(zone.id)}
      {#if f}
        <li class="zone {f.verdict}" class:current={zone.id === $gameState.currentZoneId} class:locked={!f.unlocked}>
          <div class="head">
            <span class="name">{zone.name}</span>
            <span class="verdict">{VERDICT_LABEL[f.verdict]}</span>
          </div>
          <div class="facts">
            Мобы {zone.monsterLevelRange.min}–{zone.monsterLevelRange.max} ур. ·
            награда ×{zone.rewardMultiplier.toFixed(1)} ·
            {formatNumber(f.goldPerHour)} золота/ч · {formatNumber(f.xpPerHour)} опыта/ч
          </div>
          <div class="warning">{warning(f)}, {toughness(f)}.</div>
          {#if zone.id === $gameState.currentZoneId}
            <span class="here">Ты здесь</span>
          {:else if f.unlocked}
            <button type="button" onclick={() => travelToZone(zone.id)}>Отправиться</button>
          {:else}
            <span class="lock">Откроется с {zone.unlockRequirement} уровня</span>
          {/if}
        </li>
      {/if}
    {/each}
  </ul>
  <p class="hint">
    Смерть отбрасывает в последнюю зону, где ты выживал
    {#if $gameState.lastSurvivedZoneId}
      — сейчас это «{ZONE_BY_ID[$gameState.lastSurvivedZoneId]?.name}».
    {:else}
      ; пока ты нигде никого не убил, так что вернёшься на старт.
    {/if}
  </p>
</section>

<style>
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .zone {
    border: 1px solid #8884;
    border-left: 4px solid var(--verdict-color);
    border-radius: 8px;
    padding: 0.6rem 0.7rem;
    text-align: left;
    font-size: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .zone.safe {
    --verdict-color: #4caf50;
  }
  .zone.risky {
    --verdict-color: #d4a017;
  }
  .zone.deadly {
    --verdict-color: #e57373;
  }
  .zone.hopeless {
    --verdict-color: #b71c1c;
  }
  .zone.current {
    background: color-mix(in srgb, var(--verdict-color) 10%, transparent);
  }
  .zone.locked {
    opacity: 0.55;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
  }
  .name {
    font-weight: 600;
    font-size: 0.95rem;
  }
  .verdict {
    color: var(--verdict-color);
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .facts {
    opacity: 0.75;
    font-size: 0.78rem;
  }
  .warning {
    font-size: 0.8rem;
  }
  .here,
  .lock {
    font-size: 0.78rem;
    opacity: 0.7;
    margin-top: 0.15rem;
  }
  .hint {
    margin: 0.7rem 0 0;
    font-size: 0.78rem;
    opacity: 0.55;
    text-align: left;
  }
  button {
    font: inherit;
    font-size: 0.78rem;
    margin-top: 0.2rem;
    align-self: flex-start;
    padding: 0.25em 0.7em;
    border: 1px solid #8886;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  button:hover {
    border-color: var(--verdict-color);
  }
</style>
