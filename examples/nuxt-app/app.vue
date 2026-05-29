<script setup lang="ts">
const count = ref(0);
const features = [
  'Click any element to leave a comment',
  'The comment lands in .pinagent/ with file:line + a screenshot',
  'A coding agent picks it up and edits the source',
];
</script>

<template>
  <main class="page">
    <header class="hero">
      <h1>Pinagent × Nuxt</h1>
      <p class="tagline">
        Click an element, leave a comment, let an agent fix it — now in Nuxt.
      </p>
    </header>

    <section class="demo">
      <button class="counter" type="button" @click="count++">
        Count is {{ count }}
      </button>
      <p class="hint">Try clicking this button (or anything else) with the Pinagent widget.</p>
    </section>

    <section class="features">
      <h2>How it works</h2>
      <ul>
        <li v-for="feature in features" :key="feature">{{ feature }}</li>
      </ul>
    </section>

    <footer class="footer">
      <a href="https://github.com/Pinagent/pinagent">github.com/Pinagent/pinagent</a>
    </footer>
  </main>
</template>

<style>
:root {
  color-scheme: light dark;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
}
body {
  margin: 0;
}
.page {
  max-width: 42rem;
  margin: 0 auto;
  padding: 3rem 1.5rem;
}
.hero h1 {
  margin: 0 0 0.5rem;
  font-size: 2rem;
}
.tagline {
  margin: 0;
  opacity: 0.7;
}
.demo {
  margin: 2.5rem 0;
}
.counter {
  font-size: 1rem;
  padding: 0.6rem 1.1rem;
  border-radius: 0.6rem;
  border: 1px solid currentColor;
  background: transparent;
  cursor: pointer;
}
.hint {
  margin-top: 0.75rem;
  font-size: 0.9rem;
  opacity: 0.6;
}
.features ul {
  padding-left: 1.2rem;
  line-height: 1.7;
}
.footer {
  margin-top: 3rem;
  font-size: 0.9rem;
}
</style>
