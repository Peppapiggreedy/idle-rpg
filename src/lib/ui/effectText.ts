// ТЕКСТ МЕТОК — имя, значок и строка подсказки для ряда значков под сценой.
//
// Логика (`game/effectViews.ts`) отдаёт КОД рода, источник, цель и ЧИСЛА;
// слово живёт здесь. Правило то же, что у `itemText`, `axisText` и
// `talentText`: второй формулировки в игре быть не должно.
import { ABILITY_BY_ID } from '../data/abilities'
import { TALENT_BY_ID } from '../data/talents'
import type { EffectSource, EffectView } from '../game'
import type { IconName } from './icons/manifest'

/**
 * ИМЯ МЕТКИ — ЭТО ИМЯ ЕЁ ИСТОЧНИКА. «Стойка», «Клеймо», «Заслон» — игрок уже
 * знает эти слова по кнопкам и по книге умений, и второе имя той же вещи
 * («смягчение», «метка урона») заставило бы учить словарь заново.
 *
 * Исключение одно и названо поимённо: бесплатные применения источника не
 * помнят (`freeCastsLeft` — скаляр), и назвать их можно только родом.
 */
export function effectName(view: EffectView): string {
  if (view.kind === 'free-casts') return 'Бесплатные применения'
  return sourceName(view.source)
}

function sourceName(source: EffectSource): string {
  if (source.kind === 'talent') return TALENT_BY_ID[source.id]?.name ?? source.id
  return ABILITY_BY_ID[source.id]?.name ?? source.id
}

/**
 * ЗНАЧОК — ТОЖЕ ОТ ИСТОЧНИКА, и по тому же доводу: метка «Клейма» обязана
 * выглядеть как кнопка «Клейма». Свой набор значков для меток был бы вторым
 * словарём рядом с первым.
 */
export function effectIcon(view: EffectView): IconName {
  if (view.kind === 'free-casts') return 'ability-focus'
  if (view.source.kind === 'talent') return TALENT_BY_ID[view.source.id]?.icon ?? 'ability-focus'
  return ABILITY_BY_ID[view.source.id]?.icon ?? 'ability-focus'
}

/**
 * ЧТО МЕТКА ДЕЛАЕТ — одной строкой, по роду. Запись ЗАКРЫТА по `EffectKind`:
 * новая метка не пройдёт проверку типов, пока про неё не решат, как она
 * читается игроком.
 */
const WHAT: Record<EffectView['kind'], string> = {
  dot: 'Кровотечение: урон каждый тик',
  weaken: 'Ближайшие удары цели слабее',
  brand: 'Цель получает больше урона',
  stance: 'Свой урон ниже, входящий мягче',
  absorb: 'Щит съедает входящий урон',
  resolve: 'Каждый пропущенный удар делает следующий мягче',
  ramp: 'Каждый свой удар поднимает урон',
  edge: 'Урон растёт от избытка полоски',
  'free-casts': 'Умения не стоят ресурса',
  'hound-haste': 'Пёс кусает чаще',
  'hound-recall': 'Пёс отозван: не кусает и лечится',
  'hound-grip': 'Цель замахивается медленнее',
  'hound-skulk': 'Пёс принимает больше входящего вместо героя',
  'hound-avenge': 'Пёс пал — урон героя выше',
}

const pct = (share: number) => `${Math.round(share * 100)} %`

/**
 * Сколько осталось, словами. МЕТКА ЧИТАЕТСЯ РОВНО ОДНИМ СПОСОБОМ: та, что
 * тратится временем, — секундами, та, что тратится штуками, — счётчиком.
 * Показать оба у одной значило бы обещать, что оба кончатся.
 */
export function effectLeft(view: EffectView): string {
  if (view.msLeft !== undefined) return `${Math.ceil(view.msLeft / 1000)} с`
  if (view.charges !== undefined) return String(view.charges)
  return ''
}

/**
 * Строка подсказки. Величина здесь ДЕЙСТВУЮЩАЯ — та, что приходит из
 * состояния, а не номинал из данных умения: «Упор» на первой секунде смягчает
 * ноль, и номинал соврал бы ему вдвое.
 */
export function effectTip(view: EffectView): string {
  const parts = [effectName(view), WHAT[view.kind]]
  if (view.share !== undefined) parts.push(`сейчас ${pct(view.share)}`)
  if (view.msLeft !== undefined) parts.push(`осталось ${Math.ceil(view.msLeft / 1000)} с`)
  if (view.charges !== undefined) {
    parts.push(view.kind === 'dot' ? `тиков ${view.charges}` : `осталось ${view.charges}`)
  }
  return parts.join(' · ')
}
