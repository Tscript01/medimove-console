<script setup lang="ts">
import type { NuxtError } from '#app'

defineProps<{ error: NuxtError }>()

async function recover(): Promise<void> {
  await clearError({ redirect: '/' })
}
</script>

<template>
  <main class="mm-auth">
    <section class="mm-auth__card" role="alert">
      <div class="mm-brand__mark" aria-hidden="true">M</div>
      <h1>Something went wrong</h1>
      <p class="mm-muted">{{ error?.message || 'The console could not load this page.' }}</p>
      <p class="mm-faint">Reference: {{ error?.statusCode || 'unknown' }}</p>
      <div class="mm-filter-bar" style="margin-top: 24px;">
        <button class="mm-btn" type="button" aria-label="Return to console home" @click="recover">
          Return home
        </button>
      </div>
    </section>
  </main>
</template>
