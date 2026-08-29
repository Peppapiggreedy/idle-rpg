
// ============================================================================
// Травы — данные. Отдельный от материалов ТИП, и это не дублирование:
// материал ПАДАЕТ с убитого моба своим броском, а трава СРЕЗАЕТСЯ временем,
// пока герой в зоне. Входы разные (убийство против секунд), поэтому и поле
// разное: у материала вес рулетки, у травы — сколько пучков в минуту.
//
// Скорость сбора — часть контракта аптайма зелий (POTION_TARGET_UPTIME в
// data/balance.ts): запаса травы с подходящей по уровню зоны обязано хватать
// на почти непрерывное действие ОДНОГО зелья и не хватать на три сразу.
// Держит это game/__tests__/potions.test.ts, а не договорённость.
//
// Ссылки «трава → зона» и «в каждой зоне что-то растёт» проверяет
// content:check: зона, где не растёт ничего, выглядит сломанной.
import type { IconName } from '../ui/icons/manifest'

export interface HerbDef {
  id: string
  name: string
  /** Иконка. Тип выведен из реестра: опечатка — ошибка проверки типов. */
  icon: IconName
  /** Зоны, где трава растёт. Пустой список — недостижимый контент. */
  zoneIds: string[]
  /** Сколько пучков герой срезает за минуту, пока фармит в такой зоне.
   *  Обычный number: это скорость, а не неограниченно растущая величина. */
  perMinute: number
}

// Три травы — по одной на каждое зелье. Полосы намеренно ПЕРЕКРЫВАЮТСЯ к
// концу лестницы: с Продувного перевала (37 уровень) и дальше растут все
// три, поэтому герой, доросший до зелий (40 уровень), варит любое из них,
// не бегая по половине мира. В ранних зонах травы тоже растут — они просто
// копятся до сорокового, ровно как материалы копятся до дорогих рецептов.
export const HERBS: HerbDef[] = [
  {
    id: 'bitterleaf',
    name: 'Горчелист',
    icon: 'herb-bitterleaf',
    // Самая частая трава: на ней держится боевое зелье, и запас по ней
    // должен быть двойным — именно её игрок жжёт постоянно.
    zoneIds: [
      'shepherds-meadow',
      'rusted-furrows',
      'mirefen-hollows',
      'root-vaults',
      'mold-horizon',
      'windswept-pass',
      'wormwood-rise',
      'salt-pit',
      'emery-stack',
      'rimeback-ridge',
      'frozen-crookwood',
      'hollow-dell',
      'mute-bluff',
    ],
    perMinute: 1.2,
  },
  {
    id: 'emberroot',
    name: 'Тлекорень',
    icon: 'herb-emberroot',
    zoneIds: [
      'hollow-quarry',
      'glasswaste',
      'ashen-ridge',
      'mine-collapse',
      'sulfur-springs',
      'ashen-terrace',
      'windswept-pass',
      'wormwood-rise',
      'salt-pit',
      'emery-stack',
      'rimeback-ridge',
      'frozen-crookwood',
      'hollow-dell',
      'mute-bluff',
    ],
    perMinute: 1.0,
  },
  {
    id: 'hoarbloom',
    name: 'Стылоцвет',
    icon: 'herb-hoarbloom',
    zoneIds: [
      'flooded-tier',
      'mold-horizon',
      'windswept-pass',
      'wormwood-rise',
      'salt-pit',
      'emery-stack',
      'rimeback-ridge',
      'frozen-crookwood',
      'hollow-dell',
      'mute-bluff',
    ],
    perMinute: 0.9,
  },
]

export const HERB_BY_ID: Record<string, HerbDef> = Object.fromEntries(
  HERBS.map((h) => [h.id, h]),
)

/** Травы, растущие в этой зоне. Пусто — травничеству здесь делать нечего. */
export function herbsInZone(zoneId: string): HerbDef[] {
  return HERBS.filter((h) => h.zoneIds.includes(zoneId))
}

/** Сколько пучков в минуту даёт зона по каждой траве — вход в расчёт аптайма. */
export function zoneHerbYield(zoneId: string): Record<string, number> {
  return Object.fromEntries(herbsInZone(zoneId).map((h) => [h.id, h.perMinute]))
}


