<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import { ref } from 'vue';
import Counter from './Counter.vue';
import Logo from './Logo.vue';

const navItems = ['Overview', 'Counters', 'Activity', 'Settings'];
const fruits = ['Pineapple', 'Grapes', 'Oranges', 'Mangoes', 'Blueberries'];
const footerHovered = ref(false);
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <Logo :size="18" />
        <span>Pinagent</span>
      </div>
      <nav>
        <a
          v-for="(item, i) in navItems"
          :key="item"
          :href="`#${item.toLowerCase()}`"
          :class="{ active: i === 0 }"
        >
          {{ item }}
        </a>
      </nav>
    </aside>

    <main>
      <h1>Pinagent demo</h1>
      <p>
        Open the <Logo :size="16" class="inline-logo" /> button in the bottom-right, pick an
        element, and leave a comment.
      </p>
      <p class="lede">
        Leave feedback right on the UI. Every comment records a screenshot, the selected element,
        and the exact source file and line that produced it — sending your request straight to the
        code that needs changing. Try it on anything here, including the counters and the footer.
      </p>

      <section class="counters">
        <Counter v-for="fruit in fruits" :key="fruit" :label="fruit" />
      </section>

      <footer
        :class="{ hovered: footerHovered }"
        @mouseenter="footerHovered = true"
        @mouseleave="footerHovered = false"
      >
        Built as a Pinagent smoke-test playground — a minimal Vite + Vue app for exercising the
        click-to-comment flow end to end, from widget selection through agent fixes in the editor.
      </footer>
    </main>
  </div>
</template>

<style scoped>
.layout {
  font-family: system-ui, sans-serif;
  display: grid;
  grid-template-columns: 220px 1fr;
  min-height: 100vh;
}
.sidebar {
  border-right: 1px solid #e5e7eb;
  padding: 40px 20px;
  background: #f9fafb;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 24px;
}
.brand :deep(svg) {
  border-radius: 4px;
}
.brand span {
  font-weight: 600;
  font-size: 14px;
}
.sidebar nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sidebar nav a {
  padding: 6px 10px;
  border-radius: 6px;
  text-decoration: none;
  font-size: 14px;
  color: #4b5563;
  background: transparent;
}
.sidebar nav a.active {
  color: #111827;
  background: #e5e7eb;
}
main {
  padding: 40px;
  max-width: 720px;
  margin: 0 auto;
}
.inline-logo {
  vertical-align: -3px;
  border-radius: 3px;
}
.lede {
  color: #4b5563;
  line-height: 1.55;
}
.counters {
  margin-top: 24px;
}
footer {
  margin-top: 40px;
  color: #6b7280;
  font-size: 13px;
}
footer.hovered {
  color: #111827;
}
</style>
