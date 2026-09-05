<script lang="ts">
  // Дерево талантов СВОЕГО класса: три ветки переключаются вкладками, ветка
  // разложена по ЭТАЖАМ, на этаже один, два или три таланта с общим порогом.
  // Весь текст для игрока — здесь; логика отдаёт только ранги, коды причин и
  // структурированные эффекты.
  import {
    Decimal,
    availablePoints,
    formatNumber,
    heroBranches,
    resetStatus,
    spentInBranch,
    talentStatus,
    takeBackStatus,
    type ResetBlockReason,
    type StatId,
    type TalentBlockReason,
  } from '../game'
  import {
    TALENT_BY_ID,
    groupHolder,
    type BranchId,
    type TalentDef,
    type TalentFlag,
    type TalentModifier,
  } from '../data/talents'
  import { floorsOf } from './talentFloors'
  import { LEVEL_CAP, TALENT_FIRST_LEVEL } from '../data/balance'
  import {
    gameState,
    investTalentPoint,
    resetTalentTree,
    takeBackTalentPoint,
  } from '../stores/game'
  import { talentDraft } from '../stores/ui'
  import { resourceWords } from './resource'
  import { flatText } from './statText'
  import { abilityTuneText } from './abilityText'
  import { ABILITY_BY_ID } from '../data/abilities'
  import { Button, NumberText, Panel, Tag } from './kit'
  import { Icon } from './icons'

  const points = $derived(availablePoints($gameState))
  const reset = $derived(resetStatus($gameState))

  // Почему кнопка сброса заперта. Заперта молча она читалась как сломанная.
  // СКОЛЬКО НЕ ХВАТАЕТ — ЧИСЛОМ. «Не хватает золота» не говорит, сколько ещё
  // копить, и цель превращается в стену без расстояния до неё. Число берётся
  // из логики (`resetStatus.short`), а не считается здесь второй раз.
  const RESET_REASON: Record<ResetBlockReason, (short: Decimal) => string> = {
    'nothing-spent': () => 'Сбрасывать нечего — очки не вложены',
    gold: (short) => `Не хватает ${formatNumber(short)} золота на сброс`,
  }

  // Ресурс называется по классу: ветки у классов разные, но общие статы
  // описываются одними и теми же строками.
  const resource = $derived(resourceWords($gameState.classId))

  // Названия статов и флагов — единственное место, где они превращаются в текст.
  const STAT_NAMES: Record<StatId, string> = $derived({
    strength: 'силы',
    agility: 'ловкости',
    intellect: 'интеллекта',
    vitality: 'выносливости',
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
      'ability-learns-effect': (e) =>
        'abilityId' in e && 'effect' in e
          ? `«${ABILITY_BY_ID[e.abilityId]?.name ?? e.abilityId}» начинает кровить: ` +
            `${e.effect.ticks} ${e.effect.ticks === 1 ? 'раз' : e.effect.ticks < 5 ? 'раза' : 'раз'} ` +
            `по ${Math.round(e.effect.weaponDamagePercent.toNumber() * 100)} % удара оружия ` +
            `каждые ${e.effect.tickIntervalSec} с`
          : 'Умение начинает накладывать урон по времени',
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
  // КАКАЯ ВЕТКА ОТКРЫТА — «где я сейчас». В сейв ему не место, и переживать
  // перезагрузку он не должен; локальной переменной компонента достаточно.
  let openBranch = $state<BranchId>(heroBranches($gameState)[0]?.id ?? 'warden-wrath')

  const REASON_TEXT: Record<TalentBlockReason, (t: TalentDef) => string> = {
    'other-class': () => 'Ветка другого класса',
    'branch-locked': (t) => `Нужно ${t.requiredPointsInBranch} очков в ветке`,
    'max-rank': () => 'Уже максимальный ранг',
    'no-points': () => 'Нет свободных очков',
    // СТРЕЛКА НАЗЫВАЕТ ОПОРНЫЙ ТАЛАНТ ПО ИМЕНИ. «Не открыто» ничего не
    // говорит игроку, который смотрит на дерево впервые.
    'needs-talent': (t) => {
      const need = t.requires
      if (!need) return 'Нужен талант выше'
      const anchor = TALENT_BY_ID[need.talentId]?.name ?? need.talentId
      const rank = need.minRank ?? 1
      return rank > 1 ? `Нужно ${rank} ранга в «${anchor}»` : `Нужен талант «${anchor}»`
    },
    // ГРУППА НАЗЫВАЕТ ВЫБРАННОГО СОСЕДА ПО ИМЕНИ: «заперто» не объясняет, чем.
    'group-taken': (t) => {
      const chosen = groupHolder($gameState.talents, t)
      return chosen ? `Выбран «${chosen.name}» — вместе не берутся` : 'Заперт выбором на этаже'
    },
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
    // ТАЛАНТ, ПРАВЯЩИЙ УМЕНИЕ, ПОКАЗЫВАЕТ, ЧЕМ УМЕНИЕ СТАНЕТ. Строка
    // собирается из тех же полей, что и описание самого умения: второй
    // формулировки на игру быть не должно.
    if (talent.effect.kind === 'ability') return abilityTuneText(talent.effect)
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

  <!-- ТРИ ВЕТКИ ПЕРЕКЛЮЧАЮТСЯ, И ОЧКИ ВИДНЫ В КАЖДОЙ. Три дерева по тридцать
       с лишним узлов рядом не помещаются ни на одном экране, а выбор ветки —
       главное решение игрока: он обязан видеть, сколько уже вложено в каждую,
       не переключаясь. -->
  <div class="tabs" role="tablist" data-branch-tabs>
    {#each heroBranches($gameState) as branch (branch.id)}
      {@const spent = spentInBranch($gameState.talents, branch.id)}
      <button
        type="button"
        role="tab"
        class="tab"
        class:active={branch.id === openBranch}
        aria-selected={branch.id === openBranch}
        onclick={() => (openBranch = branch.id)}
      >
        {branch.name}
        <span class="spent" class:some={spent > 0}>{spent}</span>
      </button>
    {/each}
  </div>

  {#each heroBranches($gameState).filter((b) => b.id === openBranch) as branch (branch.id)}
    <div class="branch" data-branch={branch.id}>
      {#each floorsOf(branch.id) as floor (floor.row)}
        <!-- ЭТАЖ — РЯД. Пустых мест в ряду нет: два таланта значит два, а не
             два и дырка. Порог этажа подписан один раз на ряд — он общий. -->
        <div class="floor" data-floor={floor.row}>
          <span class="gate" class:met={spentInBranch($gameState.talents, branch.id) >= floor.required}>
            {floor.required}
          </span>
          <div class="row">
            {#each floor.talents as talent (talent.id)}
              {@const status = talentStatus($gameState, talent)}
              {@const back = takeBackStatus($gameState, talent, $talentDraft)}
              <div
                class="talent"
                class:locked={!status.canInvest && status.rank === 0}
                class:taken={status.rank > 0}
                class:group-locked={status.reason === 'group-taken'}
                data-talent={talent.id}
                data-group-locked={status.reason === 'group-taken' ? '' : undefined}
              >
                <div class="head">
                  <Icon name={talent.icon} /><span class="name">{talent.name}</span>
                  <span class="rank" class:full={status.rank === status.maxRank} data-rank>
                    {status.rank}/{status.maxRank}
                  </span>
                </div>
                <!-- СТРЕЛКА НАЗВАНА ПРЯМО, а не нарисована линией: линия в
                     колонке из тринадцати рядов читается хуже имени. -->
                {#if talent.requires}
                  <span class="arrow" data-arrow>
                    ↑ {TALENT_BY_ID[talent.requires.talentId]?.name ?? talent.requires.talentId}
                    {#if (talent.requires.minRank ?? 1) > 1}({talent.requires.minRank}){/if}
                  </span>
                {/if}
                <div class="effect">{effectText(talent)}</div>
                <div class="acts">
                  {#if status.canInvest}
                    <Button size="sm" variant="primary" onclick={() => investTalentPoint(talent.id)}>
                      Вложить
                    </Button>
                  {:else}
                    <span class="reason" data-reason>
                      {REASON_TEXT[status.reason ?? 'no-points'](talent)}
                      {#if status.reason === 'branch-locked'}
                        <span class="progress">
                          (вложено {status.pointsInBranch} из {status.requiredPointsInBranch})
                        </span>
                      {/if}
                    </span>
                  {/if}
                  <!-- ОТМЕНА ПОКА ЭКРАН ОТКРЫТ. Кнопка появляется только у
                       того, что вложено В ЭТОТ ЗАХОД: остальное снимается
                       платным сбросом, и обещать иное нельзя. -->
                  {#if back.fromThisVisit > 0}
                    <Button
                      size="sm"
                      disabled={!back.canTakeBack}
                      title={back.reason === 'blocks-dependent'
                        ? 'Ниже стоит талант, которому нужен этот ранг'
                        : 'Снять очко, вложенное в этот заход'}
                      onclick={() => takeBackTalentPoint(talent.id)}
                    >
                      Снять
                    </Button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/each}

  {#snippet footer()}
    <Button disabled={!reset.canReset} onclick={() => resetTalentTree()}>
      Сбросить таланты за <NumberText value={reset.cost} tone="gold" />
    </Button>
    <span class="hint">
      {#if reset.reason}
        {RESET_REASON[reset.reason](reset.short)}.
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
  /* ПЕРЕКЛЮЧАТЕЛЬ ВЕТОК. Три дерева по тридцать с лишним узлов рядом не
     помещаются, а число вложенных очков видно у каждой вкладки: выбор ветки
     — главное решение, и делать его вслепую нельзя. */
  .tabs {
    display: flex;
    gap: var(--space-1);
    margin-bottom: var(--space-3);
  }
  .tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-height: var(--tap-min);
    padding: var(--space-2);
    font: inherit;
    color: var(--c-text-muted);
    background: var(--c-surface-sunken);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    cursor: pointer;
  }
  .tab.active {
    color: var(--c-text);
    border-color: var(--c-accent);
    background: color-mix(in srgb, var(--c-accent) var(--tint-weak), var(--c-surface-sunken));
  }
  .spent {
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
  .spent.some {
    color: var(--c-xp);
  }
  .branch {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  /* ЭТАЖ — РЯД. Порог слева один на ряд: он общий для всех талантов этажа,
     и повторять его у каждой клетки значило бы сказать одно трижды. */
  .floor {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: start;
    gap: var(--space-2);
  }
  .gate {
    min-width: 2ch;
    padding-top: var(--space-2);
    font-size: var(--text-xs);
    color: var(--c-text-faint);
    text-align: right;
  }
  .gate.met {
    color: var(--c-xp);
  }
  .row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: var(--space-2);
  }
  .arrow {
    font-size: var(--text-2xs);
    color: var(--c-accent);
  }
  .acts {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
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
</style>
