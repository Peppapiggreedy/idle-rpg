// Тик — конвейер чистых шагов (state, ctx) => state. Порядок фиксирован и важен:
//   1. applyRevive          — мёртвый герой: отсчёт воскрешения; по нулю — полный HP
//                             и откат в последнюю зону, где он выживал
//   1a. applyRest           — привал: отсчёт отдыха либо уход на него по порогу
//   2. applyCooldowns       — кулдауны умений и GCD идут игровым временем
//   2a. applyEnrage         — время боя с боссом; по нему растёт его урон
//   2a. applyAutocast       — таймер реакции и применение умения по приоритету
//   3. applyPendingKill     — моб, добитый мгновенным умением вне тика
//   4a. applyOffhandCombat  — удары ЛЕВОЙ руки по своему таймеру, независимо
//   4. applyCombat          — удары героя по свинг-таймеру; умение из очереди
//                             ЗАМЕНЯЕТ автоатаку; смерть моба в ctx.killedMonster
//   5. applyEffects         — тики урона по времени; тоже могут убить моба
//   6. applyKillRewards     — золото за убитого + событие kill
//   7. applyLevelUps        — опыт за убитого, перенос остатка + событие levelup
//   8. applyLootDrop        — бросок дропа + событие loot
//   9. applyMonsterAttack   — ответный удар моба по своему свинг-таймеру; может убить героя
//  10. applyRegen           — реген HP (в бою медленный, вне боя быстрый) и маны
//  11. applyRespawn         — взводит таймер после смерти моба ИЛИ ведёт отсчёт и спавнит
//  12. applyAutosaveCounter — копит игровое время для автосейва (сохраняет стор)
// Шаги не знают ни про UI, ни про Svelte; текст для игрока рендерится из событий в UI.
// rng потребляют: удар героя (урон + крит), дроп, удар моба и спавн (уровень + архетип).
import { Decimal } from './numbers'
import { applyXp } from './formulas'
import { rollLoot } from './loot'
import { hasOffhand, rollBlock, rollMonsterDamage, rollSwing } from './combat'
import { autoEquipIfBetter } from './equipment'
import type { Rng } from './rng'
import { pushEvent, spawnMonster, type ActiveEffect, type GameState } from './state'
import { ensureStats } from './stats'
import { emit as busEmit } from './events'
import {
  INVENTORY_SIZE,
  REGEN_TICK_S,
  RESPAWN_DELAY_MS,
  REVIVE_DELAY_MS,
} from '../data/balance'
import { ABILITY_BY_ID } from '../data/abilities'
import { currentZone, reviveInZone } from './zones'
import { advanceCooldowns, autocastStep, consumeQueuedAbility } from './abilities'
import { finishRest, needsRest, startRest } from './rest'
import { classById } from '../data/classes'
import { reviveMultiplier } from './talents'
import {
  advanceDungeon,
  clearedXpBonus,
  currentBoss,
  enrageMultiplier,
  leaveDungeon,
  type BossDef,
} from './dungeons'
import { rollBossLoot } from './loot'
import type { AttackEvent, Monster } from '../types'

// Погрешность накопления долей замаха: 0.05 и подобные не представимы в double.
const SWING_EPS = 1e-9

// Предохранитель на случай огромного dtMs (возврат из оффлайна одним шагом):
// цикл начисления порций маны обязан быть конечным. Мана всё равно упирается
// в кап, поэтому потолок ничего не отнимает.
const MAX_REGEN_TICKS_PER_STEP = 64

// Контекст одного тика: вход (dtMs, rng, emit) и факты, которыми шаги обмениваются.
interface TickContext {
  dtMs: number
  rng: Rng
  emitAttack: (event: AttackEvent) => void
  killedMonster: Monster | null
  /** Ударов нанесено и получено за тик: из них класс копит свой ресурс. */
  swingsDealt: number
  hitsTaken: number
}

type TickStep = (state: GameState, ctx: TickContext) => GameState

const applyRevive: TickStep = (s, ctx) => {
  if (s.heroState !== 'dead') return s
  const left = s.reviveMsLeft - ctx.dtMs
  if (left > 0) return { ...s, reviveMsLeft: left }
  // Воскрешение: полный HP и откат в последнюю зону, где герой выживал
  // (если такой нет — в безопасную). Смена зоны сама спавнит моба и пишет лог.
  const revived = reviveInZone(
    { ...s, combatLog: pushEvent(s.combatLog, { type: 'revive' }) },
    ctx.rng,
  )
  return {
    ...revived,
    heroState: 'alive',
    reviveMsLeft: 0,
    currentHp: s.stats.maxHp,
    // Умения не переживают смерть: очередь и эффекты были на прежнем мобе.
    queuedAbilityId: null,
    activeEffects: [],
  }
}

