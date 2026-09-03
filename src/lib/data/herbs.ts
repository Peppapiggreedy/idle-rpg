
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

// ТРАВЫ НАЧИНАЮТСЯ С ТОПЛЕНОГО ЯРУСА (мобы 41-45) И НЕ РАНЬШЕ.
//
// Раньше они росли с самого луга и копились «до сорокового, ровно как
// материалы копятся до дорогих рецептов». Разница между травой и материалом
// в том, что материал ЛЕЖИТ в мешке молча, а трава срезается временем и
// показывает себя счётчиком: игрок двадцать уровней смотрел, как растёт
// запас того, к чему у него нет ни рецепта, ни кнопки. Закрытая механика,
// которая уже что-то делает, — худшее из состояний: она обещает и не даёт.
//
// Порог один и тот же, что у самих зелий (POTION_UNLOCK_LEVEL): первая зона,
// где растёт хоть что-то, — первая, куда герой приходит УЖЕ травником.
// Держится content:check'ом: механика с уровнем открытия N не может иметь
// источник ресурса в зоне ниже N.
//
// Три травы — по одной на каждое зелье, и ВСЕ ТРИ доступны сразу с первой
// травяной зоны: герой, доросший до зелий, варит любое из них, не бегая по
// половине мира. Дальше полосы расходятся (у каждой травы своя пропущенная
// зона) и снова сходятся к Продувному перевалу.
export const HERBS: HerbDef[] = [
  {
    id: 'bitterleaf',
    name: 'Горчелист',
    icon: 'herb-bitterleaf',
    // Самая частая трава: на ней держится боевое зелье, и запас по ней
    // должен быть двойным — именно её игрок жжёт постоянно.
    zoneIds: [
      'flooded-tier',
      'mold-horizon',
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
    perMinute: 1.2,
  },
  {
    id: 'emberroot',
    name: 'Тлекорень',
    icon: 'herb-emberroot',
    zoneIds: [
      'flooded-tier',
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


