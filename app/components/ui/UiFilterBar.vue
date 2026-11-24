<script setup lang="ts">
defineProps<{ label?: string }>()
</script>

<template>
  <fieldset class="mm-card mm-filter-bar" :aria-label="label ?? 'Filters'">
    <legend class="mm-metric__label">{{ label ?? 'Filters' }}</legend>
    <slot />
  </fieldset>
</template>
