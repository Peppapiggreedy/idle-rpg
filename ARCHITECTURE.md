# ARCHITECTURE.md — реальное состояние кода

Снимок после рефакторинга «конвейер тика + события» (ветка pipeline-refactor).
Документ описывает то, что есть в `src/` фактически. Обновляется вместе с кодом.

## 1. Карта модулей

### Точка входа

| Файл | Отвечает за | Импортирует |
|---|---|---|
| `src/main.ts` | старт: `initGame()` (загрузка сейва) → mount App → `startGameLoop()`; слушатель `visibilitychange` для сейва при уходе вкладки в фон | `App.svelte`, `stores/game` |
| `src/App.svelte` | компоновка экрана, никакой логики | все компоненты `ui/` |
| `src/app.css` | глобальные стили; декоративные цвета `--color-gold` / `--color-xp` — единственное место определения | — |
| `src/vite-env.d.ts` | объявление `__BUILD_TIME__` (подставляется Vite define) | — |

### `src/lib/game/` — логика

| Файл | Отвечает за | Импортирует |
|---|---|---|
| `numbers.ts` | реэкспорт `Decimal` (единственная точка импорта break_infinity) и `formatNumber` (1.23K/…/1.00e15) | break_infinity.js |
| `rng.ts` | тип `Rng`, `createRng(seed)` (mulberry32), `randomSeed()` без Math.random. Единственный источник случайности | — |
| `formulas.ts` | `upgradeCost` (base·1.15^owned), `xpToNextLevel` (floor(10·L^1.5) с эпсилоном против погрешности pow), `applyXp` (перенос остатка, мультиуровень, предохранитель) | numbers, types |
| `loop.ts` | планировщик: rAF + аккумулятор, фикс. шаг `STEP_MS=100`, максимум 10 шагов/кадр, сброс «долга»; метрики fps/tps. Технические константы живут здесь — это не баланс | — |
| `state.ts` | `GameState`, `createInitialState(seed?)`, `spawnMonster`, `pushEvent`, `COMBAT_LOG_SIZE`. Общая зависимость tick/loot/save — взаимных импортов между ними нет | numbers, formulas, rng, data/{monsters,balance}, types |
| `tick.ts` | **конвейер тика** из шести чистых шагов `(state, ctx) => state` (см. раздел 3); реэкспорт state-модуля для совместимости | numbers, formulas, loot, rng, state, data/{balance,monsters}, types |
| `upgrades.ts` | `buyUpgrade`, `ownedCount` | numbers, formulas, state, types |
| `loot.ts` | `rollRarity` (взвешенная рулетка), `rollLoot` (шанс + генерация имени), `sellItem`/`sellPrice` | numbers, rng, state, data/{rarity,loot}, types |
| `save.ts` | формат сейва v2, миграции, localStorage (инжектируемый), оффлайн-прогресс агрегатом, base64 экспорт/импорт, коды ошибок загрузки | numbers, formulas, state, data/{balance,loot,monsters,rarity}, types |
| `index.ts` | фасад: реэкспорт всего публичного | все выше |

Тесты: рядом с кодом (`*.test.ts`) + `__tests__/golden.test.ts` (характеризационный,
час симуляции против эталона `__snapshots__/golden.json`) и `__tests__/fixtures.test.ts`
(реальные сейвы v0/v1/v2 из `__fixtures__/`).

### `src/lib/data/` — статические данные и баланс

| Файл | Содержимое |
|---|---|
| `balance.ts` | **общий баланс**: стартовый урон 10, респаун 300 мс, 12 слотов инвентаря, потолок оффлайна 8 ч, автосейв 15 с |
| `monsters.ts` | единственный моб «Луговой хлюпень»: 30 hp, +5 золота, +3 опыта |
| `upgrades.ts` | «Заточка оружия»: база 10, рост 1.15, +1 к урону |
| `rarity.ts` | 5 тиров: веса рулетки, цвета редкостей (единственное место), множители бонуса и цены |
| `loot.ts` | шаблоны имён 8×8, шанс дропа 25%, базовый бонус и цена, имя-заглушка битого предмета |

### `src/lib/stores/game.ts` — мост логика↔UI

`writable(GameState)` (наружу `readonly`), `loopMetrics`, `offlineReport`,
`saveNotice` (**коды** `NoticeCode`, не строки). Экшены: `purchaseUpgrade`,
`sellInventoryItem`, `exportSaveString`, `importSaveString`, `initGame`,
`persistNow`, `startGameLoop`/`stopGameLoop`. Rng создаётся один раз из
`state.rngSeed`. Автосейв: счётчик копит шаг конвейера `applyAutosaveCounter`,
стор проверяет его после тика, сохраняет и сбрасывает.

### `src/lib/ui/` — 8 компонентов

`CombatScreen` (моб, HP-бар, статы; **рендер событий лога** — весь русский текст
боя в функции `eventText`), `HeroPanel`, `UpgradePanel`, `InventoryPanel`,
`SaveControls`, `OfflineModal`, `NoticeBar` (карта `NoticeCode` → текст),
`DebugOverlay` (`?debug=0` скрывает).

### `src/lib/types/index.ts`

