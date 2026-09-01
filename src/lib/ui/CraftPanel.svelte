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
  import { materialCount, recipeStatus, type CraftBlockReason } from '../game/crafting'
  import { craftRecipe, gameState } from '../stores/game'
  import { MATERIALS, MATERIAL_BY_ID } from '../data/materials'
  import { HERBS, HERB_BY_ID } from '../data/herbs'
  import { REAGENTS, REAGENT_BY_ID } from '../data/reagents'
  import { PROFESSIONS, recipesOf, type RecipeDef } from '../data/recipes'
  import { SLOT_NAMES } from '../data/slots'
  import { rarityName } from './kit'
  import { Button, NumberText, Panel, Tooltip } from './kit'
  import { Icon } from './icons'

  const REASON_TEXT: Record<CraftBlockReason, string> = {
    level: 'Рецепт откроется позже',
    locked: 'Награда храма: дойди до своего рубежа волн',
    materials: 'Не хватает материалов',
    gold: 'Не хватает золота',
    'inventory-full': 'Сумка полна — освободи место',
  }

  // Мешок держит четыре вида: материалы зон, травы, реагенты боссов и готовую
  // еду со склянками. Забытый вид просто не показался бы игроку.
  const BAG_ENTRIES = [
    ...MATERIALS.map((m) => ({ id: m.id, name: m.name, icon: m.icon })),
    ...HERBS.map((h) => ({ id: h.id, name: h.name, icon: h.icon })),
    ...REAGENTS.map((r) => ({ id: r.id, name: r.name, icon: r.icon })),
  ]
  const owned = $derived(
    BAG_ENTRIES.map((m) => ({ material: m, count: materialCount($gameState, m.id) })).filter(
      (row) => row.count.gt(0),
    ),
  )

  function outputText(recipe: RecipeDef): string {
    if (recipe.output.kind === 'food') return 'Порция еды: привал вдвое короче'
    if (recipe.output.kind === 'potion') {
      return `Склянка: ${Math.round(recipe.output.durationSec / 60)} мин действия`
    }
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
    MATERIAL_BY_ID[id]?.name ?? HERB_BY_ID[id]?.name ?? REAGENT_BY_ID[id]?.name ?? id

  // Строка модификатора теми же словами, что в подсказке зелья: два разных
  // способа назвать «+8 силы» игрок прочитал бы как две разные механики.
  function modLine(mod: { stat: StatId; kind: string; value: Decimal }): string {
    const name = statLabels[mod.stat] ?? mod.stat
    if (mod.kind === 'percent') return `+${mod.value.times(100).toFixed(0)}% ${name}`
    if (mod.kind === 'multiplier') return `×${mod.value.toFixed(2)} ${name}`
    return `+${formatNumber(mod.value)} ${name}`
  }
  const statLabels = $derived(statNames($gameState.classId))
</script>

<Panel title="Ремёсла">
  <p class="hint">
    Уровней у профессий нет: рецепт собирается, как только есть материалы.
    Материалы падают своим броском и место в сумке не занимают.
  </p>

  <section class="bag">
    <h3>Мешок материалов</h3>
    {#if owned.length === 0}
      <p class="empty">Пока пусто. Материалы падают с мобов — по своим для каждой зоны.</p>
    {:else}
      <ul class="materials">
        {#each owned as row (row.material.id)}
          <li>
            <Icon name={row.material.icon} />
            <span>{row.material.name}</span>
            <b>{formatNumber(row.count)}</b>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#each PROFESSIONS as profession (profession.id)}
    <section class="profession">
      <h3><Icon name={profession.icon} />{profession.name}</h3>
      <p class="hint">{profession.tagline}</p>
      <ul class="recipes">
        {#each recipesOf(profession.id) as recipe (recipe.id)}
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
                  {MATERIAL_BY_ID[input.materialId]?.name ??
                    HERB_BY_ID[input.materialId]?.name ??
                    REAGENT_BY_ID[input.materialId]?.name ??
                    input.materialId}
                  {formatNumber(have)}/{input.count}
                </li>
              {/each}
            </ul>
            <Button
              size="sm"
              block
              disabled={!status.canCraft}
              title={status.reason ? REASON_TEXT[status.reason] : ''}
              onclick={() => craftRecipe(recipe.id)}
            >
              {status.canCraft ? 'Собрать' : REASON_TEXT[status.reason!]}
            </Button>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</Panel>

<style>
  .hint,
  .empty {
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
  .materials {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }
  .materials li {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-sm);
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
