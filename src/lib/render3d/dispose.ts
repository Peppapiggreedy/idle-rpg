// Выгрузка сцены.
//
// Геометрию и материалы сборщик мусора браузера не заберёт: они живут
// в памяти видеокарты, и освободить их можно только руками. Обход вынесен
// из компонента отдельной функцией, чтобы его можно было проверить в node —
// в живом браузере «освободилось ли» снаружи не видно, а ошибиться легко:
// материал бывает массивом, и один пропущенный узел утекает молча.

/** Ровно то, что нужно для выгрузки; полный тип three здесь не требуется. */
export interface DisposableNode {
  geometry?: { dispose?: () => void }
  material?: { dispose?: () => void } | { dispose?: () => void }[]
}

export interface TraversableNode {
  traverse(visit: (node: TraversableNode & DisposableNode) => void): void
}

/**
 * Обходит сцену и освобождает геометрию и материалы каждого узла.
 * Возвращает число освобождённых ресурсов — по нему видно, что обход
 * что-то нашёл, а не прошёл вхолостую.
 */
export function disposeSceneGraph(root: TraversableNode): number {
  let disposed = 0
  root.traverse((node) => {
    if (node.geometry?.dispose) {
      node.geometry.dispose()
      disposed += 1
    }
    const material = node.material
    if (Array.isArray(material)) {
      for (const one of material) {
        if (one?.dispose) {
          one.dispose()
          disposed += 1
        }
      }
    } else if (material?.dispose) {
      material.dispose()
      disposed += 1
    }
  })
  return disposed
}
