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
  <!-- Две колонки на десктопе: слева бой и то, чем в бою управляют,
       справа — всё, что копится. На мобильном одна колонка сверху вниз. -->
  <div class="layout">
    <div class="column">
      <HeroPanel />
      <CombatScreen />
      <AbilityPanel />
      <DungeonPanel />
      <ZonePanel />
      <StatsPanel />
    </div>
    <div class="column">
      <TalentPanel />
      <UpgradePanel />
      <EquipmentPanel />
      <InventoryPanel />
    </div>
  </div>
  <SaveControls />
</main>

<OfflineModal />

<DebugOverlay />

<DebugPanel />

<style>
  main {
    max-width: 68rem;
    margin: 0 auto;
    padding: var(--space-5) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  h1 {
    margin: 0;
    font-size: var(--text-2xl);
    line-height: var(--leading-tight);
    text-align: center;
  }
  .layout {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    align-items: start;
  }
  .column {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
  }

  @media (min-width: 720px) {
    main {
      padding: var(--space-6) var(--space-4);
    }
    .layout {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