Только используемое: `Monster`, `MonsterTemplate`, `UpgradeDef`, `Rarity`, `Item`,
`CombatEvent`. `Decimal` импортируется из `game/numbers`, не из break_infinity.
Реальный формат сейва — `SavePayloadV2`, экспортируется из `save.ts`.

## 2. Состояние

- Один `writable<GameState>` в `stores/game.ts`; состав — в `game/state.ts`:
  totalTicks, playtimeMs, gold, level, currentXp, xpToNext, baseDamage, upgrades,
  inventory, itemSeq, rngSeed, monster, respawnMsLeft, combatLog (события),
  msSinceAutosave.
- Мутации — только через экшены стора: цикл (tick), покупка/продажа, initGame,
  импорт сейва, сброс счётчика автосейва.
- UI читает `$gameState` (readonly); чистые функции (`formatNumber`, `upgradeCost`,
  `sellPrice`) и данные (`RARITY_BY_ID`, `UPGRADES`) компоненты импортируют напрямую —
  это разрешено правилами.

## 3. Бой: конвейер тика

`tick(state, dtMs, rng)` — счётчики (totalTicks, playtimeMs), затем шесть чистых
шагов в фиксированном порядке; факты тика (убит ли моб) передаются через контекст:

1. `applyCombat` — урон `baseDamage × dtMs / 1000`; смерть фиксируется в ctx
2. `applyKillRewards` — золото + событие `kill`
3. `applyLevelUps` — опыт через `applyXp` + событие `levelup`
4. `applyLootDrop` — бросок дропа (единственный потребитель rng) + событие `loot`
5. `applyRespawn` — взводит таймер 300 мс после смерти ИЛИ ведёт отсчёт и спавнит (событие `spawn`)
6. `applyAutosaveCounter` — копит игровое время для автосейва

События (`CombatEvent`): `hit` (зарезервирован, в лог не пишется), `kill`,
`levelup`, `loot`, `spawn`. Лог — последние 5 событий, новые в начале.
Числа урона: старт из `data/balance.ts`, +1 за каждую заточку (см. долг №1).
Спавнится всегда `FIRST_MONSTER` (см. долг №2). Оффлайн-бой — отдельная формула
в `save.ts` (агрегат), лут в оффлайне не выпадает.

## 4. Сохранение

- Версия формата: **2** (`SAVE_VERSION`), ключ `idle-rpg-save`. Автосейв 15 с
  (значение в `data/balance.ts`) + `visibilitychange`.
- Формат — `SavePayloadV2` (Decimal строками): version, lastTimestamp, gold, level,
  currentXp, baseDamage, upgrades, inventory[{id,name,rarity,statBonus}], itemSeq,
  totalTicks, playtimeMs. Не сохраняются: monster/respawn, combatLog, xpToNext,
  rngSeed, msSinceAutosave (восстанавливаются заново; сид при загрузке — свежий).
- Миграции: 0→1 (доверсионный формат, legacy-алиасы `xp`/`damagePerSecond`),
  1→2 (пустые inventory/itemSeq). Сейв из будущей версии и битый JSON → коды
  `newer-version`/`corrupted`, текст рендерит NoticeBar. Фикстуры всех версий — в
  `__fixtures__`, тесты грузят их через `loadGame`.
- Оффлайн: потолок 8 ч (balance), награда агрегатом, часы назад — ничего.

## 5. Расхождения с CLAUDE.md

После рефакторинга и обновления CLAUDE.md под реальность существенных расхождений
не осталось. Единственное задокументированное: правило «никаких накопительных
мутаций статов» уже записано, но `buyUpgrade` пока мутирует `baseDamage`
накопительно — это долг №1, закрыть до экипировки.

## 6. Техдолг под экипировку, умения, таланты и зоны

| # | Долг | Оценка | Почему |
|---|---|---|---|
| 1 | **Урон — накопительная мутация, а не пересчёт из источников.** `baseDamage` = стартовые 10 + все купленные +1. Вклад источника невычитаем: надетый предмет нельзя будет снять. Нужен `effectiveDamage = f(уровень, апгрейды, экипировка)`. | **Блокирует** экипировку и таланты | Продажа надетого предмета иначе навсегда изменит урон |
| 2 | **Моб захардкожен**: `applyRespawn` всегда спавнит `FIRST_MONSTER`; `currentZoneId` в состоянии нет. | **Блокирует** зоны | Спавн должен стать функцией от зоны; сейв потребует v3 |
| 3 | **Оффлайн-формула дублирует бой** (`save.ts` считает цикл убийства сам). Новые боевые механики придётся отражать в двух местах. | **Мешает** | Вывести «убийств в секунду» в одну функцию для tick-баланса и оффлайна |
| 4 | `rng` создаётся в сторе один раз, но позиция потока не сохраняется; реплеи «с середины» невозможны. | Терпит | Для сид-ранов достаточно текущего |
| 5 | Событие `hit` объявлено, но не эмитится — визуальный слой (пункт 8 дорожной карты, числа урона) потребует решить, как его доставлять без записи в лог. | Терпит | Осознанная заглушка |

Закрыто рефакторингом (было в прошлой версии документа): монолитный tick →
конвейер; лог строками → события; баланс разбросан → `data/balance.ts`;
типы-фантомы удалены; взаимный импорт tick↔loot разорван через `state.ts`;
дубли декоративных цветов → CSS-переменные.
