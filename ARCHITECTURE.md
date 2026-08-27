# ARCHITECTURE.md — реальное состояние кода

Снимок после ввода дерева талантов (ветка claude/talents).
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
| `rng.ts` | тип `Rng`, `createRng(seed)` (mulberry32), `randRange(rng, min, max)` (при min = max поток не расходуется), `randomSeed()` без Math.random. Единственный источник случайности | numbers |
| `events.ts` | шина `AttackEvent`: `emit`/`subscribe`. Логика эмитит, UI подписывается (задел под всплывающие числа урона) | types |
| `stats.ts` | **конвейер статов — единственный источник правды производных чисел**: 13 стат, модификаторы {stat, kind: **base**/flat/percent/multiplier, value, source}, порядок base → +flat → ×(1+Σpercent) → ×multiplier; `base` заменяет дефолт `BASE_STATS` (последний выигрывает при дублях); производный `swingTime = weaponSpeed/(1+haste)` вне `StatId` — модификатор на него невозможен; `collectModifiers` собирает источники в порядке экипировка → апгрейды; кеш `statsDirty`/`ensureStats` (прогресс замаха трогать не нужно — он в долях); `applyModifiers` (чистое ядро), `explainStat`/`explainSwingTime` для панели | numbers, state (тип), data/{balance,upgrades,slots} |
| `talents.ts` | правила дерева: `earnedPoints`/`availablePoints` (очки — производная от уровня, отдельного счётчика нет), `talentStatus` (коды отказа `no-points`/`max-rank`/`branch-locked`), `investTalent`, `resetTalents`/`resetCost`, `talentFlags`, `talentAbilityEffect`, `reviveMultiplier`. Чистые производные (`rankOf`, `talentModifiers`) живут в данных и оттуда же читаются `stats.ts` — цикла импортов нет | numbers, stats, state, data/{talents,balance} |
| `rotation.ts` | раскладка ротации по приоритетам под ограничение маны: `rotationRate(stats, settings, plan)`, где `plan` — две оси, «через задержку реакции или сразу» и «только отмеченное галкой или всё». Отсюда берутся обе цифры урона в секунду; своей формулы урона нет | numbers, combat, state, data/{abilities,balance} |
| `abilities.ts` | активные умения: `abilityStatus` (коды отказа `dead`/`cooldown`/`gcd`/`no-mana`), `useAbility` (мгновенное бьёт сразу, `onNextSwing` встаёт в очередь / снимается с неё), `consumeQueuedAbility` (замах заменяется умением, мана списывается здесь), `advanceCooldowns`, `autocastStep` (таймер реакции по каждому умению + применение первого доступного по приоритету) и `autocastCandidates`. Своей формулы урона нет — зовёт `rollSwing` с долей `weaponDamagePercent` | numbers, combat, state, data/{balance,abilities} |
| `zones.ts` | доступ к зонам (`isZoneUnlocked`), переходы (`travelToZone`, `activateAbility`, `setAbilityAutocast`, `moveAbilityPriority`, `investTalentPoint`, `resetTalentTree`, `reviveInZone`, `retreatZone`) и **честный прогноз опасности**: `zoneRate` (темп зоны — среднее по пулу × уровням, смертность один раз на зону по средней потере HP) и `forecastZone` → `ZoneForecast` с кодом вердикта `safe/risky/deadly/hopeless`. Своей формулы боя нет — зовёт `estimateCombatRate` | numbers, combat, state, data/{balance,zones} |
| `equipment.ts` | надеть/снять/сравнить: `equipItem` (снятое возвращается в инвентарь), `unequipItem` (нужен свободный слот сумки), `isEquipped`, `isUpgrade` и `autoEquipIfBetter` (**строго по `estimateCombatRate().damagePerSecond`**, не по сумме статов), `compareItem` → `EquipComparison` с производными числами для UI | combat, stats, state, data/{balance,slots}, types |
| `combat.ts` | **ЕДИНСТВЕННЫЙ дом боевых формул**: `rollSwing` (бросок урона оружия + вклад силы атаки + крит), `rollMonsterDamage`, `swingDamageRange`/`expectedSwingDamage`/`critFactor`, `estimateCombatRate` (урон/с, убийств/с, uptime, время до смерти; цикл «фарм → смерть → воскрешение»). tick вызывает эти функции, оффлайн-агрегат — только `estimateCombatRate`; своей формулы нет ни у кого | numbers, rng, state, stats, data/balance, types |
| `formulas.ts` | `upgradeCost` (base·1.15^owned), `xpToNextLevel` (floor(10·L^1.5) с эпсилоном против погрешности pow), `applyXp` (перенос остатка, мультиуровень, предохранитель) | numbers, types |
| `loop.ts` | планировщик: rAF + аккумулятор, фикс. шаг `STEP_MS=100`, максимум 10 шагов/кадр, сброс «долга»; метрики fps/tps; `setSpeed(m)` — дебаг-ускорение игрового времени (лимит шагов за кадр сохраняется). Технические константы живут здесь — это не баланс | — |
| `state.ts` | `GameState`, `createInitialState(seed?)`, `spawnMonster`, `pushEvent`, `COMBAT_LOG_SIZE`. Общая зависимость tick/loot/save — взаимных импортов между ними нет | numbers, formulas, rng, data/{monsters,balance}, types |
| `tick.ts` | **конвейер тика** из шести чистых шагов `(state, ctx) => state` (см. раздел 3); реэкспорт state-модуля для совместимости | numbers, formulas, loot, rng, state, data/{balance,monsters}, types |
| `upgrades.ts` | `buyUpgrade`, `ownedCount` | numbers, formulas, state, types |
| `loot.ts` | `rollRarity` и `rollSlot` (взвешенные рулетки), `rollLoot` (шанс → редкость → слот → имя → модификаторы), `sellItem` (надетое продать нельзя)/`sellPrice` | numbers, rng, state, equipment, data/{rarity,loot,slots,items}, types |
| `save.ts` | формат сейва v7, миграции, localStorage (инжектируемый), оффлайн-прогресс агрегатом, base64 экспорт/импорт, коды ошибок загрузки | numbers, formulas, state, stats, data/{balance,loot,monsters,rarity,slots}, types |
| `index.ts` | фасад: реэкспорт всего публичного | все выше |

