# Idle RPG

Idle RPG в браузере: герой сам сражается с мобами, набирает уровни, собирает
добычу и продвигается по зонам — даже когда вкладка закрыта. Числа растут без
ограничений благодаря [break_infinity.js](https://github.com/Patashu/break_infinity.js).

Стек: [Vite](https://vite.dev/) + [Svelte 5](https://svelte.dev/) + TypeScript.

## Играть

Игра будет доступна по адресу: **https://peppapiggreedy.github.io/idle-rpg/**

Деплой происходит автоматически при каждом пуше в `main`
(см. [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)).
В настройках репозитория (Settings → Pages) источником должен быть выбран
**GitHub Actions**.

## Запуск локально

```bash
npm install
npm run dev
```

Другие команды:

```bash
npm run build    # продакшен-сборка в dist/
npm run preview  # локальный просмотр сборки
npm run check    # проверка типов (svelte-check + tsc)
```

## Структура проекта

```
src/
  lib/
    game/    # игровая логика: тики, бой, формулы, сейв
    ui/      # Svelte-компоненты интерфейса
    data/    # статические данные: мобы, предметы, зоны
    types/   # TypeScript-типы и интерфейсы
  App.svelte # корневой компонент
  main.ts    # точка входа
```
