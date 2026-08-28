// Загрузка моделей и кеш.
//
// Кеш обязателен не ради скорости: GLB весит мегабайты, и второй запрос
// того же файла — это второе скачивание и вторая копия геометрии в памяти
// видеокарты. Загруженный GLTF хранится в Map, а наружу отдаётся КЛОН.
//
// Клонировать надо SkeletonUtils.clone, а НЕ object.clone(): у обычного
// клона скины продолжают ссылаться на кости оригинала, и вторая копия
// повторяет позу первой. Ошибка тихая — модель просто «залипает», —
// поэтому она вынесена сюда и подписана.

import type * as ThreeNs from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'


export interface LoadedModel {
  /** Готовый к добавлению в сцену корень; у каждого вызова свой. */
  scene: ThreeNs.Group
  /** Клипы как есть из файла — по ним создаются действия микшера. */
  animations: ThreeNs.AnimationClip[]
  /** Имена клипов в файле: их показывает отладочный оверлей. */
  clipNames: string[]
}

/** Кешу от ассета нужны только id и путь: бойцу, пропсу — всё равно. */
export interface LoadableAsset {
  id: string
  path: string
}

export interface ModelCache {
  load(asset: LoadableAsset): Promise<LoadedModel>
  /** Сколько файлов реально скачано — по нему видно, что кеш работает. */
  fetches(): number
  dispose(): void
}

/** Зависимости three передаются снаружи: модуль грузится динамически. */
export interface ModelDeps {
  GLTFLoader: new () => { loadAsync(url: string): Promise<GLTF> }
  clone: (source: ThreeNs.Object3D) => ThreeNs.Object3D
  baseUrl: string
}

export function createModelCache(deps: ModelDeps): ModelCache {
  // Храним ПРОМИС, а не результат: два запроса подряд, пока файл ещё летит,
  // не должны обернуться двумя скачиваниями.
  const cache = new Map<string, Promise<GLTF>>()
  const loader = new deps.GLTFLoader()
  let fetched = 0

  return {
    async load(asset) {
      let entry = cache.get(asset.id)
      if (!entry) {
        fetched += 1
        entry = loader.loadAsync(deps.baseUrl + asset.path)
        cache.set(asset.id, entry)
        // Неудачу из кеша убираем: иначе один сетевой сбой навсегда
        // отравил бы запись, и повтор был бы невозможен.
        entry.catch(() => cache.delete(asset.id))
      }
      const gltf = await entry
      return {
        scene: deps.clone(gltf.scene) as ThreeNs.Group,
        animations: gltf.animations,
        clipNames: gltf.animations.map((a) => a.name),
      }
    },
    fetches() {
      return fetched
    },
    dispose() {
      cache.clear()
    },
  }
}

/**
 * Множитель размера, чтобы модель встала в нужный рост.
 * Считается по реальной высоте загруженной модели, а не берётся на глаз:
 * у KayKit и у RobotExpressive единицы разные, и одно число на всех
 * означало бы великана рядом с карликом.
 */
export function fitScale(measuredHeight: number, targetHeight: number): number {
  if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) return 1
  return targetHeight / measuredHeight
}
