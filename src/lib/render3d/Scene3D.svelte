<script lang="ts">
  // Боевая сцена на примитивах: площадка, герой и моб прямоугольными мешами.
  // Моделей нет и пока не будет — это заготовка правильной формы, поверх
  // которой позже встанут настоящие.
  //
  // ЖЕЛЕЗНОЕ ПРАВИЛО: слой 3D ТОЛЬКО ЧИТАЕТ игровое состояние и НИКОГДА
  // в него не пишет. Отсюда не вызывается ни один экшен стора игры, а всё,
  // что сцена берёт из состояния, собрано в model.ts одной чистой функцией.
  // Единственная запись наружу — reportSceneFailure() в стор ИНТЕРФЕЙСА,
  // когда WebGL не завёлся: без неё игра осталась бы у чёрного холста.
  //
  // three грузится динамически: библиотека тяжёлая, а в текстовом режиме
  // и на машине без WebGL она не нужна вовсе — пусть не едет в основной бандл.
  import type * as ThreeNs from 'three'
  import { onDestroy, onMount } from 'svelte'
  import { subscribe as subscribeAttacks } from '../game/events'
  import { gameState } from '../stores/game'
  import { reportSceneFailure } from '../stores/ui'
  import { isDebugMode, showsSceneHelpers } from '../ui/route'
  import { disposeSceneGraph } from './dispose'
  import { createFrameGate, SCENE_FPS } from './frameGate'
  import { sceneModel, type SceneModel } from './model'
  import { readScenePalette } from './palette'

  // --- Раскладка сцены. Числа здесь — про картинку, не про баланс. ---

  /** Радиус площадки, м. */
  const GROUND_RADIUS = 12
  /** Где стоят бойцы: герой ближе к камере, моб напротив. */
  const HERO_Z = 1.6
  const MONSTER_Z = -1.6
  /** Камера как в MMO: сверху и чуть из-за плеча героя.
   *  Задана НАПРАВЛЕНИЕМ и расстоянием, а не точкой: расстояние зависит
   *  от пропорций холста (см. resize). */
  const CAMERA_TARGET = { x: 0, y: 1.15, z: -0.2 }
  const CAMERA_DIRECTION = { x: 0.212, y: 0.252, z: 0.944 } // единичный вектор
  const CAMERA_DISTANCE = 6.15
  const CAMERA_FOV = 50
  /** Пропорции, под которые подобрана рамка кадра: десктопные 16:9. */
  const REFERENCE_ASPECT = 16 / 9
  /** Отдача от удара: на сколько метров дёргается меш и как быстро гаснет. */
  const HIT_KICK = 0.22
  const HIT_DECAY_MS = 220

  let host: HTMLDivElement
  let canvas: HTMLCanvasElement

  const debug = isDebugMode()
  const helpers = showsSceneHelpers()

  // Показания для отладочного оверлея. Обновляются раз в секунду: строка,
  // которая скачет каждый кадр, нечитаема.
  let stats = $state({ fps: 0, calls: 0, geometries: 0, textures: 0, camera: '' })

  // Модель сцены — снимок состояния. Стор читаем подпиской, а не $gameState:
  // цикл рендера живёт вне реактивности Svelte и ему нужно просто значение.
  let model: SceneModel | null = null
  const unsubscribeState = gameState.subscribe((s) => {
    model = sceneModel(s)
  })

  // Отдача от ударов. Шина событий пишет сюда, кадр — читает и гасит.
  let heroKick = 0
  let monsterKick = 0
  const unsubscribeAttacks = subscribeAttacks((event) => {
    if (event.targetId === 'hero') heroKick = 1
    else monsterKick = 1
  })

  let dispose: (() => void) | null = null

  onMount(() => {
    // Асинхронный старт: onMount не должен возвращать промис (Svelte принял
    // бы его за функцию очистки), поэтому запускаем и не ждём.
    void start()
  })

  async function start(): Promise<void> {
    let THREE: typeof ThreeNs
    try {
      THREE = await import('three')
    } catch {
      // Чанк не доехал — обычно из-за сети. Это не повод показать пустоту.
      reportSceneFailure()
      return
    }
    // Компонент могли размонтировать, пока грузился чанк.
    if (!canvas) return

    try {
      dispose = build(THREE)
    } catch {
      // Контекст WebGL могли не дать: старый драйвер, политика браузера,
      // исчерпанные контексты. Игра обязана продолжаться текстом.
      reportSceneFailure()
    }
  }

  function build(THREE: typeof ThreeNs): () => void {
    const palette = readScenePalette()

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    // Потолок 2: на экране с плотностью 3 это вчетверо меньше пикселей
    // на кадр, а на глаз разницы для примитивов нет.
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2))

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(palette.fog)
    // Экспоненциальный туман прячет край площадки: без него круг обрывается
    // в пустоту и сразу видно, что мир кончился.
    scene.fog = new THREE.FogExp2(palette.fog, 0.07)

    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100)

    // Заливка слабая, направленный свет сильный: на матовых примитивах
    // только разница между ними и рисует объём. При ярком ambient коробки
    // становятся плоскими цветными прямоугольниками.
    scene.add(new THREE.AmbientLight(palette.light, 0.55))
    const sun = new THREE.DirectionalLight(palette.light, 2.2)
    sun.position.set(4, 9, 5)
    scene.add(sun)

    // Площадка: круг матовым материалом, повёрнутый в горизонт.
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(GROUND_RADIUS, 64),
      new THREE.MeshLambertMaterial({ color: palette.ground }),
    )
    // Чуть ниже нуля: иначе основания коробок и площадка лежат в одной
    // плоскости и мерцают друг сквозь друга (z-fighting).
    ground.position.y = -0.01
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)

    // Единичные коробки: настоящий размер задаётся масштабом из модели,
    // поэтому геометрия одна на всё время жизни сцены и не пересоздаётся,
    // когда моб сменился на более крупного.
    const heroMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: palette.hero }),
    )
    const monsterMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: palette.monster }),
    )
    scene.add(heroMesh, monsterMesh)

    if (helpers) {
      scene.add(new THREE.AxesHelper(3))
      scene.add(new THREE.GridHelper(GROUND_RADIUS * 2, 24))
    }

    // --- Размер холста ---

    function resize(): void {
      const width = Math.max(1, Math.round(host.clientWidth))
      const height = Math.max(1, Math.round(host.clientHeight))
      renderer.setSize(width, height, false)
      const aspect = width / height
      camera.aspect = aspect
      // Угол обзора у PerspectiveCamera ВЕРТИКАЛЬНЫЙ, поэтому на узком
      // холсте по горизонтали помещается меньше — на мобильном 4:3 герой
      // упирался в объектив и вылезал за кадр. Отодвигаем камеру ровно
      // во столько раз, во сколько кадр уже эталонного.
      const fit = Math.min(1, aspect / REFERENCE_ASPECT)
      const distance = CAMERA_DISTANCE / Math.max(fit, 0.4)
      camera.position.set(
        CAMERA_TARGET.x + CAMERA_DIRECTION.x * distance,
        CAMERA_TARGET.y + CAMERA_DIRECTION.y * distance,
        CAMERA_TARGET.z + CAMERA_DIRECTION.z * distance,
      )
      camera.lookAt(CAMERA_TARGET.x, CAMERA_TARGET.y, CAMERA_TARGET.z)
      camera.updateProjectionMatrix()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    // --- Цикл рендера ---

    const gate = createFrameGate(SCENE_FPS)
    let frameId = 0
    let running = true
    let framesThisSecond = 0
    let secondStart = performance.now()
    let previous = performance.now()

    function applyActor(
      mesh: ThreeNs.Mesh,
      baseColor: number,
      actor: { height: number; width: number; depth: number; health: number } | null,
      z: number,
      kick: number,
    ): void {
      mesh.visible = actor !== null
      if (!actor) return
      mesh.scale.set(actor.width, actor.height, actor.depth)
      // Меш стоит НА площадке: центр коробки на половине роста.
      mesh.position.set(0, actor.height / 2, z)
      // Раненый заметно темнеет — здоровье читается прямо с силуэта.
      // Считаем ОТ базового цвета, а не от текущего: иначе каждый кадр
      // умножал бы уже потускневший цвет и боец за секунду ушёл бы в чёрный.
      const material = mesh.material as ThreeNs.MeshLambertMaterial
      material.color.setHex(baseColor)
      material.color.multiplyScalar(0.4 + 0.6 * actor.health)
      // Отдача от удара: меш отъезжает от противника и возвращается.
      mesh.position.z += kick * HIT_KICK * Math.sign(z || 1)
    }

    function frame(now: number): void {
      if (!running) return
      frameId = requestAnimationFrame(frame)
      // Вкладка спрятана — не рисуем вовсе. Игровое время при этом идёт
      // своим чередом: за него отвечает game/loop.ts, а не сцена.
      if (document.hidden) return
      if (!gate.shouldRender(now)) return

      const dt = Math.max(0, now - previous)
      previous = now
      // Отдача гаснет реальным временем: это украшение, а не игровая величина.
      const decay = Math.exp(-dt / HIT_DECAY_MS)
      heroKick *= decay
      monsterKick *= decay

      const current = model
      if (current) {
        applyActor(heroMesh, palette.hero, current.hero, HERO_Z, heroKick)
        applyActor(monsterMesh, palette.monster, current.monster, MONSTER_Z, monsterKick)
      }

      renderer.render(scene, camera)

      framesThisSecond += 1
      if (debug && now - secondStart >= 1000) {
        stats = {
          fps: framesThisSecond,
          calls: renderer.info.render.calls,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          camera: `${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}`,
        }
        framesThisSecond = 0
        secondStart = now
      }
      // Помечаем первый нарисованный кадр: по нему съёмка понимает, что
      // сцена уже на холсте, а не ждёт наугад.
      if (!host.dataset.scene) host.dataset.scene = 'ready'
    }

    // Пока вкладка спрятана, requestAnimationFrame и так не вызывается,
    // но точку отсчёта надо сбросить: иначе первый кадр после возврата
    // придёт с гигантским dt и отдача мигнёт.
    function onVisibility(): void {
      previous = performance.now()
      secondStart = previous
      framesThisSecond = 0
    }
    document.addEventListener('visibilitychange', onVisibility)

    frameId = requestAnimationFrame(frame)

    return () => {
      running = false
      cancelAnimationFrame(frameId)
      document.removeEventListener('visibilitychange', onVisibility)
      observer.disconnect()
      // Обход всей сцены: геометрию и материалы браузер сам не соберёт,
      // они живут в памяти видеокарты. Сам обход — в dispose.ts, там его
      // проверяет тест: снаружи «освободилось ли» не видно.
      disposeSceneGraph(scene)
      scene.clear()
      renderer.dispose()
    }
  }

  onDestroy(() => {
    unsubscribeState()
    unsubscribeAttacks()
    dispose?.()
    dispose = null
  })
</script>

<div class="host" bind:this={host}>
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
  {#if debug}
    <div class="probe">
      <div>fps: {stats.fps} / {SCENE_FPS}</div>
      <div>draw calls: {stats.calls}</div>
      <div>geometries: {stats.geometries}</div>
      <div>textures: {stats.textures}</div>
      <div>camera: {stats.camera}</div>
    </div>
  {/if}
</div>

<style>
  .host {
    position: absolute;
    inset: 0;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  /* Отладочные числа — тот самый случай, под который заведён --font-mono:
     технические латинские подписи, которые игрок не читает как текст. */
  .probe {
    position: absolute;
    top: var(--space-2);
    left: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--c-bg) var(--tint-strong), transparent);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
    color: var(--c-text-muted);
    pointer-events: none;
  }
</style>
