// Что двумерная сцена берёт из игрового состояния — и ничего кроме.
//
// ЖЕЛЕЗНОЕ ПРАВИЛО СЛОЯ СЦЕНЫ: он ТОЛЬКО ЧИТАЕТ состояние и никогда в него
// не пишет. Поэтому вся выборка собрана здесь, одной чистой функцией: если
// сцена однажды попробует что-то «подправить», это будет видно в диффе
// сразу, а не потеряется среди CSS.
//
// Файл нарочно не знает про Svelte и DOM: он проверяется в node.

import { backgroundForLevel, monsterSpriteFor, type BackgroundBand, type SpriteAsset } from '../data/sprites'
import { activeDungeon, currentBoss, enrageMultiplier, formatNumber } from '../game'
import type { GameState } from '../game/state'

/** Что сейчас на площадке — от этого зависит поза сцены целиком. */
export type ScenePhase = 'fight' | 'respawn' | 'rest' | 'dead'

export interface HeroView {
  /** Доля здоровья 0..1. */
  health: number
  alive: boolean
  resting: boolean
  /** Доля пройденного привала 0..1; вне привала 0. */
  restProgress: number
  /** Доля замаха 0..1: по ней герой отводит руку. */
  swing: number
  /**
   * Здоровье числом — «текущее / максимум», как у моба. Появилось вместе с
   * правилом одного вида полос: раньше у моба над головой была крупная
   * полоска с числами, а у героя — тонкая чёрточка без них, и чужое
   * состояние читалось лучше своего.
   */
  hpLabel: string
}

export interface MonsterView {
  id: string
  name: string
  level: number
  health: number
  /**
   * Здоровье числом — «текущее / максимум» — для подписи внутри полоски над
   * головой. Полоска у моба ОДНА, в сцене; второй, в раме, больше нет,
   * поэтому число обязано читаться здесь. Тот же formatNumber, что и у
   * остальных чисел интерфейса.
   */
  hpLabel: string
  swing: number
  isBoss: boolean
  /** Ярость босса вошла в силу: моб подсвечивается. */
  enraged: boolean
  sprite: SpriteAsset
}

export interface SceneModel {
  phase: ScenePhase
  hero: HeroView
  /** Моб; null — он мёртв и ждёт респауна, на площадке его нет. */
  monster: MonsterView | null
  /** Фон по уровню моба — полосы уровней, а не зоны: две зоны на картинку. */
  background: BackgroundBand
}

/** Доля 0..1; нули и мусор в знаменателе не должны рождать NaN. */
export function fraction(current: number, max: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return 0
  return Math.max(0, Math.min(1, current / max))
}

function phaseOf(state: GameState, monsterAlive: boolean): ScenePhase {
  if (state.heroState === 'dead') return 'dead'
  if (state.heroState === 'resting') return 'rest'
  return monsterAlive ? 'fight' : 'respawn'
}

/**
 * Снимок состояния для сцены. Decimal в CSS не уедет: наружу отдаются
 * доли и обычные number, потому что позиции и размеры спрайтов не растут.
 */
export function sceneModel(state: GameState): SceneModel {
  const monsterAlive = state.respawnMsLeft <= 0 && state.monster.currentHp.gt(0)
  const phase = phaseOf(state, monsterAlive)
  // Босс — не отдельная сущность, а роль моба внутри забега по данжу;
  // свой силуэт ему положен ровно на время забега.
  const isBoss = state.dungeonRun !== null
  const boss = currentBoss(state)
  const enraged =
    isBoss && boss !== null && activeDungeon(state) !== null && state.dungeonRun !== null
      ? enrageMultiplier(boss, state.dungeonRun.fightMs) > 1
      : false
  return {
    phase,
    hero: {
      health: fraction(state.currentHp.toNumber(), state.stats.maxHp.toNumber()),
      alive: state.heroState !== 'dead',
      resting: state.heroState === 'resting',
      restProgress:
        state.heroState === 'resting'
          ? 1 - fraction(state.restMsLeft, state.restTotalMs)
          : 0,
      swing: phase === 'fight' ? fraction(state.swingProgress, 1) : 0,
      hpLabel: `${formatNumber(state.currentHp)} / ${formatNumber(state.stats.maxHp)}`,
    },
    monster: monsterAlive
      ? {
          id: state.monster.id,
          name: state.monster.name,
          level: state.monster.level,
          health: fraction(state.monster.currentHp.toNumber(), state.monster.maxHp.toNumber()),
          hpLabel: `${formatNumber(state.monster.currentHp)} / ${formatNumber(state.monster.maxHp)}`,
          swing: fraction(state.monster.swingProgress, 1),
          isBoss,
          enraged,
          sprite: monsterSpriteFor(state.monster.id, isBoss),
        }
      : null,
    background: backgroundForLevel(state.monster.level),
  }
}
