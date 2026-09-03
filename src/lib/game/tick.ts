// Тик — конвейер чистых шагов (state, ctx) => state. Порядок фиксирован и важен:
//   1. applyRevive          — мёртвый герой: отсчёт воскрешения; по нулю — полный HP
//                             и откат в последнюю зону, где он выживал
//   1a. applyRest           — привал: отсчёт отдыха (уход — в applyRestCheck)
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
import { rollLoot, stashLoot } from './loot'
import {
  advanceProcCooldowns,
  hasOffhand,
  rollBlock,
  rollMonsterDamage,
  rollProcs,
  rollSwing,
} from './combat'
import type { Rng } from './rng'
import { pushEvent, spawnMonster, type ActiveEffect, type GameState } from './state'
import { ensureStats } from './stats'
import { emit as busEmit } from './events'
import {
  INVENTORY_SIZE,
  REGEN_TICK_S,
  RESPAWN_DELAY_MS,
  REVIVE_DELAY_MS,
  xpGapShare,
} from '../data/balance'
import { ABILITY_BY_ID } from '../data/abilities'
import { currentZone, reviveInZone } from './zones'
import {
  advanceCooldowns,
  autocastStep,
  consumeQueuedAbility,
  queuedAbilityDropReason,
} from './abilities'
import { finishRest, needsRest, startRest } from './rest'
import { addMaterial, rollMaterial } from './crafting'
import { classById } from '../data/classes'
import { advancePotions, gatherHerbs } from './potions'
import {
  blockReflectShare,
  blockResourceShare,
  doubleStrikeChance,
  killCooldownMultiplier,
  reviveMultiplier,
} from './talents'

/**
 * Смерть героя одним местом. Раньше она была вписана внутрь applyMonsterAttack;
 * теперь герой может упасть и не от удара моба (героическая отдача списывает
 * HP в момент траты ресурса), и оформлять смерть двумя способами нельзя.
 */
function heroDies(state: GameState, rng: Rng): GameState {
  // Талант «Скорое возвращение» режет простой; множитель живёт в данных.
  const reviveMs = REVIVE_DELAY_MS * reviveMultiplier(state.talents)
  const dead: GameState = {
    ...state,
    heroState: 'dead',
    reviveMsLeft: reviveMs,
    queuedAbilityId: null,
    activeEffects: [],
    combatLog: pushEvent(state.combatLog, { type: 'death', reviveMs }),
  }
  // СМЕРТЬ В ХРАМЕ ЗАСЧИТЫВАЕТСЯ. Это завершение забега С РЕЗУЛЬТАТОМ, а не
  // потеря: этаж, на котором героя добили, пройденным не считается (его
  // отмечает смерть БОЙЦА, а не героя), а все этажи под ним оплачиваются и
  // поднимают рекорд. Отличается это от брошенного забега ровно последним
  // аргументом — и разница между ними принципиальна: если бы смерть шла по
  // ветке прерывания, погибнуть стало бы не дороже, чем закрыть вкладку.
  if (dead.templeRun) return leaveTemple(dead, rng, true, true)
  // Смерть в данже выкидывает наружу: лут за убитых боссов уже в сумке,
  // а прогресс цепочки не сохраняется — заходить придётся заново.
  return dead.dungeonRun ? leaveDungeon(dead, rng, true) : dead
}

/**
 * Двойной удар: талант-флаг даёт замаху шанс повториться.
 *
 * Бросок делается ТОЛЬКО когда шанс положительный. Это не оптимизация:
 * лишний вызов rng сдвинул бы весь поток случайности, и golden-прогон
 * героя БЕЗ таланта перестал бы сходиться с эталоном.
 */
