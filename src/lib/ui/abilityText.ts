// Тексты про умения, общие для панели действий и настроек автокаста.
// Логика отдаёт коды причин — человеческие формулировки живут здесь.
import type { AbilityBlockReason } from '../game'
import type { ResourceWords } from './resource'

// Причина «не хватает ресурса» называет его по имени класса, остальные три
// от класса не зависят. Поэтому это функция, а не таблица: таблица заставила
// бы изувера читать, что ему не хватает маны.
export function abilityReasonText(reason: AbilityBlockReason, resource: ResourceWords): string {
  const fixed: Record<Exclude<AbilityBlockReason, 'no-mana'>, string> = {
    dead: 'Ты мёртв — умения недоступны',
    cooldown: 'Ещё не восстановилось',
    gcd: 'Общая задержка после прошлого умения',
  }
  return reason === 'no-mana' ? `Не хватает ${resource.genitive}` : fixed[reason]
}
