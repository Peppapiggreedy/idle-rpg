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
      <button
        type="button"
        class:active={hours === h}
        disabled={running}
        onclick={() => (hours = h)}>{h}</button
      >
    {/each}
    <button type="button" class="run" disabled={running} onclick={run}>
      {running ? 'Считаю…' : 'Посчитать'}
    </button>
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
              <td>{formatNumber(row.result.killsPerHour)}</td>
              <td>{formatNumber(row.result.goldPerHour)}</td>
              <td>{formatNumber(row.result.xpPerHour)}</td>
              <td class:bad={row.result.deathsPerHour > 0}>{row.result.deathsPerHour.toFixed(1)}</td>
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
              <td>{formatNumber(row.result.killsPerHour)}</td>
              <td>{formatNumber(row.result.goldPerHour)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if weaponSpread !== null}
      <p class="verdict" class:bad={weaponSpread > BALANCE_PRESET.weaponSpreadLimit}>
        Разброс {percent(weaponSpread)}
        {weaponSpread > BALANCE_PRESET.weaponSpreadLimit
          ? '— выбор оружия схлопнулся, одно строго лучше остальных.'
          : '— выбор оружия честный.'}
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
              <td>{formatNumber(row.result.abilityDamage)}</td>
              <td>{formatNumber(row.result.manaSpent)}</td>
              <td class="strong">
                {row.result.damagePerMana
                  ? formatNumber(row.result.damagePerMana)
                  : '—'}
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

  <p class="back"><a href="./?debug=1">← вернуться в игру</a></p>
</main>

<style>
  main {
    max-width: 52rem;
    margin: 0 auto;
    padding: 2.5rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    text-align: left;
  }
  h1 {
    margin: 0;
  }
  h2 {
    margin: 1rem 0 0;
    font-size: 1.05rem;
  }
  .lead,
  .note,
  .warn {
    margin: 0;
    font-size: 0.85rem;
    opacity: 0.75;
  }
  .warn {
    color: #d4a017;
    opacity: 1;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin-top: 0.5rem;
  }
  .label {
    font-size: 0.85rem;
    opacity: 0.75;
  }
  button {
    border: 1px solid #8886;
    border-radius: 6px;
    padding: 0.3rem 0.7rem;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
  }
  button.active {
    border-color: #4caf50;
    background: #4caf5022;
  }
  button.run {
    margin-left: auto;
    border-color: #4caf50;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 0.35rem 0.6rem;
    text-align: right;
    border-bottom: 1px solid #8883;
    white-space: nowrap;
  }
  th {
    font-weight: 600;
    opacity: 0.7;
  }
  th:first-child,
  td.name {
    text-align: left;
  }
  td.bad {
    color: #e57373;
  }
  td.strong {
    font-weight: 600;
  }
  .verdict {
    margin: 0.25rem 0 0;
    font-size: 0.85rem;
    color: #4caf50;
  }
  .verdict.bad {
    color: #e57373;
  }
  .back {
    margin-top: 1.5rem;
    font-size: 0.85rem;
  }
</style>
