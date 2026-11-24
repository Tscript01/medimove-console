<script setup lang="ts">
import { roleLabel } from '~/utils/roleRouting'

definePageMeta({
  middleware: ['auth', 'mobile-role'],
  layout: false
})

const { user, logout } = useAuth()
const busy = ref(false)

async function signOut(): Promise<void> {
  busy.value = true
  try {
    await logout()
    await navigateTo('/login', { replace: true })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="mm-auth">
    <section class="mm-auth__card" aria-labelledby="mobile-title">
      <div class="mm-brand__mark" aria-hidden="true">M</div>
      <h1 id="mobile-title" style="margin-top: 16px;">Use the MediMove mobile app</h1>
      <p class="mm-muted">
        Your account ({{ roleLabel(user?.role) }}) is for patients and crew. Those journeys
        run in the mobile app, not in this operations console.
      </p>
      <p class="mm-faint">You can safely sign out of this browser below.</p>
      <button class="mm-btn" type="button" :disabled="busy" aria-label="Sign out of the console" @click="signOut">
        {{ busy ? 'Signing out…' : 'Sign out' }}
      </button>
    </section>
  </main>
</template>
