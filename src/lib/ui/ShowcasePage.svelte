<script lang="ts">
  // Витрина дизайн-системы: всё, из чего собран интерфейс, на одной странице.
  // У владельца проекта нет локальной среды — это его единственная возможность
  // увидеть все примитивы во всех состояниях сразу, поэтому здесь плотно.
  import { Decimal } from '../game'
  import { RARITIES } from '../data/rarity'
  import { Button, IconSlot, NumberText, Panel, StatBar, Tag, Tooltip, rarityStyle } from './kit'
  import ItemMods from './ItemMods.svelte'
  import type { Rarity } from '../types'
  import type { StatModifier } from '../game'

  // --- Палитра. Список ведём руками: витрина обязана показывать токен вместе
  // с его именем, а CSS не умеет перечислять свои кастомные свойства.
  const SURFACES = [
    { token: '--c-bg', name: 'фон страницы' },
    { token: '--c-surface', name: 'поверхность панели' },
    { token: '--c-surface-raised', name: 'приподнятая' },
    { token: '--c-surface-sunken', name: 'утопленная' },
    { token: '--c-border', name: 'граница' },
    { token: '--c-border-strong', name: 'граница активная' },
  ]
  const TEXTS = [
    { token: '--c-text', name: 'основной текст' },
    { token: '--c-text-muted', name: 'второстепенный' },
    { token: '--c-text-faint', name: 'подписи' },
  ]
  const SEMANTIC = [
    { token: '--c-accent', name: 'акцент — взаимодействие' },
    { token: '--c-accent-strong', name: 'акцент под курсором' },
    { token: '--c-damage', name: 'урон' },
    { token: '--c-heal', name: 'лечение и здоровье' },
    { token: '--c-mana', name: 'мана' },
    { token: '--c-xp', name: 'опыт и прокачка' },
    { token: '--c-gold', name: 'золото' },
    { token: '--c-warning', name: 'предупреждение' },
  ]

  const SPACES = ['--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6']
  const RADII = ['--radius-sm', '--radius-md', '--radius-lg', '--radius-pill']
  const SHADOWS = ['--shadow-sm', '--shadow-md', '--shadow-lg']
  const TYPE = [
    { token: '--text-2xs', name: '11px — подписи слотов, бейджи' },
    { token: '--text-xs', name: '12px — сноски, причины отказа' },
    { token: '--text-sm', name: '14px — плотный интерфейс' },
    { token: '--text-md', name: '16px — основной текст' },
    { token: '--text-lg', name: '18px — заголовок панели' },
    { token: '--text-xl', name: '24px — крупное число' },
    { token: '--text-2xl', name: '32px — заголовок страницы' },
  ]
  const WEIGHTS = [
    { token: '--weight-regular', name: 'обычный' },
    { token: '--weight-medium', name: 'средний' },
    { token: '--weight-bold', name: 'жирный' },
  ]

  // Считанное значение токена — чтобы рядом со swatch стояло само число.
  let resolved = $state<Record<string, string>>({})
  $effect(() => {
    const style = getComputedStyle(document.documentElement)
    const all = [...SURFACES, ...TEXTS, ...SEMANTIC].map((t) => t.token)
    const extra = [...SPACES, ...RADII, ...TYPE.map((t) => t.token)]
    resolved = Object.fromEntries(
      [...all, ...extra].map((token) => [token, style.getPropertyValue(token).trim()]),
    )
  })

  const RARITY_IDS = RARITIES.map((r) => r.id) as Rarity[]

  // Живая полоска: витрина должна показывать плавность, а не статичную заливку.
  // При системной настройке «меньше движения» полоска замирает — это и
  // правильная реакция на настройку, и условие воспроизводимости снимков.
  let pulse = $state(72)
  $effect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(() => {
      pulse = pulse <= 4 ? 100 : pulse - 6
    }, 400)
    return () => clearInterval(id)
  })

  let busy = $state(false)
  function fakeWork() {
    busy = true
    setTimeout(() => (busy = false), 1600)
  }

  const SAMPLE_MODS: StatModifier[] = [
    { stat: 'weaponSpeed', kind: 'base', value: new Decimal(3.4), source: 'equipment:weapon' },
    { stat: 'weaponDamageMin', kind: 'base', value: new Decimal(34), source: 'equipment:weapon' },
    { stat: 'attackPower', kind: 'percent', value: new Decimal(0.1), source: 'equipment:weapon' },
    { stat: 'critChance', kind: 'flat', value: new Decimal(0.03), source: 'equipment:trinket' },
  ]

  const NUMBERS = [
    new Decimal(7),
    new Decimal(942),
    new Decimal(15_400),
    new Decimal(2_360_000),
    new Decimal(8.4e12),
    new Decimal(1.2e34),
  ]
</script>

