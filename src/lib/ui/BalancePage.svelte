<script lang="ts">
  // Страница прогона баланса: те же таблицы, что печатает тест
  // game/__tests__/balance.test.ts, только посчитанные на лету. Весь текст —
  // здесь; simulate() отдаёт голые числа.
  import {
    BALANCE_PRESET,
    formatNumber,
    simulate,
    spreadOf,
    type SimResult,
  } from '../game'
  import { Decimal } from '../game'
  import { ZONES } from '../data/zones'
  import { WEAPONS, WEAPON_BY_ID } from '../data/items'
  import { ABILITY_BY_ID } from '../data/abilities'
  import { Button, NumberText, Panel, Tag } from './kit'

  const HOURS = [1, 2, 4, 8]
  let hours = $state(1)
  let running = $state(false)
  let done = $state(false)
  let zoneRows = $state<Array<{ name: string; result: SimResult }>>([])
  let weaponRows = $state<Array<{ name: string; speed: string; result: SimResult }>>([])
  let manaRows = $state<Array<{ name: string; speed: string; result: SimResult }>>([])

  const weaponSpread = $derived(
    weaponRows.length === WEAPONS.length
      ? spreadOf(weaponRows.map((r) => r.result.goldPerHour))
      : null,
  )
  const manaRatio = $derived(
    manaRows.length === 2 && manaRows[0].result.damagePerMana
      ? manaRows[1].result.damagePerMana!.div(manaRows[0].result.damagePerMana!).toNumber()
      : null,
  )

  // Уступаем браузеру кадр, чтобы таблица наполнялась построчно, а вкладка не
  // выглядела зависшей. Это рендер, а не игровая логика: игровой цикл здесь
  // не крутится вовсе — страница прогона живёт без него.
  const yieldFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

  async function run() {
    if (running) return
    running = true
    done = false
    zoneRows = []
    weaponRows = []
    manaRows = []
    await yieldFrame()

    for (const zone of ZONES) {
      const result = simulate({
        hours,
        zoneId: zone.id,
        build: BALANCE_PRESET.zoneBuild,
      })
      zoneRows = [...zoneRows, { name: zone.name, result }]
      await yieldFrame()
    }

    for (const template of WEAPONS) {
      const result = simulate({
        hours,
        zoneId: BALANCE_PRESET.weaponZoneId,
        freezeLevel: true,
        build: {
          ...BALANCE_PRESET.weaponBuild,
          weapon: { templateId: template.id, bare: true },
          autocast: 'none',
        },
      })
      weaponRows = [
        ...weaponRows,
        { name: template.noun, speed: template.weaponSpeed.toFixed(1), result },
      ]
      await yieldFrame()
    }

    for (const id of ['fang', 'crusher']) {
      const template = WEAPON_BY_ID[id]
      const result = simulate({
        hours,
        zoneId: BALANCE_PRESET.weaponZoneId,
        freezeLevel: true,
        build: {
          ...BALANCE_PRESET.weaponBuild,
          weapon: { templateId: id, bare: true },
          autocast: [...BALANCE_PRESET.manaAbilities],
        },
      })
      manaRows = [
        ...manaRows,
        { name: template.noun, speed: template.weaponSpeed.toFixed(1), result },
      ]
      await yieldFrame()
    }

    running = false
    done = true
  }

  function minutes(seconds: number | null): string {
    if (seconds === null) return '—'
    return `${(seconds / 60).toFixed(1)} мин`
  }

  const percent = (v: number) => `${(v * 100).toFixed(1)}%`
  const zoneName = ZONES.find((z) => z.id === BALANCE_PRESET.weaponZoneId)?.name ?? ''
  const abilityNames = BALANCE_PRESET.manaAbilities
    .map((id) => ABILITY_BY_ID[id]?.name)
    .filter(Boolean)
    .join(', ')
</script>