Тесты: рядом с кодом (`*.test.ts`) + `__tests__/golden.test.ts` (характеризационный,
час симуляции против эталона `__snapshots__/golden.json`) и `__tests__/fixtures.test.ts`
(реальные сейвы v0…v7 из `__fixtures__/`).

### `src/lib/data/` — статические данные и баланс

| Файл | Содержимое |
|---|---|
| `balance.ts` | **общий баланс**: `BASE_STATS` (13 стат), `UNARMED` (2.0с, урон 8–12), `PER_LEVEL` (что даёт уровень персонажа: +14 hp, +0.8 регена hp, +5 маны, +0.5 регена маны), `AUTOCAST_DELAY_MS` (0.5с), `AUTOCAST_MAX_LOSS` (0.2), `OFFLINE_EFFICIENCY` (0.9), `TALENT_FIRST_LEVEL` (10) и цена сброса талантов, `AP_NORMALIZATION`, пороги вердикта зоны, респаун 300 мс, 12 слотов инвентаря, потолок оффлайна 8 ч и его шаг 1 мин, автосейв 15 с, воскрешение 30 с, `LEGACY_V3_SWING_TIME_S` (замороженная константа миграции) |
| `monsters.ts` | роли мобов (`RUNT`/`COMMON`/`BRUTE`), база моба 1 уровня и **формула масштаба от уровня**: hp ×1.35/ур., урон ×1.12/ур., награда ×1.25/ур.; `buildMonster(архетип, уровень, множитель зоны)` |
| `abilities.ts` | 3 умения: Скорый выпад (instant, 9 маны, кд 2с, 160% удара), Рваная рана (onNextSwing, 15 маны, кд 5с, 180% + 3 тика по 50%), Сокрушение (onNextSwing, 30 маны, кд 12с, 500%). Урон — доля удара оружия, не множитель к силе атаки |
| `talents.ts` | 2 ветки по 4 таланта: Ярость (сила атаки → крит → множитель крита → флаг «Скорый выпад накладывает урон по времени») и Стойкость (здоровье → реген → мана и снижение урона → флаг «воскрешение вдвое быстрее»). Эффект — либо модификаторы `stats.ts`, либо флаг с payload; `rankOf` и `talentModifiers` — чистые производные |
| `zones.ts` | 4 зоны (Пастуший луг 1–2, Полая каменоломня 4–6, Топкие лощины 9–12, Пепельный гребень 16–20): пул из трёх архетипов, множитель награды, требование по уровню персонажа, флаг безопасной; `zoneMonsterVariants` (весь набор возможных спавнов) и `representativeMonster` |
| `upgrades.ts` | «Заточка оружия»: база 10, рост 1.15, +1 к урону |
| `rarity.ts` | 5 тиров: веса рулетки, цвета редкостей (единственное место), множители бонуса и цены |
| `loot.ts` | 8 прилагательных, шанс дропа 25%, базовая цена, имя-заглушка битого предмета |
| `slots.ts` | 6 слотов (`weapon/head/chest/hands/legs/trinket`), их названия и веса в рулетке дропа |
| `items.ts` | 3 оружия с заметно разной скоростью и **одинаковым** отношением средний урон/скорость = 7.5 (Змеезуб 1.4с 7–14, Полуторник 2.2с 11–22, Крушитель 3.4с 17–34) + их побочные статы; существительные брони по слотам; базовые прибавки брони |

