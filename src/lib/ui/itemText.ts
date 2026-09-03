// Тексты про предмет. Логика отдаёт коды — слова живут здесь, ровно как
// у причин отказа умений, талантов и распыления.
import type { EquipBlockReason, UnequipBlockReason } from '../game'
import type { Grip } from '../data/items'
import { SLOT_NAMES, type SlotId } from '../data/slots'

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

/**
 * ПОДПИСЬ ПРЕДМЕТА ГОВОРИТ ХВАТ, А НЕ ПОЗИЦИЮ.
 *
 * Слот у находки — это то, КУДА она легла при броске лута, а не то, чем она
 * является. Одноручный клинок, выпавший в левую руку, подписывался «Левая
 * рука» — и игрок читал это как «носится только слева», хотя одноручное идёт
 * в любую. Хват берётся из шаблона и врать не может: щитом и оружием
 * одновременно быть нельзя, это одно поле, а не два флага.
 *
 * У щита подпись остаётся позиционной, и это не исключение из правила, а его
 * применение: щит и правда носится только в левой руке — хват «shield» ровно
 * это и значит.
 *
 * Слова берутся отсюда же, из GRIP_TEXT, с заглавной: подпись слота стоит в
 * начале строки рядом с «Голова» и «Талисман».
 */
export function itemSlotLabel(item: { slot: SlotId; grip?: Grip }): string {
  if (item.grip === 'shield') return SLOT_NAMES.offHand
  if (!item.grip) return SLOT_NAMES[item.slot]
  const word = GRIP_TEXT[item.grip]
  return word.charAt(0).toUpperCase() + word.slice(1)
}
