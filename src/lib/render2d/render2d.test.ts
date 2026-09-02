import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Decimal } from '../game/numbers'
import { createInitialState } from '../game/state'
import { FLOATER_LIMIT, FLOATER_LIFE_MS } from '../data/render'
import {
  BACKGROUND_BANDS,
  BOSS_SPRITE_ID,
  FALLBACK_SPRITE_ID,
  MONSTER_SPRITE_BY_ARCHETYPE,
  backgroundForLevel,
  monsterSpriteFor,
} from '../data/sprites'
import { createFloaterQueue, floaterKind, floaterProgress } from './floaters'
import { fraction, sceneModel } from './model'

const RENDER2D_DIR = new URL('./', import.meta.url)

describe('слой 2D только читает', () => {
  // Железное правило слоя представления: сцена ЧИТАЕТ игровое состояние
  // и никогда в него не пишет. Одна «маленькая правка»
  // из компонента — и ход игры зависит от того, открыта ли вкладка.
  const files = readdirSync(RENDER2D_DIR).filter(
    (f) => f.endsWith('.ts') || f.endsWith('.svelte'),
  )
  const sources = files
    .filter((f) => !f.endsWith('.test.ts'))
    .map((f) => [f, readFileSync(new URL(f, RENDER2D_DIR), 'utf8')] as const)

  it('в папке есть что проверять', () => {
    expect(sources.map(([name]) => name)).toContain('Scene2D.svelte')
  })

  // Из stores/game слою рендера позволены ТОЛЬКО read-only сторы.
  const READ_ONLY = ['gameState', 'simSpeed', 'loopMetrics', 'offlineReport']

  it.each(sources)('%s: не вызывает экшенов стора игры', (_name, source) => {
    const gameImports = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'[^']*stores\/game'/g)]
    const imported = gameImports
      .flatMap((m) => m[1].split(','))
      .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean)
    expect(imported.filter((name) => !READ_ONLY.includes(name))).toEqual([])
  })

  it.each(sources)('%s: не трогает сейв и localStorage', (_name, source) => {
    expect(source).not.toContain('localStorage')
    expect(source).not.toMatch(/\bpersistNow\b|\bimportSaveString\b|\bexportSaveString\b/)
  })

  it.each(sources)('%s: не лезет в стор интерфейса', (_name, source) => {
    // Двумерной сцене нечего сообщать наружу: картинка не завелась —
    // на месте спрайта цветной прямоугольник, а не падение. Значит и
    // прав на стор интерфейса у неё нет — ни читать, ни писать.
    expect(source).not.toMatch(/from\s*'[^']*stores\/ui'/)
  })

  it('движение сцены не сидит на таймерах компонента', () => {
    // Эффекты живут метками времени и гаснут на тике: у игры ОДИН цикл,
    // и setTimeout в сцене расходился бы с ним при ускорении и паузе.
    const scene = readFileSync(new URL('Scene2D.svelte', RENDER2D_DIR), 'utf8')
    expect(scene).not.toMatch(/\bsetTimeout\b|\bsetInterval\b|\brequestAnimationFrame\b/)
  })
})

