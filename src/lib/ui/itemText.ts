// Тексты про предмет. Логика отдаёт коды — слова живут здесь, ровно как
// у причин отказа умений, талантов и распыления.
import type { EquipBlockReason, UnequipBlockReason } from '../game'
import type { Grip } from '../data/items'

/** Хват СЛОВОМ. Игрок читает не 'two', а «двуручное». */
export const GRIP_TEXT: Record<Grip, string> = {
  one: 'одноручное',
  two: 'двуручное',
  shield: 'щит',
}

/** Почему предмет нельзя надеть прямо сейчас. */
export const EQUIP_BLOCK_TEXT: Record<EquipBlockReason, string> = {
  'two-handed-needs-both':
    'Двуручное занимает обе руки — освободи место в сумке под то, что придётся снять',
  'shield-offhand-only': 'Щит надевается только во вторую руку',
  'occupied-by-two-handed': 'Вторая рука занята двуручным — сперва сними его',
}

/** Почему надетое нельзя снять. Пустой слот кнопки не показывает — текст на всякий случай. */
export const UNEQUIP_BLOCK_TEXT: Record<UnequipBlockReason, string> = {
  'empty-slot': 'Слот пуст',
  'inventory-full': 'Сумка полна — освободи место, снятому некуда лечь',
}
