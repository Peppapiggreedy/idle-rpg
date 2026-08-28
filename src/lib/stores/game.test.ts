import { describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { applyScreenshotState, gameStarted, gameState } from './game'
import { createInitialState } from '../game/state'

describe('режим съёмки', () => {
  // Пресет — это НАЧАТАЯ игра, а не пустой профиль: класс в нём уже выбран.
  // Без этого поверх снимка вставал выбор класса и накрывал собой всё —
  // и снимок, и нажатия. Тест держит именно это, потому что вручную такое
  // видно только глазами на картинке.
  it('пресет считается начатой игрой, выбор класса поверх не встаёт', () => {
    expect(get(gameStarted)).toBe(false)
    applyScreenshotState(createInitialState())
    expect(get(gameStarted)).toBe(true)
  })

  it('прокручивает тики: лог боя не пуст', () => {
    applyScreenshotState(createInitialState())
    expect(get(gameState).combatLog.length).toBeGreaterThan(0)
  })
})