describe('модель сцены', () => {
  it('в бою герой и моб на площадке, фон по уровню моба', () => {
    const state = createInitialState()
    const model = sceneModel(state)
    expect(model.phase).toBe('fight')
    expect(model.hero.alive).toBe(true)
    expect(model.hero.health).toBe(1)
    expect(model.monster).not.toBeNull()
    expect(model.monster!.isBoss).toBe(false)
    expect(model.monster!.sprite.path).toMatch(/^sprites\//)
    expect(model.background).toBe(backgroundForLevel(state.monster.level))
  })

  it('мёртвый моб со сцены исчезает, фаза — респаун', () => {
    const state = createInitialState()
    state.monster.currentHp = new Decimal(0)
    state.respawnMsLeft = 300
    const model = sceneModel(state)
    expect(model.monster).toBeNull()
    expect(model.phase).toBe('respawn')
  })

  it('привал — своя фаза с долей пройденного', () => {
    const state = createInitialState()
    state.heroState = 'resting'
    state.restTotalMs = 4000
    state.restMsLeft = 1000
    const model = sceneModel(state)
    expect(model.phase).toBe('rest')
    expect(model.hero.resting).toBe(true)
    expect(model.hero.restProgress).toBeCloseTo(0.75)
    // На привале замаха нет: иначе герой сидел бы с отведённой рукой.
    expect(model.hero.swing).toBe(0)
  })

  it('смерть героя — своя фаза', () => {
    const state = createInitialState()
    state.heroState = 'dead'
    const model = sceneModel(state)
    expect(model.phase).toBe('dead')
    expect(model.hero.alive).toBe(false)
  })

  it('внутри данжа моб — босс своим силуэтом, до отметки ярости не разъярён', () => {
    const state = createInitialState()
    state.dungeonRun = { dungeonId: 'sunken-barrow', difficulty: 'normal', bossIndex: 0, fightMs: 0 }
    const model = sceneModel(state)
    expect(model.monster!.isBoss).toBe(true)
    expect(model.monster!.sprite.id).toBe(BOSS_SPRITE_ID)
    expect(model.monster!.enraged).toBe(false)
    state.dungeonRun = { ...state.dungeonRun, fightMs: 1_000_000 }
    expect(sceneModel(state).monster!.enraged).toBe(true)
  })

  it('доли зажаты в 0..1 и не дают NaN', () => {
    expect(fraction(5, 10)).toBe(0.5)
    expect(fraction(-1, 10)).toBe(0)
    expect(fraction(20, 10)).toBe(1)
    expect(fraction(1, 0)).toBe(0)
    expect(fraction(Number.NaN, 10)).toBe(0)
    expect(fraction(1, Number.POSITIVE_INFINITY)).toBe(0)

    const state = createInitialState()
    state.currentHp = new Decimal(-50)
    expect(sceneModel(state).hero.health).toBe(0)
    state.stats.maxHp = new Decimal(0)
    expect(sceneModel(state).hero.health).toBe(0)
  })

  it('чтение состояния его не меняет', () => {
    const state = createInitialState()
    const dump = () =>
      JSON.stringify(state, (_k, v) => (v instanceof Decimal ? v.toString() : v))
    const before = dump()
    sceneModel(state)
    expect(dump()).toBe(before)
  })
})

describe('всплывающие числа', () => {
  const sample = (bornAt: number) => ({
    anchor: 'monster' as const,
    kind: 'damage' as const,
    text: '10',
    bornAt,
    drift: 0,
  })

  it('бюджет держится отбрасыванием новых, а не вытеснением старых', () => {
    const queue = createFloaterQueue(3, 1000)
    expect(queue.push(sample(0))).toBe(true)
    expect(queue.push(sample(1))).toBe(true)
    expect(queue.push(sample(2))).toBe(true)
    expect(queue.push(sample(3))).toBe(false)
    expect(queue.size()).toBe(3)
    expect(queue.alive(10).map((f) => f.bornAt)).toEqual([0, 1, 2])
  })

  it('отжившие уходят и освобождают место', () => {
    const queue = createFloaterQueue(2, 100)
    queue.push(sample(0))
    queue.push(sample(50))
    expect(queue.alive(120).map((f) => f.bornAt)).toEqual([50])
    expect(queue.push(sample(130))).toBe(true)
    queue.clear()
    expect(queue.size()).toBe(0)
  })

  it('по умолчанию берёт бюджет и срок жизни из данных', () => {
    const queue = createFloaterQueue()
    for (let i = 0; i < FLOATER_LIMIT; i += 1) expect(queue.push(sample(0))).toBe(true)
    expect(queue.push(sample(0))).toBe(false)
    expect(queue.alive(FLOATER_LIFE_MS)).toEqual([])
  })

  it('доля прожитого 0..1, нулевой срок — сразу прожито', () => {
    const f = { ...sample(100), id: 1 }
    expect(floaterProgress(f, 100, 1000)).toBe(0)
    expect(floaterProgress(f, 600, 1000)).toBeCloseTo(0.5)
    expect(floaterProgress(f, 5000, 1000)).toBe(1)
    expect(floaterProgress(f, 50, 1000)).toBe(0)
    expect(floaterProgress(f, 100, 0)).toBe(1)
  })

  it('вид числа: по герою красное, крит крупный, умение своим цветом', () => {
    expect(floaterKind(true, true, 'x')).toBe('player-damage')
    expect(floaterKind(false, true, null)).toBe('crit')
    expect(floaterKind(false, true, 'strike')).toBe('crit')
    expect(floaterKind(false, false, 'strike')).toBe('ability')
    expect(floaterKind(false, false, null)).toBe('damage')
  })
})

describe('реестр спрайтов', () => {
  it('босс идёт своим силуэтом независимо от архетипа', () => {
    expect(monsterSpriteFor('meadow-squelcher', true).id).toBe(BOSS_SPRITE_ID)
    expect(monsterSpriteFor('nobody', true).id).toBe(BOSS_SPRITE_ID)
  })

  it('архетип — точным совпадением, боец храма — по префиксу, чужак — запасным', () => {
    const [archetype, spriteId] = Object.entries(MONSTER_SPRITE_BY_ARCHETYPE)[0]
    expect(monsterSpriteFor(archetype, false).id).toBe(spriteId)
    expect(monsterSpriteFor(`${archetype}-w3`, false).id).toBe(spriteId)
    expect(monsterSpriteFor('nobody-at-all', false).id).toBe(FALLBACK_SPRITE_ID)
  })

  it('фон есть для любого уровня, включая мусор и края', () => {
    const first = BACKGROUND_BANDS[0]
    const last = BACKGROUND_BANDS[BACKGROUND_BANDS.length - 1]
    expect(backgroundForLevel(first.minLevel)).toBe(first)
    expect(backgroundForLevel(last.maxLevel)).toBe(last)
    expect(backgroundForLevel(0)).toBe(first)
    expect(backgroundForLevel(-5)).toBe(first)
    expect(backgroundForLevel(last.maxLevel + 500)).toBe(last)
    expect(backgroundForLevel(Number.NaN)).toBe(first)
    for (let level = first.minLevel; level <= last.maxLevel; level += 1) {
      const band = backgroundForLevel(level)
      expect(level).toBeGreaterThanOrEqual(band.minLevel)
      expect(level).toBeLessThanOrEqual(band.maxLevel)
    }
  })
})
