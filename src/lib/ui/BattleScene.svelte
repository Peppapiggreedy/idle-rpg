<script lang="ts">
  // Боевая сцена — главный элемент экрана. Самой 3D-сцены ещё нет, поэтому
  // здесь заглушка ПРАВИЛЬНЫХ ПРОПОРЦИЙ: 16:9 на десктопе, 4:3 на мобильном.
  // Макет из-за этого уже верный, и когда появится canvas, он встанет ровно
  // на это место, ничего не сдвинув.
  //
  // Заглушка не пустая: имя моба и его здоровье игрок должен видеть и сейчас.
  // Всё остальное про бой — в ленте лога под сценой и в текстовом режиме.
  import { formatNumber } from '../game'
  import { gameState } from '../stores/game'
  import { StatBar } from './kit'
</script>

<div class="scene" role="img" aria-label="Боевая сцена: {$gameState.monster.name}">
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
    <p class="stub">Здесь будет боевая сцена</p>
  </div>
</div>

<style>
  .scene {
    /* Пропорции держит сам блок: заменим содержимое на canvas — раскладка
       не шелохнётся. Мобильный 4:3 выше и занимает верх экрана целиком. */
    aspect-ratio: 4 / 3;
    width: 100%;
    display: flex;
    align-items: flex-end;
    border: 1px solid var(--c-border);
    border-radius: var(--radius-lg);
    /* Пока сцены нет — спокойный градиент, а не пустой прямоугольник:
       так видно, что это отведённое место, а не сломанная вёрстка. */
    background:
      radial-gradient(
        120% 90% at 50% 0%,
        color-mix(in srgb, var(--c-xp) var(--tint-weak), var(--c-surface-sunken)),
        var(--c-surface-sunken)
      );
    overflow: hidden;
  }
  .inner {
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
  .level {
    font-size: var(--text-xs);
    color: var(--c-text-faint);
  }
  .stub {
    margin: 0;
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-faint);
  }

  @media (min-width: 720px) {
    .scene {
      aspect-ratio: 16 / 9;
    }
  }
</style>
