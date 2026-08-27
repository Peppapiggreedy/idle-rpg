import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Decimal } from '../game/numbers'
import { createInitialState } from '../game/state'
import { FLOATER_LIMIT } from '../data/render'
import { disposeSceneGraph, type DisposableNode, type TraversableNode } from './dispose'
import { createFloaterQueue, floaterProgress, projectToScreen } from './floaters'
import { createFrameGate, SCENE_FPS } from './frameGate'
import { HERO_HEIGHT, monsterHeight, sceneModel } from './model'
import { parseHexColor, readScenePalette, SCENE_TOKENS } from './palette'

const RENDER3D_DIR = new URL('./', import.meta.url)

describe('слой 3D только читает', () => {
  // Правило, которое нельзя нарушать: сцена ЧИТАЕТ игровое состояние и
  // никогда в него не пишет. Держим его тестом, а не обещанием: одна
  // «маленькая правка» из компонента рендера, и состояние станет
  // невоспроизводимым — оно будет зависеть от того, была ли открыта вкладка.
  const files = readdirSync(RENDER3D_DIR).filter(
    (f) => f.endsWith('.ts') || f.endsWith('.svelte'),
  )
  const sources = files
    .filter((f) => !f.endsWith('.test.ts'))
    .map((f) => [f, readFileSync(new URL(f, RENDER3D_DIR), 'utf8')] as const)

  it('в папке есть что проверять', () => {
    expect(sources.length).toBeGreaterThan(0)
  })

  // Из stores/game слою рендера позволены ТОЛЬКО read-only сторы. Всё
  // остальное, что там экспортируется, — экшены, меняющие игру.
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

  it('единственная запись наружу — сообщение о несработавшей сцене', () => {
    const scene = readFileSync(new URL('Scene3D.svelte', RENDER3D_DIR), 'utf8')
    const uiImports = [...scene.matchAll(/import\s*\{([^}]*)\}\s*from\s*'[^']*stores\/ui'/g)]
      .flatMap((m) => m[1].split(','))
      .map((s) => s.trim())
      .filter(Boolean)
    expect(uiImports).toEqual(['reportSceneFailure'])
  })
})

describe('модель сцены', () => {
  it('герой и моб стоят на площадке в полный рост', () => {
    const model = sceneModel(createInitialState())
    expect(model.hero.height).toBe(HERO_HEIGHT)
    expect(model.hero.alive).toBe(true)
    expect(model.hero.health).toBe(1)
    expect(model.monster).not.toBeNull()
    expect(model.monster!.height).toBeGreaterThan(0)
  })

  it('мёртвый моб со сцены исчезает', () => {
    const state = createInitialState()
    state.monster.currentHp = new Decimal(0)
    state.respawnMsLeft = 1500
    expect(sceneModel(state).monster).toBeNull()
  })

  it('доля здоровья зажата в 0..1 и не даёт NaN', () => {
    const state = createInitialState()
    state.currentHp = new Decimal(-50)
    expect(sceneModel(state).hero.health).toBe(0)

    state.currentHp = state.stats.maxHp.times(3)
    expect(sceneModel(state).hero.health).toBe(1)

    state.stats.maxHp = new Decimal(0)
    expect(sceneModel(state).hero.health).toBe(0)
  })

  it('рост моба растёт с уровнем, но упирается в потолок', () => {
    expect(monsterHeight(1)).toBeLessThan(monsterHeight(20))
    expect(monsterHeight(1000)).toBe(monsterHeight(10_000))
    // Даже гигант не выше трёх метров: иначе он закроет собой камеру.
    expect(monsterHeight(10_000)).toBeLessThan(3)
  })

  it('чтение состояния его не меняет', () => {
    // Прямая проверка железного правила на самой выборке.
    const state = createInitialState()
    const before = JSON.stringify(state, (_k, v) =>
      v instanceof Decimal ? v.toString() : v,
    )
    sceneModel(state)
    const after = JSON.stringify(state, (_k, v) => (v instanceof Decimal ? v.toString() : v))
    expect(after).toBe(before)
  })
})

