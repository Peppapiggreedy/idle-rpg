<script lang="ts">
  // Профессии: что есть в мешке и что из этого можно собрать.
  //
  // Кнопка недоступного рецепта ОБЪЯСНЯЕТ причину, а не просто гаснет:
  // «нет двух Луговых сборов» полезнее, чем серый прямоугольник. Логика
  // отдаёт код отказа и список нехватки — текст живёт здесь.
  import { formatNumber, type Decimal, type StatId } from '../game'
  import { craftedItem } from '../game/crafting'
  import { REST_DURATION_S, REST_FOOD_SPEEDUP } from '../data/balance'
  import { potionEffectText } from './potionText'
  import { statNames } from './statFormat'
  import { GRIP_TEXT } from './itemText'
  import type { PotionRecipe } from '../data/recipes'
  import {
    hasIntermediate,
    materialCount,
    rawCost,
    recipeStatus,
    type CraftBlockReason,
  } from '../game/crafting'
  import { craftRecipe, gameState } from '../stores/game'
  
  import { HERBS, HERB_BY_ID } from '../data/herbs'
  import { LEVEL_BANDS, bandDepth, bandForLevel } from '../data/bands'
  import { ZONE_BY_ID } from '../data/zones'
  import { commonReagentsInBand } from '../data/reagents'
  import { MASTERY_MAX, hasMastery, masteryRank, pointsToNextRank } from '../data/mastery'
  import { masteryOf } from '../game/recipeBook'
  import type { ProfessionId } from '../data/recipes'
  import { REAGENTS, REAGENT_BY_ID } from '../data/reagents'
  import {
    PROFESSIONS,
    professionUnlocked,
    recipeLevel,
    recipesOf,
    type RecipeDef,
  } from '../data/recipes'
  import { SLOT_NAMES } from '../data/slots'
  import { recipeSourceText, unknownRecipeText } from './recipeText'
  import { rarityName } from './kit'
  import { Button, NumberText, Panel, StatBar, Tooltip } from './kit'
  import { Icon } from './icons'

  const REASON_TEXT: Record<CraftBlockReason, string> = {
    level: 'Рецепт откроется позже',
    // «Не знаю» — не то же самое, что «не дорос»: у первого есть адрес, и
    // адрес этот подписан строкой ниже. Слово на кнопке зависит от источника:
    // рецепт лестницы придёт сам, за остальными надо идти.
    unknown: 'Рецепт не найден',
    materials: 'Не хватает материалов',
    gold: 'Не хватает золота',
    'inventory-full': 'Сумка полна — освободи место',
  }

  // ПОЛКА, А НЕ СПИСОК. Мешок был плоской строкой из всего, что есть, и
  // читался он единственным способом — чтением подряд: сорок с лишним
  // реагентов игры лежали вперемешку, а вопрос у игрока всегда один и тот же
  // — «чего мне не хватает ЗДЕСЬ». Полка отвечает на него расстановкой:
  // реагенты стоят ПО ПОЛОСАМ, в том же порядке, в каком игрок их проходил.
  //
  // ПОЛОСЫ ВЫШЕ СВОЕЙ НЕ ПОКАЗЫВАЮТСЯ — правило лестницы открытий: полка
  // растёт вместе с героем, а не обещает ему содержимое, до которого он не
  // дошёл. Пустая ячейка полосы, куда игрок уже приходил, — это подсказка
  // «здесь падает и такое», и она полезнее пустоты.
  const heroBand = $derived(bandDepth(bandForLevel($gameState.level.toNumber()).id))
  const shelf = $derived(
    LEVEL_BANDS.filter((band) => bandDepth(band.id) <= heroBand).map((band) => ({
      band,
      cells: [
        ...commonReagentsInBand(band.id).map((r) => ({
          id: r.id,
          name: r.name,
          icon: r.icon,
          note: 'падает с мобов полосы',
        })),
        ...HERBS.filter((h) =>
          h.zoneIds.some((z) => ZONE_BY_ID[z] && bandForLevel(ZONE_BY_ID[z].monsterLevelRange.max).id === band.id),
        ).map((h) => ({ id: h.id, name: h.name, icon: h.icon, note: 'срезается сама, пока герой в зоне' })),
      ].map((cell) => ({ ...cell, count: materialCount($gameState, cell.id) })),
    })),
  )

  // ДОБЫТОЕ В ПОДЗЕМЕЛЬЯХ И СДЕЛАННОЕ РУКАМИ — отдельной полкой: у них нет
  // полосы, на которой они падают, и ставить их в ряд с луговой рудой значило
  // бы обещать, что их можно нафармить в зоне.
  const special = $derived(
    REAGENTS.filter((r) => r.role !== 'common')
      .map((r) => ({ id: r.id, name: r.name, icon: r.icon, count: materialCount($gameState, r.id) }))
      .filter((row) => row.count.gt(0)),
  )

  /**
   * ПОРЯДОК РЕЦЕПТОВ: сперва то, что можно собрать ПРЯМО СЕЙЧАС, потом всё
   * остальное — снизу вверх по глубине.
   *
   * Порядок файла данных — это порядок автора, а не игрока. У кузнечного
   * тридцать рецептов, и собираемые лежали вперемешку с теми, до которых
   * герой дойдёт через сорок уровней: чтобы найти «что мне сделать сейчас»,
   * приходилось читать список целиком. Сортировка отвечает на этот вопрос
   * расстановкой.
   */
  function sorted(profession: ProfessionId): RecipeDef[] {
    return recipesOf(profession).slice().sort((a, b) => {
      const ready = Number(recipeStatus($gameState, b).canCraft) -
        Number(recipeStatus($gameState, a).canCraft)
      return ready !== 0 ? ready : recipeLevel(a) - recipeLevel(b)
    })
  }

  /** Ступень мастерства профессии — числами, которые считает сама игра. */
  function masteryRow(profession: ProfessionId) {
    const value = masteryOf($gameState, profession)
    const rank = masteryRank(value)
    const next = pointsToNextRank(value)
    return { value, rank, next }
  }

  function outputText(recipe: RecipeDef): string {
    if (recipe.output.kind === 'food') return 'Порция еды: привал вдвое короче'
    if (recipe.output.kind === 'potion') {
      return `Склянка: ${Math.round(recipe.output.durationSec / 60)} мин действия`
    }
    // Промежуточный реагент — не вещь: слота и редкости у него нет, а есть
    // место в пути к вещи. Так и называется.
    if (recipe.output.kind === 'reagent') return 'Передел: идёт в лучшую вещь полосы'
    return `${SLOT_NAMES[recipe.output.slot]}, ${rarityName(recipe.output.rarity)}`
  }

  /**
   * ЧТО ИМЕННО ПОЛУЧИТСЯ. Числа берутся из ТЕХ ЖЕ данных, из которых предмет
   * будет создан: у вещи — из craftedItem (той самой функции, что зовёт крафт),
   * у зелья — из его модификаторов, у еды — из ставки ускорения привала.
   * Ни одно число здесь не выписано текстом в рецепте: выпишешь — и оно
   * разъедется с настоящим предметом при первой же правке данных.
   */
  function recipeTooltip(recipe: RecipeDef): string {
    const out = recipe.output
    const parts = [recipe.name]
    if (out.kind === 'food') {
      parts.push(`Еда: привал короче в ${REST_FOOD_SPEEDUP} раза`)
      parts.push(`${REST_DURATION_S} с превращаются в ${(REST_DURATION_S / REST_FOOD_SPEEDUP).toFixed(0)} с`)
      parts.push('Порция тратится за один привал.')
    } else if (out.kind === 'potion') {
      parts.push(`Склянка, ${Math.round(out.durationSec / 60)} мин действия`)
      parts.push(potionEffectText({ ...recipe, output: out } as PotionRecipe))
      parts.push('Зелья пьются только руками: ни автокаст, ни оффлайн их не трогают.')
    } else if (out.kind === 'reagent') {
      parts.push('Передел: сам не надевается, но без него не собрать лучшую вещь полосы.')
    } else {
      const item = craftedItem(out, 0)
      parts.push(`${SLOT_NAMES[out.slot]} · ${rarityName(out.rarity)} · ${out.level} ур.`)
      if (item) {
        for (const mod of item.mods) parts.push(modLine(mod))
        if (item.grip) parts.push(GRIP_TEXT[item.grip])
      }
    }
    const need = recipe.inputs
      .map((i) => `${MATERIAL_LABEL(i.materialId)} ×${i.count}`)
      .join(', ')
    parts.push(`Нужно: ${need}`)
    return parts.join('\n')
  }

  const MATERIAL_LABEL = (id: string) =>
    REAGENT_BY_ID[id]?.name ?? HERB_BY_ID[id]?.name ?? id

  // Строка модификатора теми же словами, что в подсказке зелья: два разных
  // способа назвать «+8 силы» игрок прочитал бы как две разные механики.
  function modLine(mod: { stat: StatId; kind: string; value: Decimal }): string {
    const name = statLabels[mod.stat] ?? mod.stat
    if (mod.kind === 'percent') return `+${mod.value.times(100).toFixed(0)}% ${name}`
    if (mod.kind === 'multiplier') return `×${mod.value.toFixed(2)} ${name}`
    return `+${formatNumber(mod.value)} ${name}`
  }
  const statLabels = $derived(statNames($gameState.classId))

  /**
   * ЗАКРЫТО ЗНАЧИТ НЕ ВИДНО. Профессия, до которой герой не дорос, не
   * показывается вовсе — ни серой, ни с замком. Интригу держит лестница
   * открытий в разделе «Развитие»: там сказано, что на тридцатом что-то
   * будет, и не сказано что. Запертая вкладка на её месте отвечала бы на
   * вопрос заранее и притом раздражала.
   */
  const openProfessions = $derived(
    PROFESSIONS.filter((p) => professionUnlocked(p.id, $gameState.level.toNumber())),
  )
