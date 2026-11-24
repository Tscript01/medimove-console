<script setup lang="ts">
import type { Role } from '~/types/auth'

const props = defineProps<{
  /** Exact backend role values allowed to render the slot. */
  roles: Role[]
  module: string
}>()

const { user, ensureUser } = useAuth()
const allowed = computed(() => Boolean(user.value && props.roles.includes(user.value.role)))

onMounted(async () => {
  if (!user.value && hasSession()) {
    try {
      await ensureUser()
    } catch {
      // The API layer ends the session; the gate stays closed.
    }
  }
})
</script>

<template>
  <slot v-if="allowed" />
  <section v-else class="mm-card" role="alert" :aria-label="`${module} access restricted`">
    <h2>{{ module }} is not available for this role</h2>
    <p class="mm-muted">
      Frontend gates are a UX courtesy only. The backend enforces the real role and
      data scope on every request.
    </p>
    <NuxtLink class="mm-btn mm-btn--secondary" :to="homeForRole(user?.role)">
      Go to my home page
    </NuxtLink>
  </section>
</template>
