<script lang="ts">
  // Двумерная боевая сцена: фон зоны, два силуэта, эффекты и всплывающие
  // числа — обычные элементы и CSS, без движка.
  //
  // ЖЕЛЕЗНОЕ ПРАВИЛО СЛОЯ: сцена ТОЛЬКО ЧИТАЕТ игровое состояние и никогда
  // в него не пишет. Из stores/game ей позволена ровно подписка; ни одного
  // экшена. Держится тестом render2d.test.ts, который читает этот файл.
  //
  // ВЕСЬ БЮДЖЕТ ДВИЖЕНИЯ — НА УДАР, НЕ НА ПОКОЙ. В покое бойцы стоят; видно
  // обязано быть замах (кто сейчас бьёт), попадание (вспышка, сдвиг, число),
  // крит (крупнее и другим цветом), умение (отличается от автоатаки),
  // лечение (своё кольцо и цвет), смерть моба (затухание), привал
  // (отдельное состояние, не пустой экран) и новый уровень (вспышка и номер
  // над героем — иначе момент виден только сменой цифры в строке уровня).
  //
  // Эффекты держатся НЕ ключевыми кадрами, а состоянием: удар ставит метку
  // времени, каждый тик состояния решает, жив ли ещё эффект, и вешает класс.
  // Так эффект замирает вместе с игрой, не зависит от prefers-reduced-motion
  // (там анимации обрезаны до миллисекунды) и в точности воспроизводится
  // позой для эталона: поза — те же классы, только застывшие.
  import { onDestroy, onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { formatNumber } from '../game'
  import { subscribe as subscribeAttacks, subscribeLog } from '../game/events'
  import {
    CRIT_FLASH_MS,
    DEATH_FADE_MS,
    FLOATER_LIMIT,
    FLOATER_LIMIT_MOBILE,
    FLOATER_MAX_SPEED,
    HEAL_PULSE_MS,
    HIT_FLASH_MS,
    MOBILE_BREAKPOINT,
    STRIKE_MS,
  } from '../data/render'
  import { HERO_SPRITE } from '../data/sprites'
  import { gameState, offlineReport, simSpeed } from '../stores/game'
  import { screenshotPose } from '../ui/route'
  import { createFloaterQueue, floaterKind, floaterProgress, type Floater } from './floaters'
  import { createLevelUpTracker, type LevelUpView } from './levelup'
  import { sceneModel, type MonsterView, type SceneModel } from './model'

  type HitState = 'none' | 'hit' | 'crit'

  interface Effects {
    /** Выпад бьющего: кто сейчас ударил. */
    heroLunge: boolean
    monsterLunge: boolean
    /** Вспышка и сдвиг на получившем. */
    heroHit: HitState
    monsterHit: HitState
    /** Последний удар по мобу был умением — след другого вида. */
    monsterAbility: boolean
    /** Кольцо лечения над героем. */
    heroHeal: boolean
  }

  const NO_EFFECTS: Effects = {
    heroLunge: false,
    monsterLunge: false,
    heroHit: 'none',
    monsterHit: 'none',
    monsterAbility: false,
    heroHeal: false,
  }

  const base = import.meta.env.BASE_URL
  // Поза для эталона: только в режиме съёмки, в живой игре всегда null.
  const pose = screenshotPose()
  // На телефоне чисел меньше: экран уже, каждое — перекладка.
  const mobile = globalThis.innerWidth < MOBILE_BREAKPOINT
  const floaters = createFloaterQueue(mobile ? FLOATER_LIMIT_MOBILE : FLOATER_LIMIT)
  // Новый уровень: один слот с меткой времени, гаснет на тике, как всё здесь.
  const levelUps = createLevelUpTracker()
  // Пик эффекта для позы: уже поднялось, ещё не начало таять — та же доля,
  // на которой застывает число в seedPoseFloater.
  const POSE_LIFE = 0.3

  let host: HTMLDivElement
  let bgImg = $state<HTMLImageElement | null>(null)
  let heroImg = $state<HTMLImageElement | null>(null)

  const initial = sceneModel(get(gameState))
  let view = $state<SceneModel>(initial)
  let effects = $state<Effects>(NO_EFFECTS)
  let painted = $state<{ f: Floater; life: number }[]>([])
  // Убитый моб ещё виден, пока тает; прогресс 0..1 считает тик, не CSS.
  let dying = $state<{ view: MonsterView; progress: number } | null>(null)
  // Вспышка и номер нового уровня над героем; null — эффекта нет.
  let levelUp = $state<LevelUpView | null>(null)

  let speed = 1
  let offlineOpen = false
  let lastMonster: MonsterView | null = initial.monster
  let dyingSince = -Infinity

  // Метки времени ударов; по ним каждый тик решает, жив ли эффект.
  let heroStruckAt = -Infinity
  let monsterStruckAt = -Infinity
  let heroHurtAt = -Infinity
  let heroHurtCrit = false
  let monsterHurtAt = -Infinity
  let monsterHurtCrit = false
  let monsterHurtAbility = false
  let healAt = -Infinity

  function hitState(at: number, crit: boolean, now: number): HitState {
    const life = crit ? CRIT_FLASH_MS : HIT_FLASH_MS
    if (now - at >= life) return 'none'
    return crit ? 'crit' : 'hit'
  }

  function liveEffects(now: number): Effects {
    return {
      heroLunge: now - heroStruckAt < STRIKE_MS,
      monsterLunge: now - monsterStruckAt < STRIKE_MS,
      heroHit: hitState(heroHurtAt, heroHurtCrit, now),
      monsterHit: hitState(monsterHurtAt, monsterHurtCrit, now),
      monsterAbility: monsterHurtAbility && now - monsterHurtAt < HIT_FLASH_MS,
      heroHeal: now - healAt < HEAL_PULSE_MS,
    }
  }

  // Поза — застывший пик эффекта. Числа берутся из состояния, а не из
  // констант: эталон должен показывать тот же порядок величин, что игра.
  function posedEffects(): Effects {
    if (pose === null) return NO_EFFECTS
    return {
      heroLunge: pose === 'hit' || pose === 'crit',
      monsterLunge: false,
      heroHit: 'none',
      monsterHit: pose === 'hit' ? 'hit' : pose === 'crit' ? 'crit' : 'none',
      monsterAbility: false,
      heroHeal: pose === 'heal',
    }
  }

  function posedModel(m: SceneModel): SceneModel {
    if (pose === 'rest') {
      return {
        ...m,
        phase: 'rest',
        monster: null,
        hero: { ...m.hero, resting: true, restProgress: 0.4, swing: 0 },
      }
    }
    if (pose === 'swing') return { ...m, hero: { ...m.hero, swing: 0.85 } }
    return { ...m, hero: { ...m.hero, swing: 0 } }
  }

  function paint(now: number): void {
    const s = get(gameState)
    const m = sceneModel(s)

    // Смерть моба ловим по НАБЛЮДАЕМОМУ переходу «был → исчез», как это
    // делает прогон баланса: ради сцены в тик не добавлено ни одного поля.
    // На ускорении и под отчётом возврата затухания нет: там моб за кадр
    // сменяется десятки раз, и любая анимация была бы ложью.
    if (lastMonster !== null && m.monster === null && speed <= FLOATER_MAX_SPEED && !offlineOpen) {
      dyingSince = now
      dying = { view: lastMonster, progress: 0 }
    }
    if (dying !== null) {
      const progress = DEATH_FADE_MS > 0 ? (now - dyingSince) / DEATH_FADE_MS : 1
      if (m.monster !== null || progress >= 1) dying = null
      else dying = { view: dying.view, progress }
    }
    lastMonster = m.monster

    view = pose === null ? m : posedModel(m)
    effects = pose === null ? liveEffects(now) : posedEffects()
    // В позе число застыло (см. seedPoseFloater) и по часам не тает.
    if (pose === null) painted = floaters.alive(now).map((f) => ({ f, life: floaterProgress(f, now) }))
    // Поза нового уровня показывает уровень героя из состояния, а не константу:
    // эталон обязан показывать те же числа, что игра.
    levelUp =
      pose === null
        ? levelUps.alive(now)
        : pose === 'levelup'
          ? { level: formatNumber(s.level), life: POSE_LIFE }
          : null
  }

  const unsubscribeState = gameState.subscribe(() => paint(performance.now()))

  const unsubscribeSpeed = simSpeed.subscribe((v) => {
    speed = v
  })

  const unsubscribeOffline = offlineReport.subscribe((r) => {
    offlineOpen = r !== null
    if (offlineOpen) {
      floaters.clear()
      levelUps.clear()
      dying = null
    }
  })

  const unsubscribeAttacks = subscribeAttacks((event) => {
    const now = performance.now()
    const targetIsHero = event.targetId === 'hero'
    if (event.sourceId === 'hero') heroStruckAt = now
    else monsterStruckAt = now
    if (targetIsHero) {
      heroHurtAt = now
      heroHurtCrit = event.isCrit
    } else {
      monsterHurtAt = now
      monsterHurtCrit = event.isCrit
      monsterHurtAbility = event.abilityId !== null
    }
    // Числа не создаются вовсе, когда их некому читать: спрятанная вкладка
    // и ускоренная симуляция. На ×100 сюда прилетают сотни событий за кадр.
    if (document.hidden || speed > FLOATER_MAX_SPEED) return
    floaters.push({
      anchor: targetIsHero ? 'hero' : 'monster',
      kind: floaterKind(targetIsHero, event.isCrit, event.abilityId),
      text: formatNumber(event.amount),
      bornAt: now,
      // Math.random, а НЕ game/rng: поток случайности игры принадлежит
      // симуляции, и вычерпывать его из слоя рендера значило бы менять
      // ход игры от того, открыта вкладка или нет.
      drift: Math.random() * 2 - 1,
    })
  })

  // Лечение и новый уровень идут не ударом, а событием лога: прок с
  // эффектом heal, зелье и `levelup` из applyLevelUps.
  const unsubscribeLog = subscribeLog((events) => {
    const now = performance.now()
    levelUps.push(events, now)
    for (const event of events) {
      if (event.type === 'proc' && event.effect === 'heal') {
        healAt = now
        if (document.hidden || speed > FLOATER_MAX_SPEED) continue
        floaters.push({
          anchor: 'hero',
          kind: 'heal',
          text: `+${formatNumber(event.amount)}`,
          bornAt: now,
          drift: Math.random() * 2 - 1,
        })
      } else if (event.type === 'potion') {
        healAt = now
      }
    }
  })

  // Поза несёт своё число: игра в режиме съёмки стоит, и настоящих ударов нет.
  function seedPoseFloater(): void {
    if (pose === null) return
    const s = get(gameState)
    const now = performance.now()
    // Доли — подобие типичного удара, крита и прока лечения на этом уровне.
    if (pose === 'hit') {
      floaters.push({ anchor: 'monster', kind: 'damage', text: formatNumber(s.monster.maxHp.mul(0.12)), bornAt: now, drift: 0 })
    } else if (pose === 'crit') {
      floaters.push({ anchor: 'monster', kind: 'crit', text: formatNumber(s.monster.maxHp.mul(0.29)), bornAt: now, drift: 0 })
    } else if (pose === 'heal') {
      floaters.push({ anchor: 'hero', kind: 'heal', text: `+${formatNumber(s.stats.maxHp.mul(0.18))}`, bornAt: now, drift: 0 })
    }
    // Число застывает на трети пути: уже поднялось, ещё не начало таять.
    painted = floaters.alive(now).map((f) => ({ f, life: 0.3 }))
  }

  // Готовность — когда фон и герой на месте (или точно не приедут): снимок
  // сцены без картинок был бы снимком пустоты. Ошибка загрузки готовности
  // не мешает: на месте картинки остаётся цветной прямоугольник, игра идёт.
  let settled = 0
  function settle(): void {
    settled += 1
    if (settled >= 2 && host && !host.dataset.scene) host.dataset.scene = 'ready'
  }

  function onVisibility(): void {
    // Спрятанная вкладка: числа никому не нужны, и копиться им незачем.
    if (document.hidden) {
      floaters.clear()
      levelUps.clear()
      painted = []
      levelUp = null
    }
  }

  onMount(() => {
    // Картинка из кеша может успеть загрузиться до подписки на onload.
    for (const img of [bgImg, heroImg]) if (img?.complete) settle()
    seedPoseFloater()
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  })

  onDestroy(() => {
    unsubscribeState()
    unsubscribeSpeed()
    unsubscribeOffline()
    unsubscribeAttacks()
    unsubscribeLog()
    floaters.clear()
    levelUps.clear()
  })
</script>

<div
  class="host"
  bind:this={host}
  data-phase={view.phase}
  data-pose={pose}
  aria-hidden="true"
>
  <!-- Слой 1: фон полосы уровней. -->
  <img
    class="bg"
    alt=""
    src={base + view.background.path}
    bind:this={bgImg}
    onload={settle}
    onerror={settle}
  />

  <!-- Слой 2: моб (или его тающая тень). -->
  {#if view.monster}
    <div
      class="actor monster"
      class:boss={view.monster.isBoss}
      class:enraged={view.monster.enraged}
      style="--swing: {view.monster.swing.toFixed(3)}"
    >
      <div
        class="body"
        class:lunge={effects.monsterLunge}
        class:kick={effects.monsterHit === 'hit'}
        class:kick-crit={effects.monsterHit === 'crit'}
      >
        <img class="sprite" alt="" src={base + view.monster.sprite.path} />
      </div>
    </div>
  {:else if dying}
    <div
      class="actor monster dying"
      class:boss={dying.view.isBoss}
      style="--swing: 0; --fade: {dying.progress.toFixed(3)}"
    >
      <div class="body">
        <img class="sprite" alt="" src={base + dying.view.sprite.path} />
      </div>
    </div>
  {/if}

  <!-- Слой 3: герой. -->
  <div
    class="actor hero"
    class:dead={!view.hero.alive}
    class:resting={view.hero.resting}
    style="--swing: {view.hero.swing.toFixed(3)}"
  >
    <div
      class="body"
      class:lunge={effects.heroLunge}
      class:kick={effects.heroHit === 'hit'}
      class:kick-crit={effects.heroHit === 'crit'}
    >
      <img
        class="sprite"
        alt=""
        src={base + HERO_SPRITE.path}
        bind:this={heroImg}
        onload={settle}
        onerror={settle}
      />
    </div>
  </div>

  <!-- Слой 4: эффекты — след умения на мобе, кольцо лечения на герое. -->
  <div class="fx">
    {#if view.monster && effects.monsterHit !== 'none'}
      <i class="flash monster" class:crit={effects.monsterHit === 'crit'} class:ability={effects.monsterAbility}></i>
    {/if}
    {#if effects.heroHit !== 'none'}
      <i class="flash hero"></i>
    {/if}
    {#if effects.heroHeal}
      <i class="ring"></i>
    {/if}
  </div>

  <!-- Новый уровень: вспышка и номер над героем. Всё ведёт --life (доля
       прожитого), как у всплывающих чисел; в позе застывает на пике. -->
  {#if levelUp}
    <div class="levelup" style="--life: {levelUp.life.toFixed(3)}">
      <i class="burst"></i>
      <span class="caption">уровень</span>
      <span class="number">{levelUp.level}</span>
    </div>
  {/if}

  <!-- Полоски здоровья над головами: ширина — доля здоровья. У моба она
       ЕДИНСТВЕННАЯ на экране (в раме второй нет), поэтому несёт число. -->
  <div class="bars">
    <div class="bar hero">
      <i style="width: {Math.round(view.hero.health * 100)}%"></i>
    </div>
    {#if view.monster}
      <div class="bar monster" class:boss={view.monster.isBoss}>
        <i style="width: {Math.round(view.monster.health * 100)}%"></i>
        <span class="hp">{view.monster.hpLabel}</span>
      </div>
    {/if}
  </div>

  <!-- Слой 5: всплывающие числа. Всё считает --life (доля прожитого):
       кадр состояния сам двигает число, при паузе оно замирает. -->
  <div class="floaters">
    {#each painted as p (p.f.id)}
      <span
        class="floater {p.f.kind} {p.f.anchor}"
        style="--life: {p.life.toFixed(3)}; --drift: {p.f.drift.toFixed(3)}"
      >
        {p.f.text}
      </span>
    {/each}
  </div>

  <!-- Привал: отдельное состояние сцены, а не пустая площадка. -->
  {#if view.phase === 'rest'}
    <div class="rest">
      <span class="caption">Привал</span>
      <span class="progress"><i style="width: {Math.round(view.hero.restProgress * 100)}%"></i></span>
    </div>
  {/if}
</div>

<style>
  .host {
    position: absolute;
    inset: 0;
    overflow: hidden;
    /* Раскладка площадки: где стоят бойцы и насколько они высоки. */
    --hero-x: 30%;
    --monster-x: 70%;
    /* Земля поднята над подписью рамы (имя и уровень моба внизу сцены):
       ноги, кольцо лечения и тень не должны уходить под неё. */
    --ground: 19%;
    --figure-h: 42%;
    --monster-scale: 1;
    /* Насколько бойца ведёт назад на замахе и вперёд на выпаде. */
    --lean: 5%;
    --lunge: 14%;
    --kick: 6%;
    /* Голова — над ней полоска и числа. */
    --head: calc(var(--ground) + var(--figure-h));
  }
  @media (max-width: 719px) {
    .host {
      /* Мобильная рама 4:3 ниже, а подпись под ней той же высоты и съедает
         уже четверть картинки: земля выше, бойцы ниже — иначе имя моба
         ложится им на пояс. */
      --ground: 30%;
      --figure-h: 38%;
    }
  }
  .bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center bottom;
  }

  .actor {
    position: absolute;
    bottom: var(--ground);
    height: var(--figure-h);
    aspect-ratio: 160 / 200;
    transform: translateX(-50%);
  }
  .actor.hero {
    left: var(--hero-x);
  }
  .actor.monster {
    left: var(--monster-x);
    height: calc(var(--figure-h) * var(--monster-scale));
  }
  .actor.monster.boss {
    --monster-scale: 1.25;
  }
  .body {
    width: 100%;
    height: 100%;
    transition: transform var(--dur-fast) ease-out;
    /* Замах ведёт назад (--swing 0..1), выпад бросает вперёд, попадание
       отбрасывает. Герой смотрит вправо, моб — влево: знаки зеркальны. */
    --dir: 1;
    --shift: calc(var(--swing) * var(--lean) * -1);
    transform: translateX(calc(var(--shift) * var(--dir)));
  }
  .monster .body {
    --dir: -1;
  }
  .body.lunge {
    --shift: var(--lunge);
  }
  .body.kick {
    --shift: calc(var(--kick) * -1);
  }
  .body.kick-crit {
    --shift: calc(var(--kick) * -2);
  }
  .sprite {
    display: block;
    width: 100%;
    height: 100%;
    transition: filter var(--dur-fast) ease-out;
  }
  /* Вспышка на цели: обычный удар осветляет, крит — сильнее и теплее. */
  .kick .sprite {
    filter: brightness(1.8);
  }
  .kick-crit .sprite {
    filter: brightness(2.2) drop-shadow(0 0 0.6rem var(--c-warning));
  }
  .enraged .sprite {
    filter: saturate(1.5) drop-shadow(0 0 0.5rem var(--c-damage));
  }
  .enraged .kick .sprite,
  .enraged .kick-crit .sprite {
    filter: brightness(2) saturate(1.5) drop-shadow(0 0 0.6rem var(--c-damage));
  }
  /* Смерть: тень тает, прогресс считает тик. */
  .actor.dying {
    opacity: calc(1 - var(--fade));
    transform: translateX(-50%) translateY(calc(var(--fade) * 6%));
  }
  /* Павший герой лежит; привал — присел. */
  .actor.dead .body {
    transform: translateY(30%) rotate(-80deg);
    filter: grayscale(0.7) brightness(0.6);
    transition: transform var(--dur-slow) ease-in;
  }
  .actor.resting .body {
    transform: translateY(12%) scaleY(0.88);
  }

  .fx {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .fx i {
    position: absolute;
    display: block;
    transform: translate(-50%, 50%);
  }
  /* След удара: полоса поперёк цели — у автоатаки светлая, у умения цвета
     опыта, у крита цвета предупреждения и шире.
     Длина полосы задана ВЫСОТОЙ и поворотом от вертикали, а не шириной:
     процент в width считается от ширины сцены, и на широком экране полоса
     легла бы через всю площадку. Проценты высоты считаются от высоты —
     той же величины, что и рост фигуры. */
  .fx .flash {
    height: calc(var(--figure-h) * 0.9);
    width: 0.35rem;
    border-radius: var(--radius-pill);
    background: var(--c-text);
    box-shadow: 0 0 0.6rem var(--c-text);
    opacity: 0.85;
    bottom: calc(var(--ground) + var(--figure-h) * 0.55);
  }
  .fx .flash.monster {
    left: var(--monster-x);
    transform: translate(-50%, 50%) rotate(62deg);
  }
  .fx .flash.hero {
    left: var(--hero-x);
    transform: translate(-50%, 50%) rotate(-62deg);
    background: var(--c-damage);
    box-shadow: 0 0 0.6rem var(--c-damage);
  }
  .fx .flash.ability {
    background: var(--c-xp);
    box-shadow: 0 0 0.8rem var(--c-xp);
    width: 0.45rem;
  }
  .fx .flash.crit {
    background: var(--c-warning);
    box-shadow: 0 0 1rem var(--c-warning);
    width: 0.6rem;
    height: calc(var(--figure-h) * 1.2);
  }
  /* Кольцо лечения: обод вокруг ног героя. Ширину даёт aspect-ratio от
     высоты — по той же причине, что и у следа удара. */
  .fx .ring {
    left: var(--hero-x);
    bottom: var(--ground);
    height: calc(var(--figure-h) * 0.2);
    aspect-ratio: 3 / 1;
    border: 0.25rem solid var(--c-heal);
    border-radius: 50%;
    box-shadow: 0 0 0.8rem var(--c-heal);
    opacity: 0.9;
  }

  .bars {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .bar {
    position: absolute;
    bottom: calc(var(--head) + 0.4rem);
    width: 3rem;
    height: var(--bar-sm);
    transform: translateX(-50%);
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--c-surface-sunken) 80%, transparent);
    outline: 1px solid color-mix(in srgb, var(--c-border) 70%, transparent);
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    border-radius: var(--radius-pill);
  }
  .bar.hero {
    left: var(--hero-x);
  }
  .bar.hero i {
    background: var(--c-heal);
  }
  .bar.monster {
    left: var(--monster-x);
    /* Число внутри: полоска выше и шире хвостовой, иначе цифры не влезут. */
    width: 7rem;
    height: var(--bar-lg);
  }
  .bar.monster.boss {
    bottom: calc(var(--ground) + var(--figure-h) * 1.25 + 0.4rem);
    width: 8rem;
  }
  .bar.monster i {
    background: var(--c-damage);
  }
  /* «Текущее / максимум» поверх заливки: тень держит читаемость и на
     красной половине, и на тёмной. */
  .bar .hp {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-2xs);
    font-weight: var(--weight-bold);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    color: var(--c-text);
    text-shadow: var(--shadow-sm);
    white-space: nowrap;
  }

  .floaters {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .floater {
    position: absolute;
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-bold);
    font-size: var(--text-sm);
    line-height: 1;
    white-space: nowrap;
    text-shadow: var(--shadow-md);
    /* Стартует над полоской здоровья и поднимается, тая к концу. */
    bottom: calc(var(--head) + 1.4rem + var(--life) * 2.4rem);
    transform: translateX(calc(-50% + var(--drift) * 1.6rem));
    opacity: calc(1 - var(--life) * var(--life));
  }
  .floater.hero {
    left: var(--hero-x);
  }
  .floater.monster {
    left: var(--monster-x);
  }
  .floater.damage {
    color: var(--c-text);
  }
  .floater.ability {
    color: var(--c-xp);
  }
  .floater.crit {
    color: var(--c-warning);
    font-size: var(--text-xl);
  }
  .floater.player-damage {
    color: var(--c-damage);
  }
  .floater.heal {
    color: var(--c-heal);
  }

  /* Новый уровень: вспышка цвета опыта расходится от головы героя, над ней
     поднимается номер. Всё ведёт --life; рост и подъём вынесены в свои
     переменные, чтобы prefers-reduced-motion обнулял их, оставляя вспышку
     и номер на месте. */
  .levelup {
    position: absolute;
    left: var(--hero-x);
    --rise: 1.4rem;
    --grow: 0.8;
    bottom: calc(var(--head) + 2.2rem + var(--life) * var(--rise));
    display: flex;
    flex-direction: column;
    align-items: center;
    transform: translateX(-50%);
    pointer-events: none;
    color: var(--c-xp);
    text-shadow: var(--shadow-md);
    line-height: 1;
    white-space: nowrap;
    opacity: calc(1 - var(--life) * var(--life));
  }
  .levelup .burst {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 5.5rem;
    aspect-ratio: 1;
    border-radius: 50%;
    background: radial-gradient(
      circle,
      color-mix(in srgb, var(--c-xp) 55%, transparent) 0%,
      transparent 70%
    );
    box-shadow: 0 0 1.2rem var(--c-xp);
    transform: translate(-50%, -50%) scale(calc(0.7 + var(--life) * var(--grow)));
    opacity: calc(1 - var(--life));
  }
  /* Текст позиционирован, чтобы лечь ПОВЕРХ вспышки: статичный элемент
     рисовался бы под абсолютно позиционированным соседом. */
  .levelup .caption,
  .levelup .number {
    position: relative;
    font-weight: var(--weight-bold);
  }
  .levelup .caption {
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
  }
  .levelup .number {
    font-size: var(--text-2xl);
    font-variant-numeric: tabular-nums;
  }

  .rest {
    position: absolute;
    left: 50%;
    top: var(--space-3);
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--c-surface-sunken) 75%, transparent);
    color: var(--c-heal);
    font-size: var(--text-sm);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
  }
  .rest .progress {
    display: block;
    width: 6rem;
    height: var(--bar-sm);
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--c-border) 60%, transparent);
    overflow: hidden;
  }
  .rest .progress i {
    display: block;
    height: 100%;
    background: var(--c-heal);
  }

  /* Игрок попросил меньше движения: ни сдвигов, ни отбрасываний, ни подъёма
     чисел. Вспышки и сами числа остаются — это информация, не украшение. */
  @media (prefers-reduced-motion: reduce) {
    .body,
    .body.lunge,
    .body.kick,
    .body.kick-crit {
      --shift: 0%;
    }
    .actor.dying {
      transform: translateX(-50%);
    }
    .floater {
      bottom: calc(var(--head) + 1.8rem);
    }
    .levelup {
      --rise: 0rem;
      --grow: 0;
    }
  }
</style>
