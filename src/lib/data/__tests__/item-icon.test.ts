// ЗНАЧОК ПРИНАДЛЕЖИТ ВЕЩИ, А СЛОТ ДАЁТ ЗНАЧОК ТОЛЬКО ПУСТОМУ МЕСТУ.
//
// Две жалобы из живой игры сводились к одной причине: значок брался у СЛОТА.
// Одноручный клинок, надетый в левую руку, рисовался щитом (значок слота
// `offHand` — щит), а двуручное оружие — тем же широким мечом, что и
// одноручное. Слот говорит, КУДА вещь надета, и про вещь не знает ничего.
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GRIP_ICONS, itemIcon, ONE_HANDED, SHIELDS, WEAPONS } from '../items'
import { SLOT_ICONS, SLOT_IDS } from '../slots'
import { ICON_NAMES } from '../../ui/icons/manifest'

describe('значок вещи', () => {
  it('занятый слот берёт значок у вещи, пустой — у слота', () => {
    // Одна и та же рука с разным содержимым даёт РАЗНЫЕ значки, и ни один из
    // них не равен значку пустой руки.
    const shield = itemIcon({ slot: 'offHand', grip: 'shield' })
    const blade = itemIcon({ slot: 'offHand', grip: 'one' })
    expect(shield).not.toBe(blade)
    expect(blade).not.toBe(SLOT_ICONS.offHand)
    // У брони хвата нет: там значок слота и есть значок вещи.
    expect(itemIcon({ slot: 'chest' })).toBe(SLOT_ICONS.chest)
  })

  it('двуручное, одноручное и щит различимы значками', () => {
    const icons = [GRIP_ICONS.one, GRIP_ICONS.two, GRIP_ICONS.shield]
    expect(new Set(icons).size).toBe(3)
  })

  it('одноручное оружие в левой руке НЕ показывает щит', () => {
    // Именно эта жалоба: в левую руку идёт и щит, и одноручное, а значок был
    // один на обоих.
    for (const template of ONE_HANDED) {
      expect(itemIcon({ slot: 'offHand', grip: template.grip }), template.id).toBe(GRIP_ICONS.one)
      expect(itemIcon({ slot: 'offHand', grip: template.grip }), template.id).not.toBe(
        GRIP_ICONS.shield,
      )
    }
  })

  it('у каждого хвата из данных есть свой значок, и он в реестре', () => {
    const grips = new Set([...WEAPONS.map((w) => w.grip), ...SHIELDS.map((s) => s.grip)])
    for (const grip of grips) {
      expect(GRIP_ICONS[grip], grip).toBeTruthy()
      expect(ICON_NAMES, grip).toContain(GRIP_ICONS[grip])
    }
    // Двуручное оружие в данных есть — иначе проверка выше ничего не значит.
    expect(grips.has('two')).toBe(true)
  })

  it('значок слота остался у каждого слота: пустое место рисовать чем-то надо', () => {
    for (const slot of SLOT_IDS) expect(SLOT_ICONS[slot], slot).toBeTruthy()
  })

  // СТОРОЖ ПРОТИВ ВОЗВРАТА ПРИЧИНЫ. Чинить симптом легко: поправить один
  // компонент и оставить остальные. Поэтому запрещён сам ОБРАЗЕЦ — значок
  // слота, взятый по слоту ВЕЩИ. Индексировать `SLOT_ICONS` можно только
  // переменной слота (пустое место), а не выражением вида `что-то.slot`.
  it('ни один экран не берёт значок слота по слоту вещи', () => {
    const found: string[] = []
    for (const [file, source] of uiSources()) found.push(...slotIconOnItem(file, source))
    expect(found).toEqual([])
  })

  it('сторож ловит заведомо битый образец', () => {
    const broken = '<Icon name={SLOT_ICONS[item.slot]} size="lg" />'
    expect(slotIconOnItem('образец.svelte', broken)).toHaveLength(1)
    // И не срабатывает на законном случае — значок ПУСТОГО слота.
    expect(slotIconOnItem('образец.svelte', '<Icon name={SLOT_ICONS[slot]} />')).toEqual([])
  })
})

const UI_DIR = new URL('../../ui/', import.meta.url).pathname

/**
 * Все исходники экранов: .svelte и .ts, включая вложенные каталоги.
 *
 * Обход без `withFileTypes`: этот файл лежит под `src/`, а его проверяет ещё
 * и svelte-check по tsconfig.app, где типов node нет — знакома только
 * односоставная перегрузка `readdirSync`. Каталог отличается от файла
 * отсутствием расширения: в `ui/` расширение есть у всего.
 */
function uiSources(dir = UI_DIR): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const name of readdirSync(dir)) {
    if (/\.(svelte|ts)$/.test(name)) out.push([name, readFileSync(`${dir}${name}`, 'utf8')])
    else if (!name.includes('.')) out.push(...uiSources(`${dir}${name}/`))
  }
  return out
}

/** Замечания вида «файл:строка». Пустой массив — образца нет. */
function slotIconOnItem(file: string, source: string): string[] {
  const out: string[] = []
  source.split('\n').forEach((line, index) => {
    // Индекс — выражение с точкой: `item.slot`, `carried.slot`, `q.item.slot`.
    if (/SLOT_ICONS\[[^\]]*\.[^\]]*\]/.test(line)) {
      out.push(`${file}:${index + 1} — значок слота взят по слоту ВЕЩИ: у занятой ячейки значок берётся у предмета (itemIcon)`)
    }
  })
  return out
}