/**
 * Привал. Сидит ДО кулдаунов и боя: пока герой отдыхает, он не бьёт, не
 * получает по себе и не жмёт умений — тик для него сводится к отсчёту.
 *
 * Уход на привал проверяется здесь же, но ПОСЛЕ отсчёта: порог мерится по
 * состоянию, с которым герой пришёл в тик.
 */
const applyRest: TickStep = (s, ctx) => {
  if (s.heroState === 'dead') return s
  if (s.heroState === 'resting') {
    const restMsLeft = s.restMsLeft - ctx.dtMs
    if (restMsLeft > 0) return { ...s, restMsLeft }
    const done = finishRest(s)
    return { ...done, combatLog: pushEvent(done.combatLog, { type: 'rest-end', interrupted: false }) }
  }
  if (!needsRest(s)) return s
  const resting = startRest(s)
  return { ...resting, combatLog: pushEvent(resting.combatLog, { type: 'rest-start' }) }
}

// Кулдауны умений и GCD идут ИГРОВЫМ временем: множитель скорости из
// отладочной панели ускоряет их ровно так же, как бой.
const applyCooldowns: TickStep = (s, ctx) => advanceCooldowns(s, ctx.dtMs)

// Время боя с текущим боссом копится игровым временем — от него ярость.
// Скачок ярости пишем в лог один раз, в момент перехода на новую ступень.
const applyEnrage: TickStep = (s, ctx) => {
  const boss = currentBoss(s)
  if (!s.dungeonRun || !boss || s.heroState === 'dead') return s
  const fightMs = s.dungeonRun.fightMs + ctx.dtMs
  const before = enrageMultiplier(boss, s.dungeonRun.fightMs)
  const after = enrageMultiplier(boss, fightMs)
  const next = { ...s, dungeonRun: { ...s.dungeonRun, fightMs } }
  if (after === before) return next
  return {
    ...next,
    combatLog: pushEvent(next.combatLog, {
      type: 'enrage',
      bossName: boss.name,
      multiplier: after,
    }),
  }
}

// Автокаст: ведёт таймер реакции и жмёт первое доступное умение по приоритету.
// Стоит ПОСЛЕ кулдаунов (иначе умение, освободившееся на этом тике, пришлось
// бы ждать лишний тик) и ДО боя (мгновенное умение бьёт до замаха).
const applyAutocast: TickStep = (s, ctx) => {
  // Между мобами и на привале автокаст молчит: бить некого, таймеры
  // взводятся заново.
  if (s.respawnMsLeft > 0 || s.heroState === 'resting') return { ...s, autocastReadyMs: {} }
  return autocastStep(s, ctx.dtMs, ctx.rng, ctx.emitAttack)
}

// Мгновенное умение бьёт вне тика и может добить моба. Смерть оформляет
// конвейер — награды, лут и респаун идут обычным путём.
const applyPendingKill: TickStep = (s, ctx) => {
  if (s.respawnMsLeft > 0 || s.heroState !== 'alive') return s
  if (s.monster.currentHp.gt(0)) return s
  ctx.killedMonster = s.monster
  return s
}

