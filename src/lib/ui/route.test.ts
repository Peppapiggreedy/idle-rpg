import { describe, expect, it } from 'vitest'
import {
  debugRoute,
  isBalanceRoute,
  isSceneDisabled,
  isScreenshotMode,
  presetName,
  screenshotPose,
} from './route'

// Подделка Location: тест не поднимает браузер, а маршрут — чистая функция.
function loc(url: string): Location {
  const parsed = new URL(url)
  return { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash } as Location
}

describe('отладочные маршруты', () => {
  it('без ?debug=1 отладочных страниц нет ни по пути, ни по хешу', () => {
    expect(debugRoute(loc('https://x.dev/idle-rpg/balance'))).toBeNull()
    expect(debugRoute(loc('https://x.dev/idle-rpg/ui'))).toBeNull()
    expect(debugRoute(loc('https://x.dev/idle-rpg/#/ui'))).toBeNull()
    expect(debugRoute(loc('https://x.dev/idle-rpg/balance?debug=0'))).toBeNull()
  })

  it('открываются и чистым путём, и хешем', () => {
    expect(debugRoute(loc('https://x.dev/idle-rpg/balance?debug=1'))).toBe('balance')
    expect(debugRoute(loc('https://x.dev/idle-rpg/balance/?debug=1'))).toBe('balance')
    expect(debugRoute(loc('https://x.dev/idle-rpg/?debug=1#/balance'))).toBe('balance')
    expect(debugRoute(loc('https://x.dev/idle-rpg/ui?debug=1'))).toBe('ui')
    expect(debugRoute(loc('https://x.dev/idle-rpg/?debug=1#/ui'))).toBe('ui')
  })

  it('сама игра под ?debug=1 остаётся игрой', () => {
    expect(debugRoute(loc('https://x.dev/idle-rpg/?debug=1'))).toBeNull()
    expect(debugRoute(loc('https://x.dev/idle-rpg/?debug=1#/talents'))).toBeNull()
    // Похожие, но другие пути не считаются.
    expect(debugRoute(loc('https://x.dev/idle-rpg/rebalance?debug=1'))).toBeNull()
    expect(debugRoute(loc('https://x.dev/idle-rpg/gui?debug=1'))).toBeNull()
  })

  it('isBalanceRoute — частный случай того же разбора', () => {
    expect(isBalanceRoute(loc('https://x.dev/idle-rpg/balance?debug=1'))).toBe(true)
    expect(isBalanceRoute(loc('https://x.dev/idle-rpg/ui?debug=1'))).toBe(false)
  })
})

describe('пресет состояния для съёмки', () => {
  it('без ?debug=1 пресет не подхватывается', () => {
    // Иначе чужую ссылку с ?state= можно было бы подсунуть живому игроку.
    expect(presetName(loc('https://x.dev/idle-rpg/?state=rich'))).toBeNull()
    expect(presetName(loc('https://x.dev/idle-rpg/?state=rich&debug=0'))).toBeNull()
    expect(isScreenshotMode(loc('https://x.dev/idle-rpg/?state=rich'))).toBe(false)
  })

  it('с ?debug=1 отдаёт имя пресета', () => {
    expect(presetName(loc('https://x.dev/idle-rpg/?debug=1&state=fresh'))).toBe('fresh')
    expect(presetName(loc('https://x.dev/idle-rpg/?debug=1&state=mid'))).toBe('mid')
    expect(isScreenshotMode(loc('https://x.dev/idle-rpg/?debug=1&state=rich'))).toBe(true)
  })

  it('мусорное имя отбрасывается — оно идёт в путь импорта', () => {
    expect(presetName(loc('https://x.dev/idle-rpg/?debug=1&state=../secret'))).toBeNull()
    expect(presetName(loc('https://x.dev/idle-rpg/?debug=1&state=Rich'))).toBeNull()
    expect(presetName(loc('https://x.dev/idle-rpg/?debug=1&state='))).toBeNull()
  })

  it('обычная игра пресетом не считается', () => {
    expect(presetName(loc('https://x.dev/idle-rpg/?debug=1'))).toBeNull()
    expect(isScreenshotMode(loc('https://x.dev/idle-rpg/'))).toBe(false)
  })
})

describe('переключатель сцены', () => {
  it('?scene=off убирает сцену и не требует ?debug=1', () => {
    expect(isSceneDisabled(loc('https://x.dev/idle-rpg/?scene=off'))).toBe(true)
    expect(isSceneDisabled(loc('https://x.dev/idle-rpg/?scene=off&debug=1'))).toBe(true)
  })

  it('по умолчанию и с любым другим значением — сцена', () => {
    expect(isSceneDisabled(loc('https://x.dev/idle-rpg/'))).toBe(false)
    expect(isSceneDisabled(loc('https://x.dev/idle-rpg/?scene=2d'))).toBe(false)
    expect(isSceneDisabled(loc('https://x.dev/idle-rpg/?scene=3d'))).toBe(false)
  })
})

describe('поза сцены для снимка', () => {
  it('работает только вместе с пресетом', () => {
    // В живой игре застывшая поза была бы ложью о бое.
    expect(screenshotPose(loc('https://x.dev/idle-rpg/?pose=hit'))).toBeNull()
    expect(screenshotPose(loc('https://x.dev/idle-rpg/?debug=1&pose=hit'))).toBeNull()
    expect(screenshotPose(loc('https://x.dev/idle-rpg/?state=rich&pose=hit'))).toBeNull()
  })

  it('с пресетом отдаёт одну из известных поз', () => {
    for (const pose of ['idle', 'swing', 'hit', 'crit', 'heal', 'rest']) {
      expect(screenshotPose(loc(`https://x.dev/idle-rpg/?debug=1&state=rich&pose=${pose}`))).toBe(pose)
    }
  })

  it('неизвестная поза — сцена живёт по состоянию', () => {
    expect(screenshotPose(loc('https://x.dev/idle-rpg/?debug=1&state=rich&pose=dance'))).toBeNull()
    expect(screenshotPose(loc('https://x.dev/idle-rpg/?debug=1&state=rich'))).toBeNull()
    expect(screenshotPose(loc('https://x.dev/idle-rpg/?debug=1&state=rich&pose='))).toBeNull()
  })
})