describe('потолок кадров сцены', () => {
  it('первый кадр рисуется сразу, дальше не чаще потолка', () => {
    const gate = createFrameGate(SCENE_FPS)
    expect(gate.shouldRender(0)).toBe(true)
    // Кадры браузера идут по 16 мс, наш потолок — 33.3 мс.
    expect(gate.shouldRender(16)).toBe(false)
    expect(gate.shouldRender(32)).toBe(false)
    expect(gate.shouldRender(48)).toBe(true)
  })

  it('за секунду выходит не больше SCENE_FPS кадров', () => {
    const gate = createFrameGate(SCENE_FPS)
    let drawn = 0
    // 60 кадров в секунду от браузера.
    for (let t = 0; t <= 1000; t += 1000 / 60) if (gate.shouldRender(t)) drawn += 1
    expect(drawn).toBeLessThanOrEqual(SCENE_FPS + 1)
    expect(drawn).toBeGreaterThan(SCENE_FPS / 2)
  })

  it('долг после долгой паузы не отыгрывается пачкой', () => {
    const gate = createFrameGate(SCENE_FPS)
    gate.shouldRender(0)
    // Вкладку прятали десять секунд.
    expect(gate.shouldRender(10_000)).toBe(true)
    // Следующий кадр — по обычному расписанию, а не мгновенно.
    expect(gate.shouldRender(10_010)).toBe(false)
  })
})

