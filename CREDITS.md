# Благодарности

Idle RPG собрана на чужих плечах. Здесь перечислено всё стороннее, что попало
в игру или в сборку, вместе с лицензиями.

## В самой игре

| Что | Зачем | Лицензия |
|---|---|---|
| [break_infinity.js](https://github.com/Patashu/break_infinity.js) | числа, которые растут без потолка: золото, урон, опыт | MIT |
| [Svelte](https://svelte.dev/) | интерфейс | MIT |
| [Inter](https://rsms.me/inter/) | единственный шрифт интерфейса; лежит в `public/fonts/` подмножествами кириллицы и латиницы | SIL Open Font License 1.1 |

## В сборке и проверках

| Что | Зачем | Лицензия |
|---|---|---|
| [Vite](https://vite.dev/) | сборка и локальный сервер | MIT |
| [TypeScript](https://www.typescriptlang.org/) | типы | Apache-2.0 |
| [Vitest](https://vitest.dev/) | тесты игровой логики | MIT |
| [Playwright](https://playwright.dev/) | съёмка и сравнение скриншотов | Apache-2.0 |
| [svelte-check](https://github.com/sveltejs/language-tools) | проверка типов в компонентах | MIT |

## Содержимое игры

Все названия зон, мобов, предметов, умений, талантов и данжей —
оригинальные. Ни ассетов, ни имён из чужих игр в проекте нет.

## Сама игра

Исходники: https://github.com/Peppapiggreedy/idle-rpg

## Иконки

Иконки интерфейса взяты с [game-icons.net](https://game-icons.net/) и
используются по лицензии
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Лицензия требует
указания авторства — оно ниже. Изменения: у каждой иконки снята чёрная
подложка, а фигура переведена на `currentColor`, чтобы она красилась цветом
текста; иконки собраны в один встроенный SVG-спрайт
(`src/lib/ui/icons/sprite.svg`, собирается `npm run icons:build`).

Всего иконок в игре: 39.

| Автор | Иконок |
|---|---|
| DarkZaitzev | 1 |
| Delapouite | 13 |
| GeneralAce135 | 1 |
| Lorc | 19 |
| Sbed | 2 |
| Skoll | 2 |
| Zeromancer | 1 |

Полный список «иконка → файл автора» — в реестре
`src/lib/ui/icons/manifest.ts`: он же единственный источник имён,
и тест не даёт ему разойтись со спрайтом и с данными игры.
