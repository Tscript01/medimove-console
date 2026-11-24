<script setup lang="ts">
withDefaults(defineProps<{
  variant: 'loading' | 'empty' | 'error' | 'offline'
  title: string
  message?: string
}>(), { message: '' })

const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div
    class="mm-state"
    :class="{
      'mm-state--error': variant === 'error',
      'mm-state--offline': variant === 'offline'
    }"
    :role="variant === 'error' ? 'alert' : 'status'"
    :aria-live="variant === 'loading' ? 'polite' : undefined"
  >
    <template v-if="variant === 'loading'">
      <div class="mm-skeleton" style="width: 220px;" aria-hidden="true" />
      <div class="mm-skeleton" style="width: 320px; height: 12px;" aria-hidden="true" />
      <div class="mm-skeleton" style="width: 260px; height: 12px;" aria-hidden="true" />
      <span class="sr-only">Loading…</span>
    </template>
    <template v-else>
      <strong>{{ title }}</strong>
      <span v-if="message">{{ message }}</span>
      <button
        v-if="variant === 'error' || variant === 'offline'"
        class="mm-btn mm-btn--secondary"
        type="button"
        :aria-label="`Retry: ${title}`"
        @click="emit('retry')"
      >
        Try again
      </button>
    </template>
  </div>
</template>