describe('палитра сцены', () => {
  it('разбирает короткий и длинный хекс, отвергает остальное', () => {
    expect(parseHexColor('#fff')).toBe(0xffffff)
    expect(parseHexColor(' #2fcfe0 ')).toBe(0x2fcfe0)
    expect(parseHexColor('rgb(1,2,3)')).toBeNull()
    expect(parseHexColor('')).toBeNull()
    expect(parseHexColor('#12345')).toBeNull()
  })

  it('без страницы отдаёт запасные цвета, а не падает', () => {
    const palette = readScenePalette(null)
    for (const id of Object.keys(SCENE_TOKENS)) {
      expect(palette[id as keyof typeof SCENE_TOKENS]).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('выгрузка сцены', () => {
  // Фальшивые узлы вместо three: проверяем сам обход, а не библиотеку.
  function counter() {
    const calls: string[] = []
    const make = (name: string) => ({ dispose: () => calls.push(name) })
    return { calls, make }
  }

  it('освобождает геометрию и материал каждого узла', () => {
    const { calls, make } = counter()
    const nodes: (DisposableNode & { name?: string })[] = [
      { geometry: make('ground.geo'), material: make('ground.mat') },
      { geometry: make('hero.geo'), material: make('hero.mat') },
      // Свет: ни геометрии, ни материала — обход не должен на нём падать.
      {},
    ]
    const root: TraversableNode = {
      traverse: (visit) => nodes.forEach((n) => visit(n as never)),
    }
    expect(disposeSceneGraph(root)).toBe(4)
    expect(calls.sort()).toEqual(['ground.geo', 'ground.mat', 'hero.geo', 'hero.mat'])
  })

  it('материал-массив освобождается целиком, а не только первый', () => {
    const { calls, make } = counter()
    const root: TraversableNode = {
      traverse: (visit) =>
        visit({ material: [make('a'), make('b'), make('c')] } as never),
    }
    expect(disposeSceneGraph(root)).toBe(3)
    expect(calls).toEqual(['a', 'b', 'c'])
  })

  it('пустая сцена не считается выгруженной', () => {
    expect(disposeSceneGraph({ traverse: () => {} })).toBe(0)
  })
})

describe('всплывающие числа', () => {
  it('бюджет не превышается, лишние отбрасываются', () => {
    const q = createFloaterQueue(3, 1000)
    const add = () =>
      q.push({ anchor: 'monster', kind: 'damage', text: '1', bornAt: 0, drift: 0 })
    expect([add(), add(), add(), add(), add()]).toEqual([true, true, true, false, false])
    expect(q.size()).toBe(3)
  })

  it('отбрасываются НОВЫЕ, а не вытесняются старые', () => {
    // Иначе при сотне событий за кадр набор на экране полностью меняется
    // каждый кадр и не прочитать ни одного числа.
    const q = createFloaterQueue(2, 1000)
    q.push({ anchor: 'monster', kind: 'damage', text: 'первое', bornAt: 0, drift: 0 })
    q.push({ anchor: 'monster', kind: 'damage', text: 'второе', bornAt: 0, drift: 0 })
    q.push({ anchor: 'monster', kind: 'damage', text: 'третье', bornAt: 0, drift: 0 })
    expect(q.alive(0).map((f) => f.text)).toEqual(['первое', 'второе'])
  })

  it('отжившие уходят, и место освобождается', () => {
    const q = createFloaterQueue(2, 100)
    q.push({ anchor: 'hero', kind: 'damage', text: 'a', bornAt: 0, drift: 0 })
    q.push({ anchor: 'hero', kind: 'damage', text: 'b', bornAt: 0, drift: 0 })
    expect(q.push({ anchor: 'hero', kind: 'damage', text: 'c', bornAt: 0, drift: 0 })).toBe(false)
    expect(q.alive(150)).toEqual([])
    expect(q.push({ anchor: 'hero', kind: 'damage', text: 'c', bornAt: 150, drift: 0 })).toBe(true)
  })

  it('после тысячи событий на экране остаётся не больше бюджета', () => {
    const q = createFloaterQueue(FLOATER_LIMIT, 1000)
    for (let i = 0; i < 1000; i += 1) {
      q.push({ anchor: 'monster', kind: 'damage', text: String(i), bornAt: 0, drift: 0 })
    }
    expect(q.alive(0).length).toBe(FLOATER_LIMIT)
    // И через секунду DOM возвращается к пустому.
    expect(q.alive(1001).length).toBe(0)
  })

  it('доля прожитого идёт от нуля к единице и не выходит за края', () => {
    const f = { id: 1, anchor: 'hero' as const, kind: 'damage' as const, text: '1', bornAt: 100, drift: 0 }
    expect(floaterProgress(f, 100, 200)).toBe(0)
    expect(floaterProgress(f, 200, 200)).toBe(0.5)
    expect(floaterProgress(f, 5000, 200)).toBe(1)
    expect(floaterProgress(f, 0, 200)).toBe(0)
  })
})

describe('проекция мира на экран', () => {
  it('центр кадра попадает в середину холста', () => {
    expect(projectToScreen({ x: 0, y: 0, z: 0 }, 800, 600)).toEqual({
      x: 400,
      y: 300,
      visible: true,
    })
  })

  it('ось Y перевёрнута: верх мира — верх экрана', () => {
    expect(projectToScreen({ x: 0, y: 1, z: 0 }, 800, 600).y).toBe(0)
    expect(projectToScreen({ x: 0, y: -1, z: 0 }, 800, 600).y).toBe(600)
  })

  it('точка ЗА камерой не рисуется', () => {
    // project() отдаёт для неё зеркальные координаты в кадре: без отсечения
    // полоска здоровья мирно поехала бы по экрану, будучи за спиной.
    expect(projectToScreen({ x: 0, y: 0, z: 1.4 }, 800, 600).visible).toBe(false)
    expect(projectToScreen({ x: 0, y: 0, z: -3 }, 800, 600).visible).toBe(false)
  })

  it('улетевшее далеко за край кадра не рисуется', () => {
    expect(projectToScreen({ x: 4, y: 0, z: 0 }, 800, 600).visible).toBe(false)
    expect(projectToScreen({ x: Number.NaN, y: 0, z: 0 }, 800, 600).visible).toBe(false)
  })
})
