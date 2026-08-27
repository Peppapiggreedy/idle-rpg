// Что сцена берёт из игрового состояния — и ничего кроме.
//
// ЖЕЛЕЗНОЕ ПРАВИЛО СЛОЯ 3D: он ТОЛЬКО ЧИТАЕТ состояние и никогда в него
// не пишет. Поэтому вся выборка собрана здесь, одной чистой функцией: если
// сцена однажды попробует что-то «подправить», это будет видно в диффе
// сразу, а не потеряется среди работы с three.
//
// Файл нарочно не знает ни про three, ни про Svelte: он проверяется в node.

import type { GameState } from '../game/state'

/** Один боец сцены: рост, доля здоровья и жив ли он. */
export interface ActorModel {
  /** Рост в метрах — размер меша. */
  height: number
  /** Ширина плеч в метрах. */
  width: number
  /** Толщина в метрах. */
  depth: number
  /** Доля здоровья 0..1 — по ней меш бледнеет к смерти. */
  health: number
  alive: boolean
}

export interface SceneModel {
  hero: ActorModel
  /** Моб; null — он мёртв и ждёт респауна, на площадке его нет. */
  monster: ActorModel | null
}

/** Рост героя, м. Он один на игру, поэтому просто константа. */
export const HERO_HEIGHT = 1.8
export const HERO_WIDTH = 0.62
export const HERO_DEPTH = 0.36

// Мобы растут с уровнем, но в пределах разумного: без потолка моб
// сорокового уровня закрыл бы собой камеру.
const MONSTER_MIN_HEIGHT = 1.1
const MONSTER_MAX_HEIGHT = 2.6
const MONSTER_HEIGHT_PER_LEVEL = 0.02

/** Рост моба от его уровня: заметно, но без великанов во весь экран. */
export function monsterHeight(level: number): number {
  const raw = MONSTER_MIN_HEIGHT + Math.max(0, level) * MONSTER_HEIGHT_PER_LEVEL
  return Math.min(MONSTER_MAX_HEIGHT, raw)
}

/** Доля 0..1; нули и мусор в знаменателе не должны рождать NaN. */
function fraction(current: number, max: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return 0
  return Math.max(0, Math.min(1, current / max))
}

/**
 * Снимок состояния для сцены. Decimal в three не уедет: наружу отдаются
 * обычные number, потому что позиции и размеры мешей неограниченно не растут.
 */
export function sceneModel(state: GameState): SceneModel {
  const monsterAlive = state.respawnMsLeft <= 0 && state.monster.currentHp.gt(0)
  const level = state.monster.level
  const height = monsterHeight(level)
  return {
    hero: {
      height: HERO_HEIGHT,
      width: HERO_WIDTH,
      depth: HERO_DEPTH,
      health: fraction(state.currentHp.toNumber(), state.stats.maxHp.toNumber()),
      alive: state.heroState === 'alive',
    },
    monster: monsterAlive
      ? {
          height,
          // Мобы шире и приземистее героя: силуэт должен читаться с одного
          // взгляда, даже когда рост совпал.
          width: height * 0.45,
          depth: height * 0.3,
          health: fraction(
            state.monster.currentHp.toNumber(),
            state.monster.maxHp.toNumber(),
          ),
          alive: true,
        }
      : null,
  }
}
