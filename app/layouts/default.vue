<script setup lang="ts">
import type { Role } from '~/types/auth'
import { roleLabel } from '~/utils/roleRouting'

const { user, logout } = useAuth()
const route = useRoute()

/** Navigation mirrors permissions.ts only; the backend enforces real access. */
const navigation = computed<{ label: string; to: string; roles: Role[] }[]>(() => [
  { label: 'Dispatch console', to: '/dispatch', roles: ['DISPATCHER'] },
  { label: 'Provider portal', to: '/provider', roles: ['PROVIDER_ADMIN'] },
  { label: 'Hospital portal', to: '/hospital', roles: ['HOSPITAL_STAFF'] },
  { label: 'Administration', to: '/admin', roles: ['STATE_ADMIN', 'PLATFORM_ADMIN'] }
])

const visibleNavigation = computed(() =>
  navigation.value.filter((item) => Boolean(user.value && item.roles.includes(user.value.role)))
)

async function signOut(): Promise<void> {
  await logout()
  await navigateTo('/login', { replace: true })
}
</script>

<template>
  <div class="mm-shell">
    <div class="mm-brand">
      <span class="mm-brand__mark" aria-hidden="true">M</span>
      <div>
        <strong>MediMove</strong>
        <small>Operations console</small>
      </div>
    </div>

    <header class="mm-header">
      <div>
        <strong>{{ user?.fullName || 'Console user' }}</strong>
        <div class="mm-faint" style="font-size: 12px;">{{ user?.email || 'No email on file' }}</div>
      </div>
      <div class="mm-filter-bar" style="margin: 0;">
        <UiScopeBadge :role="user?.role" :state-id="user?.stateId" />
        <span class="mm-badge mm-badge--neutral">{{ roleLabel(user?.role) }}</span>
        <button class="mm-btn mm-btn--secondary" type="button" aria-label="Sign out" @click="signOut">
          Sign out
        </button>
      </div>
    </header>

    <nav class="mm-nav" aria-label="Console sections">
      <span class="mm-nav__label">Your sections</span>
      <ul class="mm-nav__list">
        <li v-for="item in visibleNavigation" :key="item.to">
          <NuxtLink
            class="mm-nav__link"
            :to="item.to"
            :aria-current="route.path === item.to ? 'page' : undefined"
          >
            {{ item.label }}
          </NuxtLink>
        </li>
      </ul>
    </nav>

    <main class="mm-main">
      <slot />
    </main>
  </div>
</template>
