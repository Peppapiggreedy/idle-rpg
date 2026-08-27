// Тексты про умения, общие для панели действий и настроек автокаста.
// Логика отдаёт коды причин — человеческие формулировки живут здесь.
import type { AbilityBlockReason } from '../game'

export const ABILITY_REASON_TEXT: Record<AbilityBlockReason, string> = {
  dead: 'Ты мёртв — умения недоступны',
  cooldown: 'Ещё не восстановилось',
  gcd: 'Общая задержка после прошлого умения',
  'no-mana': 'Не хватает маны',
}
