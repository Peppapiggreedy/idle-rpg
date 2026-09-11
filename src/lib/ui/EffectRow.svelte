<script lang="ts">
  // ЧТО ВИСИТ ПРЯМО СЕЙЧАС — одной полосой под сценой: слева метки ГЕРОЯ,
  // справа метки ЦЕЛИ. Сторона и есть ответ на вопрос «на ком»: подписи
  // «на герое» / «на цели» заняли бы больше места, чем сами значки, и всё
  // равно повторяли бы то, что видно по расположению.
  //
  // ПОЧЕМУ ЭТО ВООБЩЕ ПОЯВИЛОСЬ. Кровотечение, ослабление, клеймо, стойка,
  // щит, упор, разгон, грань и четыре команды псу жили ТОЛЬКО в числах: игрок
  // видел, что урон скачет, и не видел почему. Журнал их пишет, но журнал
  // отвечает на вопрос «что было», а не «что сейчас».
  //
  // ПУСТО — ЗНАЧИТ НИЧЕГО НЕТ, И РЯД НЕ РИСУЕТСЯ ВОВСЕ. Пустая полоса на
  // месте меток занимала бы высоту, самое дорогое на телефоне, и обещала бы
  // содержимое, которого в этот момент нет.
  import { effectViews, type EffectView } from '../game'
  import { gameState } from '../stores/game'
  import { effectIcon, effectLeft, effectTip } from './effectText'
  import { Tooltip } from './kit'
  import { Icon } from './icons'

  const views = $derived(effectViews($gameState))
  const hero = $derived(views.filter((v) => v.target === 'hero'))
  const monster = $derived(views.filter((v) => v.target === 'monster'))

  // Ключ метки — РОД плюс источник: два кровотечения от разных умений это
  // две метки, а одно и то же клеймо, наложенное заново, — одна.
  const keyOf = (v: EffectView) => `${v.kind}:${v.source.kind}:${v.source.id}`
</script>

{#if views.length > 0}
  <div class="effects" data-effects>
    <div class="side hero" data-effects-hero>
      {#each hero as view (keyOf(view))}
        <Tooltip text={effectTip(view)}>
          <span class="mark" data-effect={view.kind}>
            <Icon name={effectIcon(view)} size="sm" />
            <span class="left">{effectLeft(view)}</span>
          </span>
        </Tooltip>
      {/each}
    </div>
    <div class="side target" data-effects-target>
      {#each monster as view (keyOf(view))}
        <Tooltip text={effectTip(view)}>
          <span class="mark" data-effect={view.kind}>
            <Icon name={effectIcon(view)} size="sm" />
            <span class="left">{effectLeft(view)}</span>
          </span>
        </Tooltip>
      {/each}
    </div>
  </div>
{/if}

<style>
  /* ДВЕ ГРУППЫ ПО КРАЯМ: герой под героем, цель под целью. Между ними
     распорка, а не колонки фиксированной ширины — групп бывает и одна. */
  .effects {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    padding-block: var(--space-1);
    min-width: 0;
  }
  .side {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    min-width: 0;
  }
  .side.target {
    justify-content: flex-end;
  }
  /* Значок с числом справа от него: число мелкое и табличное, чтобы ряд не
     дёргался, пока секунды убывают. */
  .mark {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-sm);
    background: var(--c-surface);
  }
  .left {
    font-size: var(--text-xs);
    color: var(--c-text-dim);
  }
</style>