const applyCombat: TickStep = (s, ctx) => {
  // На привале герой не бьёт: замах стоит, как и во время респауна.
  if (s.heroState !== 'alive') return s
  // Во время респауна свинг-таймер стоит: первый удар по новому мобу — через
  // полный замах, без бесплатного «накопленного» удара.
  if (s.respawnMsLeft > 0) return s
  // Прогресс копится ДОЛЕЙ замаха: dt / swingTime. Смена оружия или haste
  // в середине замаха сохраняет долю — без сброса и без мгновенного удара.
  let swingProgress = s.swingProgress + ctx.dtMs / (s.stats.swingTime * 1000)
  let monster = s.monster
  let combatLog = s.combatLog
  // Удар при каждом полном замахе; остаток доли переносится, иначе на
  // медленном тике теряется время между ударами. EPS гасит накопленную
  // погрешность дробей (0.05 не представима в double).
  // Всё, что замах может изменить, ведём локально и собираем в конце.
  let swung: GameState = s
  while (swingProgress >= 1 - SWING_EPS && ctx.killedMonster === null) {
    swingProgress = Math.max(0, swingProgress - 1)
    // Замах пришёлся на умение из очереди — оно ЗАМЕНЯЕТ автоатаку. Не хватило
    // маны или умение успело уйти в кулдаун — очередь снимается, бьём обычно.
    const withAbility = consumeQueuedAbility(
      { ...swung, monster, combatLog },
      ctx.rng,
      ctx.emitAttack,
    )
    if (withAbility) {
      swung = withAbility
      monster = withAbility.monster
      combatLog = withAbility.combatLog
      if (monster.currentHp.lte(0)) ctx.killedMonster = monster
      continue
    }
    swung = { ...swung, queuedAbilityId: null }
    // Формула удара живёт в combat.ts — здесь только применение результата.
    const { amount, isCrit } = rollSwing(swung.stats, ctx.rng)
    const hpLeft = monster.currentHp.minus(amount)
    monster = { ...monster, currentHp: Decimal.max(hpLeft, new Decimal(0)) }
    combatLog = pushEvent(combatLog, { type: 'hit', damage: amount, isCrit })
    ctx.emitAttack({
      sourceId: 'hero',
      targetId: monster.id,
      amount,
      isCrit,
      abilityId: null, // авто-атака
      timestamp: swung.playtimeMs.toNumber(),
    })
    if (hpLeft.lte(0)) ctx.killedMonster = monster
  }
  return { ...swung, swingProgress, monster, combatLog }
}

// Эффекты умений (урон по времени) тикают игровым временем и могут добить
// моба — поэтому шаг стоит ДО начисления наград.
const applyEffects: TickStep = (s, ctx) => {
  if (s.activeEffects.length === 0) return s
  // Эффекты живут на конкретном мобе: он мёртв или его нет — эффекты снимаются.
  if (ctx.killedMonster || s.respawnMsLeft > 0) return { ...s, activeEffects: [] }
  let monster = s.monster
  let combatLog = s.combatLog
  const remaining: ActiveEffect[] = []
  for (const effect of s.activeEffects) {
    // Интервал между тиками постоянен и живёт в данных умения.
    const intervalMs = (ABILITY_BY_ID[effect.abilityId]?.effect?.tickIntervalSec ?? 1) * 1000
    let { ticksLeft, msToNextTick } = effect
    let msLeft = ctx.dtMs
    // Один жирный тик может прокрутить несколько тиков эффекта; остаток
    // переносится в msToNextTick, как и остаток замаха.
    while (msLeft >= msToNextTick && ticksLeft > 0 && ctx.killedMonster === null) {
      msLeft -= msToNextTick
      msToNextTick = intervalMs
      ticksLeft -= 1
      const hpLeft = monster.currentHp.minus(effect.damagePerTick)
      monster = { ...monster, currentHp: Decimal.max(hpLeft, new Decimal(0)) }
      combatLog = pushEvent(combatLog, {
        type: 'effect',
        abilityId: effect.abilityId,
        damage: effect.damagePerTick,
      })
      ctx.emitAttack({
        sourceId: 'hero',
        targetId: monster.id,
        amount: effect.damagePerTick,
        isCrit: false,
        abilityId: effect.abilityId,
        timestamp: s.playtimeMs.toNumber(),
      })
      if (hpLeft.lte(0)) ctx.killedMonster = monster
    }
    if (ticksLeft > 0) remaining.push({ ...effect, ticksLeft, msToNextTick: msToNextTick - msLeft })
  }
  return { ...s, monster, combatLog, activeEffects: remaining }
}

const applyKillRewards: TickStep = (s, ctx) => {
  const killed = ctx.killedMonster
  if (!killed) return s
  return {
    ...s,
    // Убил моба — значит в этой зоне выживает; сюда же вернёт смерть.
    lastSurvivedZoneId: s.currentZoneId,
    gold: s.gold.plus(killed.goldReward),
    combatLog: pushEvent(s.combatLog, {
      type: 'kill',
      monsterName: killed.name,
      gold: killed.goldReward,
      xp: killed.xpReward.times(clearedXpBonus(s.dungeonsCleared)),
    }),
  }
}

