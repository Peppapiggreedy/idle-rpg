<script lang="ts">
  // ПОДСКАЗКА УЗЛА ДЕРЕВА — ОКНОМ У УЗЛА, как описание надетого на кукле.
  //
  // Описание ушло из узла целиком: в квадрате размером в палец помещается
  // значок и ранг, и больше ничего. Всё, что игрок читал в карточке списка —
  // имя, эффект за ранг, порог этажа, стрелка, выбор на этаже, причина
  // отказа, — живёт здесь. НЕ ПРИЛИПАЕТ: уход курсора, нажатие, потеря
  // фокуса, Esc и прокрутка закрывают его; решает панель, окно только рисует.
  //
  // Мышь окно НЕ ловит: под ним соседние узлы, и они обязаны нажиматься.
  // Границы экрана считает общая `placeTip` — та же, что у окон куклы и
  // сумки: три окна у одного курсора обязаны переворачиваться одинаково.
  import { CONCEPT_ROWS, TALENT_BY_ID, type TalentDef } from '../data/talents'
  import type { TalentStatus } from '../game'
  import type { TakeBackStatus } from '../game/talents'
  import { placeTip } from './tipPlace'
  import type { ResourceWords } from './resource'
  import {
    blockReasonText,
    choiceText,
    effectText,
    pluralRu,
    takeBackReasonText,
  } from './talentText'
  import { Tag } from './kit'

  interface Props {
    talent: TalentDef
    status: TalentStatus
    back: TakeBackStatus
    /** Кто из группы уже выбран вместо этого таланта. */
    holder: TalentDef | null
    resource: ResourceWords
    /** Открыто тач-нажатием: подсказка говорит, что сделает второе. */
    touch: boolean
    /** Якорь в координатах окна: правый верхний угол узла. */
    x: number
    y: number
  }
  let { talent, status, back, holder, resource, touch, x, y }: Props = $props()

  let box = $state<HTMLElement | null>(null)
  let size = $state({ w: 260, h: 160 })
  $effect(() => {
    if (!box) return
    const rect = box.getBoundingClientRect()
    if (rect.width !== size.w || rect.height !== size.h) size = { w: rect.width, h: rect.height }
  })
  const pos = $derived(
    placeTip(x, y, size, { width: window.innerWidth, height: window.innerHeight }),
  )

  const isKey = $derived(CONCEPT_ROWS.includes(talent.row))
  const need = $derived(talent.requires)
  const anchorName = $derived(need ? TALENT_BY_ID[need.talentId]?.name : null)
</script>

<div class="tip" bind:this={box} style="left: {pos.left}px; top: {pos.top}px" role="tooltip" data-talent-tip>
  <div class="head">
    <span class="name">{talent.name}</span>
    <span class="rank">{status.rank}/{status.maxRank}</span>
  </div>
  {#if isKey}
    <Tag tone="xp" label="ключевой этаж" />
  {/if}
  <div class="effect">{effectText(talent, resource)}</div>
  <div class="where">
    Этаж {talent.row} · порог {talent.requiredPointsInBranch}
    {pluralRu(talent.requiredPointsInBranch, 'очко', 'очка', 'очков')} в ветке
    {#if status.pointsInBranch < talent.requiredPointsInBranch}
      (вложено {status.pointsInBranch})
    {/if}
  </div>
  {#if need}
    <!-- СТРЕЛКА НАЗВАНА СЛОВОМ И ЗДЕСЬ: линия в сетке показывает, ОТКУДА,
         а имя говорит, СКОЛЬКО туда вложить. -->
    <div class="need">
      Стрелка: нужен «{anchorName ?? need.talentId}»{#if (need.minRank ?? 1) > 1}, {need.minRank} ранга{/if}
    </div>
  {/if}
  {#if holder}
    <div class="choice">Выбран «{holder.name}» — вместе не берутся</div>
  {:else if choiceText(talent)}
    <div class="choice">{choiceText(talent)}</div>
  {/if}
  {#if !status.canInvest && status.reason}
    <div class="reason" data-reason>{blockReasonText(status.reason, talent, holder)}</div>
  {/if}
  <div class="hint">
    {#if touch}
      {status.canInvest ? 'Ещё одно нажатие — вложить' : 'Нажмите в другом месте, чтобы закрыть'}
    {:else}
      ЛКМ — вложить · ПКМ — снять
    {/if}
    {#if status.rank > 0}
      · {back.canTakeBack
        ? `снять можно: в этот заход вложено ${back.fromThisVisit}`
        : takeBackReasonText(back.reason ?? 'nothing-invested')}
    {/if}
  </div>
</div>

<style>
  .tip {
    position: fixed;
    z-index: 90;
    pointer-events: none;
    width: min(18rem, calc(100vw - var(--space-4)));
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    background: var(--c-surface-raised);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--c-text);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }
  .name {
    font-weight: var(--weight-bold);
  }
  .rank {
    color: var(--c-xp);
    font-variant-numeric: tabular-nums;
  }
  .effect {
    color: var(--c-text);
  }
  .where,
  .need,
  .choice {
    color: var(--c-text-muted);
  }
  .need {
    color: var(--c-accent);
  }
  .reason {
    color: var(--c-warning);
  }
  .hint {
    margin-top: var(--space-1);
    color: var(--c-text-faint);
  }
</style>
