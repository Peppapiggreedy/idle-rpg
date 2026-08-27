<script lang="ts">
  // Полоска с заливкой и подписью. Значение приходит числами — про Decimal
  // и игровое состояние примитив не знает.
  interface Props {
    value: number
    max?: number
    // Семантика цвета: за что эта полоска отвечает.
    tone?: 'hp' | 'mana' | 'xp' | 'damage' | 'accent' | 'neutral'
    size?: 'sm' | 'md' | 'lg'
    // Подпись слева и справа под полоской.
    label?: string
    valueLabel?: string
    // Полоска идёт за игровым тиком. Выключить, когда значение прыгает редко.
    smooth?: boolean
  }
  let {
    value,
    max = 100,
    tone = 'neutral',
    size = 'md',
    label,
    valueLabel,
    smooth = true,
  }: Props = $props()

  // Доля 0..100: за границы не выходим даже на кривых входных данных.
  const percent = $derived(max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0)
</script>

<div class="wrap">
  <div
    class="track {size}"
    role="progressbar"
    aria-valuenow={Math.round(percent)}
    aria-valuemin="0"
    aria-valuemax="100"
    aria-label={label}
  >
    <div class="fill {tone}" class:smooth style="width: {percent}%"></div>
  </div>
  {#if label || valueLabel}
    <div class="caption">
      {#if label}<span class="label">{label}</span>{/if}
      {#if valueLabel}<span class="value">{valueLabel}</span>{/if}
    </div>
  {/if}
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .track {
    border: 1px solid var(--c-border);
    border-radius: var(--radius-pill);
    background: var(--c-surface-sunken);
    overflow: hidden;
  }
  .track.sm {
    height: var(--bar-sm);
  }
  .track.md {
    height: var(--bar-md);
  }
  .track.lg {
    height: var(--bar-lg);
  }
  .fill {
    height: 100%;
    background: var(--c-text-faint);
  }
  .fill.smooth {
    transition: width var(--dur-tick) linear;
  }
  .fill.hp {
    background: var(--c-heal);
  }
  .fill.mana {
    background: var(--c-mana);
  }
  .fill.xp {
    background: var(--c-xp);
  }
  .fill.damage {
    background: var(--c-damage);
  }
  .fill.accent {
    background: var(--c-accent);
  }
  .caption {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--c-text-muted);
  }
  .value {
    color: var(--c-text);
  }
  @media (prefers-reduced-motion: reduce) {
    .fill.smooth {
      transition: none;
    }
  }
</style>
