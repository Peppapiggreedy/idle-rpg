<script lang="ts">
  // Ритм боя одной полосой: сколько осталось до следующего удара.
  //
  // Прогресс берётся ДОЛЕЙ из состояния (swingProgress 0..1), а не считается
  // здесь по миллисекундам. Это принципиально: доля — та же величина, что
  // хранит игра, поэтому смена оружия или haste мгновенно меняет ПОДПИСЬ,
  // но не двигает саму полосу. Игрок видит ровно то, что произойдёт: удар
  // придёт раньше или позже, а замах не сбросится и не долетит мгновенно.
  //
  // ПОЛОСА — ТОТ ЖЕ ПРИМИТИВ, ЧТО И ОСТАЛЬНЫЕ (`kit/StatBar`), а не своя
  // копия трека с заливкой. Копия и была причиной разнобоя: у неё была своя
  // высота, своя форма и свой цвет, и замах выходил то голубым, то
  // фиолетовым — фиолетовым он становился, когда в очередь вставало умение.
  // Цвет обязан различать СМЫСЛ полосы, а не её настроение: замах всегда
  // цвета взаимодействия, а про умение в очереди говорит подпись.
  import { abilitiesByPriority } from '../game'
  import { gameState } from '../stores/game'
  import { StatBar } from './kit'

  const stats = $derived($gameState.stats)
  const progress = $derived(Math.max(0, Math.min(1, $gameState.swingProgress)))
  const swingTime = $derived(stats.swingTime)
  const secondsLeft = $derived(Math.max(0, swingTime * (1 - progress)))

  // Умение, поставленное в очередь на следующий замах: игрок должен видеть,
  // что следующий удар будет ЗАМЕНЁН, а не просто «что-то нажато».
  const queued = $derived(
    $gameState.queuedAbilityId
      ? abilitiesByPriority($gameState.abilitySettings, false).find(
          (a) => a.id === $gameState.queuedAbilityId,
        )
      : undefined,
  )

  // ОБЩЕЙ ЗАДЕРЖКИ ЗДЕСЬ БОЛЬШЕ НЕТ, и это не упрощение.
  //
  // Полоска замаха — про ОРУЖИЕ: когда прилетит следующая автоатака. Общая
  // задержка — про УМЕНИЯ: когда снова можно нажать кнопку. Две разные вещи
  // на одной шкале читались как одна, и игрок ждал удара, глядя на задержку.
  // ГКД теперь виден там, где он и нужен, — заливкой на самих иконках умений
  // (ui/ActionBar.svelte), тем же приёмом, что и обычный кулдаун.

  const dead = $derived($gameState.heroState === 'dead')

  const label = $derived(
    dead
      ? 'Герой повержен'
      : queued
        ? `Замах · ${queued.name} заменит удар`
        : 'Замах',
  )
</script>

<div class="swing">
  <StatBar
    value={progress}
    max={1}
    tone={dead ? 'neutral' : 'accent'}
    size="md"
    {label}
    valueLabel="{secondsLeft.toFixed(1)}с из {swingTime.toFixed(2)}с"
  />
</div>

<style>
  /* Обёртка нужна как якорь раскладки и как имя для тестов: «рядом с
     полоской замаха нет общей задержки» проверяется именно по ней. */
  .swing {
    min-width: 0;
  }
</style>
