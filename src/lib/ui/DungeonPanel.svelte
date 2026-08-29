<script lang="ts">
  // Список входов в данжи с причиной отказа. Всё, что происходит ВНУТРИ
  // забега (место в цепочке, ярость, выход), — в DungeonHud под сценой:
  // это часть боя и должно быть видно из любого раздела.
  import {
    allDungeonStatuses,
    type DungeonBlockReason,
    type DungeonDef,
  } from '../game'
  import { DUNGEONS, HEROIC, HEROIC_DUNGEONS, clearKey } from '../data/dungeons'
  import { REAGENT_BY_ID } from '../data/reagents'
  import { ZONE_BY_ID } from '../data/zones'
  import { enterDungeonRun, gameState } from '../stores/game'
  import { Button, Panel, Tag } from './kit'
  import { Icon } from './icons'

  // Ключ статуса — пара (данж, сложность): у одного данжа их две, и вторая
  // затирала бы первую, будь ключом голый id.
  const statuses = $derived(
    new Map(
      allDungeonStatuses($gameState).map((s) => [clearKey(s.dungeonId, s.difficulty), s]),
    ),
  )
  const heroicById = $derived(new Map(HEROIC_DUNGEONS.map((d) => [d.id, d])))

  const REASON_TEXT: Record<DungeonBlockReason, (d: DungeonDef) => string> = {
    level: (d) => `Откроется с ${d.unlockRequirement} уровня`,
    // Зона входа уже названа строкой выше — здесь только действие,
    // иначе игрок читает одно и то же название дважды подряд.
    'wrong-zone': () => 'Сначала перейди в эту зону',
    dead: () => 'Сначала воскресни',
    'already-inside': () => 'Ты уже внутри',
  }
</script>

<Panel title="Данжи">
  <ul>
    {#each DUNGEONS as d (d.id)}
      {@const status = statuses.get(d.id)}
      {#if status}
        <li class="entry" class:locked={!status.canEnter}>
          <div class="head">
            <Icon name={d.icon} /><span class="name">{d.name}</span>
            {#if status.cleared}<Tag tone="gold" label="пройден" />{/if}
          </div>
          <div class="facts">
            {d.bosses.length} босса подряд · вход из зоны «{ZONE_BY_ID[d.zoneId]?.name ?? d.zoneId}»
          </div>
          {#if status.canEnter}
            <Button size="sm" variant="primary" onclick={() => enterDungeonRun(d.id)}>
              Войти
            </Button>
          {:else}
            <span class="reason">{REASON_TEXT[status.reason ?? 'level'](d)}</span>
          {/if}
          {#if !status.cleared}
            <span class="reward">За первое прохождение: +5% опыта навсегда</span>
          {/if}

          <!-- Героика — вторая строка того же данжа, а не отдельная запись:
               это один и тот же путь, пройденный второй раз и тяжелее. -->
          {#if heroicById.get(d.id) && statuses.get(clearKey(d.id, 'heroic'))}
            {@const heroic = heroicById.get(d.id)!}
            {@const hStatus = statuses.get(clearKey(d.id, 'heroic'))!}
            <div class="heroic" class:locked={!hStatus.canEnter}>
              <div class="head">
                <Icon name="dungeon-heroic" /><span class="name">Героика</span>
                {#if hStatus.cleared}<Tag tone="gold" label="героика пройдена" />{/if}
              </div>
              <div class="facts">
                Боссы крепче и злее, ярость подступает раньше. У каждого — своя уловка.
              </div>
              <div class="facts">
                Находки от эпических и выше · роняет «{REAGENT_BY_ID[heroic.reagentId]?.name ??
                  heroic.reagentId}»
              </div>
              {#if hStatus.canEnter}
                <Button size="sm" onclick={() => enterDungeonRun(d.id, 'heroic')}>
                  Войти в героику
                </Button>
              {:else if hStatus.reason === 'level'}
                <span class="reason">Героика откроется с {HEROIC.unlockRequirement} уровня</span>
              {:else}
                <span class="reason">{REASON_TEXT[hStatus.reason ?? 'level'](heroic)}</span>
              {/if}
              {#if !hStatus.cleared}
                <span class="reward">
                  За первое прохождение героики: +{Math.round(HEROIC.clearXpBonus * 100)}% опыта
                  навсегда
                </span>
              {/if}
            </div>
          {/if}
        </li>
      {/if}
    {/each}
  </ul>
</Panel>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .entry {
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
    font-size: var(--text-sm);
  }
  .entry.locked {
    opacity: 0.55;
  }
  /* Героика — вложенная строка того же данжа: отступ показывает, что это
     второй проход по той же цепочке, а не девятый данж. */
  .heroic {
    width: 100%;
    margin-top: var(--space-1);
    padding-top: var(--space-2);
    border-top: 1px solid var(--c-border);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
  }
  .heroic.locked {
    opacity: 0.55;
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }
  .name {
    font-weight: var(--weight-bold);
  }
  .facts,
  .reason {
    font-size: var(--text-xs);
    color: var(--c-text-muted);
  }
  .reward {
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
</style>
