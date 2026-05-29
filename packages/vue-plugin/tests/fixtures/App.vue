<script setup lang="ts">
import { ref } from 'vue';

const count = ref(0);
const fruits = ['Apples', 'Pears'];
</script>

<template>
  <main class="demo">
    <h1>Pinagent Vue demo</h1>
    <button @click="count++">Count is {{ count }}</button>
    <ul>
      <li v-for="fruit in fruits" :key="fruit">{{ fruit }}</li>
    </ul>
    <p v-if="count > 0">clicked</p>
    <p v-else>not yet</p>
  </main>
</template>
