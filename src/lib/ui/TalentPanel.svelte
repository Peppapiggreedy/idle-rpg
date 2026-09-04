<script lang="ts">
  // Дерево талантов: три колонки-ветки СВОЕГО класса, каждая глубиной
  // в 61 очко. Весь текст для игрока — здесь; логика отдаёт только ранги,
  // коды причин и структурированные эффекты.
  import {
    availablePoints,
    heroBranches,
    resetStatus,
    spentInBranch,
    talentStatus,
    type ResetBlockReason,
    type StatId,
    type TalentBlockReason,
  } from '../game'
  import {
    talentsInBranch,
    type TalentDef,
    type TalentFlag,
    type TalentModifier,
  } from '../data/talents'
  import { LEVEL_CAP, TALENT_FIRST_LEVEL } from '../data/balance'
  import { gameState, investTalentPoint, resetTalentTree } from '../stores/game'
  import { resourceWords } from './resource'
  import { flatText } from './statText'
  import { Button, NumberText, Panel, Tag } from './kit'
  import { Icon } from './icons'

  const points = $derived(availablePoints($gameState))
  const reset = $derived(resetStatus($gameState))

  // Почему кнопка сброса заперта. Заперта молча она читалась как сломанная.
  const RESET_REASON: Record<ResetBlockReason, string> = {
    'nothing-spent': 'Сбрасывать нечего — очки не вложены',
    gold: 'Не хватает золота на сброс',
  }

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
    armor: 'брони',
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
  // Текст флага собирается из ПЕЙЛОАДА таланта: число живёт в данных, а не
  // в подписи. Ветвления по id таланта здесь нет и быть не должно.
  const FLAG_TEXT: Record<TalentFlag, (e: Extract<TalentDef['effect'], { kind: 'flag' }>) => string> =
    {
      'ability-learns-effect': () => 'Умение начинает накладывать урон по времени',
      'ability-extra-charge': (e) =>
        `+${'extraCharges' in e ? e.extraCharges : 1} заряд умения: второе нажатие проходит, пока идёт откат`,
      'double-strike': (e) =>
        `${'chance' in e ? (e.chance * 100).toFixed(0) : 0}% шанс, что замах бьёт дважды`,
      'block-reflects': (e) =>
        `Блок возвращает ${'damageShare' in e ? (e.damageShare * 100).toFixed(0) : 0}% поглощённого урона в моба`,
      'block-restores-resource': (e) =>
        `Блок возвращает ${'resourceShare' in e ? (e.resourceShare * 100).toFixed(0) : 0}% запаса ${resource.genitive}`,
      'kill-refunds-cooldowns': (e) =>
        `Убийство срезает откаты на ${'cooldownShare' in e ? ((1 - e.cooldownShare) * 100).toFixed(0) : 0}%`,
      'rest-clears-cooldowns': () => 'После привала умения готовы: откаты снимаются',
      'shorter-rest': (e) =>
        `Привал короче на ${'durationMultiplier' in e ? ((1 - e.durationMultiplier) * 100).toFixed(0) : 0}%`,
      'faster-revive': (e) =>
        `Воскрешение быстрее на ${'reviveMultiplier' in e ? ((1 - e.reviveMultiplier) * 100).toFixed(0) : 0}%`,
    }
  const REASON_TEXT: Record<TalentBlockReason, (t: TalentDef) => string> = {
    'other-class': () => 'Ветка другого класса',
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
    return `${flatText(mod.value)} ${name}`
  }

  function effectText(talent: TalentDef): string {
    if (talent.effect.kind === 'flag') return FLAG_TEXT[talent.effect.flag](talent.effect)
    return `${talent.effect.mods.map(modText).join(', ')} за ранг`
  }
</script>

<!-- ЗАКРЫТО ЗНАЧИТ НЕ ВИДНО: до первого очка дерева нет в разметке вовсе.
     Пустое дерево с подписью «первое очко на десятом уровне» показывало
     игроку всю будущую прокачку заранее — то есть ровно то, что лестница
     открытий держит закрытым. -->
{#if $gameState.level.gte(TALENT_FIRST_LEVEL)}
<Panel title="Таланты">
  {#snippet header()}
    {#if points > 0}
      <Tag tone="xp" size="md" label="свободных очков: {points}" />
    {:else if $gameState.level.gte(LEVEL_CAP)}
      <!--
        НА ПОТОЛКЕ ОБЕЩАТЬ НЕЧЕГО. «Следующее с уровнем» — правда ровно до
        сотого: дальше уровней не будет, и обещание превращается в ожидание
        того, что не наступит. Всё, что можно, уже вложено; поменять выбор
        можно только сбросом, и подпись говорит именно это.
      -->
      <Tag size="md" label="очки кончились: все вложены, дальше только сброс" />
    {:else}
      <Tag size="md" label="очков нет — следующее с уровнем" />
    {/if}
  {/snippet}

  <div class="branches">
    {#each heroBranches($gameState) as branch (branch.id)}
      <div class="branch">
        <h3>
          {branch.name}
          <span class="invested">{spentInBranch($gameState.talents, branch.id)}</span>
        </h3>
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
    <Button disabled={!reset.canReset} onclick={() => resetTalentTree()}>
      Сбросить таланты за <NumberText value={reset.cost} tone="gold" />
    </Button>
    <span class="hint">
      {#if reset.reason}
        {RESET_REASON[reset.reason]}.
      {:else if $gameState.talentResets > 0}
        Сбросов было {$gameState.talentResets} — каждый следующий дороже.
      {:else}
        Первый сброс по базовой цене; каждый следующий дороже.
      {/if}
    </span>
  {/snippet}
</Panel>
{/if}

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
