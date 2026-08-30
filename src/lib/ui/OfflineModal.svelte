<script lang="ts">
  import { dismissOfflineReport, offlineReport } from '../stores/game'
  import { OFFLINE_CAP_HOURS, OFFLINE_EFFICIENCY } from '../data/balance'
  import { ZONE_BY_ID } from '../data/zones'
  import { Button, NumberText, Panel } from './kit'
  import { Icon } from './icons'

  // Правило названо ЧИСЛОМ и прямо здесь. Молчаливое урезание впятеро игрок
  // прочитает как баг, а не как правило: он помнит, сколько приносит час
  // за экраном, и увидит вместо него пятую часть без объяснений.
  const share = Math.round(OFFLINE_EFFICIENCY * 100)

  // Название закрытой активности по коду из отчёта. Логика отдаёт код,
  // текст живёт здесь — как у отказов умений и правил рук.
  const INTERRUPTED_TEXT = {
    dungeon: 'данжа',
    temple: 'храма',
  } as const

  function formatElapsed(ms: number): string {
    const totalMinutes = Math.floor(ms / 60_000)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    if (hours > 0) return `${hours} ч ${minutes} мин`
    return `${minutes} мин`
  }
</script>

{#if $offlineReport}
  <div class="backdrop">
    <div class="modal" role="dialog" aria-labelledby="offline-title">
      <Panel tone="raised" align="center">
        {#snippet children()}
          <h2 id="offline-title">Пока тебя не было…</h2>
          <p class="elapsed">({formatElapsed($offlineReport.elapsedMs)})</p>
          <ul>
            <li>
              <Icon name="stat-attackPower" size="lg" />
              <span class="label">Убито врагов</span>
              <NumberText value={$offlineReport.kills} bold />
            </li>
            <li>
              <Icon name="gold" size="lg" />
              <span class="label">Золото</span>
              <NumberText value={$offlineReport.gold} tone="gold" sign="plus" bold />
            </li>
            <li>
              <Icon name="xp" size="lg" />
              <span class="label">Опыт</span>
              <NumberText value={$offlineReport.xp} tone="xp" sign="plus" bold />
            </li>
          </ul>
          <!-- Про лут и смерти здесь молчим НАМЕРЕННО: оффлайн считается
               одним агрегатом и не разыгрывает ни находок, ни гибели.
               Придумать эти числа было бы враньём (см. долг №5
               в ARCHITECTURE.md). -->
          <p class="note">
            Оффлайн начисляет {share}% от онлайн-темпа: этот
            {formatElapsed($offlineReport.elapsedMs)} стоит примерно
            {formatElapsed($offlineReport.elapsedMs * OFFLINE_EFFICIENCY)} живой игры.
            Дольше {OFFLINE_CAP_HOURS} ч отсутствие не оплачивается.
          </p>
          {#if $offlineReport.interrupted}
            <!-- Оборванный забег обязан быть назван вслух. Молча пропавшая
                 цепочка боссов читается как потеря прогресса, а не как
                 правило, — а правило тут ровно одно и оно в пользу игрока:
                 закрытая вкладка больше не оставляет ни с чем. -->
            <p class="note interrupted">
              Ты вышел из {INTERRUPTED_TEXT[$offlineReport.interrupted]}: закрытая вкладка
              обрывает забег. Оффлайн начислен по зоне «{ZONE_BY_ID[$offlineReport.zoneId]
                ?.name ?? 'неизвестной'}». Попытку придётся начать заново — пройденное
              за неё не засчитано.
            </p>
          {:else}
            <p class="note">
              Начислено по зоне «{ZONE_BY_ID[$offlineReport.zoneId]?.name ?? 'неизвестной'}».
            </p>
          {/if}
          <p class="note">
            Добыча в оффлайне не собирается — только золото и опыт.
          </p>
          <div class="actions">
            <Button variant="primary" onclick={dismissOfflineReport}>Продолжить</Button>
          </div>
        {/snippet}
      </Panel>
    </div>
  </div>
{/if}

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
  }
  ul li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
  }
  .label {
    margin-right: auto;
    color: var(--c-text-muted);
  }
  .note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
  .note.interrupted {
    color: var(--c-warning);
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    background: color-mix(in srgb, var(--c-bg) 80%, transparent);
  }
  .modal {
    min-width: 18rem;
    max-width: 90vw;
    box-shadow: var(--shadow-lg);
    border-radius: var(--radius-lg);
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  .elapsed {
    margin: 0;
    color: var(--c-text-faint);
    font-size: var(--text-sm);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .actions {
    display: flex;
    justify-content: center;
  }
</style>
