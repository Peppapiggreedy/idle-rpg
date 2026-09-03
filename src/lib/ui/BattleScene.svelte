<script lang="ts">
  // Рама боевой сцены: держит пропорции (16:9 на десктопе, 4:3 на мобильном)
  // и больше не несёт ничего.
  //
  // ПОДПИСИ ЗДЕСЬ БОЛЬШЕ НЕТ. Имя и уровень моба лежали в нижнем углу рамы,
  // а его здоровье — полоской над головой: одного противника приходилось
  // собирать из двух углов экрана, и взгляд рвался надвое. Всё, что про
  // моба, переехало в ОДНУ табличку над ним (render2d/Scene2D.svelte) —
  // имя, уровень и здоровье вместе.
  //
  // Сама картинка — render2d/Scene2D.svelte: фон, спрайты, эффекты и
  // всплывающие числа обычными элементами. Рама про рендер не знает вовсе:
  // в текстовом режиме App ставит на это место текстовую панель.
  import { gameState } from '../stores/game'
  import Scene2D from '../render2d/Scene2D.svelte'

  interface Props {
    /** Сцена уехала в угол: пропорции те же, эффектов меньше. */
    mini?: boolean
  }
  let { mini = false }: Props = $props()
</script>

<div
  class="scene"
  class:mini
  role="img"
  aria-label="Боевая сцена: {$gameState.monster.name}"
>
  <Scene2D {mini} />
</div>

<style>
  .scene {
    /* Пропорции держит сам блок, а не картинка: сцена растянута по нему
       абсолютно, поэтому её содержимое не может сдвинуть раскладку.
       Мобильный 4:3 выше и занимает верх экрана целиком. */
    position: relative;
    aspect-ratio: 4 / 3;
    width: 100%;
    display: flex;
    align-items: flex-end;
    border: 1px solid var(--c-border);
    border-radius: var(--radius-lg);
    /* Фон под картинкой: он виден ровно те доли секунды, пока грузится
       фон зоны, и не должен мигать чёрным прямоугольником. */
    background:
      radial-gradient(
        120% 90% at 50% 0%,
        color-mix(in srgb, var(--c-xp) var(--tint-weak), var(--c-surface-sunken)),
        var(--c-surface-sunken)
      );
    overflow: hidden;
  }
  @media (min-width: 720px) {
    .scene {
      aspect-ratio: 16 / 9;
    }
  }
  /* В углу пропорции ТЕ ЖЕ, что на десктопе: угол — это уменьшенная сцена,
     а не другая. Меняется только ширина, и её задаёт .stage.mini. */
  .scene.mini {
    aspect-ratio: 16 / 9;
  }
</style>
