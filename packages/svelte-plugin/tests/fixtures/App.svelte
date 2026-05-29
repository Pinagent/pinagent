<script>
  let count = 0;
  const fruits = ['Apples', 'Pears'];
</script>

<main class="demo">
  <h1>Pinagent Svelte demo</h1>
  <button onclick={() => count++}>Count is {count}</button>
  <ul>
    {#each fruits as fruit}
      <li>{fruit}</li>
    {/each}
  </ul>
  {#if count > 0}
    <p>clicked</p>
  {:else}
    <p>not yet</p>
  {/if}
</main>
