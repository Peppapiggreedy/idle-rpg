<script lang="ts">
  // Профессии: что есть в мешке и что из этого можно собрать.
  //
  // Кнопка недоступного рецепта ОБЪЯСНЯЕТ причину, а не просто гаснет:
  // «нет двух Луговых сборов» полезнее, чем серый прямоугольник. Логика
  // отдаёт код отказа и список нехватки — текст живёт здесь.
  import { formatNumber } from '../game'
  import { materialCount, recipeStatus, type CraftBlockReason } from '../game/crafting'
  import { craftRecipe, gameState } from '../stores/game'
  import { MATERIALS, MATERIAL_BY_ID } from '../data/materials'
  import { HERBS, HERB_BY_ID } from '../data/herbs'
  import { REAGENTS, REAGENT_BY_ID } from '../data/reagents'
  import { PROFESSIONS, recipesOf, type RecipeDef } from '../data/recipes'
  import { SLOT_NAMES } from '../data/slots'
  import { rarityName } from './kit'
  import { Button, Panel } from './kit'
  import { Icon } from './icons'

  const REASON_TEXT: Record<CraftBlockReason, string> = {
    level: 'Рецепт откроется позже',
    locked: 'Награда храма: дойди до своего рубежа волн',
    materials: 'Не хватает материалов',
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
            <div class="head">
              <Icon name={recipe.icon} size="lg" />
              <div>
                <span class="name">{recipe.name}</span>
                <span class="out">{outputText(recipe)}</span>
              </div>
            </div>
            <ul class="inputs">
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
  .inputs .short {
    color: var(--c-warning);
  }
  @media (min-width: 720px) {
    .recipes {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