</script>

{#if openProfessions.length > 0}
<Panel title="Ремёсла">
  <p class="hint">
    Рецепт собирается, как только есть материалы и золото на пошлину.
    Материалы падают своим броском и место в сумке не занимают.
  </p>

  <section class="bag">
    <h3>Полка реагентов</h3>
    {#each shelf as row (row.band.id)}
      <div class="band">
        <span class="band-label">{row.band.minLevel}–{row.band.maxLevel}</span>
        <ul class="materials">
          {#each row.cells as cell (cell.id)}
            <li class:empty-cell={cell.count.lte(0)}>
              <Tooltip text={`${cell.name}\n${cell.note}\nПолоса ${row.band.minLevel}–${row.band.maxLevel}`}>
                <span class="cell">
                  <Icon name={cell.icon} />
                  <b>{formatNumber(cell.count)}</b>
                </span>
              </Tooltip>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
    {#if special.length > 0}
      <div class="band">
        <span class="band-label">добыто</span>
        <ul class="materials">
          {#each special as cell (cell.id)}
            <li>
              <Tooltip text={`${cell.name}\nиз подземелья или передела — в зоне не падает`}>
                <span class="cell">
                  <Icon name={cell.icon} />
                  <b>{formatNumber(cell.count)}</b>
                </span>
              </Tooltip>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </section>

  {#each openProfessions as profession (profession.id)}
    <section class="profession">
      <h3><Icon name={profession.icon} />{profession.name}</h3>
      <p class="hint">{profession.tagline}</p>
      <!-- ШКАЛА МАСТЕРСТВА — только у профессий, где она есть. У кулинарии и
           реликвария её нет вовсе, и пустая полоска на нуле читалась бы как
           «шкала сломана», а не как «шкалы нет». -->
      {#if hasMastery(profession.id)}
        {@const row = masteryRow(profession.id)}
        <StatBar
          value={row.value}
          max={MASTERY_MAX}
          tone="xp"
          size="sm"
          smooth={false}
          label={row.rank.name}
          valueLabel={row.next === null
            ? `${row.value} / ${MASTERY_MAX}`
            : `${row.value} / ${MASTERY_MAX} · до следующей ступени ${row.next}`}
        />
      {/if}
      <ul class="recipes">
        {#each sorted(profession.id) as recipe (recipe.id)}
          {@const status = recipeStatus($gameState, recipe)}
          <li class="recipe" class:blocked={!status.canCraft}>
            <!-- Подсказка говорит, ЧТО ПОЛУЧИТСЯ, — теми же числами, из
                 которых предмет и будет создан. На тач-экране открывается
                 нажатием: это умеет сам примитив, второго кода нет. -->
            <Tooltip text={recipeTooltip(recipe)} width="wide" block>
              <div class="head">
                <Icon name={recipe.icon} size="lg" />
                <div>
                  <span class="name">{recipe.name}</span>
                  <span class="out">{outputText(recipe)}</span>
                </div>
              </div>
            </Tooltip>
            <!-- НЕИЗВЕСТНЫЙ РЕЦЕПТ ПОДПИСАН ИСТОЧНИКОМ, а не просто погашен.
                 Строка отвечает на единственный вопрос, который у игрока
                 к серому рецепту и есть: куда за ним идти. -->
            {#if status.reason === 'unknown'}
              <p class="source">{recipeSourceText(recipe)}</p>
            {/if}
            <ul class="inputs">
              <!-- ПОШЛИНА ВИДНА ДО НАЖАТИЯ, и это половина смысла шага: цена,
                   о которой узнаёшь после клика, — не цена, а сюрприз. Строка
                   стоит первой и подсвечивается нехваткой ровно так же, как
                   недостающий материал. -->
              <li class="toll" class:short={status.tollShort.gt(0)}>
                Пошлина <NumberText value={status.toll} tone="gold" />
                {#if status.tollShort.gt(0)}
                  <span class="lack">не хватает <NumberText value={status.tollShort} tone="gold" /></span>
                {/if}
              </li>
              {#each recipe.inputs as input (input.materialId)}
                {@const have = materialCount($gameState, input.materialId)}
                <li class:short={have.lt(input.count)}>
                  {MATERIAL_LABEL(input.materialId)}
                  {formatNumber(have)}/{input.count}
                </li>
              {/each}
            </ul>
            <!-- ПОЛНАЯ ЦЕНА СЫРЬЁМ — только у рецептов с переделом. У
                 остальных она совпадает со строкой выше, и вторая копия тех же
                 чисел читалась бы как ещё одна цена. -->
            {#if hasIntermediate(recipe)}
              <ul class="inputs raw">
                <li class="raw-label">Всего сырья:</li>
                {#each rawCost(recipe) as input (input.materialId)}
                  {@const have = materialCount($gameState, input.materialId)}
                  <li class:short={have.lt(input.count)}>
                    {MATERIAL_LABEL(input.materialId)}
                    {formatNumber(have)}/{input.count}
                  </li>
                {/each}
              </ul>
            {/if}
            <Button
              size="sm"
              block
              disabled={!status.canCraft}
              title={status.reason ? REASON_TEXT[status.reason] : ''}
              onclick={() => craftRecipe(recipe.id)}
            >
              {status.canCraft
                ? 'Собрать'
                : status.reason === 'unknown'
                  ? unknownRecipeText(recipe)
                  : REASON_TEXT[status.reason!]}
            </Button>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</Panel>
{/if}

<style>
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--c-text-muted);
  }
  h3 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-faint);
  }
  .bag,
  .profession {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .band {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  /* Подпись полосы одна на ряд — она и есть определение ряда. Ширина
     фиксирована шкалой отступов, чтобы ячейки всех полос вставали в столбец:
     ряды, разъехавшиеся по горизонтали, читаются как разные списки. */
  .band-label {
    flex: 0 0 var(--space-6);
    font-size: var(--text-xs);
    color: var(--c-text-faint);
    text-align: right;
  }
  .materials {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    font-size: var(--text-sm);
  }
  .materials li {
    display: flex;
    align-items: center;
  }
  .cell {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: var(--tap-min);
    justify-content: center;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-sm);
  }
  /* Пустая ячейка ПОКАЗЫВАЕТСЯ, но приглушённо: «здесь падает и такое» —
     это подсказка, а не находка, и перебивать ею настоящие числа нельзя. */
  .materials li.empty-cell .cell {
    color: var(--c-text-faint);
    opacity: 0.55;
  }
  .recipes {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-2);
  }
  .recipe {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    background: var(--c-surface-sunken);
  }
  .recipe.blocked {
    color: var(--c-text-muted);
  }
  .source {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .head div {
    display: flex;
    flex-direction: column;
  }
  .name {
    font-weight: var(--weight-bold);
  }
  .out {
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
  .inputs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--c-text-muted);
  }
  .inputs .toll {
    /* Пошлина отделена от материалов: это другая валюта и другая причина
       отказа. Линия снизу читается как «итог», а не как ещё один материал. */
    border-bottom: 1px solid var(--c-border);
    padding-bottom: var(--space-1);
    margin-bottom: var(--space-1);
  }

  /* Полная цена стоит ПОД входами и приглушена: это справка о том, во что
     обойдётся передел, а не вторая цена. Ярче входов она перебила бы то,
     по чему игрок и решает, хватает ли ему. */
  .inputs.raw {
    color: var(--c-text-faint);
  }
  .raw-label {
    color: var(--c-text-faint);
  }

  .inputs .lack {
    margin-left: var(--space-1);
    color: var(--c-warning);
  }

  .inputs .short {
    color: var(--c-warning);
  }
  @media (min-width: 720px) {
    .recipes {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
