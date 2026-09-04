// ЧЕТЫРЕ СЛОТА И ПОРЯДОК КАК ПРИОРИТЕТ.
//
// Умений у класса больше, чем слотов, и решение «какие четыре и в каком
// порядке» — единственный рычаг игрока над ротацией. Числа приоритета в
// состоянии больше нет: порядок читается из самого ряда, и все, кто про
// порядок знает (автокаст, ручная игра, модель боя, оффлайн), обязаны
// читать ОДИН И ТОТ ЖЕ ряд. Здесь это и проверяется — по одному тесту на
// каждого читателя.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, defaultAbilitySlots, fillAbilitySlots, rotationOf } from './tick'
import { ensureStats } from './stats'
import { autocastCandidates, useAbility } from './abilities'
import { estimateCombatRate } from './combat'
import { abilitiesByPriority } from './rotation'
import { applyOfflineProgress, migrateSave, stateFromPayload } from './save'
import { createRng } from './rng'
import { ABILITY_SLOTS } from '../data/balance'
import { DEFAULT_CLASS } from '../data/classes'
import { readFileSync } from 'node:fs'
import type { GameState } from './state'

const QUICK = 'quick-strike'
const BLOW = 'shattering-blow'

function hero(level = 12, patch: Partial<GameState> = {}): GameState {
  return ensureStats({
    ...createInitialState(1, DEFAULT_CLASS.id, 1),
    level: new Decimal(level),
    statsDirty: true,
    ...patch,
  })
}

describe('ряд действий: четыре слота', () => {
  it('слотов ровно ABILITY_SLOTS, и они заполнены умениями класса', () => {
    const slots = defaultAbilitySlots(DEFAULT_CLASS.id)
    expect(slots).toHaveLength(ABILITY_SLOTS)
    // Пустая панель у героя недопустима: хотя бы первое умение стоит в ряду.
    expect(slots[0]).toBe(QUICK)
    for (const id of slots) {
      if (id === null) continue
      expect(DEFAULT_CLASS.abilityIds).toContain(id)
    }
  })

  it('порядок по умолчанию — порядок данных класса', () => {
    // Это и есть проверка «переделка честная»: до четырёх слотов приоритет
    // по умолчанию был индексом в том же списке.
    expect(defaultAbilitySlots(DEFAULT_CLASS.id).filter((id) => id !== null)).toEqual(
      DEFAULT_CLASS.abilityIds.slice(0, ABILITY_SLOTS),
    )
  })

  it('чужое имя в ряду вычищается, а не занимает место', () => {
    const filled = fillAbilitySlots(['gut-rip', null, null, null], DEFAULT_CLASS.id)
    expect(filled).not.toContain('gut-rip')
    expect(filled.filter((id) => id !== null).length).toBeGreaterThan(0)
  })
})

describe('порядок слотов и есть приоритет', () => {
  it('автокаст жмёт первое по ряду, а не по списку данных', () => {
    const s = hero()
    const first = autocastCandidates(s)[0]
    expect(first.id).toBe(abilitiesByPriority(rotationOf(s), true)[0].id)

    // Переставили ряд — сменился и выбор. Другого рычага для этого нет.
    const flipped = { ...s, abilitySlots: [BLOW, QUICK, null, null] }
    expect(autocastCandidates(flipped)[0].id).toBe(BLOW)
  })

  it('умение ВНЕ ряда не участвует ни в автокасте, ни в модели', () => {
    const s = hero()
    const withBlow = estimateCombatRate({ ...s, abilitySlots: [QUICK, BLOW, null, null] }, 'auto')
    const without = estimateCombatRate({ ...s, abilitySlots: [QUICK, null, null, null] }, 'auto')
    // Кнопки нет — значит и урона от неё нет: обещать в расчёте то, чего
    // игрок нажать не может, нельзя.
    expect(without.killsPerSecond.lt(withBlow.killsPerSecond)).toBe(true)
    expect(
      autocastCandidates({ ...s, abilitySlots: [QUICK, null, null, null] }).map((a) => a.id),
    ).not.toContain(BLOW)
  })

  it('оффлайн читает ТОТ ЖЕ ряд', () => {
    // Оффлайн считается по модели автокаста; забудь он про ряд — железное
    // правило «оффлайн <= автокаст» сломалось бы молча.
    const base = hero(12)
    const full = applyOfflineProgress(
      { ...base, abilitySlots: [QUICK, BLOW, null, null] },
      60 * 60 * 1000,
      createRng(1),
    )
    const thin = applyOfflineProgress(
      { ...base, abilitySlots: [QUICK, null, null, null] },
      60 * 60 * 1000,
      createRng(1),
    )
    expect(full.report!.kills.gt(thin.report!.kills)).toBe(true)
  })
})

describe('откаты живут на умении, а не на слоте', () => {
  it('перестановка слотов не сбрасывает откат', () => {
    const used = useAbility(hero(), QUICK, createRng(1), () => {})
    expect(used.abilityCooldownsMs[QUICK]).toBeGreaterThan(0)
    // Меняем местами первый и второй слот — как перетаскиванием в ряду.
    const moved: GameState = {
      ...used,
      abilitySlots: [used.abilitySlots[1], used.abilitySlots[0], ...used.abilitySlots.slice(2)],
    }
    expect(moved.abilityCooldownsMs[QUICK]).toBe(used.abilityCooldownsMs[QUICK])
  })
})

describe('старый сейв', () => {
  it('мигрирует в НЕПУСТУЮ четвёрку и сохраняет порядок игрока', () => {
    const raw = JSON.parse(
      readFileSync(new URL('./__fixtures__/save-v10.json', import.meta.url), 'utf8'),
    )
    const s = stateFromPayload(migrateSave(raw)!)
    expect(s.abilitySlots).toHaveLength(ABILITY_SLOTS)
    expect(s.abilitySlots.filter((id) => id !== null).length).toBeGreaterThan(0)
    // В v10 приоритеты 0/1/2 у «Рваной раны», «Сокрушения», «Скорого выпада».
    expect(s.abilitySlots.slice(0, 3)).toEqual(['rending-wound', BLOW, QUICK])
  })

  it('сейв с пустым рядом всё равно даёт герою кнопки', () => {
    const raw = JSON.parse(
      readFileSync(new URL('./__fixtures__/save-v28.json', import.meta.url), 'utf8'),
    )
    const s = stateFromPayload(migrateSave({ ...raw, abilitySettings: {} })!)
    expect(s.abilitySlots.filter((id) => id !== null).length).toBeGreaterThan(0)
  })
})