### `src/lib/stores/game.ts` — мост логика↔UI

`writable(GameState)` (наружу `readonly`), `loopMetrics`, `offlineReport`,
`saveNotice` (**коды** `NoticeCode`, не строки). Экшены: `purchaseUpgrade`,
`sellInventoryItem`, `equipInventoryItem`, `unequipSlot`, `toggleAutoEquip`,
`travelToZone`, `activateAbility`, `setAbilityAutocast`, `moveAbilityPriority`, `investTalentPoint`, `resetTalentTree`,
`exportSaveString`, `importSaveString`, `initGame`,
`persistNow`, `startGameLoop`/`stopGameLoop`. Rng создаётся один раз из
`state.rngSeed`. Автосейв: счётчик копит шаг конвейера `applyAutosaveCounter`,
стор проверяет его после тика, сохраняет и сбрасывает.

### `src/lib/ui/` — 14 компонентов

`CombatScreen` (моб с его уровнем, HP-бар, статы; **рендер событий лога** — весь
русский текст боя в функции `eventText`), `HeroPanel`, `UpgradePanel`,
`TalentPanel` (две колонки-ветки, ранги вида 2/3, приглушённые таланты
объясняют причину: «нужно 5 очков в ветке» с прогрессом; сброс за золото),
`AbilityPanel` (кнопки с заливкой кулдауна, стоимостью маны и хоткеями 1/2/3
в порядке приоритета; галки «использовать автоматически» и стрелки приоритета;
текст причин отказа — здесь), `ZonePanel` (список зон: уровни мобов, награда в час и предупреждение, собранное
из вердикта и разрыва в уровнях — в данных зоны такого текста нет),
`EquipmentPanel` (6 слотов, кнопка «Снять», галочка автонадевания),
`InventoryPanel` (кнопки «Надеть»/«Продать»; при наведении — сравнение
производными числами: диапазон удара, скорость, урон в секунду и разница
с надетым), `ItemMods` (модификаторы предмета человеческим текстом),
`StatsPanel` (клик по стате раскрывает раскладку по источникам),
`SaveControls`, `OfflineModal`, `NoticeBar` (карта `NoticeCode` → текст),
`DebugOverlay` (`?debug=0` скрывает), `DebugPanel` (рендерится только при
`?debug=1`: множитель скорости симуляции ×1/×10/×100 через `loop.setSpeed`,
чит-кнопки дебаг-экшенами стора, удары/мин по шине, сид rng).