function extraSwings(chance: number, rng: Rng): number {
  return chance > 0 && rng() < chance ? 1 : 0
}
import { rollBossReagent } from './crafting'
import { bossDispel, bossSwingTime } from './bossAbilities'
import { advanceTemple, clearTempleWave, leaveTemple } from './temple'
import { freshEvents } from './events'
import { advanceQuests } from './quests'
import { TEMPLE_WAVE_DELAY_MS } from '../data/temple'
import {
  activeDungeon,
  advanceDungeon,
  clearedXpBonus,
  currentBoss,
  enrageMultiplier,
  hasNextBoss,
  leaveDungeon,
  type BossDef,
} from './dungeons'
import { rollBossLoot } from './loot'
import type { AttackEvent, CombatEvent, Monster } from '../types'

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
  /** Голова лога на входе в тик: по ней считается, что нового объявлено. */
  logHead: CombatEvent | null
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
 * Привал: ТОЛЬКО ОТСЧЁТ. Пока герой отдыхает, он не бьёт, не получает по себе
 * и не жмёт умений — тик для него сводится к тиканью таймера.
 *
 * Решение «пора отдыхать» здесь больше НЕ принимается: оно переехало в
 * applyRestCheck, за убийство моба (см. там же почему).
 *
 * Возврат из привала — это НОВАЯ СХВАТКА, а не продолжение старой: герой
 * получает свежего моба с полным здоровьем. Иначе отдых был бы способом
 * долечиться посреди боя, только оформленным иначе.
 */
const applyRest: TickStep = (s, ctx) => {
  if (s.heroState !== 'resting') return s
  const restMsLeft = s.restMsLeft - ctx.dtMs
  if (restMsLeft > 0) return { ...s, restMsLeft }
  const done = finishRest(s)
  const log = pushEvent(done.combatLog, { type: 'rest-end', interrupted: false })
  // В данже цепочка боссов своя: там моба назначает забег, а не зона.
  if (done.dungeonRun) return { ...done, combatLog: log }
  const monster = spawnMonster(currentZone(done), ctx.rng, done.level.toNumber())
  return {
    ...done,
    monster,
    swingProgress: 0,
    offhandSwingProgress: 0,
    respawnMsLeft: 0,
    combatLog: pushEvent(log, { type: 'spawn', monsterName: monster.name }),
  }
}

/**
 * Пора ли на привал. Проверяется ТОЛЬКО ПОСЛЕ УБИЙСТВА и никогда в середине
 * схватки — в этом вся суть шага.
 *
 * Раньше герой выходил из боя, едва просев ниже порога, и бой поэтому был
 * безопасен: до смерти дело не доходило вовсе, а порог был не решением, а
 * страховкой. Теперь он доводит бой до конца, а решение отдохнуть принимает
 * между схватками. Отсюда риск, ради которого всё и делалось: войти в бой
 * на низком здоровье — значит, возможно, из него не выйти.
 *
 * Вход в привал снимает и текущего моба, и таймер респауна: возвращаться
 * герою будет не к кому — его встретит новый (см. applyRest).
 */
const applyRestCheck: TickStep = (s) => {
  if (s.heroState !== 'alive') return s
  // В храме привала нет: поток волн не прерывается на отдых, иначе «пока
  // герой не погибнет» превратилось бы в «пока не надоест».
  if (s.templeRun) return s
  // В ДАНЖЕ ПРИВАЛ ЕСТЬ — между боссами, но не после последнего. Каждая
  // схватка цепочки начинается с полного запаса, и это то, ради чего боссу
  // отдана почти вся полоска здоровья героя: одна схватка стоит около 80%
  // запаса, три подряд без передышки не пережил бы никто.
  //
  // После ПОСЛЕДНЕГО босса отдыхать не от чего: цепочка кончилась, и герой
  // выходит наружу. Привал там только оттянул бы выход на десять секунд.
  if (s.dungeonRun && !hasNextBoss(s)) return s
  // Только между боями: пока моб жив, порог ничего не запускает.
  if (s.monster.currentHp.gt(0)) return s
  if (!needsRest(s)) return s
  const resting = startRest(s)
  return {
    ...resting,
    respawnMsLeft: 0,
    combatLog: pushEvent(resting.combatLog, { type: 'rest-start' }),
  }
}

// Кулдауны умений и GCD идут ИГРОВЫМ временем: множитель скорости из
// отладочной панели ускоряет их ровно так же, как бой.
const applyCooldowns: TickStep = (s, ctx) => advanceCooldowns(s, ctx.dtMs)

