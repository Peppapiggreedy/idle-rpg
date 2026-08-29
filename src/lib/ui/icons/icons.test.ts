import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ABILITIES } from '../../data/abilities'
import { DUNGEONS } from '../../data/dungeons'
import { SLOT_ICONS, SLOT_IDS } from '../../data/slots'
import { STAT_ICONS } from '../../data/stats'
import { TALENTS } from '../../data/talents'
import { CLASSES } from '../../data/classes'
import { MATERIALS } from '../../data/materials'
import { HERBS } from '../../data/herbs'
import { ENCHANTS } from '../../data/enchants'
import { REAGENTS } from '../../data/reagents'
import { PROFESSIONS, RECIPES } from '../../data/recipes'
import { PROGRESSION } from '../../data/progression'
import { ZONES } from '../../data/zones'
import { STAT_IDS } from '../../game/stats'
import { ICONS, ICON_NAMES, type IconName } from './manifest'

const sprite = readFileSync(new URL('./sprite.svg', import.meta.url), 'utf8')

/** Все имена иконок, реально использованные данными игры. */
const used: IconName[] = [
  ...ABILITIES.map((a) => a.icon),
  ...TALENTS.map((t) => t.icon),
  ...ZONES.map((z) => z.icon),
  ...DUNGEONS.map((d) => d.icon),
  ...SLOT_IDS.map((s) => SLOT_ICONS[s]),
  ...Object.values(STAT_ICONS),
  ...CLASSES.map((c) => c.icon),
  ...MATERIALS.map((m) => m.icon),
  ...REAGENTS.map((r) => r.icon),
  ...PROGRESSION.map((s) => s.icon),
  ...PROFESSIONS.map((p) => p.icon),
  ...RECIPES.map((r) => r.icon),
  ...RECIPES.flatMap((r) => (r.output.kind === 'potion' ? [r.output.icon] : [])),
  ...HERBS.map((h) => h.icon),
  ...ENCHANTS.map((e) => e.icon),
  'gold',
  'xp',
  // Иконки интерфейса: их не перечисляют данные — они стоят прямо
  // в компонентах (ручка выдвижки «Журнал»).
  'log',
  // Распыление и пыль: кнопка в инвентаре и строка панели зачарования.
  'action-disenchant',
  'material-dust',
  'profession-enchanting',
]

describe('спрайт иконок', () => {
  it('на каждую иконку из реестра есть symbol', () => {
    const missing = ICON_NAMES.filter((n) => !sprite.includes(`id="icon-${n}"`))
    expect(missing).toEqual([])
  })

  it('в спрайте нет иконок сверх реестра', () => {
    const inSprite = [...sprite.matchAll(/id="icon-([\w-]+)"/g)].map((m) => m[1])
    expect(inSprite.filter((n) => !ICON_NAMES.includes(n as IconName))).toEqual([])
  })

  it('неиспользуемых иконок в реестре нет', () => {
    // Спрайт вклеивается в страницу целиком, поэтому каждая лишняя иконка —
    // это килобайт, который грузит каждый игрок и не видит никто.
    const unused = ICON_NAMES.filter((n) => !used.includes(n))
    expect(unused).toEqual([])
  })

  it('чёрная подложка снята, фигура красится currentColor', () => {
    // Иначе иконка будет чёрным квадратом на тёмной теме.
    expect(sprite).not.toContain('M0 0h512v512H0z')
    expect(sprite).not.toContain('#fff')
    expect(sprite).toContain('fill="currentColor"')
  })

  it('у каждого стата своя иконка', () => {
    for (const id of STAT_IDS) expect(STAT_ICONS[id]).toBeTruthy()
    expect(new Set(Object.values(STAT_ICONS)).size).toBe(Object.keys(STAT_ICONS).length)
  })

  it('у каждой иконки указан автор — этого требует CC BY 3.0', () => {
    for (const name of ICON_NAMES) {
      expect(ICONS[name].author, name).toMatch(/\S/)
    }
  })
})

describe('CREDITS', () => {
  const credits = readFileSync(new URL('../../../../CREDITS.md', import.meta.url), 'utf8')

  it('упомянуты иконки, лицензия и все авторы', () => {
    expect(credits).toContain('game-icons.net')
    expect(credits).toContain('CC BY 3.0')
    for (const author of new Set(ICON_NAMES.map((n) => ICONS[n].author))) {
      expect(credits, author).toContain(author)
    }
  })
})