### `src/lib/types/index.ts`

Только используемое: `Monster` (с `level`), `MonsterTemplate`, `UpgradeDef`, `Rarity`, `Item`
(`{id, name, rarity, slot, mods}` — прямых полей бонуса нет), `CombatEvent` (включая `ability` и `effect` — с id умения, а не именем),
`AttackEvent` (у умения `abilityId` заполнен). `Decimal` импортируется из `game/numbers`, не из break_infinity.
Реальный формат сейва — `SavePayloadV11`, экспортируется из `save.ts`.

## 2. Состояние

- Один `writable<GameState>` в `stores/game.ts`; состав — в `game/state.ts`:
  totalTicks, playtimeMs, gold, level, currentXp, xpToNext, swingProgress (доля
  0..1), currentHp/currentMana, heroState/reviveMsLeft, upgrades, **equipment**
  (`Record<SlotId, Item|null>`), **autoEquip**, stats + statsDirty, inventory,
  itemSeq, rngSeed, **currentZoneId**, **lastSurvivedZoneId**, monster,
  respawnMsLeft, combatLog (события), msSinceAutosave, **gcdMsLeft**,
  **abilityCooldownsMs**, **queuedAbilityId**, **activeEffects**,
  **talents** (id → ранг), **talentResets**,
  **abilitySettings** (галка автокаста и приоритет по каждому умению),
  **autocastReadyMs** (таймер реакции; в сейв не пишется).
  Источники статов — `level`, `talents`, `upgrades` и `equipment`; прямых полей урона нет.
- Мутации — только через экшены стора: цикл (tick), покупка/продажа, initGame,
  импорт сейва, сброс счётчика автосейва.
- UI читает `$gameState` (readonly); чистые функции (`formatNumber`, `upgradeCost`,
  `sellPrice`) и данные (`RARITY_BY_ID`, `UPGRADES`) компоненты импортируют напрямую —
  это разрешено правилами.

## 3. Бой: дискретные удары в конвейере тика

`tick(state, dtMs, rng, emitAttack?)` — счётчики, затем шесть чистых шагов
в фиксированном порядке; факты тика передаются через контекст:

1. `applyRevive` — мёртвый герой: отсчёт 30 c; по нулю — полный HP и откат в последнюю зону, где он выживал (`lastSurvivedZoneId`), иначе в безопасную
2. `applyCooldowns` — кулдауны умений и GCD идут игровым временем
2a. `applyAutocast` — таймер реакции по каждому умению и применение первого доступного по приоритету
3. `applyPendingKill` — моб, добитый мгновенным умением ВНЕ тика: смерть оформляет конвейер, а не умение
4. `applyCombat` — удары героя по прогрессу замаха (доля `dt/swingTime`, остаток переносится); умение из очереди ЗАМЕНЯЕТ автоатаку; урон и крит считает `combat.rollSwing`; события `hit`/`ability` + шина
5. `applyEffects` — тики урона по времени; стоят ДО наград, потому что тоже могут убить моба
6. `applyKillRewards` — золото + событие `kill`; помечает текущую зону как выжитую
7. `applyLevelUps` — опыт через `applyXp` + событие `levelup`
8. `applyLootDrop` — бросок дропа + событие `loot`, затем `autoEquipIfBetter` (при включённом флаге и приросте урона в секунду)
9. `applyMonsterAttack` — ответные удары моба по своему `swingTime` из данных; урон считает `combat.rollMonsterDamage` (бросок из `damageMin..damageMax` ×(1−damageReduction));
   события `hurt` + шина; `currentHp <= 0` → `death`, таймер воскрешения
10. `applyRegen` — HP (в бою `hpRegen`, вне боя `hpRegenOutOfCombat`), мана `manaRegen`
11. `applyRespawn` — таймер 300 мс после смерти моба ИЛИ отсчёт и спавн из пула текущей зоны (`spawn`)
12. `applyAutosaveCounter` — копит игровое время для автосейва