<main>
  <h1>Прогон баланса</h1>
  <p class="lead">
    Симуляция без экрана: те же тики, что крутит игра, прогоняются вперёд и
    сводятся в таблицу. Игровой цикл на этой странице не запускается — сейв не
    трогается, герой ничего не фармит.
  </p>

  <div class="controls">
    <span class="label">Часов игрового времени на строку:</span>
    {#each HOURS as h (h)}
      <Button
        variant={hours === h ? 'primary' : 'ghost'}
        size="sm"
        disabled={running}
        onclick={() => (hours = h)}
      >
        {h}
      </Button>
    {/each}
    <span class="run">
      <Button variant="primary" loading={running} onclick={run}>
        {running ? 'Считаю…' : 'Посчитать'}
      </Button>
    </span>
  </div>
  <p class="warn">
    Счёт идёт в этой же вкладке: {hours} ч на строку — это примерно {(hours * 0.5).toFixed(
      1,
    )} с работы на каждую из {ZONES.length + WEAPONS.length + 2} строк. Вкладка на это время подтормаживает.
  </p>

  {#if zoneRows.length > 0}
    <h2>Зоны</h2>
    <p class="note">
      Герой {BALANCE_PRESET.zoneBuild.level} уровня, {BALANCE_PRESET.zoneBuild.sharpening} заточек,
      автокаст включён. Уровень растёт по ходу прогона, как в живой игре.
    </p>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Зона</th>
            <th>Убийств/ч</th>
            <th>Золота/ч</th>
            <th>Опыта/ч</th>
            <th>Смертей/ч</th>
            <th>До ур.</th>
            <th>Итог</th>
          </tr>
        </thead>
        <tbody>
          {#each zoneRows as row (row.name)}
            <tr>
              <td class="name">{row.name}</td>
              <td><NumberText value={row.result.killsPerHour} /></td>
              <td><NumberText value={row.result.goldPerHour} tone="gold" /></td>
              <td><NumberText value={row.result.xpPerHour} tone="xp" /></td>
              <td>
                <NumberText
                  value={row.result.deathsPerHour}
                  decimals={1}
                  tone={row.result.deathsPerHour > 0 ? 'damage' : 'plain'}
                />
              </td>
              <td>{minutes(row.result.secondsToNextLevel)}</td>
              <td>{row.result.finalLevel}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if weaponRows.length > 0}
    <h2>Скорость оружия</h2>
    <p class="note">
      Три оружия с одинаковым уроном оружия в секунду, взятые голыми — без
      побочных статов модели. {zoneName}, герой {BALANCE_PRESET.weaponBuild.level} уровня,
      только автоатака. Итог обязан сойтись в пределах
      {percent(BALANCE_PRESET.weaponSpreadLimit)}: если нет — нормализация скорости сломана.
    </p>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Оружие</th>
            <th>Замах</th>
            <th>Убийств/ч</th>
            <th>Золота/ч</th>
          </tr>
        </thead>
        <tbody>
          {#each weaponRows as row (row.name)}
            <tr>
              <td class="name">{row.name}</td>
              <td>{row.speed} с</td>
              <td><NumberText value={row.result.killsPerHour} /></td>
              <td><NumberText value={row.result.goldPerHour} tone="gold" /></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if weaponSpread !== null}
      <p class="verdict">
        <Tag
          tone={weaponSpread > BALANCE_PRESET.weaponSpreadLimit ? 'damage' : 'accent'}
          size="md"
          label="разброс {percent(weaponSpread)}"
        />
        {weaponSpread > BALANCE_PRESET.weaponSpreadLimit
          ? 'выбор оружия схлопнулся, одно строго лучше остальных.'
          : 'выбор оружия честный.'}
      </p>
    {/if}
  {/if}

  {#if manaRows.length > 0}
    <h2>Урон за ману</h2>
    <p class="note">
      Включены только умения «на следующий удар» ({abilityNames}). Умение стоит
      фиксированную ману и бьёт долей замаха, поэтому медленное оружие обязано
      давать больше урона за ту же ману — это и есть награда за его выбор.
    </p>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Оружие</th>
            <th>Замах</th>
            <th>Урон умений</th>
            <th>Потрачено маны</th>
            <th>Урон за ману</th>
          </tr>
        </thead>
        <tbody>
          {#each manaRows as row (row.name)}
            <tr>
              <td class="name">{row.name}</td>
              <td>{row.speed} с</td>
              <td><NumberText value={row.result.abilityDamage} /></td>
              <td><NumberText value={row.result.manaSpent} tone="mana" /></td>
              <td>
                {#if row.result.damagePerMana}
                  <NumberText value={row.result.damagePerMana} bold tone="accent" />
                {:else}
                  —
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if manaRatio !== null}
      <p class="verdict">
        Медленное оружие даёт в {manaRatio.toFixed(2)} раза больше урона за ману —
        ровно во столько раз, во сколько оно медленнее.
      </p>
    {/if}
  {/if}

  {#if done}
    <p class="note">Готово. Поменяй число часов и посчитай ещё раз, если нужна точность.</p>
  {/if}

  <p class="back">
    <a href="./?debug=1">← вернуться в игру</a> ·
    <a href="./ui?debug=1">витрина интерфейса →</a>
  </p>
</main>

<style>
  main {
    max-width: 56rem;
    margin: 0 auto;
    padding: var(--space-6) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    text-align: left;
  }
  h1 {
    margin: 0;
    font-size: var(--text-2xl);
    line-height: var(--leading-tight);
  }
  h2 {
    margin: var(--space-4) 0 0;
    font-size: var(--text-lg);
  }
  .lead,
  .note,
  .warn {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--c-text-muted);
  }
  .warn {
    color: var(--c-warning);
  }
  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
    margin-top: var(--space-2);
  }
  .label {
    font-size: var(--text-sm);
    color: var(--c-text-muted);
  }
  .run {
    margin-left: auto;
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: var(--text-sm);
  }
  th,
  td {
    padding: var(--space-1) var(--space-3);
    text-align: right;
    border-bottom: 1px solid var(--c-border);
    white-space: nowrap;
  }
  th {
    font-weight: var(--weight-medium);
    color: var(--c-text-faint);
    font-size: var(--text-xs);
  }
  th:first-child,
  td.name {
    text-align: left;
  }
  .verdict {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--c-text-muted);
  }
  .back {
    margin-top: var(--space-5);
    font-size: var(--text-sm);
  }
</style>
