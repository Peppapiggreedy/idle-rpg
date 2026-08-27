import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  HERO_MODEL,
  MODEL_ASSETS,
  MONSTER_MODEL,
  type ActorState,
  type ModelAsset,
} from '../data/assets'
import {
  actorState,
  attackTimeScale,
  ATTACK_TIMESCALE_MAX,
  ATTACK_TIMESCALE_MIN,
  clipFor,
} from './animator'
import { createModelCache, fitScale } from './models'

const PUBLIC_MODELS = new URL('../../../public/models/', import.meta.url)
const STATES: ActorState[] = ['idle', 'attack', 'hit', 'death']

/**
 * Разбор GLB без типов node.
 *
 * Читаем в latin1: эта кодировка отображает байты 0..255 в символы 0..255
 * один в один, поэтому из строки можно достать исходные байты обратно.
 * Так тест обходится без Buffer, которого в типах приложения нет, и при
 * этом честно читает двоичный файл, а не верит реестру на слово.
 */
function readGltfJson(asset: ModelAsset): {
  animations?: { name: string }[]
  buffers?: { uri?: string }[]
  images?: { uri?: string }[]
} {
  const file = new URL(asset.path.replace('models/', ''), PUBLIC_MODELS)
  const raw = readFileSync(file, 'latin1')
  const byte = (i: number) => raw.charCodeAt(i) & 0xff
  const u32 = (i: number) => byte(i) | (byte(i + 1) << 8) | (byte(i + 2) << 16) | (byte(i + 3) << 24)

  expect(u32(0), `${asset.path}: не GLB`).toBe(0x46546c67)
  let offset = 12
  while (offset < raw.length) {
    const length = u32(offset)
    const type = u32(offset + 4)
    if (type === 0x4e4f534a) {
      const chunk = raw.slice(offset + 8, offset + 8 + length)
      // Обратно в байты и уже потом в UTF-8: имена клипов бывают не ASCII.
      const bytes = Uint8Array.from(chunk, (c) => c.charCodeAt(0) & 0xff)
      return JSON.parse(new TextDecoder().decode(bytes))
    }
    offset += 8 + length + ((4 - (length % 4)) % 4)
  }
  throw new Error(`${asset.path}: не найден JSON-кусок`)
}

function clipNamesOf(asset: ModelAsset): string[] {
  return (readGltfJson(asset).animations ?? []).map((a) => a.name)
}

