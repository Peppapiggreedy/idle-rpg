<script lang="ts">
  // Ярлык. Основной случай — редкость предмета: цвет и название берутся
  // из data/rarity.ts, второго набора цветов у интерфейса нет.
  import type { Snippet } from 'svelte'
  import type { Rarity } from '../../types'
  import { rarityName, rarityStyle } from './rarity'

  interface Props {
    // Либо редкость (цвет и подпись сами найдутся)…
    rarity?: Rarity
    // …либо семантический тон с собственной подписью.
    tone?: 'neutral' | 'accent' | 'gold' | 'xp' | 'damage' | 'warning'
    label?: string
    size?: 'sm' | 'md'
    children?: Snippet
  }
  let { rarity, tone = 'neutral', label, size = 'sm', children }: Props = $props()

  const text = $derived(label ?? (rarity ? rarityName(rarity) : ''))
</script>

<span
  class="tag {size}"
  class:rarity={rarity !== undefined}
  class:neutral={!rarity && tone === 'neutral'}
  class:accent={!rarity && tone === 'accent'}
  class:gold={!rarity && tone === 'gold'}
  class:xp={!rarity && tone === 'xp'}
  class:damage={!rarity && tone === 'damage'}
  class:warning={!rarity && tone === 'warning'}
  style={rarity ? rarityStyle(rarity) : undefined}
>
  {#if children}{@render children()}{:else}{text}{/if}
</span>

<style>
  .tag {
    --tag-color: var(--c-text-muted);
    display: inline-flex;
    align-items: center;
    border: 1px solid color-mix(in srgb, var(--tag-color) 55%, transparent);
    background: color-mix(in srgb, var(--tag-color) var(--tint-weak), transparent);
    /* Текст осветляем от того же токена: на тёмном фоне насыщенный
       фиолетовый эпика иначе не дочитывается. Второго цвета не заводим. */
    color: color-mix(in srgb, var(--tag-color) 78%, white);
    border-radius: var(--radius-sm);
    font-weight: var(--weight-medium);
    line-height: var(--leading-tight);
    white-space: nowrap;
  }
  .tag.sm {
    padding: 0 var(--space-1);
    font-size: var(--text-2xs);
  }
  .tag.md {
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
  }
  .tag.rarity {
    --tag-color: var(--rarity-color);
  }
  .tag.accent {
    --tag-color: var(--c-accent);
  }
  .tag.gold {
    --tag-color: var(--c-gold);
  }
  .tag.xp {
    --tag-color: var(--c-xp);
  }
  .tag.damage {
    --tag-color: var(--c-damage);
  }
  .tag.warning {
    --tag-color: var(--c-warning);
  }
</style>
