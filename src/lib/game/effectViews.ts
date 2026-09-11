// ЧТО СЕЙЧАС ВИСИТ: список меток для ряда значков.
//
// Функция ЧИСТАЯ и ТЕКСТА НЕ ЗНАЕТ — она отдаёт код, источник, цель и числа;
// имя, описание и значок подставляет UI. Правило то же, что у кодов отказа.
//
// ПОЧЕМУ ОДНОЙ ФУНКЦИЕЙ, А НЕ ПРЯМО В КОМПОНЕНТЕ. Метки лежат в ДЕВЯТИ разных
// полях состояния — по одному на род, — и собирать их в компоненте значило бы
// завести в разметке девять веток, которые разъедутся с логикой на первой же
// новой метке. Здесь один список и один сторож на него.
//
// ЦЕЛЬ НЕ УГАДЫВАЕТСЯ И НЕ ХРАНИТСЯ ОТДЕЛЬНЫМ ПОЛЕМ: она СТРУКТУРНАЯ. Метка
// на мобе лежит в поле, начинающемся с `monster`, метка героя — в своём поле
// героя, и третьего варианта нет по построению. Флаг «на ком висит» был бы
// вторым источником правды рядом с именем поля — и разошёлся бы с ним.
import type { EffectSource, GameState } from './state'

/**
 * Род метки. Код, а не слово: имя и описание рендерит UI (`ui/effectText.ts`).
 * Запись ЗАКРЫТА — новая метка не пройдёт проверку типов, пока про неё не
 * решат, как она называется на экране.
 */
export type EffectKind =
  | 'dot'
  | 'weaken'
  | 'brand'
  | 'stance'
  | 'absorb'
  | 'resolve'
  | 'ramp'
  | 'edge'
  | 'free-casts'
  | 'hound-haste'
  | 'hound-recall'
  | 'hound-grip'
  | 'hound-skulk'
  | 'hound-avenge'
  // Окно таланта-прока: открыто событием боя, держится временем или замахами.
  | 'proc'

/** На ком висит метка. Берётся из ПОЛЯ состояния, а не из самой записи. */
export type EffectTarget = 'hero' | 'monster'

export interface EffectView {
  kind: EffectKind
  target: EffectTarget
  /** Кто повесил: умение или талант. Значок и имя — отсюда. */
  source: EffectSource
  /**
   * Сколько осталось. У метки по ВРЕМЕНИ — миллисекунды, у метки по ШТУКАМ
   * (ударов, применений, тиков) — счётчик. Ровно одно из двух: метка, которая
   * тратится ударами, по секундам не читается, и наоборот.
   */
  msLeft?: number
  charges?: number
  /**
   * ДЕЙСТВУЮЩАЯ ВЕЛИЧИНА метки — та, что работает ПРЯМО СЕЙЧАС, а не номинал
   * из данных умения. У «Упора» и «Разгона» это набежавшая доля (они растут),
   * у остальных — снятая в момент применения. Подсказка обязана показывать
   * именно её: номинал врал бы у половины меток половину времени.
   */
  share?: number
}

/**
 * Порядок СТАБИЛЬНЫЙ и задан ЗДЕСЬ, а не порядком появления: ряд значков,
 * который перетасовывается на каждом касте, читать нельзя — глаз ищет метку
 * по месту. Порядок один и тот же у обеих групп.
 */
