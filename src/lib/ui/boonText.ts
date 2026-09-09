// СЛОВА ДЛЯ ПРАВКИ УМЕНИЯ. Логика отдаёт поле и операцию (`AbilityTune`),
// текст живёт здесь — то же правило, что у причин отказа и названий осей.
//
// Читается фраза так, как игрок её и задаёт себе: «что и насколько». Пороги
// сдвигаются В ПУНКТАХ (`points`), величины масштабируются (`percent`,
// `multiplier`), тип заменяется (`set`) — разница между сдвигом и долей
// названа словами, потому что «на 20 % выше» от порога 0.2 дало бы 0.24, а
// игрок читает пороги как «20 % → 25 %».
import type { AbilityTune, AbilityTuneField } from '../data/abilities'

/** Как называется правленое поле. Список закрыт вместе с ABILITY_TUNABLE. */
export const TUNE_FIELD_NAME: Record<AbilityTuneField | 'type', string> = {
  // 'type' стоит особняком: это единственное поле, которое ЗАМЕНЯЕТСЯ, а не
  // двигается, и в ABILITY_TUNABLE его нет — оно объявлено прямо в AbilityTune.
  type: 'тип',
  cooldownSec: 'откат',
  manaCost: 'цена',
  weaponDamagePercent: 'урон',
  effectWeaponDamagePercent: 'урон эффекта',
  effectTicks: 'тиков эффекта',
  healMaxHpShare: 'лечение',
  weakenDamageShare: 'ослабление',
  weakenHits: 'ударов ослабления',
  detonateMultiplier: 'подрыв',
  absorbArmorShare: 'щит от брони',
  absorbBlockShare: 'щит от блока',
  absorbDurationSec: 'длительность щита',
  brandDamageShare: 'сила клейма',
  brandDurationSec: 'длительность клейма',
  freeCastsCasts: 'бесплатных кастов',
  stanceDamageShare: 'урон стойки',
  stanceMitigationShare: 'защита стойки',
  stanceDurationSec: 'длительность стойки',
  executeBelowHpShare: 'порог добивания',
  brandAutocastAboveHpShare: 'порог клейма',
  healAutocastBelowHpShare: 'порог лечения',
  generateResourceShare: 'прибавка ресурса',
  leechHealShare: 'вампиризм',
  resolveMaxShare: 'потолок упора',
  resolvePerHitTaken: 'прирост упора',
  resolveDurationSec: 'длительность упора',
  refundResourceShare: 'возврат ресурса',
  bloodPriceResourceShare: 'ярость за здоровье',
  windowDurationSec: 'длительность окна',
  detonateResourceMultiplier: 'детонация от ресурса',
  rampPerSwing: 'прирост разгона',
  rampMaxShare: 'потолок разгона',
  rampDurationSec: 'длительность разгона',
  edgeDamagePerShare: 'сила грани',
  edgeDurationSec: 'длительность грани',
  edgeResourceAbove: 'порог грани',
  weaponDamageFromResource: 'урон от полоски',
  leechHealShareFromResource: 'вампиризм от полоски',
  autocastResourceAbove: 'порог автокаста по ресурсу',
  autocastHeroHpAbove: 'порог автокаста',
  // Команды псу.
  houndHasteShare: 'ускорение пса',
  houndHasteDurationSec: 'длительность травли',
  packStrikeBonusShare: 'прибавка от пса',
  recallDurationSec: 'длительность отзыва',
  recallHealShare: 'лечение при отзыве',
  gripSlowShare: 'замедление хваткой',
  gripDurationSec: 'длительность хватки',
  flurryHits: 'ударов в серии',
  houndHealMaxHpShare: 'лечение пса',
  houndHealAutocastBelowHpShare: 'порог перевязки',
  unleashBiteMult: 'укус спуска',
  skulkRedirectBonus: 'доля пса при скрадывании',
  skulkDurationSec: 'длительность скрадывания',
  rallyHpShare: 'здоровье при оклике',
  packExtraHounds: 'псов в своре',
  autocastHoundHpBelow: 'порог команды по псу',
}

/** Одна правка человеческим текстом: «лечение +40 %». */
export function tuneText(tune: AbilityTune): string {
  const name = TUNE_FIELD_NAME[tune.field] ?? tune.field
  if (tune.kind === 'set') return `${name}: ${tune.value}`
  if (tune.kind === 'multiplier') return `${name} ×${tune.value}`
  const sign = tune.value >= 0 ? '+' : '−'
  const value = Math.round(Math.abs(tune.value) * 100)
  // Сдвиг порога и доля величины пишутся ОДИНАКОВО в процентах, и это не
  // небрежность: порог сам живёт в долях, поэтому «+25 пунктов» и «+25 %» для
  // него одно и то же число на экране.
  return `${name} ${sign}${value} %`
}