// Время боя с текущим боссом копится игровым временем — от него ярость.
// Скачок ярости пишем в лог один раз, в момент перехода на новую ступень.
const applyEnrage: TickStep = (s, ctx) => {
  const boss = currentBoss(s)
  // НА ПРИВАЛЕ СЧЁТЧИК СТОИТ. Ярость — проверка на урон в секунду, а на
  // привале герой не бьёт: продолжай счётчик тикать, и с отдыха герой
  // возвращался бы к боссу, разъярённому на всю длину отсидки.
  if (!s.dungeonRun || !boss || s.heroState !== 'alive') return s
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
    // Очередь стояла и сорвалась — говорим об этом в лог: молча снятое
    // умение игрок читает как «кнопка не сработала».
    const dropped = queuedAbilityDropReason(swung)
    if (swung.queuedAbilityId && dropped) {
      combatLog = pushEvent(combatLog, {
        type: 'ability-dropped',
        abilityId: swung.queuedAbilityId,
        reason: dropped,
      })
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
    for (
      let i = extraSwings(doubleStrikeChance(swung.talents), ctx.rng);
      i > 0 && ctx.killedMonster === null;
      i -= 1
    ) {
      const extra = rollSwing(swung.stats, ctx.rng)
      const afterExtra = monster.currentHp.minus(extra.amount)
      monster = { ...monster, currentHp: Decimal.max(afterExtra, new Decimal(0)) }
      combatLog = pushEvent(combatLog, {
        type: 'hit',
        damage: extra.amount,
        isCrit: extra.isCrit,
      })
      ctx.emitAttack({
        sourceId: 'hero',
        targetId: monster.id,
        amount: extra.amount,
        isCrit: extra.isCrit,
        abilityId: null,
        timestamp: swung.playtimeMs.toNumber(),
      })
      if (afterExtra.lte(0)) ctx.killedMonster = monster
    }
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
        overTime: true,
        timestamp: s.playtimeMs.toNumber(),
      })
      if (hpLeft.lte(0)) ctx.killedMonster = monster
    }
    if (ticksLeft > 0) remaining.push({ ...effect, ticksLeft, msToNextTick: msToNextTick - msLeft })
  }
  return { ...s, monster, combatLog, activeEffects: remaining }
}

/**
 * Опыт за убийство: награда моба × постоянный бонус за пройденные данжи ×
 * доля за разрыв уровней. ОДНА функция на все начисления — и в лог, и в
 * прокачку идёт одно и то же число, а не два похожих.
 *
 * Разрыв берётся по уровню УБИТОГО, поэтому босс данжа и волна храма считаются
 * тем же правилом, что и обычный моб: своей ветки у них нет.
 */
function killXp(s: GameState, killed: Monster): Decimal {
  return killed.xpReward
    .times(clearedXpBonus(s.dungeonsCleared))
    .times(xpGapShare(s.level.toNumber(), killed.level))
}

/**
 * Награды за убийство. Здесь же читается флаг «убийство возвращает откаты»:
 * доля из данных таланта множит и кулдауны, и GCD. Единица — таланта нет,
 * и тогда не пересобирается ничего.
 */
const applyKillRewards: TickStep = (s, ctx) => {
  const killed = ctx.killedMonster
  if (!killed) return s
  const share = killCooldownMultiplier(s.talents)
  const refunded =
    share >= 1
      ? { abilityCooldownsMs: s.abilityCooldownsMs, gcdMsLeft: s.gcdMsLeft }
      : {
          abilityCooldownsMs: Object.fromEntries(
            Object.entries(s.abilityCooldownsMs).map(([id, left]) => [id, left * share]),
          ),
          gcdMsLeft: s.gcdMsLeft * share,
        }
  return {
    ...s,
    ...refunded,
    // Убил моба — значит в этой зоне выживает; сюда же вернёт смерть.
    lastSurvivedZoneId: s.currentZoneId,
    gold: s.gold.plus(killed.goldReward),
    combatLog: pushEvent(s.combatLog, {
      type: 'kill',
      // id моба — это id АРХЕТИПА (см. buildMonster): по нему цель задания
      // и узнаёт, того ли зверя бьют.
      monsterId: killed.id,
      monsterName: killed.name,
      zoneId: s.currentZoneId,
      gold: killed.goldReward,
      xp: killXp(s, killed),
    }),
  }
}

