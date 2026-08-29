<script lang="ts">
  // Дерево талантов: две колонки-ветки. Весь текст для игрока — здесь;
  // логика отдаёт только ранги, коды причин и структурированные эффекты.
  import {
    availablePoints,
    canResetTalents,
    formatNumber,
    resetCost,
    talentStatus,
    type StatId,
    type TalentBlockReason,
  } from '../game'
  import {
    BRANCHES,
    talentsInBranch,
    type TalentDef,
    type TalentFlag,
    type TalentModifier,
  } from '../data/talents'
  import { TALENT_FIRST_LEVEL } from '../data/balance'
  import { gameState, investTalentPoint, resetTalentTree } from '../stores/game'
  import { resourceWords } from './resource'
  import { Button, NumberText, Panel, Tag } from './kit'
  import { Icon } from './icons'

  const points = $derived(availablePoints($gameState))
  const cost = $derived(resetCost($gameState))
  const canReset = $derived(canResetTalents($gameState))

  // Ресурс называется по классу: ветки у классов разные, но общие статы
  // описываются одними и теми же строками.
  const resource = $derived(resourceWords($gameState.classId))

  // Названия статов и флагов — единственное место, где они превращаются в текст.
  const STAT_NAMES: Record<StatId, string> = $derived({
    strength: 'силы',
    agility: 'ловкости',
    intellect: 'интеллекта',
    vitality: 'живучести',
    attackPower: 'силы атаки',
    weaponDamageMin: 'урона оружия (мин)',
    weaponDamageMax: 'урона оружия (макс)',
    maxHp: 'здоровья',
    maxMana: resource.genitive,
    weaponSpeed: 'скорости оружия',
    offhandSpeed: 'скорости левой руки',
    offhandDamageMin: 'урона левой руки (мин)',
    offhandDamageMax: 'урона левой руки (макс)',
    blockChance: 'шанса блока',
    blockValue: 'силы блока',
    offhandPenalty: 'силы левой руки',
    regenDelay: `паузы восстановления ${resource.genitive}`,
    restDuration: 'длины привала',
    restThreshold: 'порога привала',
    haste: 'ускорения',
    critChance: 'шанса крита',
    critMultiplier: 'множителя крита',
    hpRegen: 'восстановления здоровья',
    hpRegenOutOfCombat: 'восстановления здоровья вне боя',
    manaRegen: `восстановления ${resource.genitive}`,
    damageReduction: 'снижения урона',
  })
  const PERCENT_STATS: StatId[] = [
    'critChance',
    'damageReduction',
    'haste',
    'blockChance',
    'offhandPenalty',
    'restThreshold',
  ]
  const FLAG_TEXT: Record<TalentFlag, string> = {
    'quick-strike-bleeds': 'Скорый выпад начинает накладывать урон по времени',
    'halved-revive': 'Воскрешение занимает вдвое меньше времени',
    'rest-clears-cooldowns': 'После привала умения готовы: кулдауны снимаются',
  }
  const REASON_TEXT: Record<TalentBlockReason, (t: TalentDef) => string> = {
    'branch-locked': (t) => `Нужно ${t.requiredPointsInBranch} очков в ветке`,
    'max-rank': () => 'Уже максимальный ранг',
    'no-points': () => 'Нет свободных очков',
  }

  // Текст одного модификатора за ОДИН ранг: игрок видит цену следующего очка.
  function modText(mod: TalentModifier): string {
    const name = STAT_NAMES[mod.stat]
    if (mod.kind === 'percent') return `+${mod.value.times(100).toFixed(0)}% ${name}`
    if (mod.kind === 'multiplier') return `×${mod.value.toFixed(2)} ${name}`
    if (PERCENT_STATS.includes(mod.stat)) {
      return `+${mod.value.times(100).toFixed(mod.value.times(100).lt(10) ? 1 : 0)}% ${name}`
    }
    return `+${formatNumber(mod.value)} ${name}`
  }

  function effectText(talent: TalentDef): string {
    if (talent.effect.kind === 'flag') return FLAG_TEXT[talent.effect.flag]
    return `${talent.effect.mods.map(modText).join(', ')} за ранг`
  }
</script>

<Panel title="Таланты">
  {#snippet header()}
    {#if points > 0}
      <Tag tone="xp" size="md" label="свободных очков: {points}" />
    {:else if $gameState.level.lt(TALENT_FIRST_LEVEL)}
      <Tag size="md" label="первое очко — на {TALENT_FIRST_LEVEL} уровне" />
    {:else}
      <Tag size="md" label="очков нет — следующее с уровнем" />
    {/if}
  {/snippet}

  <div class="branches">
    {#each BRANCHES as branch (branch.id)}
      <div class="branch">
        <h3>{branch.name}</h3>
        {#each talentsInBranch(branch.id) as talent (talent.id)}
          {@const status = talentStatus($gameState, talent)}
          <div class="talent" class:locked={!status.canInvest} class:taken={status.rank > 0}>
            <div class="head">
              <Icon name={talent.icon} /><span class="name">{talent.name}</span>
              <span class="rank" class:full={status.rank === status.maxRank}>
                {status.rank}/{status.maxRank}
              </span>
            </div>
            <div class="effect">{effectText(talent)}</div>
            {#if status.canInvest}
              <Button size="sm" variant="primary" onclick={() => investTalentPoint(talent.id)}>
                Вложить очко
              </Button>
            {:else}
              <span class="reason">
                {REASON_TEXT[status.reason ?? 'no-points'](talent)}
                {#if status.reason === 'branch-locked'}
                  <span class="progress">
                    (вложено {status.pointsInBranch} из {status.requiredPointsInBranch})
                  </span>
                {/if}
              </span>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>

  {#snippet footer()}
    <Button disabled={!canReset} onclick={() => resetTalentTree()}>
      Сбросить таланты за <NumberText value={cost} tone="gold" />
    </Button>
    <span class="hint">
      {#if $gameState.talentResets > 0}
        Сбросов было {$gameState.talentResets} — каждый следующий дороже.
      {:else}
        Первый сброс по базовой цене; каждый следующий дороже.
      {/if}
    </span>
  {/snippet}
</Panel>

<style>
  h3 {
    margin: 0;
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-faint);
  }
  .branches {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
  }
  .branch {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .talent {
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
    font-size: var(--text-sm);
  }
  .talent.taken {
    border-color: color-mix(in srgb, var(--c-xp) 60%, transparent);
    background: color-mix(in srgb, var(--c-xp) var(--tint-weak), transparent);
  }
  .talent.locked {
    opacity: 0.55;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-2);
    width: 100%;
  }
  .name {
    font-weight: var(--weight-bold);
  }
  .rank {
    font-size: var(--text-xs);
    color: var(--c-text-muted);
  }
  .rank.full {
    color: var(--c-gold);
  }
  .effect {
    font-size: var(--text-xs);
    color: var(--c-text-muted);
  }
  .reason {
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
  .hint {
    color: var(--c-text-faint);
  }

  @media (min-width: 720px) {
    .branches {
      /* Веток три, и на широком экране они стоят рядом: дерево читается
         целиком, а не листается. */
      grid-template-columns: repeat(3, 1fr);
    }
  }
</style>
