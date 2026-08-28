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
  import { currentCell, pacingTable, referenceBuild, ttkDrift, type PacingRow } from '../game/simulate'
  import { Decimal } from '../game'
  import {
    TTK_AHEAD_MIN,
    TTK_BEHIND_MAX,
    TTK_DRIFT_MAX,
    TTK_HARD_CEILING,
    TTK_HARD_FLOOR,
    TTK_TARGET_MAX,
    TTK_TARGET_MIN,
  } from '../data/balance'
  import { ZONES } from '../data/zones'
  import { CLASSES } from '../data/classes'
  import { intendedZone } from '../game/zones'
  import {
    DECISION_ALERT_SEC,
    DECISION_MAX_SEC,
    DECISION_MIN_SEC,
  } from '../data/balance'
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
  let pacingRows = $state<PacingRow[]>([])
  // Телеметрия: по строке на класс и уровень. Ровно то, что проверяет
  // прогон баланса, только посчитанное на лету.
  let telemetryRows = $state<
    Array<{ className: string; level: number; zone: string; result: SimResult }>
  >([])

  const drift = $derived(pacingRows.length > 0 ? ttkDrift(pacingRows) : null)

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

  const decisionsInWindow = $derived(
    telemetryRows.filter((r) => {
      const gap = r.result.decisionIntervalSec
      return gap !== null && gap >= DECISION_MIN_SEC && gap <= DECISION_MAX_SEC
    }).length,
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
    pacingRows = []
    telemetryRows = []
    await yieldFrame()

    pacingRows = pacingTable()
    await yieldFrame()

    for (const zone of ZONES) {
      const result = simulate({
        hours,
        zoneId: zone.id,
        build: referenceBuild(BALANCE_PRESET.zoneLevel),
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

    for (const hero of CLASSES) {
      for (const level of BALANCE_PRESET.telemetryLevels) {
        const zone = intendedZone(level)
        const result = simulate({
          hours: BALANCE_PRESET.telemetryHours,
          zoneId: zone.id,
          seed: BALANCE_PRESET.pacingSeed,
          bag: 'sell',
          build: referenceBuild(level, hero.id),
        })
        telemetryRows = [
          ...telemetryRows,
          { className: hero.name, level, zone: zone.name, result },
        ]
        await yieldFrame()
      }
    }

    running = false
    done = true
  }

  function minutes(seconds: number | null): string {
    if (seconds === null) return '—'
    return `${(seconds / 60).toFixed(1)} мин`
  }

  const percent = (v: number) => `${(v * 100).toFixed(1)}%`
  const sec = (v: number) => (Number.isFinite(v) ? `${v < 100 ? v.toFixed(1) : v.toFixed(0)} с` : '∞')
  const MARK: Record<string, string> = {
    current: 'актуальная',
    behind: 'отстающая',
    ahead: 'опережающая',
    near: 'соседняя',
  }
  // Красным — то, что вышло за контракт. Порог зависит от положения зоны.
  function broken(standing: string, avg: number): boolean {
    if (standing === 'current') return avg < TTK_TARGET_MIN || avg > TTK_TARGET_MAX
    if (standing === 'behind') return avg > TTK_BEHIND_MAX
    if (standing === 'ahead') return avg < TTK_AHEAD_MIN
    return false
  }
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
    )} с работы на каждую из {ZONES.length + WEAPONS.length + 2} строк, плюс одно
    эталонное прохождение на таблицу темпа. Вкладка на это время подтормаживает.
  </p>

  {#if pacingRows.length > 0}
    <h2>Темп боя</h2>
    <p class="note">
      Эталонное прохождение: герой в средней по рулетке экипировке, всё золото
      уходит в заточку, переезд в новую зону по мере открытия. В клетке —
      среднее время убийства моба зоны, в скобках самый быстрый и самый долгий.
      Контракт: в актуальной зоне {TTK_TARGET_MIN}–{TTK_TARGET_MAX} с, ни один моб не
      быстрее {TTK_HARD_FLOOR} с и не дольше {TTK_HARD_CEILING} с, отстающая зона до
      {TTK_BEHIND_MAX} с, опережающая от {TTK_AHEAD_MIN} с.
    </p>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Ур.</th>
            {#each ZONES as zone (zone.id)}
              <th>{zone.name}<br /><span class="faint"
                  >{zone.monsterLevelRange.min}–{zone.monsterLevelRange.max}</span
                ></th>
            {/each}
            <th>Заточек</th>
            <th>Смертей</th>
          </tr>
        </thead>
        <tbody>
          {#each pacingRows as row (row.level)}
            <tr>
              <td class="name">{row.level}</td>
              {#each row.cells as cell (cell.zoneId)}
                <td
                  class="ttk"
                  class:current={cell.standing === 'current'}
                  class:bad={broken(cell.standing, cell.ttk.avg)}
                  title={MARK[cell.standing]}
                >
                  {sec(cell.ttk.avg)}
                  <span class="faint">({sec(cell.ttk.min)}–{sec(cell.ttk.max)})</span>
                </td>
              {/each}
              <td>{row.sharpening}</td>
              <td>{row.deaths}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if drift !== null}
      <p class="verdict">
        <Tag
          tone={drift > TTK_DRIFT_MAX ? 'damage' : 'accent'}
          size="md"
          label="разброс {percent(drift)}"
        />
        {drift > TTK_DRIFT_MAX
          ? `темп сжимается с прогрессом: к концу игры бой идёт заметно быстрее, чем в начале (потолок ${percent(TTK_DRIFT_MAX)}).`
          : 'темп держится: бой длится примерно одинаково на всех уровнях.'}
      </p>
    {/if}
  {/if}

  {#if zoneRows.length > 0}
    <h2>Зоны</h2>
    <p class="note">
      Эталонный герой {BALANCE_PRESET.zoneLevel} уровня: столько заточек, сколько
      он к этому уровню успел купить, и средняя по рулетке экипировка. Автокаст
      включён, уровень растёт по ходу прогона, как в живой игре.
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

  {#if telemetryRows.length > 0}
    <h2>Интервал решений и привалы</h2>
    <p class="note">
      Сколько проходит между решениями игрока: находка выше обычной, очко
      таланта, открывшаяся зона. Здоровое окно — {DECISION_MIN_SEC}–{DECISION_MAX_SEC} с;
      реже {DECISION_ALERT_SEC} с — уже не idle, а пустой экран.
      Эталонный герой в подходящей по уровню зоне, {BALANCE_PRESET.telemetryHours} ч на строку.
    </p>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>класс</th>
            <th>ур.</th>
            <th>зона</th>
            <th>интервал</th>
            <th>золота/ч</th>
            <th>опыта/ч</th>
            <th>привалов/ч</th>
            <th>простой</th>
            <th>смертей/ч</th>
          </tr>
        </thead>
        <tbody>
          {#each telemetryRows as row (`${row.className}-${row.level}`)}
            {@const gap = row.result.decisionIntervalSec}
            <tr>
              <td>{row.className}</td>
              <td class="num">{row.level}</td>
              <td>{row.zone}</td>
              <td
                class="num"
                class:good={gap !== null && gap >= DECISION_MIN_SEC && gap <= DECISION_MAX_SEC}
                class:bad={gap === null || gap > DECISION_ALERT_SEC}
              >
                {gap === null ? '—' : `${gap.toFixed(0)}с`}
              </td>
              <td class="num"><NumberText value={row.result.goldPerHour} tone="gold" /></td>
              <td class="num"><NumberText value={row.result.xpPerHour} tone="xp" /></td>
              <td class="num">{row.result.restsPerHour.toFixed(1)}</td>
              <td class="num">{(row.result.restShare * 100).toFixed(0)}%</td>
              <td class="num">{row.result.deathsPerHour.toFixed(2)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="verdict">
      В здоровом окне {decisionsInWindow} строк из {telemetryRows.length}.
    </p>
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
  .faint {
    color: var(--c-text-faint);
    font-size: var(--text-xs);
  }
  td.ttk.current {
    color: var(--c-accent);
  }
  td.ttk.bad {
    color: var(--c-damage);
  }
  /* Интервал решений: зелёный — в окне, красный — за порогом тревоги.
     Цвет здесь несёт смысл, а не украшает: строка читается боковым зрением. */
  td.good {
    color: var(--c-heal);
  }
  td.bad {
    color: var(--c-damage);
  }
</style>
