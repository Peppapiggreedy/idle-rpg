<script lang="ts">
  // Спрайт вклеивается в документ ОДИН раз и целиком: так иконки не стоят
  // ни одного сетевого запроса и не мигают при первой отрисовке. Файл
  // импортируется строкой (?raw), поэтому едет в бандл вместе с кодом.
  import sprite from './sprite.svg?raw'
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -->
{@html sprite}