rng потребляется в порядке: бросок урона оружия, крит-ролл, затем (на убийстве)
шанс дропа / редкость / слот / прилагательное / существительное-модель. Бросок урона моба поток не трогает, пока `damageMin = damageMax`. Лог — последние 8 событий. Формулы боя (все — в `combat.ts`):

```
swingTime   = weaponSpeed / (1 + haste)
swingDamage = (rand(weaponDamageMin, weaponDamageMax)
               + attackPower × weaponSpeed / AP_NORMALIZATION) × weaponDamagePercent
                                                    (AP_NORMALIZATION = 14)
```
`weaponDamagePercent` равен 1 у автоатаки и берётся из данных у умения — поэтому
умения масштабируются от оружия и делят с боем одну формулу. Побочный эффект,
ради которого так и сделано: при равном уроне в секунду медленное оружие даёт
БОЛЬШЕ урона за ману, чем быстрое (цена умения фиксирована, а удар крупнее).

Во второй формуле стоит БАЗОВАЯ `weaponSpeed`, а не ускоренная `swingTime`: иначе
haste сократился бы сам с собой и не повышал урон в секунду. Медленное оружие
получает больший вклад силы атаки за удар — ровно настолько, чтобы сравняться
по урону в секунду с быстрым (14 силы атаки = +1 урона в секунду при любой скорости).
База — `BASE_STATS` в `data/balance.ts`, безоружные значения — `UNARMED`
(скорость 2.0с, урон 8–12), апгрейд — flat-модификатор +14×счётчик к силе атаки.
Надетое оружие ЗАМЕНЯЕТ базу тремя модификаторами `kind: 'base'`
(`weaponSpeed`, `weaponDamageMin`, `weaponDamageMax`, source `equipment:weapon`);
снятое — возвращает `UNARMED`. Прогресс замаха хранится долей 0..1, поэтому
переодевание в середине замаха не даёт ни сброса, ни мгновенного удара.
Темп боя (dps с матожиданием критов, убийств/с) считает ТОЛЬКО
`estimateCombatRate` — им пользуются и UI, и оффлайн-агрегат; тест держит
расхождение оффлайна с реальной симуляцией часа в пределах 5%.
Спавн берёт моба из пула ТЕКУЩЕЙ зоны: бросок уровня из диапазона, затем бросок
архетипа. Лут в оффлайне не выпадает.

## 4. Сохранение

- Версия формата: **11** (`SAVE_VERSION`), ключ `idle-rpg-save`. Автосейв 15 с
  (значение в `data/balance.ts`) + `visibilitychange`.
- Формат — `SavePayloadV11` (Decimal строками): version, lastTimestamp, gold, level,
  currentXp, currentHp, currentMana, heroState, reviveMsLeft, upgrades,
  inventory[{id,name,rarity,slot,mods[]}], equipment (слот → предмет или null),
  autoEquip, currentZoneId, lastSurvivedZoneId, gcdMsLeft, abilityCooldownsMs,
  abilitySettings, talents, talentResets, itemSeq, totalTicks, playtimeMs.
  Ранг чужого таланта отбрасывается, свой режется по `maxRank`. Неизвестный id зоны при загрузке деградирует
  до безопасной; кулдаун чужого умения или больше своего максимума — отбрасывается
  либо подрезается. Очередь `onNextSwing` и наложенные эффекты НЕ сохраняются:
  они висели на мобе, а моб при загрузке спавнится заново. Модификатор с неизвестным статом
  или kind при загрузке отбрасывается, предмет в чужом слоте не надевается.
  Прямых полей урона в формате нет — статы
  пересчитываются из счётчиков покупок при загрузке. Не сохраняются: monster/respawn, combatLog, xpToNext,
  rngSeed, msSinceAutosave (восстанавливаются заново; сид при загрузке — свежий).
