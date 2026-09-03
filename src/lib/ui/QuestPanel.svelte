<script lang="ts">
  // Панель цепочки преквестов.
  //
  // Будущие задания — БЕЗ НАЗВАНИЙ, и их нет в разметке вовсе: то же
  // правило, что у закрытых ступеней лестницы открытий. Спрятанное
  // стилями живёт до первого открытия инспектора.
  import { QUEST_CHAIN } from '../data/quests'
  import {
    activeQuest,
    chainComplete,
    chainUnlocked,
    formatNumber,
    questReward,
    questStatuses,
  } from '../game'
  import { gameState } from '../stores/game'
  import { Panel, StatBar, Tag } from './kit'
  import { Icon } from './icons'
  import { goalText, progressText } from './questText'

  const unlocked = $derived(chainUnlocked($gameState))
  const statuses = $derived(questStatuses($gameState))
  const active = $derived(activeQuest($gameState))
  const done = $derived(chainComplete($gameState))
  const reward = $derived(active ? questReward($gameState, active.reward) : null)
  const levelLeft = $derived(
    Math.max(0, QUEST_CHAIN.unlockLevel - $gameState.level.toNumber()),
  )
</script>

<!-- ЗАКРЫТО ЗНАЧИТ НЕ ВИДНО. До восьмидесятого уровня панели заданий нет в
     разметке вовсе: «первое задание выдадут на 80 уровне — осталось 55»
     это обратный отсчёт до контента, о котором игрок ещё не должен знать.
     Что на восьмидесятом что-то будет, говорит лестница открытий. -->
{#if unlocked}
<Panel title={QUEST_CHAIN.name} subtitle="Цепочка к вратам рейда">
    <ol>
      {#each statuses as row (row.quest.id)}
        <li class="quest {row.stage}">
          {#if row.stage === 'locked'}
            <!-- Ни имени, ни условия: будущее задание в разметке немое. -->
            <span class="lock" aria-hidden="true">🔒</span>
            <span class="name unknown">???</span>
          {:else}
            <Icon name={row.quest.icon} size="lg" />
            <span class="text">
              <span class="name">{row.quest.name}</span>
              <span class="goal">{goalText(row.quest.goal)}</span>
              {#if row.stage === 'active'}
                <span class="flavor">{row.quest.flavor}</span>
                <StatBar
                  tone="xp"
                  value={row.progress}
                  max={row.target}
                  label={progressText(row.quest.goal, row.progress, row.target)}
                  valueLabel={reward
                    ? `+${formatNumber(reward.gold)} золота, +${formatNumber(reward.xp)} опыта`
                    : ''}
                  smooth={false}
                />
              {/if}
            </span>
            {#if row.stage === 'done'}<Tag tone="xp" label="Сдано" />{/if}
          {/if}
        </li>
      {/each}
    </ol>
    {#if done}
      <p class="gate">
        <Icon name="raid-gate" size="lg" /> Врата Немой кручи открыты — смотри лестницу открытий.
      </p>
    {/if}
</Panel>
{/if}

<style>
  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--c-text-muted);
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .quest {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    opacity: 0.55;
  }
  .quest.done,
  .quest.active {
    opacity: 1;
  }
  .quest.active {
    border-color: var(--c-accent);
    background: color-mix(in srgb, var(--c-accent) var(--tint-weak), transparent);
  }
  .lock {
    width: var(--space-6);
    text-align: center;
  }
  .text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    gap: var(--space-1);
  }
  .name {
    font-weight: var(--weight-bold);
  }
  .name.unknown {
    color: var(--c-text-faint);
    letter-spacing: var(--tracking-wide);
  }
  .goal {
    font-size: var(--text-xs);
    color: var(--c-text-muted);
  }
  .flavor {
    font-size: var(--text-xs);
    color: var(--c-text-faint);
    font-style: italic;
  }
  .gate {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--c-gold);
  }
</style>
