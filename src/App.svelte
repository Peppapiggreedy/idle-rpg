<script lang="ts">
  import CombatScreen from './lib/ui/CombatScreen.svelte'
  import DebugOverlay from './lib/ui/DebugOverlay.svelte'
</script>

<main>
  <h1>Idle RPG</h1>
  <CombatScreen />
</main>

<DebugOverlay />

<style>
  main {
    max-width: 40rem;
    margin: 0 auto;
    padding: 3rem 1.5rem;
    text-align: center;
  }
</style>
