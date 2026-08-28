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

## Звук

Звуки взяты из паков Kenney и распространяются под лицензией
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/): она не требует
указания авторства, но мы его указываем.

| Пак | Что оттуда | Автор | Лицензия |
|---|---|---|---|
| [UI Audio](https://kenney.nl/assets/ui-audio) | щелчки интерфейса, переключатели, звук блока | Kenney Vleugels | CC0 1.0 |
| [Digital Audio](https://kenney.nl/assets/digital-audio) | удары, умения, смерть, уровень, находки по тирам | Kenney Vleugels | CC0 1.0 |

Файлы лежат в `public/audio/` без изменений; игра меняет только высоту
(±1–3 полутона) и громкость (±3 дБ) при воспроизведении. Оригинальные тексты
лицензий — `public/audio/LICENSE-Kenney-UI-Audio.txt` и
`LICENSE-Kenney-Digital-Audio.txt`.

Реестр `src/lib/data/sounds.ts` описывает каждый кью вместе с категорией,
разбросом и тем, ЧТО звук сообщает игроку (`valence`). Последнее — не
украшение: на нём держится запрет на победный звук у потери. Правила против
усталости слуха (варианты, разброс, склейка залпов, потолок голосов,
приглушение фона) живут в `src/lib/audio/mixer.ts` и проверяются числами
в `mixer.test.ts`, а не на слух.

## Модели

Персонажи взяты из паков KayKit за авторством Kay Lousberg и распространяются
под лицензией [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/):
она не требует указания авторства, но мы его указываем.

| Модель | Файл | Пак | Автор | Лицензия |
|---|---|---|---|---|
| Герой | `public/models/Knight.glb` | [KayKit Character Pack: Adventurers 1.0](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) | Kay Lousberg | CC0 1.0 |
| Моб | `public/models/Skeleton_Minion.glb` | [KayKit Character Pack: Skeletons 1.0](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0) | Kay Lousberg | CC0 1.0 |
| Пропсы зон (бочка, ящики, обломки, колонна, столб, бочонок, сундук) | `public/models/props/` | [KayKit Dungeon Remastered 1.0](https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0) | Kay Lousberg | CC0 1.0 |

Оригинальные тексты лицензий лежат рядом с моделями:
`public/models/LICENSE-KayKit-Adventurers.txt` и
`LICENSE-KayKit-Skeletons.txt`. Файлы взяты без изменений; в игре меняется
только масштаб и выбор проигрываемого клипа.

Оба пака — от ОДНОГО автора намеренно: единый стиль персонажей важнее
разнообразия, и мешать источники для героя и мобов нельзя.

### Если модели придётся заменить

Реестр `src/lib/data/assets.ts` описывает каждую модель вместе с маппингом
игровых состояний на имена клипов ВНУТРИ файла. Имена у разных паков разные,
поэтому маппинг обязателен, а в коде сцены строковых имён анимаций нет —
это закреплено тестом. Запасные варианты, если понадобятся:

- **RobotExpressive** из [three.js](https://github.com/mrdoob/three.js)
  (`examples/models/gltf/RobotExpressive/RobotExpressive.glb`) — CC0 1.0,
  Tomás Laulhé, правки Don McCurdy. Клипы: `Idle`, `Walking`, `Running`,
  `Dance`, `Death`, `Sitting`, `Standing`, `Jump`, `Yes`, `No`, `Wave`,
  `Punch`, `ThumbsUp`.
- **Fox** из [glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets)
  (`Models/Fox/glTF-Binary/Fox.glb`). Внимание: лицензия СОСТАВНАЯ — сама
  модель CC0 (PixelMannen), а **риг и анимации под CC BY 4.0** (tomkranis),
  конверсия тоже CC BY 4.0 (AsoboStudio, scurest). То есть при её
  использовании атрибуция ОБЯЗАТЕЛЬНА, в отличие от CC0-моделей выше,
  и эту таблицу нужно будет дополнить соответствующей строкой.

## Иконки

Иконки интерфейса взяты с [game-icons.net](https://game-icons.net/) и
используются по лицензии
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Лицензия требует
указания авторства — оно ниже. Изменения: у каждой иконки снята чёрная
подложка, а фигура переведена на `currentColor`, чтобы она красилась цветом
текста; иконки собраны в один встроенный SVG-спрайт
(`src/lib/ui/icons/sprite.svg`, собирается `npm run icons:build`).

Всего иконок в игре: 82.

| Автор | Иконок |
|---|---|
| DarkZaitzev | 1 |
| Delapouite | 32 |
| FaithToken | 1 |
| GeneralAce135 | 1 |
| Lorc | 41 |
| Sbed | 3 |
| Skoll | 2 |
| Zeromancer | 1 |

Полный список «иконка → файл автора» — в реестре
`src/lib/ui/icons/manifest.ts`: он же единственный источник имён,
и тест не даёт ему разойтись со спрайтом и с данными игры.
