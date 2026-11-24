<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  value: string | number
  hint?: string
}>(), { hint: '' })
</script>

<template>
  <article class="mm-card mm-metric" :aria-label="`${label}: ${value}`">
    <div class="mm-metric__label">{{ label }}</div>
    <div class="mm-metric__value mm-mono">{{ value }}</div>
    <div v-if="hint" class="mm-metric__hint">{{ hint }}</div>
  </article>
</template>
