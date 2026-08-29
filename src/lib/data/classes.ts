// Классы героя — ДАННЫЕ. Ни одного «если класс такой-то» в логике: класс
// описан набором полей, и весь код читает эти поля, а не имя класса.
//
// ГЛАВНОЕ ПОЛЕ — ресурс. Мана и ярость ведут себя противоположно: мана
// начинается полной, копится сама и обнуляет накопление при трате; ярость
// начинается пустой, копится ОТ БОЯ и тает, когда бой кончился. Обе описаны
// ОДНИМИ И ТЕМИ ЖЕ числами: сколько даёт удар свой и чужой, сколько тает вне
// боя, есть ли пауза после траты. Обнули одни поля — получишь ману, обнули
// другие — ярость; ветки в коде для этого не нужно.
import type { IconName } from '../ui/icons/manifest'
import { Decimal } from '../game/numbers'
import type { TalentModifier, BranchId } from './talents'
import type { SlotId } from './slots'

export type ResourceKind = 'mana' | 'rage'

export interface ResourceDef {
  kind: ResourceKind
  /** Полный запас на старте (мана) или пустой (ярость). */
  startFull: boolean
  /**
   * Какую ДОЛЮ полного запаса даёт один удар — свой и чужой. У маны оба
   * нуля: она копится временем, а не боем.
   *
   * Именно удар, а не единица урона: урон растёт неограниченно, а цена
   * умения — фиксированное число, и доход, пропорциональный урону, к концу
   * игры сделал бы ресурс бесплатным.
   *
   * И именно ДОЛЯ запаса, а не абсолютное число: число ударов в секунду от
   * прокачки почти не меняется, а запас растёт с уровнем — как и реген у
   * маны. С абсолютным числом изувер к концу лестницы отставал бы от стража
   * вчетверо, и это было бы не «другой ритм», а «класс похуже».
   */
  perSwingDealt: Decimal
  perHitTaken: Decimal
  /**
   * Какая ДОЛЯ полного запаса тает в секунду ВНЕ боя (пауза респауна,
   * привал). У маны ноль: она не тает. У ярости — то, что делает её ресурсом
   * непрерывного боя, а не копилкой на потом.
   *
   * Именно доля, по той же причине, что и у дохода с удара: запас растёт
   * с интеллектом вещей, и плоская утечка на большом запасе превращалась бы
   * в ничто — глубокий изувер копил бы ярость впрок, а это уже не ярость.
   */
  decayShare: Decimal
}

export interface StartingItem {
  slot: SlotId
  /** Id шаблона из data/items.ts: оружие или щит. */
  templateId: string
  kind: 'weapon' | 'shield'
}

export interface ClassDef {
  id: string
  name: string
  /** Иконка. Тип выведен из реестра: опечатка — ошибка проверки типов. */
  icon: IconName
  /** Одна строка о том, как в него играют. Показывается при выборе. */
  tagline: string
  resource: ResourceDef
  /** Стартовые статы: модификаторы конвейера с source 'class:<id>'. */
  baseMods: TalentModifier[]
  /** Умения класса, в порядке кнопок. */
  abilityIds: string[]
  /** Ветки дерева талантов, доступные классу. */
  branchIds: BranchId[]
  startingEquipment: StartingItem[]
}

export const CLASSES: ClassDef[] = [
  {
    id: 'warden',
    name: 'Страж',
    icon: 'class-warden',
    tagline: 'Мана копится сама, но не во время траты: паузы между умениями — его ритм.',
    resource: {
      kind: 'mana',
      startFull: true,
      perSwingDealt: new Decimal(0),
      perHitTaken: new Decimal(0),
      decayShare: new Decimal(0),
    },
    baseMods: [],
    abilityIds: ['quick-strike', 'rending-wound', 'shattering-blow'],
    branchIds: ['fury', 'endurance', 'composure'],
    startingEquipment: [],
  },
  {
    id: 'reaver',
    name: 'Изувер',
    icon: 'class-reaver',
    tagline: 'Ярость копится от ударов — своих и чужих — и тает, стоит выйти из боя.',
    resource: {
      kind: 'rage',
      startFull: false,
      // Числа подобраны так, чтобы за обычный бой ярости хватало примерно на
      // столько же умений, на сколько манному классу хватает запаса: разница
      // должна быть в РИТМЕ, а не в силе.
      perSwingDealt: new Decimal(0.036),
      perHitTaken: new Decimal(0.05),
      // Тает быстро: копить ярость между боями бессмысленно, и это её суть.
      // 6.7% запаса в секунду — прежние 12 из 180 стартового запаса.
      decayShare: new Decimal(0.067),
    },
    baseMods: [
      // Ярость начинается с нуля и не восстанавливается временем, поэтому
      // запас ей нужен меньше, а пауза после траты не нужна вовсе.
      // Запас БОЛЬШЕ, а доля с удара меньше — вместе это тот же доход, но
      // растёт он с уровнем медленнее: прибавка за уровень к большому запасу
      // весит меньше. Без этого изувер к концу лестницы разгонялся бы вдвое
      // против стража, и один коридор темпа не удержал бы оба класса.
      { stat: 'maxMana', kind: 'base', value: new Decimal(180) },
      // Множитель НОЛЬ, а не base: уровень добавляет восстановление ресурса
      // плоской прибавкой, и заменой базы её не отменить. Ярость не капает
      // сама по себе НИКОГДА — это и есть её определение.
      { stat: 'manaRegen', kind: 'multiplier', value: new Decimal(0) },
      { stat: 'regenDelay', kind: 'base', value: new Decimal(0) },
      // Интеллект изуверу ЧУЖД: множитель-ноль гасит его целиком, и запас
      // ярости не растёт от умных шапок. Это держит ритм класса ровным:
      // доход с удара — доля запаса, а цены умений — числа; расти запасу
      // значит дешеветь умениям, и глубокий изувер молотил бы без пауз.
      { stat: 'intellect', kind: 'multiplier', value: new Decimal(0) },
      // Плата за то, что ресурс приходит из боя: изувер обязан в этом бою
      // стоять. Чуть больше здоровья и чуть меньше уклончивости.
      { stat: 'maxHp', kind: 'percent', value: new Decimal(0.1) },
    ],
    abilityIds: ['gut-rip', 'blood-frenzy', 'skull-splitter'],
    branchIds: ['fury', 'endurance', 'composure'],
    startingEquipment: [
      // Изувер начинает с двумя клинками: ярость копится от ударов, а два
      // клинка бьют чаще. Страж начинает голым — его ресурс от боя не зависит.
      { slot: 'mainHand', templateId: 'fang', kind: 'weapon' },
      { slot: 'offHand', templateId: 'fang', kind: 'weapon' },
    ],
  },
]

export const CLASS_BY_ID: Record<string, ClassDef> = Object.fromEntries(
  CLASSES.map((c) => [c.id, c]),
)

/** Класс по умолчанию: в него мигрируют старые сейвы, у которых класса не было. */
export const DEFAULT_CLASS = CLASSES[0]

export function classById(id: string | undefined | null): ClassDef {
  return (id && CLASS_BY_ID[id]) || DEFAULT_CLASS
}