const applyLevelUps: TickStep = (s, ctx) => {
  const killed = ctx.killedMonster
  if (!killed) return s
  // Достижение за пройденный данж даёт постоянный бонус к опыту.
  const xp = killed.xpReward.times(clearedXpBonus(s.dungeonsCleared))
  const leveled = applyXp(s.level, s.currentXp, xp)
  let combatLog = s.combatLog
  if (leveled.level.gt(s.level)) {
    combatLog = pushEvent(combatLog, { type: 'levelup', level: leveled.level })
  }
  return {
    ...s,
    level: leveled.level,
    currentXp: leveled.currentXp,
    xpToNext: leveled.xpToNext,
    // Уровень — источник статов (живучесть), поэтому конвейер надо пересчитать.
    statsDirty: s.statsDirty || leveled.level.gt(s.level),
    combatLog,
  }
}

const applyLootDrop: TickStep = (s, ctx) => {
  if (!ctx.killedMonster) return s
  // Босс роняет свой пул целиком, а не по общему шансу дропа.
  const boss = currentBoss(s)
  if (boss) return dropBossLoot(s, boss, ctx)
  // Дроп только при свободном слоте; rng при полном инвентаре не трогаем.
  if (s.inventory.length >= INVENTORY_SIZE) return s
  const item = rollLoot(ctx.rng, s.itemSeq)
  if (!item) return s
  const withItem: GameState = {
    ...s,
    inventory: [...s.inventory, item],
    itemSeq: s.itemSeq + 1,
    combatLog: pushEvent(s.combatLog, { type: 'loot', item }),
  }
  // Автонадевание сравнивает предметы по оценочному урону в секунду.
  return autoEquipIfBetter(withItem, item)
}

// Лут босса: сколько влезет в инвентарь, остальное пропадает.
function dropBossLoot(s: GameState, boss: BossDef, ctx: TickContext): GameState {
  const free = INVENTORY_SIZE - s.inventory.length
  if (free <= 0) return s
  const items = rollBossLoot(boss.loot, ctx.rng, s.itemSeq).slice(0, free)
  let next: GameState = { ...s, itemSeq: s.itemSeq + items.length }
  for (const item of items) {
    next = {
      ...next,
      inventory: [...next.inventory, item],
      combatLog: pushEvent(next.combatLog, { type: 'loot', item }),
    }
    next = autoEquipIfBetter(next, item)
  }
  return next
}

/**
 * Удар ЛЕВОЙ руки. Отдельный шаг и отдельный таймер: две руки идут
 * независимо, и число ударов каждой определяется только её скоростью.
 *
 * Умение из очереди сюда не приходит — оно применяется к правой руке
 * (см. правило про onNextSwing в CLAUDE.md).
 */
const applyOffhandCombat: TickStep = (s, ctx) => {
  if (s.heroState !== 'alive' || s.respawnMsLeft > 0) return s
  if (!hasOffhand(s.stats)) return { ...s, offhandSwingProgress: 0 }
  let progress = s.offhandSwingProgress + ctx.dtMs / (s.stats.offhandSwingTime * 1000)
  let monster = s.monster
  let combatLog = s.combatLog
  while (progress >= 1 - SWING_EPS && ctx.killedMonster === null) {
    progress = Math.max(0, progress - 1)
    const { amount, isCrit } = rollSwing(s.stats, ctx.rng, new Decimal(1), 'off')
    const hpLeft = monster.currentHp.minus(amount)
    monster = { ...monster, currentHp: Decimal.max(hpLeft, new Decimal(0)) }
    combatLog = pushEvent(combatLog, { type: 'hit', damage: amount, isCrit })
    ctx.emitAttack({
      sourceId: 'hero',
      targetId: monster.id,
      amount,
      isCrit,
      abilityId: null,
      timestamp: s.playtimeMs.toNumber(),
    })
    if (hpLeft.lte(0)) ctx.killedMonster = monster
  }
  return { ...s, offhandSwingProgress: progress, monster, combatLog }
}

