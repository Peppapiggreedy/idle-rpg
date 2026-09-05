// ЭТАЖ — РЯД, И РЯД БЫВАЕТ ИЗ ОДНОГО, ДВУХ И ТРЁХ ТАЛАНТОВ.
//
// Проверка идёт на ВЫДУМАННОЙ ветке нарочно. На настоящих данных сегодня
// лежит по одному таланту на этаж — наполнение приносят стадии 5–7, — и тест
// по ним доказывал бы ровно тот случай, который и так работал. Выдуманная
// ветка проверяет форму: панель обязана уметь рисовать ряд ДО того, как в
// данных появится первая альтернатива.
import { describe, expect, it } from 'vitest'
import { groupFloors, floorsOf } from './talentFloors'
import {
  BRANCHES,
  BRANCH_ROW_STEP,
  TALENTS,
  talentsInBranch,
  type TalentDef,
} from '../data/talents'

/** Талант-заглушка: важны только этаж, порог и порядок. */
function fake(id: string, row: number): TalentDef {
  return {
    id,
    name: id,
    icon: 'talent-honed-edge',
    branch: 'warden-wrath',
    row,
    maxRank: 3,
    requiredPointsInBranch: (row - 1) * BRANCH_ROW_STEP,
    effect: { kind: 'modifiers', mods: [] },
  }
}

describe('ветка раскладывается по этажам', () => {
  it('ряд собирается из одного, двух и трёх талантов', () => {
    const floors = groupFloors([
      fake('один', 1),
      fake('два-а', 2),
      fake('два-б', 2),
      fake('три-а', 3),
      fake('три-б', 3),
      fake('три-в', 3),
    ])
    expect(floors.map((f) => f.talents.length)).toEqual([1, 2, 3])
    // ПУСТЫХ МЕСТ В РЯДУ НЕТ: два таланта значит два, а не два и дырка.
    for (const floor of floors) expect(floor.talents.every(Boolean)).toBe(true)
  })

  it('порядок внутри ряда — тот, что в данных, а не по алфавиту', () => {
    // Порядок слева направо решает автор ветки: у альтернатив он несёт смысл
    // (сперва та, что дешевле по очкам мысли, а не та, что раньше по азбуке).
    const floors = groupFloors([fake('я', 1), fake('а', 1), fake('м', 1)])
    expect(floors[0].talents.map((t) => t.id)).toEqual(['я', 'а', 'м'])
  })

  it('этажи идут по возрастанию, как бы ни лежали записи', () => {
    const floors = groupFloors([fake('третий', 3), fake('первый', 1), fake('второй', 2)])
    expect(floors.map((f) => f.row)).toEqual([1, 2, 3])
  })

  it('порог у ряда ОДИН — это и есть определение этажа', () => {
    const floors = groupFloors([fake('а', 4), fake('б', 4)])
    expect(floors[0].required).toBe(3 * BRANCH_ROW_STEP)
    // Второй порог рядом не хранится: у ряда он единственный по построению,
    // а расхождение ловит content:check ещё в данных.
    expect(Object.keys(floors[0])).toEqual(['row', 'required', 'talents'])
  })
})

describe('настоящие ветки', () => {
  it('каждая ветка каждого класса раскладывается без потерь', () => {
    // Сумма талантов по этажам обязана сойтись со списком ветки: этаж,
    // потерянный группировкой, — это узел, которого игрок не увидит вовсе.
    for (const branch of BRANCHES) {
      const flat = talentsInBranch(branch.id)
      const floors = floorsOf(branch.id)
      expect(floors.flatMap((f) => f.talents).map((t) => t.id)).toEqual(flat.map((t) => t.id))
    }
  })

  it('порог этажа совпадает с порогом каждого таланта в нём', () => {
    for (const branch of BRANCHES) {
      for (const floor of floorsOf(branch.id)) {
        for (const talent of floor.talents) {
          expect(talent.requiredPointsInBranch).toBe(floor.required)
        }
      }
    }
  })

  it('в списке талантов нет записи, не попавшей ни в один этаж', () => {
    const grouped = new Set(BRANCHES.flatMap((b) => floorsOf(b.id).flatMap((f) => f.talents)))
    for (const talent of TALENTS) expect(grouped.has(talent)).toBe(true)
  })
})
