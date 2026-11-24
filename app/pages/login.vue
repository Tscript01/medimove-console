<script setup lang="ts">
import { ApiError } from '~/composables/useApi'
import { errorMessage } from '~/utils/errors'
import { homeForRole } from '~/utils/roleRouting'

definePageMeta({
  middleware: 'guest',
  layout: false
})

const route = useRoute()
const { login } = useAuth()
const { online } = useOnline()

const email = ref('')
const password = ref('')
const busy = ref(false)
const formError = ref<ApiError | null>(null)

const sessionNotice = computed(() => {
  const reason = route.query.reason
  return typeof reason === 'string' && reason ? reason : null
})

const emailError = computed(() => {
  const field = formError.value?.field ?? ''
  return field === 'email' || field === 'body' ? formError.value?.message ?? '' : ''
})

const passwordError = computed(() => {
  const field = formError.value?.field ?? ''
  return field === 'password' || field === 'body' ? formError.value?.message ?? '' : ''
})

const generalError = computed(() => {
  const field = formError.value?.field
  if (!formError.value || field) return ''
  return errorMessage(formError.value, 'Sign-in failed.')
})

function retryConnection(): void {
  if (import.meta.client) online.value = navigator.onLine
}

async function submit(): Promise<void> {
  if (busy.value || !online.value) return
  busy.value = true
  formError.value = null
  try {
    // login() uses POST /auth/login, stores rotated tokens, then GET /auth/me.
    const user = await login(email.value, password.value)
    await navigateTo(homeForRole(user.role), { replace: true })
  } catch (caught) {
    formError.value = caught instanceof ApiError
      ? caught
      : new ApiError('Sign-in could not be completed.', { code: 'UNEXPECTED_ERROR' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="mm-auth">
    <section class="mm-auth__card" aria-labelledby="login-title">
      <div class="mm-brand__mark" aria-hidden="true">M</div>
      <h1 id="login-title" style="margin-top: 16px;">Console sign in</h1>
      <p class="mm-muted">For dispatchers, providers, hospitals and administrators.</p>

      <p v-if="sessionNotice" class="mm-backend-gap" role="status">
        {{ sessionNotice }}
      </p>

      <UiStatePanel
        v-if="!online"
        variant="offline"
        title="You appear to be offline"
        message="Sign-in needs the MediMove server. Reconnect and try again."
        @retry="retryConnection"
      />

      <form v-else class="mm-auth__form" novalidate @submit.prevent="submit">
        <p v-if="generalError" class="mm-backend-gap" role="alert">{{ generalError }}</p>

        <div class="mm-auth__field">
          <label for="email">Email address</label>
          <input
            id="email"
            v-model="email"
            type="email"
            name="email"
            autocomplete="username"
            required
            :aria-invalid="Boolean(emailError)"
            :aria-describedby="emailError ? 'email-error' : undefined"
          />
          <p v-if="emailError" id="email-error" class="mm-field-error">{{ emailError }}</p>
        </div>

        <div class="mm-auth__field">
          <label for="password">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            name="password"
            autocomplete="current-password"
            required
            :aria-invalid="Boolean(passwordError)"
            :aria-describedby="passwordError ? 'password-error' : undefined"
          />
          <p v-if="passwordError" id="password-error" class="mm-field-error">{{ passwordError }}</p>
        </div>

        <button class="mm-btn" type="submit" :disabled="busy || !online">
          {{ busy ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>

      <details class="mm-auth__demo">
        <summary>Demo console accounts</summary>
        <p class="mm-muted">Password for all demo accounts: <strong>MediMove@123</strong></p>
        <ul>
          <li>Dispatcher — dispatcher.test.ekiti@medimove.ng</li>
          <li>Dispatcher — dispatcher.test.lagos@medimove.ng</li>
          <li>Provider admin — provider.admin.test@medimove.ng</li>
          <li>Hospital staff — hospital.staff.test@medimove.ng</li>
          <li>State admin — state.admin.test@medimove.ng</li>
          <li>Platform admin — platform.admin.test@medimove.ng</li>
        </ul>
        <p class="mm-faint">Patient and crew accounts belong in the mobile app only.</p>
      </details>
    </section>
  </main>
</template>
