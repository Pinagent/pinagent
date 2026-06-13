<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
// The Pinagent brand mark, rendered natively in a Vue <template>. The
// shared <Logo> in @pinagent/widget is a React component, so this example
// draws the same pin from the framework-agnostic design tokens exported by
// @pinagent/ui — the single source of truth every Pinagent surface pulls from.
import { BRAND_CREAM, BRAND_INK, BRAND_VIEWBOX, PIN_PATH } from '@pinagent/ui/tokens';

withDefaults(defineProps<{ size?: number }>(), { size: 24 });
</script>

<template>
  <svg
    :width="size"
    :height="size"
    :viewBox="BRAND_VIEWBOX"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <rect width="93" height="93" :fill="BRAND_CREAM" />
    <path :d="PIN_PATH" :fill="BRAND_INK" />
  </svg>
</template>
