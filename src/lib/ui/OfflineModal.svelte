<script lang="ts">
  import { dismissOfflineReport, offlineReport } from '../stores/game'
  import { OFFLINE_CAP_HOURS, OFFLINE_EFFICIENCY } from '../data/balance'
  import { ZONE_BY_ID } from '../data/zones'
  import { RARITIES } from '../data/rarity'
  import { Button, NumberText, Panel, rarityName, rarityStyle } from './kit'
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

  // Порядок редкостей — из данных: добавили тир, и он появился сам.
  const lootTiers = $derived(
    $offlineReport
      ? RARITIES.map((r) => ({ id: r.id, count: $offlineReport!.loot.byRarity[r.id] ?? 0 })).filter(
          (t) => t.count > 0,
        )
      : [],
  )
  const gain = (share: number) => `+${(share * 100).toFixed(1).replace('.', ',')} %`

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
          {#if $offlineReport.loot.found > 0}
            <!-- ДОБЫЧА. Раньше её здесь не было, потому что оффлайн находок
                 не разыгрывал вовсе; теперь разыгрывает той же рулеткой, что
                 и бой. Списком предметы не вываливаем — за восемь часов их
                 сотни, и сумка покажет всё сама. -->
            <div class="loot">
              <div class="loot-head">
                <Icon name="slot-trinket" size="lg" />
                <span class="label">Найдено вещей</span>
                <strong>{$offlineReport.loot.found}</strong>
              </div>
              <ul class="tiers">
                {#each lootTiers as tier (tier.id)}
                  <li style={rarityStyle(tier.id)}>
                    <span class="dot"></span>{rarityName(tier.id)} — {tier.count}
                  </li>
                {/each}
              </ul>
              <p class="loot-line">
                {#if $offlineReport.loot.upgrades > 0}
                  Лучше надетого: <strong class="up">{$offlineReport.loot.upgrades}</strong>
                  {#if $offlineReport.loot.bestGain > 0}
                    (лучшая — {gain($offlineReport.loot.bestGain)} к темпу){/if}. Всё лежит
                  в сумке — надеть надо самому.
                {:else}
                  Ничего лучше надетого не попалось.
                {/if}
              </p>
              {#if $offlineReport.loot.sold > 0}
                <p class="loot-line">
                  Не влезло в сумку и ушло в золото: {$offlineReport.loot.sold} шт. за
                  <NumberText value={$offlineReport.loot.soldGold} tone="gold" sign="plus" />.
                </p>
              {/if}
            </div>
          {/if}
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
  .loot {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    text-align: left;
  }
  .loot-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .tiers {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
    color: var(--c-text-muted);
  }
  .tiers li {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--rarity-color);
  }
  .dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--rarity-color);
  }
  .loot-line {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
  .up {
    color: var(--c-heal);
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