export function effectViews(state: GameState): EffectView[] {
  const out: EffectView[] = []
  const hero = (v: Omit<EffectView, 'target'>) => out.push({ ...v, target: 'hero' })
  const monster = (v: Omit<EffectView, 'target'>) => out.push({ ...v, target: 'monster' })

  // ПРОКИ ТАЛАНТОВ — тоже метки героя, и стоят первыми: они открываются чаще
  // всех остального и в бою читаются как «сейчас идёт». Источник — ТАЛАНТ:
  // своего умения у прока нет, и значок с именем берутся у него.
  for (const proc of state.talentProcs) {
    if (proc.msLeft <= 0 && proc.swingsLeft <= 0) continue
    hero({
      kind: 'proc',
      source: { kind: 'talent', id: proc.talentId },
      // Ровно одно из двух: окно по времени читается секундами, окно по
      // замахам — счётчиком. Показать оба значило бы обещать, что кончатся оба.
      ...(proc.msLeft > 0 ? { msLeft: proc.msLeft } : { charges: proc.swingsLeft }),
    })
  }

  // ГЕРОЙ: щит, стойка, упор, разгон, грань, бесплатные применения.
  if (state.absorb && state.absorb.left.gt(0)) {
    hero({ kind: 'absorb', source: state.absorb.source, msLeft: state.absorb.msLeft })
  }
  if (state.stance) {
    hero({
      kind: 'stance',
      source: state.stance.source,
      msLeft: state.stance.msLeft,
      share: state.stance.mitigationShare,
    })
  }
  if (state.resolve) {
    // НАБЕЖАВШАЯ доля, а не потолок: «Упор» на первой секунде не смягчает
    // ничего, и показать ему потолок значило бы соврать вдвое.
    hero({
      kind: 'resolve',
      source: state.resolve.source,
      msLeft: state.resolve.msLeft,
      share: state.resolve.share,
    })
  }
  if (state.ramp) {
    hero({ kind: 'ramp', source: state.ramp.source, msLeft: state.ramp.msLeft, share: state.ramp.share })
  }
  if (state.edge) {
    hero({
      kind: 'edge',
      source: state.edge.source,
      msLeft: state.edge.msLeft,
      share: state.edge.damagePerShare,
    })
  }
  // БЕСПЛАТНЫЕ ПРИМЕНЕНИЯ — ДВА ПОЛЯ И ОДНА МЕТКА НА ЭКРАНЕ: игрок видит одно
  // и то же («умения ничего не стоят»), а считаются они по-разному — счётчиком
  // и временем. Источника у них нет: оба поля скалярные и умения не помнят,
  // поэтому метка их и не показывает отдельными значками.
  if (state.freeCastsLeft > 0 || state.freeCastsMsLeft > 0) {
    hero({
      kind: 'free-casts',
      source: { kind: 'ability', id: '' },
      msLeft: state.freeCastsMsLeft > 0 ? state.freeCastsMsLeft : undefined,
      charges: state.freeCastsLeft > 0 ? state.freeCastsLeft : undefined,
    })
  }
  // КОМАНДЫ ПСУ — В ГРУППЕ ГЕРОЯ, И ТРЕТЬЕЙ ГРУППЫ НЕТ. Пёс — второе тело
  // героя, а не третья сторона схватки: свой ряд значков под ним стоил бы
  // высоты экрана и читался бы как ещё один участник. Исключение одно —
  // хватка: она замедляет МОБА, то есть висит на нём.
  const marks = state.houndMarks
  if (marks.haste) {
    hero({ kind: 'hound-haste', source: marks.haste.source, msLeft: marks.haste.msLeft, share: marks.haste.share })
  }
  if (marks.recall) {
    hero({ kind: 'hound-recall', source: marks.recall.source, msLeft: marks.recall.msLeft })
  }
  if (marks.skulk) {
    hero({ kind: 'hound-skulk', source: marks.skulk.source, msLeft: marks.skulk.msLeft, share: marks.skulk.share })
  }
  if (marks.avenge) {
    hero({ kind: 'hound-avenge', source: marks.avenge.source, msLeft: marks.avenge.msLeft, share: marks.avenge.share })
  }

  // МОБ: урон по времени, ослабление, клеймо, хватка.
  for (const effect of state.activeEffects) {
    monster({
      kind: 'dot',
      source: { kind: 'ability', id: effect.abilityId },
      charges: effect.ticksLeft,
    })
  }
  if (state.monsterWeaken) {
    monster({
      kind: 'weaken',
      source: state.monsterWeaken.source,
      charges: state.monsterWeaken.hitsLeft,
      share: state.monsterWeaken.damageShare,
    })
  }
  if (state.monsterBrand) {
    monster({
      kind: 'brand',
      source: state.monsterBrand.source,
      msLeft: state.monsterBrand.msLeft,
      share: state.monsterBrand.damageShare,
    })
  }
  if (marks.grip) {
    monster({ kind: 'hound-grip', source: marks.grip.source, msLeft: marks.grip.msLeft, share: marks.grip.share })
  }
  return out
}
