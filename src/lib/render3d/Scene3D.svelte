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
  import { get } from 'svelte/store'
  import { formatNumber } from '../game'
  import { subscribe as subscribeAttacks } from '../game/events'
  import {
    FLOATER_MAX_SPEED,
    MAX_PIXEL_RATIO,
    MAX_PIXEL_RATIO_MOBILE,
    MOBILE_BREAKPOINT,
  } from '../data/render'
  import { gameState, simSpeed } from '../stores/game'
  import { reportSceneFailure, uiSettings } from '../stores/ui'
  import { isDebugMode, showsSceneHelpers } from '../ui/route'
  import { disposeSceneGraph } from './dispose'
  import {
    createFloaterQueue,
    floaterProgress,
    projectToScreen,
    type Floater,
    type FloaterKind,
    type ScreenPoint,
  } from './floaters'
  import { createFrameGate, SCENE_FPS } from './frameGate'
  import { sceneModel, type SceneModel } from './model'
  import { readScenePalette } from './palette'
  import { CLEAR_RADIUS, enrageTintAmount, placeProps } from './scenery'
  import {
    createKillRateMeter,
    deathMode,
    deathProgress,
    DEATH_ANIM_MS,
    type DeathMode,
  } from './deaths'
  import { offlineReport } from '../stores/game'
  import { DUNGEON_SCENE, ENRAGE_TINT, ENRAGE_TINT_MAX, type SceneConfig } from '../data/scenery'
  import { ZONE_BY_ID } from '../data/zones'
  import { activeDungeon, currentBoss, enrageMultiplier } from '../game'

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
  // Какой вид сейчас нужен. В данже он свой и всегда перекрывает зону:
  // под землёй, а не в лощинах, даже если вход был оттуда.
  let wantedSceneId = 'shepherds-meadow'
  let wantedConfig: SceneConfig | null = null
  let enrage = 1

  // Смерть моба ловим по НАБЛЮДАЕМОМУ переходу «был жив → исчез», как это
  // делает и прогон баланса: ради сцены в тик не добавлено ни одного поля.
  const killRate = createKillRateMeter()
  let monsterWasAlive = false
  let dying: { startedAt: number; mode: DeathMode } | null = null
  // Пока показывается отчёт возврата, сцена не разыгрывает бой: за восемь
  // часов мобов накопилось столько, что любая анимация была бы ложью.
  let offlineOpen = false
  const unsubscribeOffline = offlineReport.subscribe((r) => {
    offlineOpen = r !== null
    if (offlineOpen) {
      killRate.reset()
      dying = null
    }
  })

  const unsubscribeState = gameState.subscribe((s) => {
    model = sceneModel(s)
    const aliveNow = s.respawnMsLeft <= 0 && s.monster.currentHp.gt(0)
    if (monsterWasAlive && !aliveNow) {
      const now = performance.now()
      killRate.record(now)
      const mode = deathMode(killRate.perSecond(now), {
        offline: offlineOpen,
        // Скорость симуляции умножает темп убийств так же, как и всё
        // остальное: на ×100 анимации смерти показывать нечего.
        threshold: undefined,
      })
      // Очередь НЕ строим: новая смерть заменяет предыдущую. Иначе при
      // частых убийствах анимации копятся и не кончаются никогда.
      dying = mode === 'none' ? null : { startedAt: now, mode }
    }
    monsterWasAlive = aliveNow

    const dungeon = activeDungeon(s)
    if (dungeon) {
      wantedSceneId = `dungeon:${dungeon.id}`
      wantedConfig = DUNGEON_SCENE
      const boss = currentBoss(s)
      enrage = boss && s.dungeonRun ? enrageMultiplier(boss, s.dungeonRun.fightMs) : 1
    } else {
      const zone = ZONE_BY_ID[s.currentZoneId]
      wantedSceneId = s.currentZoneId
      wantedConfig = zone?.scene ?? null
      enrage = 1
    }
  })

  // Множитель скорости симуляции: выше ×1 всплывающих чисел нет вовсе.
  let speed = 1
  const unsubscribeSpeed = simSpeed.subscribe((v) => {
    speed = v
  })

  // Отдача от ударов. Шина событий пишет сюда, кадр — читает и гасит.
  let heroKick = 0
  let monsterKick = 0
  // Вспышка попадания: 1 в момент удара, гаснет к нулю.
  let heroFlash = 0
  let monsterFlash = 0
  // Попадание УМЕНИЯ выглядит иначе обычного удара: вспышка ярче и своего
  // цвета. Пока бойцы — коробки, это единственный способ различить их
  // на глаз; когда появятся модели, сюда встанет отдельный клип анимации.
  let monsterFlashIsAbility = false

  const floaters = createFloaterQueue()
  // Проекции пересчитываются каждый КАДР, а не каждое событие: числа
  // привязаны к точке мира и обязаны оставаться над головой при любом
  // движении камеры.
  let painted = $state<{ f: Floater; at: ScreenPoint; life: number }[]>([])
  let bars = $state<{ anchor: 'hero' | 'monster'; at: ScreenPoint; health: number }[]>([])

  function floaterKind(targetIsHero: boolean, isCrit: boolean, ability: string | null): FloaterKind {
    if (targetIsHero) return 'player-damage'
    if (isCrit) return 'crit'
    return ability ? 'ability' : 'damage'
  }

  const unsubscribeAttacks = subscribeAttacks((event) => {
    const targetIsHero = event.targetId === 'hero'
    if (targetIsHero) {
      heroKick = 1
      heroFlash = 1
    } else {
      monsterKick = event.abilityId ? 1.6 : 1
      monsterFlash = 1
      monsterFlashIsAbility = event.abilityId !== null
    }
    // Числа не создаются вовсе, когда их некому читать: спрятанная вкладка
    // и ускоренная симуляция. Это не оптимизация «на всякий случай» —
    // на ×100 сюда прилетают сотни событий за кадр.
    if (document.hidden || speed > FLOATER_MAX_SPEED) return
    floaters.push({
      anchor: targetIsHero ? 'hero' : 'monster',
      kind: floaterKind(targetIsHero, event.isCrit, event.abilityId),
      text: formatNumber(event.amount),
      bornAt: performance.now(),
      // Math.random, а НЕ game/rng: поток случайности игры принадлежит
      // симуляции, и вычерпывать его из слоя рендера значило бы менять
      // ход игры от того, открыта вкладка или нет. Разброс украшения
      // на воспроизводимость игры не влияет.
      drift: Math.random() * 2 - 1,
    })
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
    // Потолок плотности пикселей. На мобильном он ниже: там запас
    // оплачивается батареей, а экран меньше и разницы не видно.
    const mobile = globalThis.innerWidth < MOBILE_BREAKPOINT
    const cap = mobile ? MAX_PIXEL_RATIO_MOBILE : MAX_PIXEL_RATIO
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, cap))

    const scene = new THREE.Scene()
    // Экспоненциальный туман прячет край площадки: без него круг обрывается
    // в пустоту и сразу видно, что мир кончился. Цвет и плотность
    // перенастраиваются под зону, сам объект живёт всё время сцены.
    const fog = new THREE.FogExp2(palette.fog, 0.07)
    scene.fog = fog
    scene.background = fog.color

    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100)

    // Заливка слабая, направленный свет сильный: на матовых примитивах
    // только разница между ними и рисует объём. При ярком ambient коробки
    // становятся плоскими цветными прямоугольниками.
    const ambient = new THREE.AmbientLight(palette.light, 0.55)
    scene.add(ambient)
    const sun = new THREE.DirectionalLight(palette.light, 2.2)
    sun.position.set(4, 9, 5)
    scene.add(sun)

    // --- Обстановка зоны -------------------------------------------------
    //
    // Всё, что зависит от зоны, живёт в ОДНОЙ группе и выгружается целиком.
    // Это главная ловушка three: при смене зоны браузер не освобождает ни
    // геометрию, ни материалы — на телефоне игра падает через десяток
    // переходов. Поэтому загрузка и выгрузка ходят строго парой.
    let scenery: ThreeNs.Group | null = null
    let sceneryId = ''

    function unloadScenery(): void {
      if (!scenery) return
      scene.remove(scenery)
      disposeSceneGraph(scenery)
      scenery = null
      sceneryId = ''
    }

    function propMesh(shape: string, color: number): ThreeNs.Mesh {
      // Геометрия у каждого пропса своя: их десятки, а не тысячи, а общая
      // геометрия потребовала бы ручного учёта ссылок при выгрузке —
      // ровно того, на чём здесь и ошибаются.
      const material = new THREE.MeshLambertMaterial({ color })
      switch (shape) {
        case 'tree':
          return new THREE.Mesh(new THREE.ConeGeometry(0.6, 2.6, 7), material)
        case 'crystal':
          return new THREE.Mesh(new THREE.OctahedronGeometry(0.8, 0), material)
        case 'stump':
          return new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.7, 8), material)
        default:
          return new THREE.Mesh(new THREE.DodecahedronGeometry(0.6, 0), material)
      }
    }

    function loadScenery(id: string, config: SceneConfig): void {
      if (sceneryId === id) return
      unloadScenery()
      const group = new THREE.Group()

      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(GROUND_RADIUS, 64),
        new THREE.MeshLambertMaterial({ color: config.groundColor }),
      )
      // Чуть ниже нуля: иначе основания коробок и площадка лежат в одной
      // плоскости и мерцают друг сквозь друга (z-fighting).
      ground.position.y = -0.01
      ground.rotation.x = -Math.PI / 2
      group.add(ground)

      for (const prop of placeProps(config, GROUND_RADIUS)) {
        const mesh = propMesh(prop.shape, prop.color)
        mesh.position.set(prop.x, prop.scale * 0.9, prop.z)
        mesh.scale.setScalar(prop.scale)
        mesh.rotation.y = prop.rotation
        group.add(mesh)
      }

      scene.add(group)
      scenery = group
      sceneryId = id

      // Туман и свет — тоже часть места, но живут на самой сцене и потому
      // не пересоздаются, а перенастраиваются.
      fog.color.setHex(config.fogColor)
      fog.density = config.fogDensity
      scene.background = fog.color
      sun.color.setHex(config.lightColor)
      sun.intensity = config.lightIntensity
      const rad = (config.lightAngleDeg * Math.PI) / 180
      sun.position.set(Math.cos(rad) * 6, 9, Math.sin(rad) * 6)
      ambient.intensity = config.ambientIntensity
      baseFogColor = config.fogColor
      baseAmbient = config.ambientIntensity
    }

    const tintColor = new THREE.Color(ENRAGE_TINT)
    let fogTinted = false

    // Исходные значения места: подсветка ярости подмешивается К НИМ,
    // а не поверх уже подмешанного — иначе за минуту боя сцена уплывёт
    // в один сплошной оранжевый.
    let baseFogColor = palette.fog
    let baseAmbient = 0.55

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

    // Потолок кадров сцены — из настроек игрока; SCENE_FPS остаётся
    // значением по умолчанию для случая «лимит снят».
    let gate = createFrameGate(get(uiSettings).fpsLimit ?? SCENE_FPS)
    const unsubscribeFps = uiSettings.subscribe((s) => {
      gate = createFrameGate(s.fpsLimit ?? SCENE_FPS)
    })
    let frameId = 0
    let running = true
    let framesThisSecond = 0
    let secondStart = performance.now()
    let previous = performance.now()

    // Точка над головой бойца в мировых координатах — якорь для числа
    // и для полоски. Переиспользуем один вектор: новый на каждый кадр
    // и на каждое число — это мусор в куче тридцать раз в секунду.
    const anchorVec = new THREE.Vector3()

    function anchorOf(mesh: ThreeNs.Mesh, headroom: number): ScreenPoint {
      anchorVec.set(mesh.position.x, mesh.scale.y + headroom, mesh.position.z)
      anchorVec.project(camera)
      return projectToScreen(anchorVec, host.clientWidth, host.clientHeight)
    }

    function updateOverlay(now: number, current: SceneModel | null): void {
      const live = floaters.alive(now)
      const heroAt = anchorOf(heroMesh, 0.35)
      const monsterAt = monsterMesh.visible ? anchorOf(monsterMesh, 0.35) : null
      painted = live.map((f) => ({
        f,
        at: f.anchor === 'hero' ? heroAt : (monsterAt ?? heroAt),
        life: floaterProgress(f, now),
      }))
      // Полоска над головой: у героя всегда, у моба — пока он на площадке.
      const next: typeof bars = []
      if (current) {
        next.push({ anchor: 'hero', at: heroAt, health: current.hero.health })
        if (current.monster && monsterAt) {
          next.push({ anchor: 'monster', at: monsterAt, health: current.monster.health })
        }
      }
      bars = next
    }

    /** Меш умирающего моба: оседает, кренится и гаснет. */
    function applyDeath(mesh: ThreeNs.Mesh, mode: DeathMode, progress: number): void {
      mesh.visible = true
      const material = mesh.material as ThreeNs.MeshLambertMaterial
      if (mode === 'flash') {
        // Короткая вспышка вместо анимации: убийства идут чаще, чем она
        // длится, и полноценное падение превратило бы сцену в мигалку.
        material.emissive.setScalar(1 - progress)
        return
      }
      mesh.scale.y = Math.max(0.05, mesh.scale.y * (1 - progress))
      mesh.position.y = mesh.scale.y / 2
      mesh.rotation.z = progress * 0.9
      material.emissive.setScalar(0)
    }

    function applyActor(
      mesh: ThreeNs.Mesh,
      baseColor: number,
      actor: { height: number; width: number; depth: number; health: number } | null,
      z: number,
      kick: number,
      flash: number,
      flashColor: number | null = null,
    ): void {
      // Пока идёт анимация смерти, живым мешем не распоряжаемся.
      if (dying && mesh === monsterMesh) return
      mesh.visible = actor !== null
      if (!actor) return
      // Сбрасываем то, что могла оставить анимация смерти: один и тот же
      // меш переиспользуется под всех мобов подряд — своего у каждого нет.
      mesh.rotation.z = 0
      mesh.scale.set(actor.width, actor.height, actor.depth)
      // Меш стоит НА площадке: центр коробки на половине роста.
      mesh.position.set(0, actor.height / 2, z)
      // Раненый заметно темнеет — здоровье читается прямо с силуэта.
      // Считаем ОТ базового цвета, а не от текущего: иначе каждый кадр
      // умножал бы уже потускневший цвет и боец за секунду ушёл бы в чёрный.
      const material = mesh.material as ThreeNs.MeshLambertMaterial
      material.color.setHex(baseColor)
      material.color.multiplyScalar(0.4 + 0.6 * actor.health)
      // Вспышка попадания: подмешиваем свет к текущему цвету, а не меняем
      // материал — смена материала на каждом ударе пересобирает шейдер.
      if (flash > 0.01) {
        if (flashColor === null) material.emissive.setScalar(flash * 0.5)
        else material.emissive.setHex(flashColor).multiplyScalar(flash * 0.8)
      } else {
        material.emissive.setScalar(0)
      }
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

      heroFlash *= decay
      monsterFlash *= decay

      // Смена зоны делается ЗДЕСЬ, в кадре, а не в подписке на стор:
      // подписка срабатывает каждый тик, а пересобирать обстановку надо
      // ровно тогда, когда место действительно сменилось.
      if (wantedConfig) loadScenery(wantedSceneId, wantedConfig)

      // Ярость босса заливает сцену тревожным светом. Считается ОТ базовых
      // значений места: иначе за минуту боя сцена уплыла бы в оранжевый.
      const tint = enrageTintAmount(enrage, ENRAGE_TINT_MAX)
      if (tint > 0) {
        fog.color.setHex(baseFogColor).lerp(tintColor, tint)
        ambient.intensity = baseAmbient + tint
      } else if (fogTinted) {
        fog.color.setHex(baseFogColor)
        ambient.intensity = baseAmbient
      }
      fogTinted = tint > 0
      scene.background = fog.color

      // Смерть моба: он оседает и гаснет, пока идёт анимация, и лишь потом
      // уступает место следующему. В быстром режиме — только вспышка.
      if (dying) {
        const p = deathProgress(dying.startedAt, now, dying.mode === 'flash' ? 90 : DEATH_ANIM_MS)
        if (p >= 1) dying = null
        else applyDeath(monsterMesh, dying.mode, p)
      }

      const current = model
      if (current) {
        applyActor(heroMesh, palette.hero, current.hero, HERO_Z, heroKick, heroFlash)
        applyActor(
          monsterMesh,
          palette.monster,
          current.monster,
          MONSTER_Z,
          monsterKick,
          monsterFlash,
          monsterFlashIsAbility ? palette.hero : null,
        )
      }

      renderer.render(scene, camera)
      updateOverlay(now, current)

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
      // Вкладку спрятали — снимаем всплывающие числа. Убирает их кадр
      // сцены, а он остановлен: без этого последние числа замерли бы
      // в DOM и встретили игрока по возвращении, показывая урон,
      // которому уже минута.
      if (document.hidden) {
        floaters.clear()
        painted = []
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    frameId = requestAnimationFrame(frame)

    return () => {
      running = false
      cancelAnimationFrame(frameId)
      unsubscribeFps()
      unloadScenery()
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
    unsubscribeSpeed()
    unsubscribeOffline()
    floaters.clear()
    dispose?.()
    dispose = null
  })
</script>

<div class="host" bind:this={host}>
  <canvas bind:this={canvas} aria-hidden="true"></canvas>

  <!-- Оверлей поверх канвы. Позиции берутся ПРОЕКЦИЕЙ мировой точки
       в экранную, поэтому числа и полоски держатся над головой при любом
       движении камеры. Указатель не перехватываем: под ним сцена. -->
  <div class="overlay" aria-hidden="true">
    {#each bars as bar (bar.anchor)}
      {#if bar.at.visible}
        <div
          class="bar {bar.anchor}"
          style="left: {bar.at.x}px; top: {bar.at.y}px"
        >
          <i style="width: {Math.round(bar.health * 100)}%"></i>
        </div>
      {/if}
    {/each}
    {#each painted as p (p.f.id)}
      {#if p.at.visible}
        <span
          class="floater {p.f.kind}"
          style="left: {p.at.x}px; top: {p.at.y}px; --life: {p.life}; --drift: {p.f.drift}"
        >
          {p.f.text}
        </span>
      {/if}
    {/each}
  </div>
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
  .overlay {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  /* Полоска здоровья над головой. Ширина в процентах — доля здоровья,
     цвет разный у героя и у моба, как и везде в игре. */
  .bar {
    position: absolute;
    width: 3rem;
    height: var(--bar-sm);
    margin-left: -1.5rem;
    margin-top: -0.4rem;
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
  .bar.hero i {
    background: var(--c-heal);
  }
  .bar.monster i {
    background: var(--c-damage);
  }

  .floater {
    position: absolute;
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-bold);
    font-size: var(--text-sm);
    line-height: 1;
    white-space: nowrap;
    text-shadow: var(--shadow-md);
    /* Число поднимается и гаснет. Всё считает --life (доля прожитого),
       поэтому анимации как таковой нет: кадр сцены сам двигает число,
       и при паузе рендера оно замирает вместе со сценой. */
    /* Стартует ВЫШЕ полоски здоровья: они делят один якорь над головой,
       и без запаса число вылетало бы прямо из полоски. */
    transform: translate(calc(-50% + var(--drift) * 1.6rem), calc(-2.2rem - var(--life) * 2.4rem));
    opacity: calc(1 - var(--life) * var(--life));
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
  .floater.xp {
    color: var(--c-xp);
  }
  .floater.gold {
    color: var(--c-gold);
  }

  /* Игрок попросил меньше движения — гасим на месте, без подъёма.
     Число всё равно должно быть видно: это информация, а не украшение. */
  @media (prefers-reduced-motion: reduce) {
    .floater {
      transform: translate(calc(-50% + var(--drift) * 1.6rem), -2.2rem);
    }
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
