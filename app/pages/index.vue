<script setup lang="ts">
/** `/` has no UI of its own; the home middleware applies homeForRole(). */
definePageMeta({
  middleware: 'home',
  layout: false
})
</script>

<template>
  <main class="mm-auth">
    <section class="mm-auth__card" role="status" aria-live="polite">
      <div class="mm-brand__mark" aria-hidden="true">M</div>
      <h1>Opening your console…</h1>
      <p class="mm-muted">You are being routed from your role returned by the server.</p>
    </section>
  </main>
</template>