<main>
  <header class="page-head">
    <h1>Витрина интерфейса</h1>
    <p class="lead">
      Всё, из чего собрана игра: палитра, шкалы и примитивы во всех состояниях.
      Тема одна — тёмная, переключалки нет. Значения читаются из
      <code>tokens.css</code>; цвета редкостей — из <code>data/rarity.ts</code>.
    </p>
  </header>

  <!-- ================= ПАЛИТРА ================= -->
  <Panel title="Палитра" subtitle="Поверхности и текст">
    <div class="swatches">
      {#each SURFACES as t (t.token)}
        <div class="swatch">
          <span class="chip" style="background: var({t.token})"></span>
          <span class="chip-name">{t.name}</span>
          <code>{t.token}</code>
          <span class="chip-value">{resolved[t.token] ?? ''}</span>
        </div>
      {/each}
    </div>
    <div class="text-samples">
      {#each TEXTS as t (t.token)}
        <div class="text-sample" style="color: var({t.token})">
          <span>Съешь ещё этих мягких булок · 1 234 567</span>
          <code>{t.token}</code>
          <span class="chip-value">{resolved[t.token] ?? ''}</span>
        </div>
      {/each}
    </div>
  </Panel>

  <Panel title="Семантика" subtitle="Каждый цвет отвечает ровно за одно">
    <div class="swatches">
      {#each SEMANTIC as t (t.token)}
        <div class="swatch">
          <span class="chip" style="background: var({t.token})"></span>
          <span class="chip-name">{t.name}</span>
          <code>{t.token}</code>
          <span class="chip-value">{resolved[t.token] ?? ''}</span>
        </div>
      {/each}
    </div>
  </Panel>

  <Panel title="Редкости" subtitle="Цвета не дублируются в токенах — источник один, data/rarity.ts">
    <div class="rarities">
      {#each RARITIES as r (r.id)}
        <div class="rarity-row" style={rarityStyle(r.id)}>
          <span class="chip" style="background: var(--rarity-color)"></span>
          <Tag rarity={r.id} size="md" />
          <span class="chip-name">вес {r.weight} · бонус ×{r.bonusMult.toString()}</span>
          <code>{r.color}</code>
        </div>
      {/each}
    </div>
  </Panel>

  <!-- ================= ТИПОГРАФИКА ================= -->
  <Panel title="Типографика" subtitle="Один шрифт: Inter, кириллица, табличные цифры">
    <div class="type-scale">
      {#each TYPE as t (t.token)}
        <div class="type-row">
          <span class="type-sample" style="font-size: var({t.token})">
            Пастуший луг — 1 234 567 золота
          </span>
          <span class="type-meta">
            <code>{t.token}</code>
            <span class="chip-value">{t.name}</span>
          </span>
        </div>
      {/each}
    </div>
    <div class="weights">
      {#each WEIGHTS as w (w.token)}
        <span style="font-weight: var({w.token})">{w.name} · Ярость 42</span>
      {/each}
    </div>
    <div class="tabular">
      <p class="note">
        Табличные цифры включены глобально: столбец не дёргается, когда число
        меняется каждый тик.
      </p>
      <div class="tabular-cols">
        <div><span>1 111</span><span>8 888</span><span>1 010</span></div>
        <div class="mono"><span>ui-monospace</span><span>--font-mono</span></div>
      </div>
    </div>
  </Panel>

  <!-- ================= ШКАЛЫ ================= -->
  <Panel title="Отступы, радиусы, тени">
    <div class="spaces">
      {#each SPACES as token (token)}
        <div class="space-row">
          <span class="space-bar" style="width: var({token})"></span>
          <code>{token}</code>
          <span class="chip-value">{resolved[token] ?? ''}</span>
        </div>
      {/each}
    </div>
    <div class="radii">
      {#each RADII as token (token)}
        <div class="radius-box" style="border-radius: var({token})">
          <code>{token}</code>
        </div>
      {/each}
    </div>
    <div class="shadows">
      {#each SHADOWS as token (token)}
        <div class="shadow-box" style="box-shadow: var({token})">
          <code>{token}</code>
        </div>
      {/each}
    </div>
    <p class="note">
      Брейкпоинт один: мобильный до 720px, десктоп от 720px. Сузь окно — сетки
      ниже перестроятся в одну колонку.
    </p>
  </Panel>

  <!-- ================= КНОПКИ ================= -->
  <Panel title="Button" subtitle="три варианта × состояния × два размера">
    <div class="matrix">
      {#each ['primary', 'ghost', 'danger'] as const as variant (variant)}
        <div class="matrix-row">
          <span class="matrix-label">{variant}</span>
          <Button {variant}>Обычная</Button>
          <Button {variant} disabled>Недоступна</Button>
          <Button {variant} loading>Идёт работа</Button>
          <Button {variant} size="sm">Мелкая</Button>
          <Button {variant} size="sm" disabled>Мелкая недоступна</Button>
        </div>
      {/each}
    </div>
    <div class="matrix-row">
      <span class="matrix-label">живая</span>
      <Button variant="primary" loading={busy} onclick={fakeWork}>
        {busy ? 'Считаю…' : 'Нажми — покажу loading'}
      </Button>
      <Tooltip text={'Подсказка на наведении и на фокусе.\nПереносы строк сохраняются.'}>
        <Button variant="ghost">С подсказкой</Button>
      </Tooltip>
    </div>
    <div class="block-demo">
      <Button variant="primary" block>Кнопка во всю ширину</Button>
    </div>
  </Panel>

  <!-- ================= ПОЛОСКИ ================= -->
  <Panel title="StatBar" subtitle="семантика, размеры и плавность за игровым тиком">
    <div class="bars">
      <StatBar value={pulse} tone="hp" size="lg" label="Здоровье" valueLabel="{pulse} / 100" />
      <StatBar value={pulse} tone="mana" label="Мана" valueLabel="{pulse} / 100" />
      <StatBar value={pulse} tone="xp" size="sm" label="Опыт" valueLabel="{pulse}%" />
      <StatBar value={100 - pulse} tone="damage" size="lg" label="HP моба" />
      <StatBar value={pulse} tone="accent" label="Акцент" />
      <StatBar value={pulse} tone="neutral" label="Нейтральная (воскрешение)" />
      <StatBar value={100} tone="hp" label="Полная" valueLabel="100%" />
      <StatBar value={0} tone="damage" label="Пустая" valueLabel="0%" />
    </div>
  </Panel>

  <!-- ================= ЯЧЕЙКИ И ЯРЛЫКИ ================= -->
  <Panel title="IconSlot" subtitle="пустая ячейка и все пять редкостей">
    <div class="slots">
      <IconSlot slotLabel="Оружие" />
      {#each RARITY_IDS as rarity (rarity)}
        <IconSlot slotLabel="Оружие" {rarity} active={rarity === 'legendary'}>
          <span class="item-name">Щербатый Крушитель</span>
          <Tag {rarity} />
          <ItemMods mods={SAMPLE_MODS} />
          {#snippet footer()}
            <Button size="sm">Надеть</Button>
            <Button size="sm" variant="danger">Продать</Button>
          {/snippet}
        </IconSlot>
      {/each}
    </div>
  </Panel>

  <Panel title="Tag" subtitle="редкости и семантические тона">
    <div class="tags">
      {#each RARITY_IDS as rarity (rarity)}
        <Tag {rarity} />
      {/each}
    </div>
    <div class="tags">
      {#each RARITY_IDS as rarity (rarity)}
        <Tag {rarity} size="md" />
      {/each}
    </div>
    <div class="tags">
      <Tag tone="neutral" label="нейтральный" size="md" />
      <Tag tone="accent" label="акцент" size="md" />
      <Tag tone="gold" label="золото" size="md" />
      <Tag tone="xp" label="опыт" size="md" />
      <Tag tone="damage" label="урон" size="md" />
      <Tag tone="warning" label="предупреждение" size="md" />
    </div>
  </Panel>

  <!-- ================= ЧИСЛА ================= -->
  <Panel title="NumberText" subtitle="formatNumber, табличные цифры, семантика и знак">
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>значение</th>
            <th>plain</th>
            <th>gold</th>
            <th>xp</th>
            <th>damage</th>
            <th>+ знак</th>
            <th>xl</th>
          </tr>
        </thead>
        <tbody>
          {#each NUMBERS as value, i (i)}
            <tr>
              <td class="raw">{value.toExponential(2)}</td>
              <td><NumberText {value} /></td>
              <td><NumberText {value} tone="gold" /></td>
              <td><NumberText {value} tone="xp" /></td>
              <td><NumberText value={value.neg()} tone="damage" sign="auto" /></td>
              <td><NumberText {value} tone="hp" sign="plus" /></td>
              <td><NumberText {value} size="xl" tone="accent" /></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="tags">
      <NumberText value={3.4} decimals={2} suffix="с" tone="muted" />
      <NumberText value={0.05} decimals={0} prefix="крит " suffix="%" tone="accent" />
      <NumberText value={new Decimal(1250)} tone="gold" bold prefix="цена " />
    </div>
  </Panel>

  <!-- ================= ПОДСКАЗКИ ================= -->
  <Panel title="Tooltip" subtitle="сверху и снизу; на узком экране скрывается">
    <div class="tooltips">
      <Tooltip text={'Сверху — как у кнопок умений.\nВторая строка.'} placement="top">
        <Button>Подсказка сверху</Button>
      </Tooltip>
      <Tooltip text="Снизу — когда элемент у верхнего края экрана." placement="bottom">
        <Button>Подсказка снизу</Button>
      </Tooltip>
      <Tooltip
        text={'Широкий пузырь для длинных пояснений: столько герой выдаёт сам, автокастом — он реагирует на полсекунды позже и не придерживает кулдауны.'}
        width="wide"
      >
        <Button variant="ghost">Широкая подсказка</Button>
      </Tooltip>
    </div>
    <div class="tooltips">
      <Tooltip text={'Так пузырь выглядит раскрытым.\nБез наведения его не увидеть, поэтому на витрине он открыт принудительно.'} open>
        <Button variant="ghost">Открыта принудительно</Button>
      </Tooltip>
      <Tooltip text="И снизу тоже." placement="bottom" open>
        <Button variant="ghost">Открыта снизу</Button>
      </Tooltip>
    </div>
  </Panel>

  <!-- ================= ПАНЕЛИ ================= -->
  <Panel title="Panel" subtitle="тона и плотность">
    <div class="panels">
      <Panel title="plain" subtitle="обычная панель">
        Поверхность, граница, радиус и набивка — из токенов.
      </Panel>
      <Panel title="raised" tone="raised" subtitle="модалка и всё поверх">
        Приподнятая поверхность и тень.
      </Panel>
      <Panel title="quiet" tone="quiet" subtitle="вложенный блок без фона">
        Ни фона, ни границы, ни набивки.
      </Panel>
      <Panel title="dense" dense subtitle="плотная набивка">
        {#snippet header()}
          <Tag tone="accent" label="header" size="md" />
        {/snippet}
        Каждая строка на счету.
        {#snippet footer()}
          <span>подвал панели</span>
          <Button size="sm">действие</Button>
        {/snippet}
      </Panel>
    </div>
  </Panel>

  <p class="back"><a href="./?debug=1">← вернуться в игру</a> · <a href="./balance?debug=1">прогон баланса →</a></p>
</main>

<style>
  main {
    max-width: 60rem;
    margin: 0 auto;
    padding: var(--space-6) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .page-head h1 {
    margin: 0;
    font-size: var(--text-2xl);
    line-height: var(--leading-tight);
  }
  .lead,
  .note {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    color: var(--c-text-muted);
  }
  .note {
    margin: 0;
  }

  /* --- палитра --- */
  .swatches {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: var(--space-2);
  }
  .swatch,
  .rarity-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
  }
  .chip {
    width: var(--space-5);
    height: var(--space-5);
    flex: none;
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-sm);
  }
  .chip-name {
    flex: 1;
    color: var(--c-text-muted);
  }
  .chip-value {
    color: var(--c-text-faint);
  }
  .text-samples {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .text-sample {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    flex-wrap: wrap;
    font-size: var(--text-sm);
  }
  .rarities {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  /* --- типографика --- */
  .type-scale {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .type-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--c-border);
  }
  .type-sample {
    line-height: var(--leading-tight);
  }
  .type-meta {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    font-size: var(--text-xs);
  }
  .weights {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
    font-size: var(--text-md);
  }
  .tabular-cols {
    display: flex;
    gap: var(--space-6);
    margin-top: var(--space-2);
    font-size: var(--text-sm);
  }
  .tabular-cols div {
    display: flex;
    flex-direction: column;
  }
  .tabular-cols .mono {
    font-family: var(--font-mono);
    color: var(--c-text-faint);
  }

  /* --- шкалы --- */
  .spaces {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .space-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-xs);
  }
  .space-bar {
    height: var(--space-3);
    background: var(--c-accent);
    border-radius: var(--radius-sm);
    flex: none;
  }
  .radii,
  .shadows {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .radius-box,
  .shadow-box {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 8rem;
    padding: var(--space-4) var(--space-3);
    background: var(--c-surface-raised);
    border: 1px solid var(--c-border);
    font-size: var(--text-2xs);
  }
  .shadow-box {
    border-radius: var(--radius-md);
  }

  /* --- матрицы примитивов --- */
  .matrix {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .matrix-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .matrix-label {
    min-width: 5rem;
    font-size: var(--text-xs);
    color: var(--c-text-faint);
    font-family: var(--font-mono);
  }
  .block-demo {
    max-width: 22rem;
  }
  .bars {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
  }
  .slots {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: var(--space-2);
  }
  .item-name {
    font-weight: var(--weight-bold);
  }
  .tags {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    align-items: center;
  }
  .tooltips {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
    padding: var(--space-6) 0;
  }
  .panels {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
  }

  /* --- таблица чисел --- */
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
  td.raw,
  th:first-child {
    text-align: left;
    color: var(--c-text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .back {
    margin-top: var(--space-5);
    font-size: var(--text-sm);
  }

  @media (min-width: 720px) {
    main {
      padding: var(--space-6);
    }
    .bars {
      grid-template-columns: 1fr 1fr;
    }
    .panels {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
