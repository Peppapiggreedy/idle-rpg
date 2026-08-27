<script lang="ts">
  // Поверхность с заголовком — основа всех экранов игры.
  // Про игровое состояние не знает: только пропсы и слоты.
  import type { Snippet } from 'svelte'

  interface Props {
    title?: string
    // Подпись под заголовком: счётчик, пояснение, что угодно короткое.
    subtitle?: string
    // 'plain' — обычная панель, 'quiet' — без фона (для вложенных блоков),
    // 'raised' — приподнятая: модалка и всё, что лежит поверх.
    tone?: 'plain' | 'quiet' | 'raised'
    // Плотная набивка для панелей, где важна каждая строка.
    dense?: boolean
    align?: 'start' | 'center'
    header?: Snippet
    children: Snippet
    footer?: Snippet
  }
  let {
    title,
    subtitle,
    tone = 'plain',
    dense = false,
    align = 'start',
    header,
    children,
    footer,
  }: Props = $props()
</script>

<section class="panel {tone}" class:dense class:center={align === 'center'}>
  {#if title || subtitle || header}
    <div class="head">
      <div class="titles">
        {#if title}<h2>{title}</h2>{/if}
        {#if subtitle}<p class="subtitle">{subtitle}</p>{/if}
      </div>
      {#if header}<div class="head-extra">{@render header()}</div>{/if}
    </div>
  {/if}
  <div class="body">{@render children()}</div>
  {#if footer}<div class="foot">{@render footer()}</div>{/if}
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-lg);
    background: var(--c-surface);
    text-align: left;
  }
  .panel.quiet {
    background: transparent;
    border-color: transparent;
    padding: 0;
  }
  .panel.raised {
    background: var(--c-surface-raised);
    box-shadow: var(--shadow-md);
  }
  .panel.dense {
    gap: var(--space-2);
    padding: var(--space-3);
  }
  .panel.center {
    text-align: center;
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .titles {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
    line-height: var(--leading-tight);
  }
  .subtitle {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
  .head-extra {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .panel.dense .body {
    gap: var(--space-2);
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
</style>