- Миграции: 0→1 (доверсионный формат, legacy-алиасы `xp`/`damagePerSecond`),
  1→2 (пустые inventory/itemSeq), 2→3 (конверсия dps → урон за удар),
  3→4 (прямые поля урона удалены, пересчёт из счётчиков), 4→5 (HP/мана/смертность;
  старый сейв просыпается живым с полным запасом), 5→6 (тождество: сменилась
  модель урона, набор полей — нет; версия помечает сейвы новой формулы),
  6→7 (`statBonus` предмета → `mods: [{attackPower, flat, value}]`, слот
  `trinket` — без base-модификаторов; экипировка пустая, предметы ждут
  в инвентаре), 7→8 (появились зоны: старый сейв просыпается в безопасной,
  `lastSurvivedZoneId` пуст), 8→9 (появились умения: кулдаунов не было — значит
  их и нет), 9→10 (появился автокаст: старый сейв получает настройки по
  умолчанию — все умения включены, приоритет по порядку данных), 10→11
  (появились таланты: дерево пустое, заработанные по уровню очки ждут игрока). Сейв из будущей версии и битый JSON → коды
  `newer-version`/`corrupted`, текст рендерит NoticeBar. Фикстуры всех версий — в
  `__fixtures__`, тесты грузят их через `loadGame`.
- Оффлайн: считается по модели **автокаста** и режется на `OFFLINE_EFFICIENCY`
  (железное правило `оффлайн <= автокаст <= ручная игра`); потолок 8 ч (balance),
  награда агрегатом ШАГАМИ по 1 мин — набранные
  уровни меняют живучесть, а с ней и темп; темп берётся у ТЕКУЩЕЙ зоны через
  `zoneRate`. Часы назад — ничего. Тест держит расхождение с реальным часом
  симуляции в пределах 8% (усреднение по пулу точнее одним агрегатом не сделать).

## 5. Расхождения с CLAUDE.md

Существенных расхождений нет: раздел «Экипировка» в CLAUDE.md описывает то, что
в коде. Оговорка одна — при полном инвентаре дроп не бросается вовсе, поэтому
и автонадевание при полной сумке не срабатывает (см. долг №4).

## 6. Техдолг под умения, таланты и визуальный слой

| # | Долг | Оценка | Почему |
|---|---|---|---|
| 1 | Оффлайн-агрегат усредняет темп по пулу зоны и считает смертность по средней потере HP; в бою запас HP переносится между схватками. Расхождение ~6% за час. | Терпит | Тест на 8% ловит уезд формулы; точнее — только проигрывание тиков |
| 2 | `rng` создаётся в сторе один раз, но позиция потока не сохраняется; реплеи «с середины» невозможны. | Терпит | Для сид-ранов достаточно текущего |
| 3 | `estimateCombatRate` оценивает удары на моба без критов (консервативно); при высоких крит-шансах погрешность оффлайна вырастет. | Терпит | Тест на 5% поймает, формулу можно уточнить |
| 4 | Полный инвентарь глушит дроп целиком: с 12/12 герой перестаёт находить и надевать вещи, пока не продаст. Видно в golden — статы упираются в потолок к 3000-му шагу. | **Мешает** | Лечится либо автопродажей худшего, либо надеванием мимо сумки; и то и другое — отдельная фича |
| 5 | Оффлайн-агрегат не учитывает лут: за 8 ч герой возвращается с золотом и опытом, но без новых вещей. | Терпит | Осознанное упрощение; лут в оффлайне — отдельная фича |

Закрыто ранее: монолитный tick → конвейер; лог строками → события; баланс →
`data/balance.ts`; типы-фантомы; взаимный импорт tick↔loot; дубли цветов;
оффлайн-формула, дублировавшая бой → `estimateCombatRate`; накопительная
мутация урона → конвейер статов; экипировка поверх конвейера (оружие задаёт базу
боя модификаторами `kind: 'base'`, прогресс замаха в долях); **захардкоженный
моб → зоны как данные** — спавн стал функцией `(zone, rng)`, `currentZoneId`
живёт в состоянии и в сейве.
