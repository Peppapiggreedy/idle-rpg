<script lang="ts">
  // Число игры: короткая запись через formatNumber и табличные цифры, чтобы
  // столбец не дёргался по ширине при каждом тике.
  import { Decimal, formatNumber } from '../../game'

  interface Props {
    value: Decimal | number
    // Семантика — за что это число отвечает; 'plain' не красит.
    tone?: 'plain' | 'gold' | 'xp' | 'hp' | 'mana' | 'damage' | 'accent' | 'muted'
    size?: 'sm' | 'md' | 'lg' | 'xl'
    // Знак перед числом: 'auto' ставит + у положительных, '+' — всегда.
    sign?: 'none' | 'auto' | 'plus'
    prefix?: string
    suffix?: string
    bold?: boolean
    // Сколько знаков после запятой; по умолчанию — короткая запись formatNumber.
    decimals?: number
  }
  let {
    value,
    tone = 'plain',
    size = 'md',
    sign = 'none',
    prefix = '',
    suffix = '',
    bold = false,
    decimals,
  }: Props = $props()

  const decimal = $derived(value instanceof Decimal ? value : new Decimal(value))
  const negative = $derived(decimal.lt(0))
  const body = $derived(
    decimals === undefined
      ? formatNumber(decimal.abs())
      : decimal.abs().toNumber().toFixed(decimals),
  )
  const signText = $derived(
    sign === 'none' ? '' : negative ? '−' : sign === 'plus' || !decimal.eq(0) ? '+' : '',
  )
</script>

<span class="num {tone} {size}" class:bold>{prefix}{signText}{body}{suffix}</span>

<style>
  .num {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .num.bold {
    font-weight: var(--weight-bold);
  }
  .num.sm {
    font-size: var(--text-xs);
  }
  .num.md {
    font-size: inherit;
  }
  .num.lg {
    font-size: var(--text-lg);
  }
  .num.xl {
    font-size: var(--text-xl);
    font-weight: var(--weight-bold);
    line-height: var(--leading-tight);
  }
  .num.gold {
    color: var(--c-gold);
  }
  .num.xp {
    color: var(--c-xp);
  }
  .num.hp {
    color: var(--c-heal);
  }
  .num.mana {
    color: var(--c-mana);
  }
  .num.damage {
    color: var(--c-damage);
  }
  .num.accent {
    color: var(--c-accent);
  }
  .num.muted {
    color: var(--c-text-muted);
  }
</style>
