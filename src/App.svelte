<script lang="ts">
  import CombatScreen from './lib/ui/CombatScreen.svelte'
  import ZonePanel from './lib/ui/ZonePanel.svelte'
  import AbilityPanel from './lib/ui/AbilityPanel.svelte'
  import TalentPanel from './lib/ui/TalentPanel.svelte'
  import DungeonPanel from './lib/ui/DungeonPanel.svelte'
  import HeroPanel from './lib/ui/HeroPanel.svelte'
  import UpgradePanel from './lib/ui/UpgradePanel.svelte'
  import InventoryPanel from './lib/ui/InventoryPanel.svelte'
  import EquipmentPanel from './lib/ui/EquipmentPanel.svelte'
  import StatsPanel from './lib/ui/StatsPanel.svelte'
  import DebugOverlay from './lib/ui/DebugOverlay.svelte'
  import DebugPanel from './lib/ui/DebugPanel.svelte'
  import NoticeBar from './lib/ui/NoticeBar.svelte'
  import OfflineModal from './lib/ui/OfflineModal.svelte'
  import SaveControls from './lib/ui/SaveControls.svelte'
</script>

<main>
  <h1>Idle RPG</h1>
  <NoticeBar />
  <HeroPanel />
  <CombatScreen />
  <AbilityPanel />
  <DungeonPanel />
  <ZonePanel />
  <TalentPanel />
  <UpgradePanel />
  <StatsPanel />
  <EquipmentPanel />
  <InventoryPanel />
  <SaveControls />
</main>

<OfflineModal />

<DebugOverlay />

<DebugPanel />

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
