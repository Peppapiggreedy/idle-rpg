# Idle RPG

Idle RPG в браузере: герой сам сражается с мобами, набирает уровни, собирает
добычу и продвигается по зонам — даже когда вкладка закрыта. Числа растут без
ограничений благодаря [break_infinity.js](https://github.com/Patashu/break_infinity.js).

Стек: [Vite](https://vite.dev/) + [Svelte 5](https://svelte.dev/) + TypeScript.

## Играть

Игра доступна по адресу: **https://Peppapiggreedy.github.io/idle-rpg/**

Деплой происходит автоматически при каждом пуше в `main`
(см. [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)).

## Как проверить, что деплой жив

1. Открой вкладку **Actions** и убедись, что последний прогон «Deploy to GitHub Pages»
   зелёный — в нём два job'а: `build` и `deploy`.
2. Открой https://Peppapiggreedy.github.io/idle-rpg/ — должна загрузиться страница игры.
   Если браузер показывает старую версию, обнови страницу с очисткой кеша
   (Ctrl+Shift+R / Cmd+Shift+R).
3. Если вместо игры **404**: зайди в Settings → Pages и проверь, что в разделе
   Source выбрано **GitHub Actions**. Workflow пытается включить это сам
   (`enablement: true`), но если у токена не хватило прав — переключи вручную
   и перезапусти workflow кнопкой «Run workflow».
4. Если страница белая, а в консоли браузера ошибки загрузки `/assets/...`:
   значит разъехался `base` в [`vite.config.ts`](vite.config.ts) — он должен быть
   ровно `'/idle-rpg/'`, совпадая с именем репозитория.

## Запуск локально

```bash
npm install
npm run dev
```

Другие команды:

```bash
npm run build              # продакшен-сборка в dist/
npm run preview            # локальный просмотр сборки
npm run check              # проверка типов (svelte-check + tsc)
npm run test               # быстрый набор: типы, юниты, golden, контент (~30 с)
npm run test:balance       # прогон баланса целиком (~13 мин)
npm run test:balance:sample # он же выборкой (~2 мин)
npm run test:visual        # сборка + скриншоты (Playwright)
npm run test:all           # всё подряд
npm run screenshots:update # обновить эталоны скриншотов
```

## Отладочные адреса

Работают только с `?debug=1` — обычному игроку по ссылке ничего не подменить.

| Адрес | Что показывает |
|---|---|
| `?debug=1` | отладочный оверлей и панель: скорость симуляции, чит-кнопки, сид rng |
| `/ui?debug=1` | витрина дизайн-системы: примитивы, палитра, редкости, типографика |
| `/balance?debug=1` | прогон баланса: те же таблицы, что печатает тест |
| `?debug=1&state=fresh` | заранее заданное состояние для съёмки (`fresh`, `mid`, `rich`) |
| `?scene=off` | выключить боевую сцену и оставить только DOM (единственный, кому `?debug=1` не нужен) |

## Структура проекта

```
src/
  lib/
    game/    # игровая логика: тики, бой, формулы, сейв
    stores/  # Svelte-сторы: игровое состояние и настройки интерфейса
    ui/      # Svelte-компоненты; ui/kit — примитивы, ui/tokens.css — токены
    data/    # статические данные: мобы, предметы, зоны, баланс
    types/   # TypeScript-типы и интерфейсы
  App.svelte # корневой компонент
  main.ts    # точка входа
tests/       # визуальная проверка: спека Playwright и эталоны скриншотов
```

Подробнее — [ARCHITECTURE.md](ARCHITECTURE.md). Благодарности и лицензии
зависимостей — [CREDITS.md](CREDITS.md).
