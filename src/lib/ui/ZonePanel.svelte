<script lang="ts">
  // Экран выбора зоны. Весь текст — здесь; логика отдаёт только числа.
  // ВЕРДИКТ ЗОНЫ («по силам» / «смертельно») НЕ ПОКАЗЫВАЕТСЯ: игра называет,
  // что сделать нельзя, и молчит о том, чем кончится попытка. Показываются
  // факты — полоса уровней, доля опыта, золото и опыт в час.
  import {
    formatNumber,
    forecastAllZones,
    travelStatus,
    type TravelBlockReason,
    type ZoneForecast,
  } from '../game'
  import { ZONES, ZONE_BY_ID } from '../data/zones'
  import { MAX_REST_THRESHOLD, REST_THRESHOLD_STEP, snapRestThreshold } from '../data/balance'
  import { restDurationMs, zoneSafety } from '../game/rest'
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

  function levels(n: number): string {
    const tail = n % 10
    const teen = n % 100 >= 11 && n % 100 <= 14
    if (!teen && tail === 1) return 'уровень'
    if (!teen && tail >= 2 && tail <= 4) return 'уровня'
    return 'уровней'
  }

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
  /**
   * ДЕЙСТВУЮЩИЙ порог — тот, что реально считает конвейер. Пока порог двигали
   * таланты, он расходился с выставленным, и показывать надо было именно его.
   * Таланты на порог удалены (порог — настройка игрока, а не характеристика),
   * но строка осталась: конвейер по-прежнему единственный источник правды, и
   * молчаливое расхождение обязано быть видно, откуда бы оно ни взялось.
   */
  const effectiveRest = $derived(
    Math.abs($gameState.stats.restThreshold - $gameState.restHpThreshold) < 1e-9
      ? null
      : `${Math.round($gameState.stats.restThreshold * 100)}%`,
  )

  /**
   * ПОДПИСЬ ПОЛЗУНКА ГОВОРИТ ДЕЙСТВУЮЩУЮ ДЛИНУ ПРИВАЛА, а не константу из
   * данных: таланты её режут, еда режет вдвое, и число из `data/balance.ts`
   * было бы неправдой ровно у того игрока, который эти таланты и вложил.
   * `restDurationMs` считает то же самое, что и сам привал.
   */
  const restSeconds = $derived(Math.round(restDurationMs($gameState) / 1000))
  const restPercent = $derived(Math.round($gameState.restHpThreshold * 100))
  function onRestSlider(event: Event): void {
    const value = Number((event.currentTarget as HTMLInputElement).value)
    setRestHpThreshold(snapRestThreshold(value / 100))
  }
</script>

<Panel title="Мир">
  <ZoneMap {selectedId} onselect={(id) => (picked = id)} />

  {#if f && safety}
    <div class="detail">
      <div class="head">
        <span class="title"><Icon name={zone.icon} /><span class="name">{zone.name}</span></span>
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
      <!-- Прогноз худшего боя ОСТАЁТСЯ: это настройка собственного правила
           игрока (порог привала ниже), а не ворота в контент. Основание
           метки поменялось вместе с привалом: он теперь между боями,
           поэтому пережить надо ВСЮ схватку, а не один удар. -->
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

  <!-- ПОЛЗУНОК ВМЕСТО ЧЕТЫРЁХ ПРЕСЕТОВ. Между 40 % и 60 % разница в цене боя
       ощутима, а выбрать там было нечего; «никогда» стояло в одном ряду с
       процентами, будто это такой же процент. Крайние положения читаются
       сами и названы словами. -->
  <div class="rest">
    <label class="label" for="rest-threshold">
      Уходить на привал при HP ниже{#if effectiveRest !== null}<span class="effective"
          >&nbsp;(конвейер считает {effectiveRest})</span
        >{/if}:
    </label>
    <div class="rest-row">
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
      <b class="rest-value">
        {#if restPercent === 0}никогда{:else}{restPercent}%{/if}
      </b>
    </div>
    <p class="rest-hint">
      {#if restPercent === 0}
        Привалов не будет вовсе — герой дерётся, пока не погибнет.
      {:else}
        Привал длится {restSeconds} с и восстанавливает всё.
      {/if}
    </p>
  </div>

  {#snippet footer()}
    <p class="hint">
      Уйти на привал можно ТОЛЬКО МЕЖДУ БОЯМИ: начатую схватку герой доводит
      до конца. Чем выше порог, тем безопаснее и тем больше времени уходит на
      отдых, — это и есть выбор.
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
    border-radius: var(--radius-md);
    margin-bottom: var(--space-3);
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
    font-weight: var(--weight-regular);
  }
  .rest-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .rest-row input {
    flex: 1 1 auto;
    min-width: 0;
    /* Область нажатия на мобильном: ползунок обязан ловить палец. */
    min-height: 44px;
    accent-color: var(--c-accent);
  }
  .rest-value {
    min-width: 4.5rem;
    text-align: right;
  }
  .rest-hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--c-text-dim);
  }
  .rest {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-top: var(--space-3);
  }
  .rest .label {
    font-size: var(--text-sm);
    color: var(--c-text-muted);
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
  .facts {
    color: var(--c-text-muted);
    font-size: var(--text-xs);
  }
  .lock {
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
  .hint {
    margin: 0;
  }
</style>
