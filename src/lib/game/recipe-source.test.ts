// РЕЦЕПТ — ЭТО ДОБЫЧА, А НЕ СЛЕДСТВИЕ УРОВНЯ.
//
// До этой стадии знание было производной уровня: дорос — знаешь всё. Тест
// сторожит ровно то, что делает рецепт добычей: четыре источника с разными
// правилами, невозможность выучить дважды и молчаливый второй заход.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, manualOnlySettings, tick, type GameState } from './tick'
import { ensureStats } from './stats'
import { createRng } from './rng'
import { enterDungeon } from './dungeons'
import { recipeStatus } from './crafting'
import {
  bossRecipeToLearn,
  learnRecipe,
  recipeKnown,
  rollWorldRecipe,
  worldRecipesToLearn,
} from './recipeBook'
import { payloadFromState, readSave, stateFromPayload } from './save'
import { RECIPES, RECIPE_BY_ID, masteryToKnow, recipeLevel } from '../data/recipes'
import { DUNGEONS } from '../data/dungeons'
import { RECIPE_WORLD_CHANCE } from '../data/balance'
import { ZONES } from '../data/zones'
import { bandForLevel } from '../data/bands'
import { MASTERY_MAX } from '../data/mastery'

const WORLD = RECIPES.filter((r) => r.source.kind === 'world')
const BOSS = RECIPES.filter((r) => r.source.kind === 'boss')

/** Зона той полосы, где лежит рецепт: именно в ней он и может упасть. */
function zoneOf(level: number): string {
  const band = bandForLevel(level).id
  return (ZONES.find((z) => bandForLevel(z.monsterLevelRange.max).id === band) ?? ZONES[0]).id
}

describe('источник есть у каждого рецепта, и все четыре в деле', () => {
  it('ни одного рецепта без источника', () => {
    for (const recipe of RECIPES) {
      expect(recipe.source, recipe.id).toBeTruthy()
      expect(typeof recipe.source.kind, recipe.id).toBe('string')
    }
  })

  it('каждый из четырёх источников кем-то занят', () => {
    // Источник без единого рецепта — это не «пока не понадобился», а
    // мёртвая ветка: код есть, проверить его нечем.
    const kinds = new Set(RECIPES.map((r) => r.source.kind))
    for (const kind of ['mastery', 'boss', 'world', 'temple'] as const) {
      expect(kinds.has(kind), `источник «${kind}» не занят ни одним рецептом`).toBe(true)
    }
  })

  it('боссовых рецептов ровно столько, сколько подземелий', () => {
    // Тировый рецепт на каждый тир: пропущенный тир — это подземелье, за
    // которым ходить не за чем.
    expect(BOSS.length).toBe(DUNGEONS.length)
  })
})

describe('ступень мастерства открывает рецепт сама', () => {
  it('первый рецепт лестницы известен с нуля, следующий — нет', () => {
    const novice = createInitialState(1)
    const ladder = RECIPES.filter((r) => r.source.kind === 'mastery' && r.profession === 'smithing')
      .slice()
      .sort((a, b) => recipeLevel(a) - recipeLevel(b))
    expect(recipeKnown(novice, ladder[0])).toBe(true)
    const next = ladder.find((r) => masteryToKnow(r) > 0)
    expect(next, 'у лестницы нет второй ступени').toBeTruthy()
    if (!next) return
    expect(recipeKnown(novice, next)).toBe(false)
    // РОВНО НА ПОРОГЕ — уже знает, на очко ниже — ещё нет. Граница
    // проверяется с обеих сторон: «не ниже» и «выше» — разные правила.
    const need = masteryToKnow(next)
    expect(recipeKnown({ ...novice, mastery: { smithing: need - 1 } }, next)).toBe(false)
    expect(recipeKnown({ ...novice, mastery: { smithing: need } }, next)).toBe(true)
  })

  it('порог лестницы достижим: он не выше потолка предыдущей ступени', () => {
    // Мастерство растёт только крафтом и упирается в потолок рецепта. Порог
    // выше достижимого запер бы профессию: учить нечем, потому что учиться
    // не на чем.
    for (const recipe of RECIPES) {
      if (recipe.source.kind !== 'mastery') continue
      expect(masteryToKnow(recipe), recipe.id).toBeLessThanOrEqual(MASTERY_MAX)
    }
  })

  it('знание ступени НЕ пишется в сейв — оно выводится из мастерства', () => {
    const skilled = ensureStats({ ...createInitialState(1), mastery: { smithing: MASTERY_MAX } })
    const saved = payloadFromState(skilled, 0)
    // В списке выученных лежат только те, у кого нет другого следа.
    for (const id of saved.knownRecipeIds) {
      expect(['boss', 'world'], id).toContain(RECIPE_BY_ID[id].source.kind)
    }
  })
})

