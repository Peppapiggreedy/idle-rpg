// Фикстуры реальных сейвов всех версий формата: миграции обязаны привести
// каждую к текущей версии, не потеряв прогресс.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Decimal } from '../numbers'
import { createInitialState, defaultAbilitySettings, type GameState } from '../tick'
import { ensureStats } from '../stats'
import { expectedSwingDamage } from '../combat'
import { SAFE_ZONE, ZONE_BY_ID } from '../../data/zones'
import { ABILITY_BY_ID } from '../../data/abilities'
import {
  GCD_MS,
  INVENTORY_SIZE,
  REST_HP_THRESHOLD_DEFAULT,
  VIT_BLOCK_VALUE,
  itemLevelScale,
} from '../../data/balance'
import { TALENT_BY_ID } from '../../data/talents'
import { availablePoints, earnedPoints, spentPoints } from '../talents'
import { clearedXpBonus } from '../dungeons'
import { DUNGEONS } from '../../data/dungeons'
import {
  SAVE_KEY,
  SAVE_VERSION,
  decodeSaveString,
  encodeSaveString,
  loadGame,
  MIGRATIONS,
  migrateSave,
  stateFromPayload,
  type SaveStorage,
} from '../save'
import { CLASS_BY_ID, DEFAULT_CLASS, classById } from '../../data/classes'
import { TEMPLE, recipeUnlocked } from '../../data/temple'
import { materialCount } from '../crafting'

function fixture(name: string): string {
  return readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), 'utf8')
}

