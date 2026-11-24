<script setup lang="ts">
/** Per-module error boundary (Nuxt 4 <NuxtErrorBoundary> from the docs). */
defineProps<{ module: string }>()

function reloadPage(): void {
  if (import.meta.client) window.location.reload()
}
</script>

<template>
  <NuxtErrorBoundary>
    <slot />
    <template #error="{ error, clearBoundaryError }">
      <section class="mm-card" role="alert" :aria-label="`${module} module error`">
        <h2>{{ module }} could not be displayed</h2>
        <p class="mm-muted">{{ error?.message || 'Something went wrong in this module.' }}</p>
        <div class="mm-filter-bar">
          <button class="mm-btn" type="button" aria-label="Retry this module" @click="clearBoundaryError">
            Try again
          </button>
          <button
            class="mm-btn mm-btn--secondary"
            type="button"
            aria-label="Reload the console"
            @click="reloadPage"
          >
            Reload console
          </button>
        </div>
      </section>
    </template>
  </NuxtErrorBoundary>
</template>