describe('реестр моделей', () => {
  it.each(MODEL_ASSETS)('$id: файл лежит в public/models', (asset) => {
    const file = new URL(asset.path.replace('models/', ''), PUBLIC_MODELS)
    expect(readFileSync(file, 'latin1').length).toBeGreaterThan(1000)
  })

  it.each(MODEL_ASSETS)('$id: каждое имя клипа ЕСТЬ в файле', (asset) => {
    // Главный тест реестра. Промах в имени не даёт ни ошибки, ни падения —
    // модель просто стоит в T-позе, и заметить это можно только глазами.
    const inFile = clipNamesOf(asset)
    for (const state of STATES) {
      const name = asset.clips[state]
      if (name === null) continue
      expect(inFile, `${asset.id}.${state} = ${name}`).toContain(name)
    }
  })

  it.each(MODEL_ASSETS)('$id: указаны лицензия, автор и ссылка', (asset) => {
    // Этого требуют лицензии: CC0 не обязывает, но CC BY обязывает,
    // и запись должна быть полной независимо от того, что за модель.
    expect(asset.license).toMatch(/\S/)
    expect(asset.author).toMatch(/\S/)
    expect(asset.sourceUrl).toMatch(/^https:\/\//)
  })

  it('герой и моб — из одного источника: единый стиль важнее разнообразия', () => {
    expect(HERO_MODEL.author).toBe(MONSTER_MODEL.author)
  })

  it('GLB самодостаточны: ни внешних .bin, ни отдельных текстур', () => {
    // Иначе рядом с моделью надо было бы класть файлы, о которых знает
    // только загрузчик, и один забытый .bin ломал бы модель на проде.
    for (const asset of MODEL_ASSETS) {
      const json = readGltfJson(asset)
      const external = [...(json.buffers ?? []), ...(json.images ?? [])].filter((r) => r.uri)
      expect(external, asset.id).toEqual([])
    }
  })

  it('рядом с моделями лежит лицензия пака', () => {
    const files = readdirSync(PUBLIC_MODELS)
    expect(files.filter((f) => f.startsWith('LICENSE')).length).toBeGreaterThan(0)
  })
})

describe('имена клипов не разбежались по коду', () => {
  // Правило шага: в коде сцены не должно остаться ни одного строкового
  // имени анимации. Иначе замена модели потребует правок в рендере.
  const RENDER_DIR = new URL('./', import.meta.url)
  const sources = readdirSync(RENDER_DIR)
    .filter((f) => (f.endsWith('.ts') || f.endsWith('.svelte')) && !f.endsWith('.test.ts'))
    .map((f) => [f, readFileSync(new URL(f, RENDER_DIR), 'utf8')] as const)

  const NAMES = [...new Set(MODEL_ASSETS.flatMap((a) => Object.values(a.clips)))].filter(
    (n): n is string => n !== null,
  )

  it.each(sources)('%s: без захардкоженных имён клипов', (_name, source) => {
    expect(NAMES.filter((clip) => source.includes(`'${clip}'`))).toEqual([])
  })
})

describe('кеш моделей', () => {
  function fakeDeps(onLoad: () => void) {
    return {
      GLTFLoader: class {
        async loadAsync(url: string) {
          onLoad()
          return {
            scene: { name: url } as never,
            animations: [{ name: 'Idle' }, { name: 'Hit_A' }] as never,
          } as never
        }
      },
      clone: (o: unknown) => ({ ...(o as object), cloned: true }) as never,
      baseUrl: '/idle-rpg/',
    }
  }

  it('второй запрос той же модели не скачивает файл заново', async () => {
    let loads = 0
    const cache = createModelCache(fakeDeps(() => (loads += 1)))
    await cache.load(HERO_MODEL)
    await cache.load(HERO_MODEL)
    await cache.load(HERO_MODEL)
    expect(loads).toBe(1)
    expect(cache.fetches()).toBe(1)
  })

  it('два одновременных запроса дают одно скачивание', async () => {
    // Без этого герой и моб на одной модели скачали бы её дважды: второй
    // запрос уходит раньше, чем первый успевает записать результат.
    let loads = 0
    const cache = createModelCache(fakeDeps(() => (loads += 1)))
    await Promise.all([cache.load(HERO_MODEL), cache.load(HERO_MODEL)])
    expect(loads).toBe(1)
  })

  it('наружу отдаётся КЛОН, а не общий объект', async () => {
    // Общий объект означал бы, что второй боец повторяет позу первого.
    const cache = createModelCache(fakeDeps(() => {}))
    const a = await cache.load(HERO_MODEL)
    const b = await cache.load(HERO_MODEL)
    expect(a.scene).not.toBe(b.scene)
  })

  it('имена клипов отдаются как есть — их показывает оверлей', async () => {
    const cache = createModelCache(fakeDeps(() => {}))
    expect((await cache.load(HERO_MODEL)).clipNames).toEqual(['Idle', 'Hit_A'])
  })

  it('неудачная загрузка не отравляет кеш навсегда', async () => {
    let attempts = 0
    const cache = createModelCache({
      GLTFLoader: class {
        async loadAsync() {
          attempts += 1
          if (attempts === 1) throw new Error('сеть')
          return { scene: {} as never, animations: [] as never } as never
        }
      },
      clone: (o: unknown) => o as never,
      baseUrl: '/',
    })
    await expect(cache.load(HERO_MODEL)).rejects.toThrow('сеть')
    // Повтор обязан пройти: иначе один сетевой сбой оставил бы игрока
    // с коробкой до перезагрузки страницы.
    await expect(cache.load(HERO_MODEL)).resolves.toBeTruthy()
    expect(attempts).toBe(2)
  })
})

describe('машина анимаций', () => {
  it('приоритет состояний: смерть сильнее удара, удар сильнее покоя', () => {
    const base = { alive: true, dying: false, hurt: false, attacking: false }
    expect(actorState(base)).toBe('idle')
    expect(actorState({ ...base, hurt: true })).toBe('hit')
    expect(actorState({ ...base, hurt: true, attacking: true })).toBe('attack')
    expect(actorState({ ...base, attacking: true, dying: true })).toBe('death')
    expect(actorState({ ...base, alive: false })).toBe('death')
  })

  it('нет клипа под состояние — деградируем осмысленно', () => {
    const clips = { idle: 'Idle', attack: null, hit: null, death: null }
    // Нет атаки и удара — продолжаем стоять, а не застываем в T-позе.
    expect(clipFor(clips, 'attack')).toBe('Idle')
    expect(clipFor(clips, 'hit')).toBe('Idle')
    // Нет смерти — null, и сцена ограничится вспышкой.
    expect(clipFor(clips, 'death')).toBeNull()
  })

  it('клип атаки укладывается в замах, но не превращается в судорогу', () => {
    // Клип 1с при замахе 1с идёт как есть.
    expect(attackTimeScale(1, 1)).toBe(1)
    // Двуручник 3.4с: клип растягивается, но не более чем вдвое.
    expect(attackTimeScale(1, 3.4)).toBe(ATTACK_TIMESCALE_MIN)
    // Кинжал с ускорением: клип сжимается, но есть потолок.
    expect(attackTimeScale(1, 0.05)).toBe(ATTACK_TIMESCALE_MAX)
    // Мусор на входе не даёт NaN.
    expect(attackTimeScale(0, 1)).toBe(1)
    expect(attackTimeScale(1, 0)).toBe(ATTACK_TIMESCALE_MAX)
  })
})

describe('подгонка размера', () => {
  it('модель приводится к нужному росту независимо от своих единиц', () => {
    expect(fitScale(1, 1.8)).toBeCloseTo(1.8, 5)
    expect(fitScale(180, 1.8)).toBeCloseTo(0.01, 5)
  })

  it('нулевая и мусорная высота не дают деления на ноль', () => {
    expect(fitScale(0, 1.8)).toBe(1)
    expect(fitScale(Number.NaN, 1.8)).toBe(1)
  })
})

describe('CREDITS про модели', () => {
  const credits = readFileSync(new URL('../../../CREDITS.md', import.meta.url), 'utf8')

  it('у каждой модели указаны автор, лицензия и ссылка', () => {
    for (const asset of MODEL_ASSETS) {
      expect(credits, asset.id).toContain(asset.author)
      expect(credits, asset.id).toContain(asset.license)
      expect(credits, asset.id).toContain(asset.sourceUrl)
    }
  })

  it('про Fox отдельно сказано, что риг и анимации под CC BY 4.0', () => {
    // У Fox лицензия СОСТАВНАЯ: модель CC0, а риг и анимации CC BY 4.0,
    // и атрибуция там обязательна. Если запасной вариант когда-нибудь
    // пойдёт в дело, эта оговорка должна быть уже записана.
    expect(credits).toContain('CC BY 4.0')
    expect(credits).toContain('tomkranis')
  })
})