const applyLevelUps: TickStep = (s, ctx) => {
  const killed = ctx.killedMonster
  if (!killed) return s
  const xp = killXp(s, killed)
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

const applyMaterialDrop: TickStep = (s, ctx) => {
  if (!ctx.killedMonster) return s
  // Материалы падают СВОИМ броском и в свой мешок: места в сумке не занимают
  // и шансы редкости предметов не сдвигают. Бросок идёт ДО дропа предмета —
  // порядок фиксирован, иначе прогоны с сидом перестанут воспроизводиться.
  let next = s
  const material = rollMaterial(s.currentZoneId, ctx.rng)
  if (material) {
    next = {
      ...addMaterial(next, material.id),
      combatLog: pushEvent(next.combatLog, { type: 'material', materialId: material.id }),
    }
  }
  // Реагент — только с боссов данжа. Индекс босса ещё указывает на убитого:
  // цепочку двигает applyRespawn, и он идёт позже.
  const dungeon = activeDungeon(s)
  if (!dungeon || !s.dungeonRun) return next
  const reagent = rollBossReagent(dungeon, s.dungeonRun.bossIndex, ctx.rng)
  if (!reagent) return next
  return {
    ...addMaterial(next, reagent.id),
    combatLog: pushEvent(next.combatLog, { type: 'material', materialId: reagent.id }),
  }
}

/**
 * Проки надетых вещей.
 *
 * Стоит ПОСЛЕ ударов обеих рук и ДО эффектов и наград: бросок идёт по ударам,
 * нанесённым в этом тике, а урон прока — такой же урон, и добить моба он
 * может. Тики урона по времени в счёт не идут: прок висит на оружии, а не на
 * кровотечении (см. фильтр в emitAttack).
 *
 * Внутренние кулдауны тикают ВСЕГДА, даже когда герой мёртв или на привале:
 * это таймер вещи, а не действие героя.
 */
const applyProcs: TickStep = (s, ctx) => {
  const cooled = advanceProcCooldowns(s.procCooldownsMs, ctx.dtMs)
  const base = cooled === s.procCooldownsMs ? s : { ...s, procCooldownsMs: cooled }
  if (base.heroState !== 'alive' || base.respawnMsLeft > 0) return base
  const hits = ctx.swingsDealt
  if (hits <= 0) return base
  const { fired, cooldowns } = rollProcs(base, hits, ctx.rng)
  if (fired.length === 0) return base
  let monster = base.monster
  let currentHp = base.currentHp
  let combatLog = base.combatLog
  for (const fire of fired) {
    if (fire.damage) {
      const hpLeft = monster.currentHp.minus(fire.damage)
      monster = { ...monster, currentHp: Decimal.max(hpLeft, new Decimal(0)) }
      combatLog = pushEvent(combatLog, {
        type: 'proc',
        procId: fire.proc.id,
        effect: 'damage',
        amount: fire.damage,
      })
      ctx.emitAttack({
        sourceId: 'hero',
        targetId: monster.id,
        amount: fire.damage,
        isCrit: fire.isCrit,
        abilityId: null,
        procId: fire.proc.id,
        timestamp: base.playtimeMs.toNumber(),
      })
      // Моб мог уже пасть от замаха — тогда это перебой, как и у обычного
      // добивающего удара, и второй раз убийство не оформляется.
      if (hpLeft.lte(0) && ctx.killedMonster === null) ctx.killedMonster = monster
      continue
    }
    if (fire.heal) {
      const healed = Decimal.min(currentHp.plus(fire.heal), base.stats.maxHp)
      const gained = healed.minus(currentHp)
      currentHp = healed
      combatLog = pushEvent(combatLog, {
        type: 'proc',
        procId: fire.proc.id,
        effect: 'heal',
        amount: gained,
      })
    }
  }
  return { ...base, procCooldownsMs: cooldowns, monster, currentHp, combatLog }
}

const applyLootDrop: TickStep = (s, ctx) => {
  if (!ctx.killedMonster) return s
  // ВНУТРИ ХРАМА ЛУТ НЕ ПАДАЕТ. Награда за храм — этажи, а не мобы: заходить
  // туда можно бесконечно (кулдауна нет), и падающий с бойцов лут сделал бы
  // храм лучшей фермой в игре. Замер до правки — в data/temple.ts.
  if (s.templeRun) return s
  // Босс роняет свой пул целиком, а не по общему шансу дропа.
  const boss = currentBoss(s)
  if (boss) return dropBossLoot(s, boss, ctx)
  // Бросок идёт ВСЕГДА, независимо от заполненности сумки: раньше полная
  // сумка глушила дроп целиком, и герой переставал находить вещи, пока
  // игрок не продаст. Куда девать находку — решает stashLoot.
  const item = rollLoot(ctx.rng, s.itemSeq, s.monster.level)
  if (!item) return s
  return stashLoot({ ...s, itemSeq: s.itemSeq + 1 }, item)
}

// Лут босса: те же правила разбора, что и у обычной находки.
function dropBossLoot(s: GameState, boss: BossDef, ctx: TickContext): GameState {
  const items = rollBossLoot(boss.loot, ctx.rng, s.itemSeq, boss.level)
  let next: GameState = { ...s, itemSeq: s.itemSeq + items.length }
  for (const item of items) next = stashLoot(next, item)
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
    for (
      let i = extraSwings(doubleStrikeChance(s.talents), ctx.rng);
      i > 0 && ctx.killedMonster === null;
      i -= 1
    ) {
      const extra = rollSwing(s.stats, ctx.rng, new Decimal(1), 'off')
      const afterExtra = monster.currentHp.minus(extra.amount)
      monster = { ...monster, currentHp: Decimal.max(afterExtra, new Decimal(0)) }
      combatLog = pushEvent(combatLog, {
        type: 'hit',
        damage: extra.amount,
        isCrit: extra.isCrit,
      })
      ctx.emitAttack({
        sourceId: 'hero',
        targetId: monster.id,
        amount: extra.amount,
        isCrit: extra.isCrit,
        abilityId: null,
        timestamp: s.playtimeMs.toNumber(),
      })
      if (afterExtra.lte(0)) ctx.killedMonster = monster
    }
  }
  return { ...s, offhandSwingProgress: progress, monster, combatLog }
}

