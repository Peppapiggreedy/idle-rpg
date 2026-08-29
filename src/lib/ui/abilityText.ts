// Тексты про умения, общие для панели действий и настроек автокаста.
// Логика отдаёт коды причин — человеческие формулировки живут здесь.
import type { AbilityBlockReason } from '../game'
import type { ResourceWords } from './resource'

// Причина «не хватает ресурса» называет его по имени класса, «заперто» —
// уровень разблокировки, остальные три ни от чего не зависят. Поэтому это
// функция, а не таблица: таблица заставила бы изувера читать, что ему не
// хватает маны.
export function abilityReasonText(
  reason: AbilityBlockReason,
  resource: ResourceWords,
  unlockLevel = 1,
): string {
  const fixed: Record<Exclude<AbilityBlockReason, 'no-mana' | 'locked'>, string> = {
    dead: 'Ты мёртв — умения недоступны',
    cooldown: 'Ещё не восстановилось',
    gcd: 'Общая задержка после прошлого умения',
  }
  if (reason === 'locked') return `Откроется на ${unlockLevel} уровне`
  return reason === 'no-mana' ? `Не хватает ${resource.genitive}` : fixed[reason]
}