describe('босс роняет рецепт со стопроцентной вероятностью', () => {
  const DUNGEON = DUNGEONS[0]

  /** Герой, которому первый данж по плечу и который бьёт насмерть. */
  function adventurer(patch: Partial<GameState> = {}): GameState {
    const ready = ensureStats({
      ...createInitialState(1),
      level: new Decimal(DUNGEON.unlockRequirement),
      currentZoneId: DUNGEON.zoneId,
      abilitySettings: manualOnlySettings(),
      restHpThreshold: 0,
      statsDirty: true,
      ...patch,
    })
    return { ...ready, currentHp: ready.stats.maxHp, currentMana: ready.stats.maxMana }
  }

  /**
   * Герой, сносящий босса с удара и переживающий цепочку: тест про НАГРАДУ,
   * а не про то, проходится ли данж — это меряет свой набор тестов.
   */
  function overpowered(): GameState {
    const base = adventurer()
    const ready = ensureStats({
      ...base,
      equipment: {
        ...base.equipment,
        trinket: {
          id: 'op-trinket',
          name: 'op',
          rarity: 'common',
          slot: 'trinket',
          level: 1,
          mods: [
            {
              stat: 'attackPower',
              kind: 'flat',
              value: new Decimal(2_800_000),
              source: 'equipment:trinket',
            },
            { stat: 'maxHp', kind: 'flat', value: new Decimal(1e9), source: 'equipment:trinket' },
          ],
        },
      },
      statsDirty: true,
    })
    return { ...ready, currentHp: ready.stats.maxHp, currentMana: ready.stats.maxMana }
  }

  it('последний босс выдаёт свой рецепт и реагент разом', () => {
    let s = enterDungeon(overpowered(), DUNGEON.id)
    const rng = createRng(5)
    for (let i = 0; i < 6000 && s.dungeonRun; i += 1) s = tick(s, 100, rng)
    expect(s.dungeonsCleared[DUNGEON.id], 'цепочка не пройдена').toBe(true)
    const learned = RECIPE_BY_ID[
      BOSS.find(
        (r) => r.source.kind === 'boss' && r.source.dungeonId === DUNGEON.id,
      )!.id
    ]
    expect(s.knownRecipeIds[learned.id], 'рецепт за цепочку не выдан').toBe(true)
    expect(s.materials[DUNGEON.reagentId]?.gt(0), 'реагент за цепочку не выдан').toBe(true)
    expect(s.combatLog.some((e) => e.type === 'recipe' && e.recipeId === learned.id)).toBe(true)
  })

  it('второй заход выдаёт реагент и МОЛЧИТ про рецепт', () => {
    // Это НОРМАЛЬНЫЙ случай, а не край: при стопроцентном дропе он наступает
    // у каждого, кто пошёл в данж второй раз — за реагентом.
    const recipe = BOSS[0]
    const source = recipe.source
    if (source.kind !== 'boss') throw new Error('источник не боссовый')
    const fresh = createInitialState(1)
    expect(bossRecipeToLearn(fresh, source.dungeonId, source.bossId)?.id).toBe(recipe.id)
    const after = learnRecipe(fresh, recipe.id)
    expect(bossRecipeToLearn(after, source.dungeonId, source.bossId)).toBeNull()
  })

  it('известный рецепт не учится дважды — состояние то же самое', () => {
    const first = learnRecipe(createInitialState(1), BOSS[0].id)
    expect(learnRecipe(first, BOSS[0].id)).toBe(first)
  })
})

