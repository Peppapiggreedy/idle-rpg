<script lang="ts">
  import CombatScreen from './lib/ui/CombatScreen.svelte'
  import HeroPanel from './lib/ui/HeroPanel.svelte'
  import UpgradePanel from './lib/ui/UpgradePanel.svelte'
  import DebugOverlay from './lib/ui/DebugOverlay.svelte'
</script>

<main>
  <h1>Idle RPG</h1>
  <HeroPanel />
  <CombatScreen />
  <UpgradePanel />
</main>

<DebugOverlay />

<style>
  main {
    max-width: 40rem;
    margin: 0 auto;
    padding: 3rem 1.5rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  main h1 {
    margin: 0;
  }
</style>
