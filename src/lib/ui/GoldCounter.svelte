<script lang="ts">
  import Decimal from 'break_infinity.js'
  import { formatNumber } from '../game'

  let gold = $state(new Decimal(0))
  const mine = () => {
    gold = gold.plus(1)
  }
</script>

<button type="button" class="gold" onclick={mine}>
  Золото: {formatNumber(gold)}
</button>

<style>
  .gold {
    font: inherit;
    padding: 0.6em 1.2em;
    border: 1px solid #8886;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .gold:hover {
    border-color: #d4a017;
  }
</style>
