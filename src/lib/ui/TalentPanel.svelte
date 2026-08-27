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

  const points = $derived(availablePoints($gameState))
  const cost = $derived(resetCost($gameState))
  const canReset = $derived(canResetTalents($gameState))

  // Названия статов и флагов — единственное место, где они превращаются в текст.
  const STAT_NAMES: Record<StatId, string> = {
    attackPower: 'силы атаки',
    weaponDamageMin: 'урона оружия (мин)',
    weaponDamageMax: 'урона оружия (макс)',
    maxHp: 'здоровья',
    maxMana: 'маны',
    weaponSpeed: 'скорости оружия',
    haste: 'ускорения',
    critChance: 'шанса крита',
    critMultiplier: 'множителя крита',
    hpRegen: 'восстановления здоровья',
    hpRegenOutOfCombat: 'восстановления здоровья вне боя',
    manaRegen: 'восстановления маны',
    damageReduction: 'снижения урона',
  }
  const PERCENT_STATS: StatId[] = ['critChance', 'damageReduction', 'haste']
  const FLAG_TEXT: Record<TalentFlag, string> = {
    'quick-strike-bleeds': 'Скорый выпад начинает накладывать урон по времени',
    'halved-revive': 'Воскрешение занимает вдвое меньше времени',
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

<section class="talents">
  <h2>Таланты</h2>
  <p class="points">
    {#if points > 0}
      Свободных очков: <strong>{points}</strong>
    {:else if $gameState.level.lt(TALENT_FIRST_LEVEL)}
      Первое очко таланта — на {TALENT_FIRST_LEVEL} уровне
    {:else}
      Свободных очков нет — следующее придёт с уровнем
    {/if}
  </p>

  <div class="branches">
    {#each BRANCHES as branch (branch.id)}
      <div class="branch">
        <h3>{branch.name}</h3>
        {#each talentsInBranch(branch.id) as talent (talent.id)}
          {@const status = talentStatus($gameState, talent)}
          <div class="talent" class:locked={!status.canInvest} class:taken={status.rank > 0}>
            <div class="head">
              <span class="name">{talent.name}</span>
              <span class="rank" class:full={status.rank === status.maxRank}>
                {status.rank}/{status.maxRank}
              </span>
            </div>
            <div class="effect">{effectText(talent)}</div>
            {#if status.canInvest}
              <button type="button" onclick={() => investTalentPoint(talent.id)}>
                Вложить очко
              </button>
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

  <div class="reset">
    <button type="button" disabled={!canReset} onclick={() => resetTalentTree()}>
      Сбросить таланты за {formatNumber(cost)}
    </button>
    <span class="hint">
      {#if $gameState.talentResets > 0}
        Сбросов было {$gameState.talentResets} — каждый следующий дороже.
      {:else}
        Первый сброс по базовой цене; каждый следующий дороже.
      {/if}
    </span>
  </div>
</section>

<style>
  h2 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
  }
  h3 {
    margin: 0 0 0.4rem;
    font-size: 0.9rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    opacity: 0.7;
  }
  .points {
    margin: 0 0 0.75rem;
    font-size: 0.85rem;
  }
  .branches {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }
  .branch {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .talent {
    border: 1px solid #8884;
    border-radius: 8px;
    padding: 0.45rem 0.55rem;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.82rem;
  }
  .talent.taken {
    border-color: var(--color-xp);
    background: color-mix(in srgb, var(--color-xp) 8%, transparent);
  }
  .talent.locked {
    opacity: 0.5;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.4rem;
  }
  .name {
    font-weight: 600;
  }
  .rank {
    font-size: 0.78rem;
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }
  .rank.full {
    color: var(--color-gold);
    opacity: 1;
  }
  .effect {
    font-size: 0.75rem;
    opacity: 0.8;
  }
  .reason {
    font-size: 0.72rem;
    opacity: 0.75;
  }
  .progress {
    opacity: 0.7;
  }
  .reset {
    margin-top: 0.8rem;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .hint {
    font-size: 0.75rem;
    opacity: 0.55;
  }
  button {
    font: inherit;
    font-size: 0.78rem;
    align-self: flex-start;
    margin-top: 0.15rem;
    padding: 0.25em 0.7em;
    border: 1px solid #8886;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    border-color: var(--color-xp);
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