function storageWith(raw: string): SaveStorage {
  const data = new Map<string, string>([[SAVE_KEY, raw]])
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

function loadFixture(name: string): GameState {
  const result = loadGame({ storage: storageWith(fixture(name)), now: () => 0 })
  expect(result.kind).toBe('loaded')
  if (result.kind !== 'loaded') throw new Error('unreachable')
  return result.state
}


// Средний удар героя после сноса заточки: оружие + вклад силы атаки. Сила
// атаки = 70 базовых + 2 за каждую единицу силы (по единице за уровень);
// вклад нормализован скоростью оружия (AP_NORMALIZATION = 14).
function apSwing(level: number, weaponAvg = 10, weaponSpeed = 2, extraAp = 0, apMult = 1): number {
  const ap = (70 + 2 * (level - 1) + extraAp) * apMult
  return weaponAvg + (ap * weaponSpeed) / 14
}

/**
 * СПИСОК ФИКСТУР СТРОИТСЯ ИЗ ПАПКИ, а не переписывается руками.
 *
 * Здесь стояли двадцать одна строка `['save-vN.json']`, и соответствие
 * «на каждую версию формата — своя фикстура» держалось на внимательности.
 * Следующая миграция могла приехать без фикстуры: тесты зелёные, а ошибка в
 * поле, которого нет в синтетическом объекте `{ version: N }`, но есть в
 * настоящем сейве, уехала бы ко всем игрокам.
 *
 * Обход папки в проекте уже применяется — render2d.test.ts и kit.test.ts.
 */
const VERSIONED = /^save-v(\d+)\.json$/

function versionedFixtures(): Array<[string, number]> {
  return readdirSync(new URL('../__fixtures__/', import.meta.url))
    .map((name) => [name, VERSIONED.exec(name)] as const)
    .filter(([, m]) => m !== null)
    .map(([name, m]) => [name, Number(m![1])] as [string, number])
    .sort((a, b) => a[1] - b[1])
}

describe('фикстуры сейвов', () => {
  it('фикстур ровно столько, сколько версий формата', () => {
    // Именно РОВНО: и дыра, и лишний файл одинаково означают, что список
    // разъехался с миграциями.
    const versions = versionedFixtures().map(([, v]) => v)
    expect(versions).toEqual(Array.from({ length: SAVE_VERSION }, (_, i) => i))
  })

  it.each(versionedFixtures().map(([name]) => [name]))(
    '%s мигрирует до текущей версии',
    (name) => {
      const payload = migrateSave(JSON.parse(fixture(name)))
      expect(payload).not.toBeNull()
      expect(payload!.version).toBe(SAVE_VERSION)
    },
  )

  // ЭТОТ ТЕСТ ПОЯВИЛСЯ ИЗ ПОЛОМКИ. Проверки «дошло до текущей версии» мало:
  // миграция 14-й версии возвращала сразу version: 17 и перепрыгивала через
  // 15→16 (классы) и 16→17 (материалы). Номер сходился, а поля не появлялись —
  // старый герой оставался без classId и без мешка, и держалось всё это на
  // запасных значениях в stateFromPayload.
  it('каждая миграция поднимает ровно на одну версию', () => {
    for (const [from, migrate] of Object.entries(MIGRATIONS)) {
      const version = Number(from)
      const next = migrate({ version } as never)
      expect(next.version, `миграция ${version}`).toBe(version + 1)
    }
  })

  // И то же самое по сути, но на настоящих данных: поля, которые добавляют
  // поздние миграции, обязаны появиться у сейва любой давности.
  it.each([['save-v13.json'], ['save-v14.json'], ['save-v15.json']])(
    '%s получает и класс, и мешок материалов',
    (name) => {
      const payload = migrateSave(JSON.parse(fixture(name)))!
      expect(CLASS_BY_ID[payload.classId]).toBeDefined()
      expect(payload.materials).toBeDefined()
    },
  )

  it('save-v20 -> v21: кулдаун храма снесён, рекорд сохранён', () => {
    // ПРАВИЛО ИЗМЕНИЛОСЬ ОСОЗНАННО: попытки в сутки больше нет, награду
    // выдают этажи выше рекорда. Отметка последнего забега поэтому просто
    // выбрасывается.
    //
    // А вот РЕКОРД сохраняется, хотя постановка говорила «рекорд 0». В 20-й
    // версии templeBestWave значил ровно то же самое — «максимальный
    // полностью пройденный этаж», — и им же открыты рецепты рубежей.
    // Обнулить его значило бы отобрать у ветерана храма уже открытые
    // рецепты, то есть потерять прогресс.
    const raw = JSON.parse(fixture('save-v20.json'))
    expect(raw.templeLastRunAtMs).toBeGreaterThan(0)
    const payload = migrateSave(raw)!
    expect(payload.version).toBe(SAVE_VERSION)
    expect('templeLastRunAtMs' in payload).toBe(false)
    expect(payload.templeBestWave).toBe(7)
    expect(payload.templeCleared).toBe(false)

    const state = loadFixture('save-v20.json')
    expect(state.templeBestWave).toBe(7)
    expect(state.templeCleared).toBe(false)
    // Забег из сейва расформирован общим правилом, и НЕ засчитан: рекорд
    // остался прежним, хотя в забеге стоял третий этаж.
    expect(state.templeRun).toBeNull()
    expect(state.gold.toNumber()).toBeGreaterThan(0)
  })

  it('save-v20 -> v21: уже испорченный сейв чинится, зачистка возвращается', () => {
    // РАЗОВАЯ ПОЧИНКА (находка 2.1). У всех, кто успел загрузиться со
    // сломанной сборкой, в сейве лежит рекорд на потолке и стёртый флаг
    // зачистки. Сама игра вернуть флаг не может: платят только этажи ВЫШЕ
    // рекорда, а рекорд уже максимальный, — поэтому рецепт «Венец испытаний»
    // остался бы запертым навсегда даже после исправления версии.
    const raw = JSON.parse(fixture('save-v20-temple-cleared.json'))
    expect(raw.templeBestWave).toBe(TEMPLE.floors)
    expect(raw.templeCleared).toBe(false)

    const payload = migrateSave(raw)!
    expect(payload.version).toBe(SAVE_VERSION)
    // Достигнутый потолок рекорда — доказательство того, что зачистка была.
    expect(payload.templeCleared).toBe(true)
    expect(payload.templeBestWave).toBe(TEMPLE.floors)

    const state = loadFixture('save-v20-temple-cleared.json')
    expect(state.templeCleared).toBe(true)
    // И рецепт снова доступен — ради этого всё и делалось.
    expect(recipeUnlocked(TEMPLE.clearReward.recipeId, state.templeBestWave, state.templeCleared))
      .toBe(true)
    // Токен на месте: поломка стирала только флаг, мешок она не трогала.
    expect(materialCount(state, TEMPLE.clearReward.materialId).toNumber()).toBe(1)
  })

  it('save-v20 -> v21: неполный рекорд зачистку НЕ выдаёт', () => {
    // Обратная сторона той же починки: она обязана срабатывать ровно на
    // потолке и ни этажом ниже, иначе превратится в раздачу уникального
    // рецепта всем подряд.
    const raw = JSON.parse(fixture('save-v20-temple-cleared.json'))
    raw.templeBestWave = TEMPLE.floors - 1
    expect(migrateSave(raw)!.templeCleared).toBe(false)
  })

  it('save-v20 -> v21: уже поднятый флаг зачистки переживает миграцию', () => {
    // Сейв, записанный сломанной сборкой ДО первой перезагрузки: номер 20,
    // но флаг уже true. Безусловное `false` в миграции стирало именно его.
    const raw = JSON.parse(fixture('save-v20.json'))
    raw.templeCleared = true
    expect(migrateSave(raw)!.templeCleared).toBe(true)
  })

  it('save-v23 -> v24: порог привала по ресурсу выброшен, остальное цело', () => {
    // Поле не имело интерфейса и у всех стояло в нуле; фикстура несёт
    // ненулевое значение нарочно — иначе тест не отличил бы «выброшено»
    // от «сброшено в ноль по умолчанию».
    const raw = JSON.parse(fixture('save-v23.json'))
    expect(raw.restResourceThreshold).toBe(0.2)
    const payload = migrateSave(raw)!
    expect(payload.version).toBe(SAVE_VERSION)
    expect('restResourceThreshold' in payload).toBe(false)
    // Порог по HP — настройка игрока, и она на месте.
    expect(payload.restHpThreshold).toBe(0.4)

    const state = loadFixture('save-v23.json')
    expect(state.restHpThreshold).toBe(0.4)
    // Прогресс не тронут: миграция — про одно мёртвое поле, а не про героя.
    expect(state.level.toNumber()).toBe(28)
    expect(state.gold.toString()).toBe('760000')
    // Забег по храму расформирован общим правилом, рекорд цел.
    expect(state.templeRun).toBeNull()
    expect(state.templeBestWave).toBe(7)
  })

  it('save-v24 -> v25: резерв маны под лечение включён, остальное цело', () => {
    const payload = migrateSave(JSON.parse(fixture('save-v24.json')))!
    expect(payload.version).toBe(SAVE_VERSION)
    expect(payload.holdManaForHeal).toBe(true)
    const state = loadFixture('save-v24.json')
    expect(state.holdManaForHeal).toBe(true)
    // Прогресс не тронут: уровень и золото те же, что лежали в файле.
    const raw = JSON.parse(fixture('save-v24.json'))
    expect(state.level.toString()).toBe(String(raw.level))
    expect(state.gold.toString()).toBe(String(raw.gold))
  })

  it('save-v19 -> v20: незаконная связка рук расформирована', () => {
    // В 19-й версии хвата не было: оружие несло hands, а щит не был отмечен
    // никак. Формат просто не умел сказать «так нельзя» — и сейв мог нести
    // двуручное вместе с занятой второй рукой. Здесь оно и расходится.
    const state = loadFixture('save-v19.json')
    expect(state.equipment.mainHand?.grip).toBe('two')
    // Вторая рука освобождена, а снятое НЕ ПОТЕРЯНО — оно в сумке.
    expect(state.equipment.offHand).toBeNull()
    expect(state.inventory.map((i) => i.id)).toContain('item-2')
    // Хват проставлен всем, кто идёт в руки, и щит опознан щитом — по своим
    // модификаторам, а не по слоту, в котором он лежал.
    const shield = state.inventory.find((i) => i.id === 'item-4')
    expect(shield?.grip).toBe('shield')
    const oneHanded = state.inventory.find((i) => i.id === 'item-3')
    expect(oneHanded?.grip).toBe('one')
    // Брони правила рук не касаются: хвата у неё нет вовсе.
    expect(state.inventory.find((i) => i.slot === 'chest')?.grip).toBeUndefined()
    // Прогресс не тронут: расформирование — про руки, а не про героя.
    expect(state.level.toNumber()).toBe(28)
    expect(state.gold.toString()).toBe('760000')
  })

  it('save-v19 -> v20: щит из главной руки уходит в сумку', () => {
    // Второй вид незаконной связки. Фикстура несёт первый (одна пара рук —
    // одна связка), поэтому этот случай собираем поверх неё точечно.
    const raw = JSON.parse(fixture('save-v19.json'))
    raw.equipment.mainHand = raw.inventory.find((i: { id: string }) => i.id === 'item-4')
    raw.equipment.mainHand.slot = 'mainHand'
    raw.equipment.offHand = null
    raw.inventory = raw.inventory.filter((i: { id: string }) => i.id !== 'item-4')
    const payload = migrateSave(raw)!
    expect(payload.version).toBe(SAVE_VERSION)
    expect(payload.equipment.mainHand).toBeNull()
    expect(payload.inventory.map((i) => i.id)).toContain('item-4')
    expect(payload.inventory.find((i) => i.id === 'item-4')?.grip).toBe('shield')
  })

  it('save-v19 -> v20: снятому некуда лечь — оно уходит в золото по цене', () => {
    // Действующее правило вытеснения: если сумка полна, в золото уходит
    // самый дешёвый из претендентов. Полной мерой ценности здесь
    // воспользоваться нельзя — состояния игры до миграции ещё нет.
    const raw = JSON.parse(fixture('save-v19.json'))
    const cheap = { ...raw.inventory[0], rarity: 'common' }
    raw.inventory = Array.from({ length: INVENTORY_SIZE }, (_, i) => ({
      ...cheap,
      id: `filler-${i}`,
    }))
    const before = Number(raw.gold)
    const payload = migrateSave(raw)!
    expect(payload.inventory).toHaveLength(INVENTORY_SIZE)
    // Снятая вторая рука ценнее наполнителя, поэтому в сумку попала она.
    expect(payload.inventory.map((i) => i.id)).toContain('item-2')
    expect(Number(payload.gold)).toBeGreaterThan(before)
  })

  it('save-v17 -> v18: заточка снесена, вещи получили уровень своей зоны', () => {
    // Сила ветерана переезжает в вещи: каждый предмет получает уровень мобов
    // зоны, где герой фармил (mirefen-hollows, полоса 16-20 — середина 18).
    // Голое level=1 обесценило бы весь его шкаф разом.
    const raw = JSON.parse(fixture('save-v17.json'))
    expect(raw.upgrades['weapon-sharpening']).toBe('18')
    const payload = migrateSave(raw)!
    expect('upgrades' in payload).toBe(false)
    for (const item of payload.inventory) expect(item.level).toBe(18)
    expect(payload.equipment.mainHand?.level).toBe(18)
    // Числа вещей домножены на масштаб уровня, как у честного дропа: без
    // этого ветеран остался бы со старыми слабыми вещами и без заточки.
    const chestAp = payload.equipment.chest!.mods.find((m) => m.stat === 'attackPower')!
    expect(Number(chestAp.value)).toBeCloseTo(7 * 3.72, 9) // itemLevelScale(18).toNumber()
    const speed = payload.equipment.mainHand!.mods.find((m) => m.stat === 'weaponSpeed')!
    expect(Number(speed.value)).toBe(3.4) // скорость НЕ растёт
    const s = loadFixture('save-v17.json')
    expect(s.equipment.mainHand?.level).toBe(18)
  })

  it('save-v0: доверсионные поля (xp, damagePerSecond) не потеряны', () => {
    const s = loadFixture('save-v0.json')
    expect(s.gold.toNumber()).toBe(150)
    expect(s.level.toNumber()).toBe(4)
    // Абсолютное число опыта пересчитала миграция v19 под новую кривую:
    // сохраняется ДОЛЯ пройденного уровня (старая кривая: 40 * 4^1.5 = 320).
    expect(s.currentXp.div(s.xpToNext).toNumber()).toBeCloseTo(11 / 320, 2)
    // Заточки v0 снесла миграция v18; остались база и сила с уровней.
    expect(expectedSwingDamage(s.stats).toNumber()).toBeCloseTo(apSwing(4), 9)
  })

  it('save-v1: прогресс не потерян, инвентарь пуст', () => {
    const s = loadFixture('save-v1.json')
    expect(s.gold.toNumber()).toBe(77)
    expect(s.level.toNumber()).toBe(5)
    expect(s.currentXp.toNumber()).toBe(3)
    // Заточку снесла миграция v18: компенсация приходит уровнем вещей,
    // а у v1 вещей не было вовсе — остались база и сила с уровней.
    expect(expectedSwingDamage(s.stats).toNumber()).toBeCloseTo(apSwing(5), 9)
    expect(s.inventory).toEqual([])
  })

  it('save-v2: после сноса заточки урон считается из уровня и вещей', () => {
    const s = loadFixture('save-v2.json')
    expect(expectedSwingDamage(s.stats).toNumber()).toBeCloseTo(apSwing(9), 9)
  })

  it('save-v3: урон восстанавливается пересчётом из источников', () => {
    const s = loadFixture('save-v3.json')
    expect(s.gold.toNumber()).toBe(900)
    expect(expectedSwingDamage(s.stats).toNumber()).toBeCloseTo(apSwing(12), 9)
    expect(s.inventory[0].rarity).toBe('rare')
  })

  it('save-v4: загружается, статы пересчитаны из источников', () => {
    const s = loadFixture('save-v4.json')
    expect(s.gold.toNumber()).toBe(1200)
    expect(expectedSwingDamage(s.stats).toNumber()).toBeCloseTo(apSwing(15), 9)
    expect(s.statsDirty).toBe(false)
  })

  it('save-v2: инвентарь и счётчики не потеряны', () => {
    const s = loadFixture('save-v2.json')
    expect(s.gold.toNumber()).toBe(500)
    expect(s.level.toNumber()).toBe(9)
    expect(s.inventory.length).toBe(2)
    expect(s.inventory[0].name).toBe('Звёздный Палаш')
    expect(s.inventory[0].rarity).toBe('epic')
    expect(s.itemSeq).toBe(2)
    expect(s.totalTicks.toNumber()).toBe(5000)
  })

  it('save-v6 -> v7: statBonus превращается в модификатор силы атаки', () => {
    const raw = JSON.parse(fixture('save-v6.json'))
    const s = loadFixture('save-v6.json')
    const item = s.inventory[0]
    expect(item.name).toBe('Закалённый Кастет')
    expect(item.slot).toBe('trinket') // слот без base — база боя не подменяется
    expect(item.mods).toHaveLength(1)
    expect(item.mods[0]).toMatchObject({ stat: 'attackPower', kind: 'flat' })
    // Миграция v18 даёт вещи уровень середины полосы зоны (v6 просыпается в
    // безопасной, полоса 1–5 → уровень 3) и домножает статы на масштаб уровня.
    expect(item.mods[0].value.toNumber()).toBeCloseTo(
      Number(raw.inventory[0].statBonus) * itemLevelScale(3).toNumber(),
      9,
    )
    // Экипировки в v6 не было: предмет ждёт в инвентаре, слоты пусты.
    expect(Object.values(s.equipment).every((i) => i === null)).toBe(true)
  })

  it('save-v7 -> v8: старый сейв просыпается в безопасной зоне', () => {
    const s = loadFixture('save-v7.json')
    expect(s.currentZoneId).toBe(SAFE_ZONE.id)
    // Выживать ещё негде: смерть вернёт в ту же безопасную зону.
    expect(s.lastSurvivedZoneId).toBeNull()
    expect(SAFE_ZONE.monsterPool.map((a) => a.id)).toContain(s.monster.id)
    // Прогресс не потерян.
    expect(s.gold.toNumber()).toBe(9000)
    expect(s.equipment.mainHand?.name).toBe('Закалённый Крушитель')
  })

  it('save-v8: зона восстанавливается, моб берётся из её пула', () => {
    const s = loadFixture('save-v8.json')
    expect(s.currentZoneId).toBe('hollow-quarry')
    expect(s.lastSurvivedZoneId).toBe('hollow-quarry')
    const pool = ZONE_BY_ID['hollow-quarry'].monsterPool.map((a) => a.id)
    expect(pool).toContain(s.monster.id)
    // Границы берём из данных: диапазон уровней зоны — это баланс, а тест
    // здесь про то, что моб пришёл ИЗ ЗОНЫ, а не про конкретные числа.
    const range = ZONE_BY_ID['hollow-quarry'].monsterLevelRange
    expect(s.monster.level).toBeGreaterThanOrEqual(range.min)
    expect(s.monster.level).toBeLessThanOrEqual(range.max)
    expect(s.gold.toNumber()).toBe(24000)
  })

  it('save-v8 -> v9: старый сейв просыпается с готовыми умениями', () => {
    const s = loadFixture('save-v8.json')
    expect(s.gcdMsLeft).toBe(0)
    expect(s.abilityCooldownsMs).toEqual({})
    expect(s.queuedAbilityId).toBeNull()
    expect(s.gold.toNumber()).toBe(24000) // прогресс не потерян
  })

  it('save-v9: кулдауны и мана переживают загрузку', () => {
    const s = loadFixture('save-v9.json')
    expect(s.gcdMsLeft).toBe(900)
    expect(s.abilityCooldownsMs['quick-strike']).toBe(1200)
    expect(s.abilityCooldownsMs['shattering-blow']).toBe(9000)
    expect(s.currentMana.toNumber()).toBe(42)
    // Очередь и эффекты висели на прежнем мобе — при загрузке их нет.
    expect(s.queuedAbilityId).toBeNull()
    expect(s.activeEffects).toEqual([])
  })

  it('save-v9 -> v10: старый сейв получает настройки автокаста по умолчанию', () => {
    const s = loadFixture('save-v9.json')
    expect(s.abilitySettings).toEqual(defaultAbilitySettings())
    expect(s.currentMana.toNumber()).toBe(42) // прогресс не потерян
  })

  it('мусорные кулдауны из сейва отбрасываются и не запирают кнопку', () => {
    const raw = JSON.parse(fixture('save-v9.json'))
    const s = stateFromPayload(
      migrateSave({
        ...raw,
        gcdMsLeft: 1e9,
        abilityCooldownsMs: {
          'quick-strike': 1e9, // больше своего кулдауна
          'ability-from-the-future': 5000, // умения с таким id нет
          'rending-wound': -5, // мусор
        },
      })!,
    )
    expect(s.gcdMsLeft).toBe(GCD_MS)
    expect(s.abilityCooldownsMs['quick-strike']).toBe(
      ABILITY_BY_ID['quick-strike'].cooldownSec * 1000,
    )
    expect(s.abilityCooldownsMs['ability-from-the-future']).toBeUndefined()
    expect(s.abilityCooldownsMs['rending-wound']).toBeUndefined()
  })

  it('save-v10: настройки автокаста переживают загрузку', () => {
    const s = loadFixture('save-v10.json')
    expect(s.abilitySettings['rending-wound'].autocast).toBe(false)
    expect(s.abilitySettings['rending-wound'].priority).toBe(0)
    expect(s.abilitySettings['quick-strike'].priority).toBe(2)
    expect(s.gold.toNumber()).toBe(140000)
  })

  it('умение без настройки в сейве добирается дефолтом', () => {
    const raw = JSON.parse(fixture('save-v10.json'))
    const s = stateFromPayload(
      migrateSave({ ...raw, abilitySettings: { 'quick-strike': { autocast: false, priority: 5 } } })!,
    )
    // Резерв появился позже галки и приоритета: в старом сейве его нет,
    // и ноль — то самое поведение, к которому игрок привык.
    expect(s.abilitySettings['quick-strike']).toEqual({
      autocast: false,
      priority: 5,
      reserve: 0,
    })
    // Остальные умения получили дефолтные настройки, а не исчезли.
    expect(s.abilitySettings['rending-wound']).toBeDefined()
    expect(s.abilitySettings['shattering-blow']).toBeDefined()
  })

  it('save-v12 -> v13: старый сейв просыпается с нулевым резервом и живым регеном', () => {
    // Правило задержки регенерации появилось в v13. Герой из v12 про резерв
    // ничего не знал: ноль — ровно то поведение, к которому он привык, а
    // пауза до старта восстановления у него не тикала, значит её и нет.
    const s = loadFixture('save-v12.json')
    for (const ability of Object.values(s.abilitySettings)) {
      expect(ability.reserve).toBe(0)
    }
    expect(s.regenDelayMsLeft).toBe(0)
    expect(s.gold.toNumber()).toBeGreaterThan(0) // прогресс не потерян
  })

  it('save-v13: резерв и пауза регенерации переживают загрузку', () => {
    const s = loadFixture('save-v13.json')
    expect(s.abilitySettings['quick-strike'].reserve).toBe(0.3)
    expect(s.regenDelayMsLeft).toBe(2500)
  })

  it('save-v13 -> v14: старый сейв получает порог привала по умолчанию', () => {
    // До v14 единственной паузой была смерть. Старый герой просыпается с
    // порогом: теперь он уйдёт отдыхать, не дожидаясь её.
    const s = loadFixture('save-v13.json')
    expect(s.restHpThreshold).toBe(REST_HP_THRESHOLD_DEFAULT)
    expect(s.heroState).not.toBe('resting')
    expect(s.gold.toNumber()).toBeGreaterThan(0)
  })

  it('save-v14: порог привала переживает загрузку, а сам привал — нет', () => {
    const s = loadFixture('save-v14.json')
    expect(s.restHpThreshold).toBe(0.6)
    // Порог по ресурсу выброшен миграцией 22 -> 23: в состоянии его нет.
    expect('restResourceThreshold' in s).toBe(false)
    // Привал не досиживается через перезагрузку: герой просыпается на ногах.
    expect(s.restMsLeft).toBe(0)
  })

  it('save-v14 -> v15: оружие переезжает в правую руку, левая остаётся пустой', () => {
    // Рук стало две. Прогресс терять нельзя: тот же предмет, те же
    // модификаторы, та же база боя — меняется только имя слота.
    const s = loadFixture('save-v14.json')
    expect(s.equipment.mainHand?.name).toBe('Закалённый Крушитель')
    expect(s.equipment.mainHand?.slot).toBe('mainHand')
    // Одноручное по нынешним меркам: всё сохранённое оружие строилось с одним
    // отношением урона к скорости. Вторая рука у старого героя свободна.
    expect(s.equipment.mainHand?.grip).toBe('one')
    expect(s.equipment.offHand).toBeNull()
    expect(s.stats.weaponSpeed).toBeCloseTo(3.4, 9)
    // Урон домножен миграцией v18 на масштаб уровня вещи: герой жил в
    // Лощине Гниловодья, полоса 16–20 → уровень 18.
    expect(s.stats.weaponDamageMin.toNumber()).toBeCloseTo(68 * itemLevelScale(18).toNumber(), 9)
    expect(s.gold.toNumber()).toBe(760000) // прогресс не потерян
  })

  it('save-v15: связка двух рук переживает загрузку', () => {
    const s = loadFixture('save-v15.json')
    expect(s.equipment.mainHand?.name).toBe('Закалённый Крушитель')
    expect(s.equipment.offHand?.name).toBe('Дубовый Заслон')
    // Щит работает через конвейер статов, как и всё остальное. Величина блока
    // домножена миграцией v18 на масштаб уровня вещи (полоса 16–20 → 18),
    // шанс блока — вероятность, её миграция не трогает.
    expect(s.stats.blockChance).toBeCloseTo(0.25, 9)
    // Сила блока — сумма щита и вклада живучести: щит задаёт базу, атрибут
    // прибавляется к ней плоским модификатором, как и везде в конвейере.
    const fromShield = 24 * itemLevelScale(18).toNumber()
    const fromVitality = s.stats.vitality.times(VIT_BLOCK_VALUE).toNumber()
    expect(s.stats.blockValue.toNumber()).toBeCloseTo(fromShield + fromVitality, 9)
    // Левая рука урона не даёт: щит — не оружие.
    expect(s.stats.offhandDamageMax.toNumber()).toBe(0)
  })

  it('save-v15 -> v16: старый герой становится Стражем и ничего не теряет', () => {
    // Классы появились в v16. Прежний герой играл на мане с правилом
    // задержки — это ровно Страж, поэтому миграция ничего не переносит,
    // а только называет то, чем он и был.
    const s = loadFixture('save-v15.json')
    expect(s.classId).toBe(DEFAULT_CLASS.id)
    expect(classById(s.classId).resource.kind).toBe('mana')
    expect(s.gold.toNumber()).toBe(760000) // прогресс не потерян
    expect(s.equipment.mainHand?.name).toBe('Закалённый Крушитель')
    // Умения — свои, стражевые, и настройки автокаста к ним прицепились.
    expect(Object.keys(s.abilitySettings).sort()).toEqual(
      [...DEFAULT_CLASS.abilityIds].sort(),
    )
  })

  it('save-v16: класс, его умения и ресурс переживают загрузку', () => {
    const s = loadFixture('save-v16.json')
    expect(s.classId).toBe('reaver')
    expect(classById(s.classId).resource.kind).toBe('rage')
    expect(Object.keys(s.abilitySettings).sort()).toEqual(
      [...CLASS_BY_ID.reaver.abilityIds].sort(),
    )
    // Настройки автокаста именно этого класса, а не дефолтные.
    expect(s.abilitySettings['gut-rip'].reserve).toBeCloseTo(0.3, 9)
    // Ресурс ведёт себя по-другому: ярость не капает сама и не ждёт паузы.
    expect(s.stats.manaRegen.toNumber()).toBe(0)
    expect(s.stats.regenDelay).toBe(0)
  })

  it('save-v16 -> v17: мешок материалов у старого героя пуст, прогресс цел', () => {
    const s = loadFixture('save-v16.json')
    expect(s.materials).toEqual({})
    expect(s.restSpeedupSource).toBeNull()
    expect(s.gold.toNumber()).toBe(760000)
  })

  it('save-v17: материалы и еда переживают загрузку, чужие id отбрасываются', () => {
    const s = loadFixture('save-v17.json')
    expect(s.materials['quarry-ore'].toNumber()).toBe(7)
    expect(s.materials['food:herb-broth'].toNumber()).toBe(2)
    // Мусор в сейве не должен превращаться в материал, которого в игре нет.
    const dirty = stateFromPayload(
      migrateSave({
        ...JSON.parse(fixture('save-v17.json')),
        materials: { 'нет-такого': '99', 'quarry-ore': '3' },
      })!,
    )
    expect(dirty.materials['нет-такого']).toBeUndefined()
    expect(dirty.materials['quarry-ore'].toNumber()).toBe(3)
  })

  it('save-v10 -> v11: старый сейв получает пустое дерево и заработанные очки', () => {
    const s = loadFixture('save-v10.json')
    expect(s.talents).toEqual({})
    expect(s.talentResets).toBe(0)
    // Уровень 19 -> очки за уровни с десятого никуда не делись, их 10.
    expect(availablePoints(s)).toBe(earnedPoints(s.level))
    expect(availablePoints(s)).toBe(10)
    expect(s.gold.toNumber()).toBe(140000) // прогресс не потерян
  })

  it('save-v11: ранги и счётчик сбросов переживают загрузку', () => {
    const s = loadFixture('save-v11.json')
    // Дерево переехало на класс: старые id перенесены картой соответствия
    // внутри стиля, ранги при этом не потеряны ни на очко.
    expect(s.talents).toEqual({
      'wrath-honed-edge': 5,
      'wrath-keen-eye': 2,
      'bulwark-thick-hide': 3,
    })
    expect(s.talentResets).toBe(2)
    expect(spentPoints(s.talents)).toBe(10)
    expect(availablePoints(s)).toBe(earnedPoints(s.level) - 10)
    // Таланты пересчитаны в статы при загрузке, а не забыты. Ловкость с
    // уровней тоже даёт крит — она входит в ожидание, а не в допуск.
    expect(s.statsDirty).toBe(false)
    const keenEye = TALENT_BY_ID['wrath-keen-eye']
    const critPerRank =
      keenEye.effect.kind === 'modifiers'
        ? (keenEye.effect.mods.find((m) => m.stat === 'critChance')?.value.toNumber() ?? 0)
        : 0
    const agiCrit = (s.level.toNumber() - 1) * 0.0005
    expect(s.stats.critChance).toBeCloseTo(0.05 + 2 * critPerRank + agiCrit, 9)
  })

  it('мусорные ранги из сейва режутся по maxRank и по списку талантов', () => {
    const raw = JSON.parse(fixture('save-v11.json'))
    const s = stateFromPayload(
      migrateSave({
        ...raw,
        talents: {
          'honed-edge': 999, // выше maxRank
          'talent-from-the-future': 3, // такого таланта нет
          'keen-eye': -5, // мусор
        },
        talentResets: -7,
      })!,
    )
    // Ранг выше потолка режется по maxRank НОВОГО таланта, чужой id и мусор
    // отбрасываются вовсе — и очки за них возвращаются свободными.
    expect(s.talents['wrath-honed-edge']).toBe(TALENT_BY_ID['wrath-honed-edge'].maxRank)
    expect(s.talents['talent-from-the-future']).toBeUndefined()
    expect(s.talents['wrath-keen-eye']).toBeUndefined()
    expect(s.talentResets).toBe(0)
  })

  it('save-v11 -> v12: старый сейв просыпается снаружи и без достижений', () => {
    const s = loadFixture('save-v11.json')
    expect(s.dungeonRun).toBeNull()
    expect(s.dungeonsCleared).toEqual({})
    expect(clearedXpBonus(s.dungeonsCleared).eq(1)).toBe(true)
    expect(s.gold.toNumber()).toBe(320000) // прогресс не потерян
  })

  it('save-v12: достижение переживает загрузку, а забег расформировывается', () => {
    // ПРАВИЛО ИЗМЕНИЛОСЬ ОСОЗНАННО. Раньше сейв возвращал героя внутрь данжа,
    // к тому же боссу: закрытая вкладка не приносила вообще ничего, и это
    // было наказанием за невнимательность. Теперь забег при загрузке
    // расформировывается, герой выходит наружу, и оффлайн идёт по зоне.
    //
    // Заработанное остаётся заработанным: флаг пройденного данжа и его
    // постоянный бонус к опыту на месте.
    const s = loadFixture('save-v12.json')
    expect(s.dungeonRun).toBeNull()
    expect(s.dungeonsCleared['sunken-barrow']).toBe(true)
    expect(clearedXpBonus(s.dungeonsCleared).gt(1)).toBe(true)
    // Снаружи перед героем обычный моб зоны, а не босс цепочки.
    expect(DUNGEONS[0].bosses.map((b) => b.id)).not.toContain(s.monster.id)
    expect(s.monster.currentHp.eq(s.monster.maxHp)).toBe(true)
  })

  it('битый забег из сейва выкидывает наружу, а не запирает перед пустотой', () => {
    const raw = JSON.parse(fixture('save-v12.json'))
    const wrongDungeon = stateFromPayload(
      migrateSave({ ...raw, dungeonRun: { dungeonId: 'нет-такого', bossIndex: 0, fightMs: 0 } })!,
    )
    expect(wrongDungeon.dungeonRun).toBeNull()

    const wrongIndex = stateFromPayload(
      migrateSave({ ...raw, dungeonRun: { dungeonId: 'sunken-barrow', bossIndex: 99, fightMs: 0 } })!,
    )
    expect(wrongIndex.dungeonRun).toBeNull()

    // Чужие данжи в списке пройденных бонуса не дают.
    const fakeClear = stateFromPayload(
      migrateSave({ ...raw, dungeonsCleared: { 'данж-из-будущего': true } })!,
    )
    expect(fakeClear.dungeonsCleared).toEqual({})
  })

  it('сейв с неизвестной зоной деградирует до безопасной, а не ломается', () => {
    const raw = JSON.parse(fixture('save-v8.json'))
    const s = stateFromPayload(migrateSave({ ...raw, currentZoneId: 'зона-из-будущего' })!)
    expect(s.currentZoneId).toBe(SAFE_ZONE.id)
  })

  it('save-v7: надетая экипировка задаёт базу боя после загрузки', () => {
    const s = loadFixture('save-v7.json')
    expect(s.gold.toNumber()).toBe(9000)
    expect(s.equipment.mainHand?.name).toBe('Закалённый Крушитель')
    expect(s.equipment.chest?.name).toBe('Пастуший Кафтан')
    // Три base-модификатора оружия перебили безоружные значения из баланса.
    // Урон домножен миграцией v18 на масштаб уровня вещи (безопасная зона,
    // полоса 1–5 → уровень 3); скорость оружия миграция не трогает.
    expect(s.stats.weaponSpeed).toBeCloseTo(3.4, 9)
    expect(s.stats.weaponDamageMin.toNumber()).toBeCloseTo(68 * itemLevelScale(3).toNumber(), 9)
    expect(s.stats.weaponDamageMax.toNumber()).toBeCloseTo(136 * itemLevelScale(3).toNumber(), 9)
    // Сила атаки: база 70 + 30 уровней силы * 2 + 7 с нагрудника (домножены
    // миграцией на тот же масштаб), всё +10% с оружия.
    expect(s.stats.attackPower.toNumber()).toBeCloseTo(
      (70 + 30 * 2 + 7 * itemLevelScale(3).toNumber()) * 1.1,
      9,
    )
    expect(s.statsDirty).toBe(false)
  })
})

describe('экспорт -> импорт', () => {
  it('восстанавливает то же состояние', () => {
    const original: GameState = ensureStats({
      ...createInitialState(1),
      statsDirty: true,
      gold: new Decimal('1.5e30'),
      level: new Decimal(77),
      currentXp: new Decimal(123),
      inventory: [
        {
          id: 'item-9',
          name: 'Сумрачный Венец',
          rarity: 'legendary',
          slot: 'head',
          level: 44,
          mods: [
            { stat: 'attackPower', kind: 'flat', value: new Decimal(16), source: 'equipment:head' },
          ],
        },
      ],
      itemSeq: 10,
    })
    const payload = decodeSaveString(encodeSaveString(original, () => 0))
    expect(payload).not.toBeNull()
    const restored = stateFromPayload(payload!)
    expect(restored.gold.eq(original.gold)).toBe(true)
    expect(restored.level.eq(original.level)).toBe(true)
    expect(restored.currentXp.eq(original.currentXp)).toBe(true)
    expect(restored.stats.attackPower.eq(original.stats.attackPower)).toBe(true)
    expect(restored.inventory).toHaveLength(1)
    expect(restored.inventory[0]).toMatchObject({ id: 'item-9', rarity: 'legendary', level: 44 })
    expect(restored.itemSeq).toBe(10)
  })
})
