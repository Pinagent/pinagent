<script>
  let count = $state(0);
  const features = [
    'Click any element to leave a comment',
    'The comment lands in .pinagent/ with file:line + a screenshot',
    'A coding agent picks it up and edits the source',
  ];
</script>

<main class="page">
  <header>
    <h1>Pinagent × SvelteKit</h1>
    <p class="tagline">Click an element, leave a comment, let an agent fix it — now in SvelteKit.</p>
  </header>

  <section class="demo">
    <button class="counter" type="button" onclick={() => count++}>Count is {count}</button>
    <p class="hint">Try clicking this button (or anything else) with the Pinagent widget.</p>
  </section>

  <section>
    <h2>How it works</h2>
    <ul>
      {#each features as feature}
        <li>{feature}</li>
      {/each}
    </ul>
  </section>
</main>

<style>
  .page { max-width: 42rem; margin: 0 auto; padding: 3rem 1.5rem; font-family: system-ui, sans-serif; }
  .tagline { opacity: 0.7; }
  .demo { margin: 2.5rem 0; }
  .counter { font-size: 1rem; padding: 0.6rem 1.1rem; border-radius: 0.6rem; cursor: pointer; }
  .hint { opacity: 0.6; font-size: 0.9rem; }
</style>
