<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import { ref } from 'vue';

defineProps<{ label: string }>();

const count = ref(0);
const hovered = ref(false);
</script>

<template>
  <div
    class="counter"
    :class="{ hovered }"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <span>{{ label }}</span>
    <button type="button" @click="count++">{{ count }}</button>
  </div>
</template>

<style scoped>
.counter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border: 1px solid #e5e7eb;
  background: transparent;
  border-radius: 8px;
  margin-bottom: 8px;
  transition: background 120ms ease, border-color 120ms ease;
}
.counter.hovered {
  border-color: #94a3b8;
  background: #f1f5f9;
}
.counter button {
  background: #e2e8f0;
  color: #0f172a;
  border: 0;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
}
</style>
