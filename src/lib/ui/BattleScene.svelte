<script lang="ts">
  // Рама боевой сцены: держит пропорции (16:9 на десктопе, 4:3 на мобильном)
  // и накрывает картинку читаемой подписью — имя моба и его здоровье игрок
  // должен видеть, а по силуэту уровень не прочитать.
  //
  // Сама картинка — render2d/Scene2D.svelte: фон, спрайты, эффекты и
  // всплывающие числа обычными элементами. Рама про рендер не знает вовсе:
  // в текстовом режиме App ставит на это место текстовую панель.
  import { formatNumber } from '../game'
  import { gameState } from '../stores/game'
  import Scene2D from '../render2d/Scene2D.svelte'
  import { StatBar } from './kit'
</script>

<div class="scene" role="img" aria-label="Боевая сцена: {$gameState.monster.name}">
  <Scene2D />
  <div class="inner">
    <div class="target">
      <span class="name">{$gameState.monster.name}</span>
      <span class="level">{$gameState.monster.level} ур.</span>
    </div>
    <StatBar
      value={$gameState.monster.currentHp.toNumber()}
      max={$gameState.monster.maxHp.toNumber()}
      tone="damage"
      size="lg"
      valueLabel="{formatNumber($gameState.monster.currentHp)} / {formatNumber(
        $gameState.monster.maxHp,
      )}"
    />
  </div>
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
  .inner {
    /* Подпись лежит ПОВЕРХ сцены и не перехватывает указатель: сцена
       ниже по стеку должна оставаться доступной для будущего управления. */
    position: relative;
    pointer-events: none;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
  }
  .target {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .name {
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
    line-height: var(--leading-tight);
  }
  .name,
  .level {
    /* Подпись лежит на сцене: без тени она теряется на светлой площадке. */
    text-shadow: var(--shadow-sm);
  }
  .level {
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
  @media (min-width: 720px) {
    .scene {
      aspect-ratio: 16 / 9;
    }
  }
</style>
