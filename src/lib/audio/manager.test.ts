// Менеджер звука: ворота, отображение событий на кью и запреты.
//
// Тут же проверяется главное архитектурное правило: слой звука ТОЛЬКО
// ЧИТАЕТ. Логика про него не знает — она эмитит события, и всё.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { Decimal } from '../game/numbers'
import { createRng } from '../game/rng'
import { cueForEvent, isAudible, SoundPlayer, type AudioGate, type SoundEngine } from './manager'
import { SOUNDS, LOSS_EVENTS, EVENT_CUES, SOUND_BY_ID } from '../data/sounds'
import { RARITIES } from '../data/rarity'
import type { CombatEvent, Item } from '../types'

const OPEN: AudioGate = {
  unlocked: true,
  enabled: true,
  hidden: false,
  speed: 1,
  textMode: false,
}

function fakeEngine() {
  const played: string[] = []
  const engine: SoundEngine = {
    durationMs: () => 200,
    play: (plan) => played.push(plan.cueId),
  }
  return { engine, played }
}

function player(gate: AudioGate = OPEN, now = () => 0) {
  const { engine, played } = fakeEngine()
  return {
    played,
    player: new SoundPlayer({ engine, gate: () => gate, now, rng: createRng(1) }),
  }
}

const item = (rarity: Item['rarity']): Item => ({
  id: 'i',
  name: 'Предмет',
  rarity,
  slot: 'trinket',
  level: 1,
  mods: [],
})

describe('ворота', () => {
  it('до жеста игрока звука нет', () => {
    expect(isAudible({ ...OPEN, unlocked: false })).toBe(false)
  })

  it('на ускорении отладки — тишина', () => {
    // На ×5 звуки идут впятеро чаще и сливаются в треск. Это не «быстрее
    // играть», это сломать уши.
    expect(isAudible({ ...OPEN, speed: 2 })).toBe(false)
    expect(isAudible({ ...OPEN, speed: 1 })).toBe(true)
  })

  it('в спрятанной вкладке и в текстовом режиме — тишина', () => {
    expect(isAudible({ ...OPEN, hidden: true })).toBe(false)
    expect(isAudible({ ...OPEN, textMode: true })).toBe(false)
  })

  it('нулевая общая громкость выключает всё', () => {
    expect(isAudible({ ...OPEN, enabled: false })).toBe(false)
  })

  it('закрытые ворота доходят до движка: ни одного play', () => {
    const { player: p, played } = player({ ...OPEN, unlocked: false })
    p.event({ type: 'kill', monsterId: 'test-monster', zoneId: 'shepherds-meadow', monsterName: 'моб', gold: new Decimal(1), xp: new Decimal(1) })
    p.ui('ui-click')
    expect(played).toEqual([])
  })
})

describe('события в звуки', () => {
  it('редкость находки слышно: у каждого тира свой звук', () => {
    const cues = RARITIES.map((r) => cueForEvent({ type: 'loot', item: item(r.id) })?.id)
    expect(cues.every((id) => id !== undefined)).toBe(true)
    // Второе кодирование обязано РАЗЛИЧАТЬ тиры, иначе оно ничего не кодирует.
    expect(new Set(cues).size).toBe(RARITIES.length)
  })

  it('крит звучит иначе, чем обычный удар', () => {
    const plain = cueForEvent({ type: 'hit', damage: new Decimal(1), isCrit: false })
    const crit = cueForEvent({ type: 'hit', damage: new Decimal(1), isCrit: true })
    expect(plain?.id).toBe('hit')
    expect(crit?.id).toBe('crit')
  })

  it('поток событий озвучен не весь — и это решение, а не пробел', () => {
    // Спавн, смена зоны и тики эффектов идут потоком; звук на каждом
    // превратился бы в шум. Молчание тоже надо выбирать.
    expect(cueForEvent({ type: 'spawn', monsterName: 'моб' })).toBeNull()
    expect(cueForEvent({ type: 'zone', zoneName: 'зона', reason: 'travel' })).toBeNull()
  })

  it('пачка событий проигрывается по порядку', () => {
    let t = 0
    const { player: p, played } = player(OPEN, () => (t += 1000))
    const events: CombatEvent[] = [
      { type: 'hit', damage: new Decimal(1), isCrit: false },
      { type: 'kill', monsterId: 'test-monster', zoneId: 'shepherds-meadow', monsterName: 'моб', gold: new Decimal(1), xp: new Decimal(1) },
      { type: 'loot', item: item('legendary') },
    ]
    p.events(events)
    expect(played).toEqual(['hit', 'kill', 'loot-legendary'])
  })
})

describe('чего в звуке быть не должно', () => {
  it('у потерь не бывает победного звука', () => {
    // «Проиграл под фанфары» — приём игровых автоматов. У нас потеря звучит
    // как потеря, иначе звук врёт игроку о том, что с ним произошло.
    for (const type of LOSS_EVENTS) {
      const id = EVENT_CUES[type]
      expect(id, `${type} без звука`).toBeTruthy()
      expect(SOUND_BY_ID[id!].valence, `${type}`).not.toBe('good')
    }
  })

  it('нет звука «почти получилось»', () => {
    // Промахов и «почти крита» в игре нет вовсе, и заводить их звуком —
    // значит завести саму механику. Реестр не должен намекать на неё.
    const forbidden = /(miss|near|almost|промах|почти)/i
    for (const cue of SOUNDS) {
      expect(forbidden.test(cue.id), cue.id).toBe(false)
    }
  })

  it('в игре нет ни одного таймера обратного отсчёта в звуке', () => {
    // Ни «успей за N секунд», ни тикающих напоминаний: игра idle, и торопить
    // игрока ей нечем и незачем.
    expect(SOUNDS.some((c) => /timer|countdown|таймер/i.test(c.id))).toBe(false)
  })
})

describe('слой звука только читает', () => {
  const dir = new URL('.', import.meta.url)

  it('в audio/ нет ни одного экшена стора', () => {
    // То же правило, что у сцены: звук читает состояние и шину, но не пишет
    // в игру. Единственное исключение — жест игрока, и он в стор ИНТЕРФЕЙСА.
    const forbidden = /from '\.\.\/stores\/game'/
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue
      const source = readFileSync(new URL(name, dir), 'utf8')
      const imports = source.match(/import[^\n]*from '[^']*'/g) ?? []
      for (const line of imports) {
        if (!forbidden.test(line)) continue
        // Разрешено ровно одно чтение: множитель скорости для ворот.
        expect(line, name).toMatch(/\{\s*simSpeed\s*\}/)
      }
    }
  })

  it('каждый файл из реестра лежит в public/', () => {
    // Ассет → файл: та же проверка, что у моделей и иконок. Промах даёт не
    // ошибку, а тишину, которую никто не заметит.
    const root = new URL('../../../public/', import.meta.url)
    for (const cue of SOUNDS) {
      for (const file of cue.files) {
        expect(() => readFileSync(new URL(file, root), 'utf8'), `${cue.id}: ${file}`).not.toThrow()
      }
    }
  })
})