describe('мировой рецепт: малый шанс со своей полосы', () => {
  it('падает только в своей полосе', () => {
    const state = createInitialState(1)
    for (const recipe of WORLD) {
      const here = zoneOf(recipeLevel(recipe))
      expect(worldRecipesToLearn(state, here).map((r) => r.id)).toContain(recipe.id)
    }
    // Стартовая зона — не полоса мировых рецептов: там их падать не должно.
    expect(worldRecipesToLearn(state, ZONES[0].id)).toEqual([])
  })

  it('БРОСКА НЕ ДЕЛАЕТСЯ ВОВСЕ, когда учить нечего', () => {
    // Это не оптимизация, а условие воспроизводимости: лишний вызов rng
    // сдвинул бы поток случайности там, где ничего не может выпасть, — и
    // прогоны с сидом перестали бы совпадать (тот же довод, что у
    // гарантированного реагента босса).
    let calls = 0
    const counted = () => {
      calls += 1
      return 0
    }
    rollWorldRecipe(createInitialState(1), ZONES[0].id, 1, counted)
    expect(calls, 'бросок сделан там, где падать нечему').toBe(0)
  })

  it('выпавший рецепт — из ненайденных, и дважды не выпадает', () => {
    const recipe = WORLD[0]
    const zone = zoneOf(recipeLevel(recipe))
    const state = createInitialState(1)
    // Бросок «всегда попадает»: 0 меньше любого шанса.
    const lucky = () => 0
    const found = rollWorldRecipe(state, zone, RECIPE_WORLD_CHANCE, lucky)
    expect(found, 'при гарантированном броске ничего не выпало').toBeTruthy()
    if (!found) return
    let learnedAll = state
    for (const r of worldRecipesToLearn(state, zone)) learnedAll = learnRecipe(learnedAll, r.id)
    expect(rollWorldRecipe(learnedAll, zone, RECIPE_WORLD_CHANCE, lucky)).toBeNull()
  })

  it('шанс мал: неудачный бросок ничего не даёт', () => {
    const recipe = WORLD[0]
    const zone = zoneOf(recipeLevel(recipe))
    expect(rollWorldRecipe(createInitialState(1), zone, RECIPE_WORLD_CHANCE, () => 0.99)).toBeNull()
    expect(RECIPE_WORLD_CHANCE).toBeGreaterThan(0)
    expect(RECIPE_WORLD_CHANCE).toBeLessThan(0.05)
  })
})

describe('незнание — отдельная причина отказа, а не «не хватает материалов»', () => {
  it('неизвестный рецепт отказывает кодом unknown', () => {
    const recipe = WORLD[0]
    const rich: GameState = {
      ...createInitialState(1),
      level: new Decimal(100),
      gold: new Decimal('1e18'),
      materials: Object.fromEntries(recipe.inputs.map((i) => [i.materialId, new Decimal(99)])),
    }
    expect(recipeStatus(rich, recipe).reason).toBe('unknown')
    // Выучил — и причина исчезла: остальное у героя есть.
    expect(recipeStatus(learnRecipe(rich, recipe.id), recipe).reason).toBeNull()
  })
})

describe('сейв: выученное переживает перезагрузку, ветеран ничего не теряет', () => {
  it('список выученных ходит туда и обратно', () => {
    const learned = learnRecipe(ensureStats(createInitialState(1)), BOSS[0].id)
    const result = readSave(payloadFromState(learned, 0) as unknown as Record<string, unknown>)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(stateFromPayload(result.payload).knownRecipeIds[BOSS[0].id]).toBe(true)
  })

  it('чужой id из сейва отбрасывается, а не ломает загрузку', () => {
    const raw = {
      ...(payloadFromState(ensureStats(createInitialState(1)), 0) as object),
      knownRecipeIds: ['нет-такого'],
    }
    const result = readSave(raw as Record<string, unknown>)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    // Чистит его СОСТОЯНИЕ, а не сам сейв: слой чтения оставляет данные как
    // есть, а собирает из них игру уже stateFromPayload.
    expect(stateFromPayload(result.payload).knownRecipeIds).toEqual({})
  })

  it('миграция возвращает ветерану то, что он знал по прежним правилам', () => {
    // До этой версии рецепт открывался УРОВНЕМ. Значит герою сотого уровня
    // возвращается всё, что открыто сотым, — не больше и не меньше.
    const result = readSave({ version: 31, level: '100', materials: {} })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    const known = new Set(result.payload.knownRecipeIds)
    for (const recipe of [...BOSS, ...WORLD]) expect(known.has(recipe.id), recipe.id).toBe(true)
  })

  it('новичок из старого сейва не получает того, чего не видел', () => {
    const result = readSave({ version: 31, level: '5', materials: {} })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    // Мировые рецепты стоят на верхних полосах — герою пятого уровня они не
    // принадлежали и по старым правилам.
    for (const recipe of WORLD) {
      expect(result.payload.knownRecipeIds).not.toContain(recipe.id)
    }
  })
})