const applyMonsterAttack: TickStep = (s, ctx) => {
  // Моб бьёт, только пока оба живы; мирные мобы (damage 0) не бьют вовсе.
  // На привале по герою не бьют: он вышел из боя, а не отвернулся в нём.
  if (s.heroState !== 'alive' || s.respawnMsLeft > 0 || ctx.killedMonster) return s
  if (s.monster.damageMax.lte(0)) return s
  let monsterSwing = s.monster.swingProgress + ctx.dtMs / (s.monster.swingTime * 1000)
  let currentHp = s.currentHp
  let combatLog = s.combatLog
  let died = false
  while (monsterSwing >= 1 - SWING_EPS && !died) {
    monsterSwing = Math.max(0, monsterSwing - 1)
    // Формула входящего урона (бросок из диапазона + damageReduction) — в combat.ts.
    const boss = currentBoss(s)
    const raw = rollMonsterDamage(
      s.monster,
      s.stats,
      ctx.rng,
      boss && s.dungeonRun ? enrageMultiplier(boss, s.dungeonRun.fightMs) : 1,
    )
    // Блок — отдельное событие в шине: его подхватят и визуал, и звук.
    // Бросок делается ВСЕГДА, когда щит есть: иначе поток случайности
    // зависел бы от того, попал моб или нет.
    const { amount, blocked } = rollBlock(s.stats, raw, ctx.rng)
    currentHp = Decimal.max(currentHp.minus(amount), new Decimal(0))
    combatLog = blocked
      ? pushEvent(combatLog, {
          type: 'block',
          damage: amount,
          blocked: raw.minus(amount),
          monsterName: s.monster.name,
        })
      : pushEvent(combatLog, { type: 'hurt', damage: amount, monsterName: s.monster.name })
    ctx.emitAttack({
      sourceId: s.monster.id,
      targetId: 'hero',
      amount,
      isCrit: false,
      abilityId: null,
      timestamp: s.playtimeMs.toNumber(),
    })
    if (currentHp.lte(0)) died = true
  }
  const next = { ...s, currentHp, monster: { ...s.monster, swingProgress: monsterSwing }, combatLog }
  if (!died) return next
  // Смерть героя: 30 игровых секунд простоя, награды не капают.
  const dead: GameState = {
    ...next,
    heroState: 'dead',
    // Талант «Скорое возвращение» режет простой; множитель живёт в данных.
    reviveMsLeft: REVIVE_DELAY_MS * reviveMultiplier(next.talents),
    queuedAbilityId: null,
    activeEffects: [],
    combatLog: pushEvent(next.combatLog, { type: 'death' }),
  }
  // Смерть в данже выкидывает наружу: лут за убитых боссов уже в сумке,
  // а прогресс цепочки не сохраняется — заходить придётся заново.
  return dead.dungeonRun ? leaveDungeon(dead, ctx.rng, true) : dead
}

const applyRegen: TickStep = (s, ctx) => {
  // На привале обычная регенерация молчит: привал САМ и есть восстановление,
  // и оно приходит целиком в его конце. Иначе полоска ползла бы дважды —
  // и по ходу отдыха, и скачком после него.
  if (s.heroState !== 'alive') return s
  const dtSec = ctx.dtMs / 1000
  // Вне боя (пауза респауна) HP восстанавливается быстрой ставкой, в бою — медленной.
  const hpRate = s.respawnMsLeft > 0 ? s.stats.hpRegenOutOfCombat : s.stats.hpRegen
  const currentHp = Decimal.min(s.currentHp.plus(hpRate.times(dtSec)), s.stats.maxHp)

  // Мана — по правилу задержки. Сперва досиживаем паузу с последней траты,
  // и только потом капаем ПОРЦИЯМИ раз в REGEN_TICK_S. Порции, а не ровный
  // ручеёк, — это то, что делает окно между тратами ощутимым: успел
  // придержать умение на два лишних тика — получил порцию.
  // Ресурс вне боя ТАЕТ, если так сказано в данных класса. У маны ноль,
  // у ярости — то, что не даёт копить её между боями. Ветка по классу здесь
  // не нужна: множитель просто равен нулю.
  const decay = classById(s.classId).resource.decayPerSecond
  const drained =
    s.respawnMsLeft > 0
      ? Decimal.max(s.currentMana.minus(decay.times(dtSec)), new Decimal(0))
      : s.currentMana

  const regenDelayMsLeft = Math.max(0, s.regenDelayMsLeft - ctx.dtMs)
  if (regenDelayMsLeft > 0) {
    // Пока пауза идёт, таймер тика взведён заново: восстановление начнётся
    // с полного интервала, а не с остатка от прошлого раза.
    return {
      ...s,
      currentHp,
      currentMana: drained,
      regenDelayMsLeft,
      regenTickMsLeft: REGEN_TICK_S * 1000,
    }
  }
  let regenTickMsLeft = s.regenTickMsLeft - ctx.dtMs
  let currentMana = drained
  let guard = 0
  while (regenTickMsLeft <= 0 && guard < MAX_REGEN_TICKS_PER_STEP) {
    currentMana = currentMana.plus(s.stats.manaRegen.times(REGEN_TICK_S))
    regenTickMsLeft += REGEN_TICK_S * 1000
    guard += 1
  }
  return {
    ...s,
    currentHp,
    currentMana: Decimal.min(currentMana, s.stats.maxMana),
    regenDelayMsLeft,
    regenTickMsLeft,
  }
}