const applyMonsterAttack: TickStep = (s, ctx) => {
  // Моб бьёт, только пока оба живы; мирные мобы (damage 0) не бьют вовсе.
  // На привале по герою не бьют: он вышел из боя, а не отвернулся в нём.
  if (s.heroState !== 'alive' || s.respawnMsLeft > 0 || ctx.killedMonster) return s
  if (s.monster.damageMax.lte(0)) return s
  const reflectShare = blockReflectShare(s.talents)
  const resourceShare = blockResourceShare(s.talents)
  // Время замаха берём через bossSwingTime: героический босс ускоряется на
  // низком здоровье, обычный отдаёт своё число как было.
  let monsterSwing = s.monster.swingProgress + ctx.dtMs / (bossSwingTime(s) * 1000)
  let monster = s.monster
  let currentHp = s.currentHp
  let currentMana = s.currentMana
  let combatLog = s.combatLog
  let died = false
  while (monsterSwing >= 1 - SWING_EPS && !died) {
    monsterSwing = Math.max(0, monsterSwing - 1)
    // Формула входящего урона (бросок из диапазона + damageReduction) — в combat.ts.
    const boss = currentBoss(s)
    const raw = rollMonsterDamage(
      s.monster,
      s.stats,
      s.level.toNumber(),
      ctx.rng,
      boss && s.dungeonRun ? enrageMultiplier(boss, s.dungeonRun.fightMs) : 1,
    )
    // Блок — отдельное событие в шине: его подхватят и визуал, и звук.
    // Бросок делается ВСЕГДА, когда щит есть: иначе поток случайности
    // зависел бы от того, попал моб или нет.
    const { amount, blocked } = rollBlock(s.stats, raw, ctx.rng)
    currentHp = Decimal.max(currentHp.minus(amount), new Decimal(0))
    // Два флага живучести, оба срабатывают ТОЛЬКО на удачном блоке; числа
    // приходят из payload талантов, а не из логики.
    let reflected: Decimal | undefined
    if (blocked) {
      const absorbed = raw.minus(amount)
      if (reflectShare > 0 && absorbed.gt(0)) {
        reflected = absorbed.times(reflectShare)
        const hpAfter = monster.currentHp.minus(reflected)
        monster = { ...monster, currentHp: Decimal.max(hpAfter, new Decimal(0)) }
        ctx.emitAttack({
          sourceId: 'hero',
          targetId: monster.id,
          amount: reflected,
          isCrit: false,
          abilityId: null,
          timestamp: s.playtimeMs.toNumber(),
        })
      }
      if (resourceShare > 0) {
        currentMana = Decimal.min(
          currentMana.plus(s.stats.maxMana.times(resourceShare)),
          s.stats.maxMana,
        )
      }
    }
    combatLog = blocked
      ? pushEvent(combatLog, {
          type: 'block',
          damage: amount,
          blocked: raw.minus(amount),
          ...(reflected ? { reflected } : {}),
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
  // Отражение может добить моба. Награды за это убийство придут СЛЕДУЮЩИМ
  // тиком, через applyPendingKill: шаг мобов стоит в конвейере после наград,
  // и переставлять его ради отражения нельзя — порядок ударов важнее.
  const next = {
    ...s,
    currentHp,
    currentMana,
    monster: { ...monster, swingProgress: monsterSwing },
    combatLog,
  }
  if (!died) return next
  // Смерть героя: 30 игровых секунд простоя, награды не капают.
  // Талант «Скорое возвращение» режет простой; множитель живёт в данных.
  const reviveMs = REVIVE_DELAY_MS * reviveMultiplier(next.talents)
  const dead: GameState = {
    ...next,
    heroState: 'dead',
    reviveMsLeft: reviveMs,
    queuedAbilityId: null,
    activeEffects: [],
    combatLog: pushEvent(next.combatLog, { type: 'death', reviveMs }),
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
  const decay = classById(s.classId).resource.decayShare.times(s.stats.maxMana)
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
  // На привале респауна нет: герой ушёл отдыхать, и встретит его новый моб
  // в момент возвращения (applyRest), а не тот, что стоял бы тут без него.
  if (s.heroState === 'resting') return s
  // Смерть моба на этом тике — взводим таймер; отсчёт начнётся со следующего
  // тика. В храме пауза своя: волна должна читаться как волна, а не как
  // мигание.
  if (ctx.killedMonster) {
    return { ...s, respawnMsLeft: s.templeRun ? TEMPLE_WAVE_DELAY_MS : RESPAWN_DELAY_MS }
  }
  // В храме пауза ведёт к следующей волне, а не к респауну моба зоны.
  if (s.templeRun && s.respawnMsLeft > 0) {
    const left = s.respawnMsLeft - ctx.dtMs
    if (left > 0) return { ...s, respawnMsLeft: left }
    return advanceTemple(s)
  }
  // В данже пауза ведёт не к респауну, а к следующему боссу цепочки.
  if (s.dungeonRun && s.respawnMsLeft > 0) {
    const left = s.respawnMsLeft - ctx.dtMs
    if (left > 0) return { ...s, respawnMsLeft: left }
    return advanceDungeon(s, ctx.rng)
  }
  // ПОСЛЕ ПРИВАЛА цепочку двигаем здесь. Привал начинается на том же тике,
  // на котором босс умер, и до этого шага тик уже не доходит (герой стал
  // 'resting', см. первую строку) — значит пауза респауна не взводится вовсе.
  // Без этой ветки цепочка вставала бы намертво: босс лежит, таймер ноль,
  // следующий не выходит никогда.
  if (s.dungeonRun && s.monster.currentHp.lte(0)) return advanceDungeon(s, ctx.rng)
  if (s.respawnMsLeft <= 0) return s
  const left = s.respawnMsLeft - ctx.dtMs
  if (left > 0) return { ...s, respawnMsLeft: left }
  const monster = spawnMonster(currentZone(s), ctx.rng, s.level.toNumber())
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

/**
 * Зелья: отсчёт длительностей. Идёт ИГРОВЫМ временем, тем же dtMs, что и
 * кулдауны. Шаг стоит ПЕРВЫМ среди боевых и до applyCooldowns: зелье,
 * истёкшее на этом тике, не должно бить этим тиком.
 */
const applyPotions: TickStep = (s, ctx) => advancePotions(s, ctx.dtMs)

/**
 * Рассеивание героического босса. Стоит ДО applyEnrage: отметки считаются от
 * ещё не сдвинутого fightMs, ровно по тому же отрезку времени, по которому
 * дальше посчитается ступень ярости.
 */
const applyBossDispel: TickStep = (s, ctx) => bossDispel(s, ctx.dtMs)

/**
 * Прогресс заданий. Своих счётчиков шаг НЕ ЗАВОДИТ: он берёт события, которые
 * этот тик уже объявил (убийство, пройденный данж), и отдаёт их чистой
 * advanceQuests. Стоит ПОСЛЕ applyRespawn намеренно — именно там цепочка
 * боссов объявляет о полном прохождении.
 */
const applyQuests: TickStep = (s, ctx) => advanceQuests(s, freshEvents(s.combatLog, ctx.logHead))

/**
 * Волна храма засчитана. Отдельным шагом и ДО решения об отдыхе: между
 * смертью бойца и следующей волной герой может выйти сам, а пройденная
 * волна обязана остаться в рекорде.
 */
const applyTempleWave: TickStep = (s, ctx) => {
  if (!s.templeRun || !ctx.killedMonster) return s
  return clearTempleWave(s)
}

/**
 * Герой мог упасть не от удара моба: героическая отдача списывает HP в момент
 * траты ресурса, в том числе при ручном нажатии между тиками. Без этого шага
 * герой остался бы стоять на нуле «живым», пока моб не соберётся ударить.
 */
const applyLethalCheck: TickStep = (s, ctx) =>
  s.heroState === 'alive' && s.currentHp.lte(0) ? heroDies(s, ctx.rng) : s

/**
 * Травы: собираются ВРЕМЕНЕМ, а не убийством. Шаг не смотрит на
 * ctx.killedMonster и не берёт ни одного броска из rng — поэтому его место
 * в конвейере на воспроизводимость прогонов с сидом не влияет вовсе.
 */
const applyHerbGather: TickStep = (s, ctx) => gatherHerbs(s, ctx.dtMs)

const PIPELINE: TickStep[] = [
  applyRevive,
  applyRest,
  applyPotions,
  applyCooldowns,
  applyBossDispel,
  applyEnrage,
  applyAutocast,
  applyPendingKill,
  applyCombat,
  applyOffhandCombat,
  applyProcs,
  applyEffects,
  applyKillRewards,
  applyLevelUps,
  applyMaterialDrop,
  applyLootDrop,
  // Решение об отдыхе — здесь, за наградами и добычей: моб уже мёртв,
  // и это единственный момент, когда герой волен уйти.
  applyRestCheck,
  applyLethalCheck,
  applyMonsterAttack,
  applyResourceGain,
  applyRegen,
  applyRespawn,
  // ЭТОГО ШАГА ЗДЕСЬ НЕ БЫЛО, и храм молча не платил ничего. Функция была
  // написана, снабжена комментарием «стоит ПОСЛЕ applyRespawn намеренно» — и
  // в конвейер не попала: `run.cleared` оставался нулём при любой глубине
  // забега, а `finishTempleRun` платит ровно за этажи выше рекорда, то есть
  // за отрезок от 1 до 0. Игрок доходил до четырнадцатого этажа и получал
  // пусто. Поймано замером: волны шли до седьмой, `cleared` стоял на нуле.
  applyTempleWave,
  applyHerbGather,
  applyQuests,
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
      // Тики урона по времени ударами не считаются: иначе одно умение с
      // эффектом кормило бы ресурс втрое лучше остальных.
      // Тики урона по времени и удары ПРОКОВ ударами не считаются: ресурс
      // копится от замахов героя, а не от того, что сработало само. Иначе
      // одна реликвия кормила бы ярость лучше любого умения.
      else if (!event.overTime && !event.procId) ctx.swingsDealt += 1
      emitAttack(event)
    },
    killedMonster: null,
    swingsDealt: 0,
    logHead: state.combatLog[0] ?? null,
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
