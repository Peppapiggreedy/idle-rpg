<script lang="ts">
  // Иконка из общего спрайта. Никаких сетевых запросов и никаких PNG:
  // спрайт вклеен в страницу один раз (см. IconSprite.svelte), а здесь
  // только ссылка на нужный symbol.
  import type { IconName } from './manifest'

  interface Props {
    name: IconName
    /** Размер в шрифтовых единицах: иконка живёт в строке текста. */
    size?: 'sm' | 'md' | 'lg'
    /** Подпись для читалок; без неё иконка считается украшением. */
    label?: string
  }
  let { name, size = 'md', label }: Props = $props()
</script>

<svg
  class="icon {size}"
  role={label ? 'img' : 'presentation'}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  focusable="false"
><use href="#icon-{name}" /></svg>

<style>
  /* Красится currentColor — той же строкой, в которой стоит. Поэтому одна
     и та же иконка работает и на кнопке, и в цвете редкости, и в
     приглушённом тексте, и второго набора цветов не заводится. */
  .icon {
    display: inline-block;
    flex: none;
    fill: currentColor;
    vertical-align: -0.15em;
  }
  .sm {
    width: 1em;
    height: 1em;
  }
  .md {
    width: 1.25em;
    height: 1.25em;
  }
  .lg {
    width: 1.75em;
    height: 1.75em;
  }
</style>
