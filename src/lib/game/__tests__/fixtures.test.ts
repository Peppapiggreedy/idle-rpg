// Фикстуры реальных сейвов всех версий формата: миграции обязаны привести
// каждую к текущей версии, не потеряв прогресс.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Decimal } from '../numbers'
import { createInitialState, defaultAbilitySettings, type GameState } from '../tick'
import { ensureStats } from '../stats'
import { expectedSwingDamage } from '../combat'
import { buyUpgrade } from '../upgrades'
import { WEAPON_SHARPENING } from '../../data/upgrades'
import { SAFE_ZONE, ZONE_BY_ID } from '../../data/zones'
import { ABILITY_BY_ID } from '../../data/abilities'
import { GCD_MS } from '../../data/balance'
import { TALENT_BY_ID } from '../../data/talents'
import { availablePoints, earnedPoints, spentPoints } from '../talents'
import {
  SAVE_KEY,
  SAVE_VERSION,
  decodeSaveString,
  encodeSaveString,
  loadGame,
  migrateSave,
  stateFromPayload,
  type SaveStorage,
} from '../save'

function fixture(name: string): string {
  return readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), 'utf8')
}

function storageWith(raw: string): SaveStorage {
  const data = new Map<string, string>([[SAVE_KEY, raw]])
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

function loadFixture(name: string): GameState {
  const result = loadGame({ storage: storageWith(fixture(name)), now: () => 0 })
  expect(result.kind).toBe('loaded')
  if (result.kind !== 'loaded') throw new Error('unreachable')
  return result.state
}

describe('фикстуры сейвов', () => {
  it.each([
    ['save-v0.json'],
    ['save-v1.json'],
    ['save-v2.json'],
    ['save-v3.json'],
    ['save-v4.json'],
    ['save-v5.json'],
    ['save-v6.json'],
    ['save-v7.json'],
    ['save-v8.json'],
    ['save-v9.json'],
    ['save-v10.json'],
    ['save-v11.json'],
  ])('%s мигрирует до текущей версии', (name) => {
    const payload = migrateSave(JSON.parse(fixture(name)))
    expect(payload).not.toBeNull()
    expect(payload!.version).toBe(SAVE_VERSION)
  })

  it('save-v0: доверсионные поля (xp, damagePerSecond) не потеряны', () => {
    const s = loadFixture('save-v0.json')
    expect(s.gold.toNumber()).toBe(150)
    expect(s.level.toNumber()).toBe(4)
    expect(s.currentXp.toNumber()).toBe(11)
    // 13 dps = 10 базовых + 3 заточки; средний удар после пересчёта: 20 + 3*2 = 26
    expect(expectedSwingDamage(s.stats).toNumber()).toBe(26)
  })

  it('save-v1: прогресс и апгрейды не потеряны, инвентарь пуст', () => {
    const s = loadFixture('save-v1.json')
    expect(s.gold.toNumber()).toBe(77)
    expect(s.level.toNumber()).toBe(5)
    expect(s.currentXp.toNumber()).toBe(3)
    expect(expectedSwingDamage(s.stats).toNumber()).toBe(24) // 12 dps -> 20 + 2 заточки * 2
    expect(s.upgrades['weapon-sharpening'].toNumber()).toBe(2)
    expect(s.inventory).toEqual([])
  })

  it('save-v2 -> v4: эффективный урон в секунду не изменился', () => {
    // v2 хранил baseDamage = урон в секунду; v4 пересчитывает урон из счётчика
    // покупок (21 dps = 10 базовых + 11 заточек -> 20 + 11*2 = 42 за удар).
    const raw = JSON.parse(fixture('save-v2.json'))
    const s = loadFixture('save-v2.json')
    const dpsBefore = Number(raw.baseDamage)
    const dpsAfter = expectedSwingDamage(s.stats).div(s.stats.swingTime).toNumber()
    expect(dpsAfter).toBe(dpsBefore)
  })

  it('покупка апгрейда даёт тот же прирост урона в секунду, что и раньше (+1)', () => {
    const before = { ...createInitialState(1), gold: new Decimal(1000) }
    const after = buyUpgrade(before, WEAPON_SHARPENING)
    const dpsGain = expectedSwingDamage(after.stats)
      .minus(expectedSwingDamage(before.stats))
      .div(after.stats.swingTime)
    expect(dpsGain.toNumber()).toBe(1)
  })

  it('save-v3 -> v4: урон восстанавливается пересчётом и совпадает с хранившимся', () => {
    const raw = JSON.parse(fixture('save-v3.json'))
    const s = loadFixture('save-v3.json')
    expect(s.gold.toNumber()).toBe(900)
    // v3 хранил damagePerSwing 30 при 5 заточках; пересчёт: 20 + 5*2 = 30.
    expect(expectedSwingDamage(s.stats).toNumber()).toBe(Number(raw.damagePerSwing))
    expect(s.inventory[0].rarity).toBe('rare')
  })

  it('save-v4: загружается, статы пересчитаны из источников', () => {
    const s = loadFixture('save-v4.json')
    expect(s.gold.toNumber()).toBe(1200)
    expect(expectedSwingDamage(s.stats).toNumber()).toBe(20 + 8 * 2)
    expect(s.statsDirty).toBe(false)
  })

  it('save-v2: инвентарь и счётчики не потеряны', () => {
    const s = loadFixture('save-v2.json')
    expect(s.gold.toNumber()).toBe(500)
    expect(s.level.toNumber()).toBe(9)
    expect(s.upgrades['weapon-sharpening'].toNumber()).toBe(11)
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
    expect(item.mods[0].value.toNumber()).toBe(Number(raw.inventory[0].statBonus))
    // Экипировки в v6 не было: предмет ждёт в инвентаре, слоты пусты.
    expect(Object.values(s.equipment).every((i) => i === null)).toBe(true)
    expect(s.autoEquip).toBe(true)
  })

  it('save-v7 -> v8: старый сейв просыпается в безопасной зоне', () => {
    const s = loadFixture('save-v7.json')
    expect(s.currentZoneId).toBe(SAFE_ZONE.id)
    // Выживать ещё негде: смерть вернёт в ту же безопасную зону.
    expect(s.lastSurvivedZoneId).toBeNull()
    expect(SAFE_ZONE.monsterPool.map((a) => a.id)).toContain(s.monster.id)
    // Прогресс не потерян.
    expect(s.gold.toNumber()).toBe(9000)
    expect(s.equipment.weapon?.name).toBe('Закалённый Крушитель')
  })

  it('save-v8: зона восстанавливается, моб берётся из её пула', () => {
    const s = loadFixture('save-v8.json')
    expect(s.currentZoneId).toBe('hollow-quarry')
    expect(s.lastSurvivedZoneId).toBe('hollow-quarry')
    const pool = ZONE_BY_ID['hollow-quarry'].monsterPool.map((a) => a.id)
    expect(pool).toContain(s.monster.id)
    expect(s.monster.level).toBeGreaterThanOrEqual(4)
    expect(s.monster.level).toBeLessThanOrEqual(6)
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
    expect(s.abilitySettings['quick-strike']).toEqual({ autocast: false, priority: 5 })
    // Остальные умения получили дефолтные настройки, а не исчезли.
    expect(s.abilitySettings['rending-wound']).toBeDefined()
    expect(s.abilitySettings['shattering-blow']).toBeDefined()
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
    expect(s.talents).toEqual({ 'honed-edge': 5, 'keen-eye': 2, 'thick-hide': 3 })
    expect(s.talentResets).toBe(2)
    expect(spentPoints(s.talents)).toBe(10)
    expect(availablePoints(s)).toBe(earnedPoints(s.level) - 10)
    // Таланты пересчитаны в статы при загрузке, а не забыты.
    expect(s.statsDirty).toBe(false)
    expect(s.stats.critChance).toBeCloseTo(0.05 + 2 * 0.03, 9)
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
    expect(s.talents['honed-edge']).toBe(TALENT_BY_ID['honed-edge'].maxRank)
    expect(s.talents['talent-from-the-future']).toBeUndefined()
    expect(s.talents['keen-eye']).toBeUndefined()
    expect(s.talentResets).toBe(0)
  })

  it('сейв с неизвестной зоной деградирует до безопасной, а не ломается', () => {
    const raw = JSON.parse(fixture('save-v8.json'))
    const s = stateFromPayload(migrateSave({ ...raw, currentZoneId: 'зона-из-будущего' })!)
    expect(s.currentZoneId).toBe(SAFE_ZONE.id)
  })

  it('save-v7: надетая экипировка задаёт базу боя после загрузки', () => {
    const s = loadFixture('save-v7.json')
    expect(s.gold.toNumber()).toBe(9000)
    expect(s.equipment.weapon?.name).toBe('Закалённый Крушитель')
    expect(s.equipment.chest?.name).toBe('Пастуший Кафтан')
    // Три base-модификатора оружия перебили безоружные значения из баланса.
    expect(s.stats.weaponSpeed).toBeCloseTo(3.4, 9)
    expect(s.stats.weaponDamageMin.toNumber()).toBe(68)
    expect(s.stats.weaponDamageMax.toNumber()).toBe(136)
    // Сила атаки: база 70 + 18 заточек * 14 + 7 с нагрудника, всё это +10% с оружия.
    expect(s.stats.attackPower.toNumber()).toBeCloseTo((70 + 18 * 14 + 7) * 1.1, 9)
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
      upgrades: { 'weapon-sharpening': new Decimal(67) },
      inventory: [
        {
          id: 'item-9',
          name: 'Сумрачный Венец',
          rarity: 'legendary',
          slot: 'head',
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
    expect(restored.upgrades['weapon-sharpening'].eq(new Decimal(67))).toBe(true)
    expect(restored.inventory).toHaveLength(1)
    expect(restored.inventory[0]).toMatchObject({ id: 'item-9', rarity: 'legendary' })
    expect(restored.itemSeq).toBe(10)
  })
})
