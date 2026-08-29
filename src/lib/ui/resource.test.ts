import { describe, expect, it } from 'vitest'
import { CLASSES } from '../data/classes'
import { resourceKindName, resourceWords } from './resource'
import { abilityReasonText } from './abilityText'

describe('имя ресурса', () => {
  it('у стража мана, у изувера ярость', () => {
    expect(resourceWords('warden').name).toBe('Мана')
    expect(resourceWords('warden').genitive).toBe('маны')
    expect(resourceWords('warden').accusative).toBe('ману')
    expect(resourceWords('reaver').name).toBe('Ярость')
    expect(resourceWords('reaver').genitive).toBe('ярости')
    expect(resourceWords('reaver').accusative).toBe('ярость')
  })

  // Отличие ресурса боя от ресурса времени берётся из ДАННЫХ, а не из имени
  // класса: подпись «копится от ударов» появляется у любого класса, у
  // которого удары что-то дают.
  it('«копится от ударов» читается из чисел ресурса, а не из id класса', () => {
    expect(resourceWords('warden').fromCombat).toBe(false)
    expect(resourceWords('reaver').fromCombat).toBe(true)
  })

  it('у каждого класса есть слова для его ресурса', () => {
    for (const hero of CLASSES) {
      expect(resourceKindName(hero.resource.kind)).not.toBe(hero.resource.kind)
      expect(resourceWords(hero.id).genitive).not.toBe('')
    }
  })

  // Сейв без класса (или с неизвестным) не должен ломать интерфейс.
  it('незнакомый класс откатывается к мане', () => {
    expect(resourceWords(undefined).name).toBe('Мана')
    expect(resourceWords('нет такого').name).toBe('Мана')
  })
})

describe('причина отказа умения', () => {
  // Причина «не хватает ресурса» — единственная, которая зависит от класса.
  it('называет ресурс класса, а не ману всегда', () => {
    expect(abilityReasonText('no-mana', resourceWords('warden'))).toBe('Не хватает маны')
    expect(abilityReasonText('no-mana', resourceWords('reaver'))).toBe('Не хватает ярости')
  })

  it('остальные причины от класса не зависят', () => {
    for (const reason of ['dead', 'cooldown', 'gcd'] as const) {
      expect(abilityReasonText(reason, resourceWords('warden'))).toBe(
        abilityReasonText(reason, resourceWords('reaver')),
      )
    }
  })

  it('«заперто» называет уровень разблокировки', () => {
    expect(abilityReasonText('locked', resourceWords('warden'), 4)).toBe('Откроется на 4 уровне')
  })
})