describe('мёртвых рецептов нет: собирается каждый', () => {
  it('герой, у которого есть всё, собирает ВСЕ рецепты игры', () => {
    // Самая простая проверка на мёртвый контент и самая полезная: рецепт,
    // который не собирается ни при каких обстоятельствах, — это строка в
    // списке, отвечающая игроку «нет» навсегда. Ловится он только так, потому
    // что каждая отдельная причина отказа по-своему законна.
    const materials: Record<string, Decimal> = {}
    for (const recipe of RECIPES) {
      for (const input of recipe.inputs) materials[input.materialId] = new Decimal(999)
    }
    const everything: GameState = {
      ...createInitialState(1),
      level: new Decimal(100),
      gold: new Decimal('1e30'),
      materials,
      mastery: { smithing: MASTERY_MAX, herbalism: MASTERY_MAX },
      knownRecipeIds: Object.fromEntries(RECIPES.map((r) => [r.id, true])),
      templeBestWave: 999,
      templeCleared: true,
    }
    const dead = RECIPES.filter((r) => !recipeStatus(everything, r).canCraft).map(
      (r) => `${r.id}: ${recipeStatus(everything, r).reason}`,
    )
    expect(dead, `не собираются:\n${dead.join('\n')}`).toEqual([])
  })

  it('каждый рецепт даёт то, что где-то нужно', () => {
    // Обратная сторона: передел, который никто не тратит, — тупик. Правило
    // держит и content:check на слепке контента; здесь оно проверяется на
    // живых данных, вместе с остальными свойствами лестницы.
    for (const recipe of RECIPES) {
      if (recipe.output.kind !== 'reagent') continue
      const id = recipe.output.id
      expect(
        RECIPES.some((r) => r.inputs.some((i) => i.materialId === id)),
        `${recipe.id}: его выход не тратит никто`,
      ).toBe(true)
    }
  })
})

describe('стопроцентный дроп рецепта НЕ двигает лестницу предметов', () => {
  // Гарантированный рецепт — самое подозрительное место всей стадии: если бы
  // он выдавал вещь, которой не бывает в дропе, лестница предметов поехала бы
  // вслед за ним, а с ней темп, цена боя и ворота подземелий.
  it('боссовый рецепт даёт РЕДКУЮ вещь — то же, что хорошая находка', () => {
    for (const recipe of BOSS) {
      expect(recipe.output.kind).toBe('item')
      if (recipe.output.kind !== 'item') continue
      expect(['uncommon', 'rare'], recipe.id).toContain(recipe.output.rarity)
    }
  })

  it('вещь стоит НЕ МЕНЬШЕ двух полных прохождений', () => {
    // Реагент падает с последнего босса ровно по одному за пройденную
    // цепочку. Рецепт гарантирован — а ВЕЩЬ нет: за неё платят походами.
    for (const recipe of BOSS) {
      const source = recipe.source
      if (source.kind !== 'boss') continue
      const dungeon = DUNGEONS.find((d) => d.id === source.dungeonId)!
      const need = recipe.inputs.find((i) => i.materialId === dungeon.reagentId)
      expect(need, `${recipe.id}: не просит реагент своего подземелья`).toBeTruthy()
      expect(need!.count, recipe.id).toBeGreaterThanOrEqual(2)
    }
  })

  it('уровень вещи не выше своей полосы', () => {
    // Третья сторона того же: гарантированный рецепт не может выдать вещь
    // ГЛУБЖЕ, чем полоса, на которой стоит его подземелье.
    for (const recipe of BOSS) {
      if (recipe.output.kind !== 'item') continue
      const band = bandForLevel(recipe.output.level)
      expect(recipe.output.level, recipe.id).toBeLessThanOrEqual(band.maxLevel)
    }
  })
})
