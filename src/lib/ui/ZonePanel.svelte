<script lang="ts">
  // Экран выбора зоны. Весь текст — здесь; логика отдаёт только числа и вердикт.
  import {
    formatNumber,
    forecastAllZones,
    travelStatus,
    type TravelBlockReason,
    type ZoneForecast,
    type ZoneVerdict,
  } from '../game'
  import { ZONES, ZONE_BY_ID } from '../data/zones'
  import { REST_DURATION_S, REST_HP_PRESETS } from '../data/balance'
  import { zoneSafety } from '../game/rest'
  import { enterDungeonRun, gameState, setRestHpThreshold, travelToZone } from '../stores/game'
  import { allDungeonStatuses, type DungeonBlockReason, type DungeonDef } from '../game'
  import { DUNGEONS, HEROIC, HEROIC_DUNGEONS, clearKey, dungeonOpening } from '../data/dungeons'
  import { Button, NumberText, Panel, Tag } from './kit'
  import { Icon } from './icons'
  import ZoneMap from './ZoneMap.svelte'
  import { CLOSED_RUN_WARNING } from './runText'
  import { combatKey, createMemo } from './memo'

  // ПРОГНОЗ ВСЕХ ЗОН — самая дорогая производная в игре: боевая оценка по
  // каждому мобу каждой из двадцати зон. Пересчитывается только когда меняются
  // её входы, а не каждый тик (см. ui/memo.ts).
  const forecastMemo = createMemo<ReturnType<typeof forecastAllZones>>()
  const forecasts = $derived(forecastMemo(combatKey($gameState), () => forecastAllZones($gameState)))
  // Метка безопасности выбранной зоны — тоже боевая оценка по всему её пулу.
  const safetyMemo = createMemo<ReturnType<typeof zoneSafety>>()
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

  // Выбранный узел карты. По умолчанию — тот, где герой стоит сейчас:
  // экран открывается там, где игрок и находится.
  let picked = $state<string | null>(null)
  const selectedId = $derived(picked ?? $gameState.currentZoneId)
  const zone = $derived(ZONE_BY_ID[selectedId] ?? ZONE_BY_ID[$gameState.currentZoneId])
  const f = $derived(byId.get(selectedId) ?? null)
  const safety = $derived(
    safetyMemo([...combatKey($gameState), selectedId], () => zoneSafety($gameState, zone)),
  )

  // Инстансы ВЫБРАННОЙ зоны. Отдельного списка данжей больше нет: данж —
  // это дверь в конкретном месте карты, и жить он должен рядом с местом.
  const statuses = $derived(
    new Map(allDungeonStatuses($gameState).map((st) => [clearKey(st.dungeonId, st.difficulty), st])),
  )
  const heroicById = $derived(new Map(HEROIC_DUNGEONS.map((d) => [d.id, d])))
  const zoneDungeons = $derived(DUNGEONS.filter((d) => d.zoneId === selectedId))

  // Почему нельзя переехать. Кнопка не пропадает молча: на её месте причина.
  const TRAVEL_REASON: Record<TravelBlockReason, string> = {
    unknown: 'Нет такой зоны',
    'in-temple': 'Сначала выйди из храма',
    'in-dungeon': 'Сначала выйди из данжа',
    dead: 'Сначала воскресни',
    locked: 'Закрыта',
    'same-zone': 'Ты здесь',
  }

  const DUNGEON_REASON: Record<DungeonBlockReason, (d: DungeonDef) => string> = {
    level: (d) => `Откроется с ${d.unlockRequirement} уровня`,
    'wrong-zone': () => 'Сначала перейди в эту зону',
    dead: () => 'Сначала воскресни',
    'already-inside': () => 'Ты уже внутри',
  }

  /**
   * ДЕЙСТВУЮЩИЙ порог — тот, что реально считает конвейер. Он совпадает с
   * нажатой кнопкой, пока в дереве нет талантов на привал; как только они
   * вложены, число расходится, и показать надо именно его. Раньше порог
   * стоял отдельной строкой в общем списке статов — там он читался как
   * находка, а не как настройка (см. SETTING_STATS в ui/statFormat.ts).
   */
  const effectiveRest = $derived(
    Math.abs($gameState.stats.restThreshold - $gameState.restHpThreshold) < 1e-9
      ? null
      : `${Math.round($gameState.stats.restThreshold * 100)}%`,
  )
