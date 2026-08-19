<script lang="ts">
  import GoldCounter from './lib/ui/GoldCounter.svelte'
</script>

<main>
  <h1>Idle RPG</h1>
  <p>
    Скаффолд готов. Игровая логика — в <code>src/lib/game</code>, компоненты
    интерфейса — в <code>src/lib/ui</code>, статические данные — в
    <code>src/lib/data</code>, типы — в <code>src/lib/types</code>.
  </p>
  <GoldCounter />
</main>

<style>
  main {
    max-width: 40rem;
    margin: 0 auto;
    padding: 4rem 1.5rem;
    text-align: center;
  }
</style>