/**
 * Ресурс из боя. Мана берёт отсюда ноль — у неё оба множителя нулевые, — а
 * ярость только отсюда и живёт. Ветки по классу нет: числа приходят из данных.
 */
const applyResourceGain: TickStep = (s, ctx) => {
  const resource = classById(s.classId).resource
  // Доли от полного запаса: с уровнем растёт запас — растёт и доход, ровно
  // как реген у маны.
  const gained = resource.perSwingDealt
    .times(ctx.swingsDealt)
    .plus(resource.perHitTaken.times(ctx.hitsTaken))
    .times(s.stats.maxMana)
  if (gained.lte(0)) return s
  return { ...s, currentMana: Decimal.min(s.currentMana.plus(gained), s.stats.maxMana) }
}

const applyRespawn: TickStep = (s, ctx) => {
  // Смерть моба на этом тике — взводим таймер; отсчёт начнётся со следующего тика.
  if (ctx.killedMonster) return { ...s, respawnMsLeft: RESPAWN_DELAY_MS }
  // В данже пауза ведёт не к респауну, а к следующему боссу цепочки.
  if (s.dungeonRun && s.respawnMsLeft > 0) {
    const left = s.respawnMsLeft - ctx.dtMs
    if (left > 0) return { ...s, respawnMsLeft: left }
    return advanceDungeon(s, ctx.rng)
  }
  if (s.respawnMsLeft <= 0) return s
  const left = s.respawnMsLeft - ctx.dtMs
  if (left > 0) return { ...s, respawnMsLeft: left }
  const monster = spawnMonster(currentZone(s), ctx.rng)
  return {
    ...s,
    respawnMsLeft: 0,
    monster,
    activeEffects: [], // эффекты были на прежнем мобе
    combatLog: pushEvent(s.combatLog, { type: 'spawn', monsterName: monster.name }),
  }
}

const applyAutosaveCounter: TickStep = (s, ctx) => {
  return { ...s, msSinceAutosave: s.msSinceAutosave + ctx.dtMs }
}

const PIPELINE: TickStep[] = [
  applyRevive,
  applyRest,
  applyCooldowns,
  applyEnrage,
  applyAutocast,
  applyPendingKill,
  applyCombat,
  applyOffhandCombat,
  applyEffects,
  applyKillRewards,
  applyLevelUps,
  applyLootDrop,
  applyMonsterAttack,
  applyResourceGain,
  applyRegen,
  applyRespawn,
  applyAutosaveCounter,
]

export function tick(
  state: GameState,
  dtMs: number,
  rng: Rng,
  emitAttack: (event: AttackEvent) => void = busEmit,
): GameState {
  // Учёт урона — ЗДЕСЬ, на той же шине, что кормит цифры на экране: отдельного
  // счётчика в тик не добавлено. Ресурс класса копится ровно из этих чисел.
  const ctx: TickContext = {
    dtMs,
    rng,
    emitAttack: (event) => {
      if (event.targetId === 'hero') ctx.hitsTaken += 1
      else ctx.swingsDealt += 1
      emitAttack(event)
    },
    killedMonster: null,
    swingsDealt: 0,
    hitsTaken: 0,
  }
  // Кеш статов: пересчёт только если источники менялись с прошлого тика.
  let s: GameState = {
    ...ensureStats(state),
    totalTicks: state.totalTicks.plus(1),
    playtimeMs: state.playtimeMs.plus(dtMs),
  }
  for (const step of PIPELINE) s = step(s, ctx)
  return s
}

// Реэкспорт для обратной совместимости импортов (тесты, index).
export {
  COMBAT_LOG_SIZE,
  createInitialState,
  manualOnlySettings,
  defaultAbilitySettings,
  spawnMonster,
  monsterFromTemplate,
  emptyEquipment,
} from './state'
export type { GameState, Equipment } from './state'
export { RESPAWN_DELAY_MS } from '../data/balance'