</script>

<Panel title="Мир">
  <ZoneMap {selectedId} onselect={(id) => (picked = id)} />

  {#if f && safety}
    <div class="detail {f.verdict}">
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
        <div class="xp-gap" class:none={f.xpShare <= 0}>{xpGapText(f)}</div>
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
        {@const travel = travelStatus($gameState, zone.id)}
        {#if travel.canTravel}
          <Button size="sm" onclick={() => travelToZone(zone.id)}>Отправиться</Button>
        {:else}
          <span class="reason">{TRAVEL_REASON[travel.reason ?? 'locked']}</span>
        {/if}
      {:else}
        <!-- ЧЕМ ОТКРЫВАЕТСЯ. Не уровнем, а конкретным данжем: игроку нужно
             знать, куда идти, а не сколько ждать. -->
        {@const opener = dungeonOpening(zone.id)}
        <span class="lock">
          {opener ? `Откроется, когда пройдёшь «${opener.name}»` : 'Закрыта'}
        </span>
      {/if}

      <!-- ВХОДЫ ЭТОЙ ЗОНЫ. Данж живёт рядом со своим местом на карте, а не
           отдельным списком: «вход из зоны X» в списке приходилось читать
           строкой, а на карте это просто соседство. -->
      {#each zoneDungeons as d (d.id)}
        {@const status = statuses.get(clearKey(d.id, 'normal'))}
        {#if status}
          <div class="entry" class:locked={!status.canEnter}>
            <div class="head">
              <Icon name={d.icon} /><span class="name">{d.name}</span>
              {#if status.cleared}<Tag tone="gold" label="пройден" />{/if}
            </div>
            <div class="facts">{d.bosses.length} босса подряд</div>
            <p class="closed-run">{CLOSED_RUN_WARNING}</p>
            {#if status.canEnter}
              <Button size="sm" variant="primary" onclick={() => enterDungeonRun(d.id)}>
                Войти
              </Button>
            {:else}
              <span class="reason">{DUNGEON_REASON[status.reason ?? 'level'](d)}</span>
            {/if}
            {#if heroicById.get(d.id) && statuses.get(clearKey(d.id, 'heroic'))}
              {@const heroic = heroicById.get(d.id)!}
              {@const hStatus = statuses.get(clearKey(d.id, 'heroic'))!}
              <div class="heroic">
                <Icon name="dungeon-heroic" /><span class="name">Героика</span>
                {#if hStatus.cleared}<Tag tone="gold" label="пройдена" />{/if}
                {#if hStatus.canEnter}
                  <Button size="sm" onclick={() => enterDungeonRun(d.id, 'heroic')}>Войти</Button>
                {:else if hStatus.reason === 'level'}
                  <span class="reason">с {HEROIC.unlockRequirement} уровня</span>
                {:else}
                  <span class="reason">{DUNGEON_REASON[hStatus.reason ?? 'level'](heroic)}</span>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  {/if}

  <div class="rest">
    <span class="label">
      Уходить на привал при HP ниже{#if effectiveRest !== null}<span class="effective"
          >&nbsp;(с талантами {effectiveRest})</span
        >{/if}:
    </span>
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
  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    border: 1px solid var(--c-border);
    border-left: var(--space-1) solid var(--verdict-color, var(--c-border));
    border-radius: var(--radius-md);
    margin-bottom: var(--space-3);
  }
  .detail.safe {
    --verdict-color: var(--c-heal);
  }
  .detail.risky {
    --verdict-color: var(--c-warning);
  }
  .detail.deadly,
  .detail.hopeless {
    --verdict-color: var(--c-damage);
  }
  .entry {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-top: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
  }
  .entry.locked {
    opacity: 0.7;
  }
  .heroic {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-top: var(--space-1);
    border-top: 1px solid var(--c-border);
  }
  .closed-run {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
  .reason {
    font-size: var(--text-sm);
    color: var(--c-text-faint);
  }
  .safety {
    font-size: var(--text-sm);
    color: var(--c-warning);
  }
  .safety.safe {
    color: var(--c-heal);
  }
  .effective {
    color: var(--c-text-dim);
    font-weight: 400;
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
