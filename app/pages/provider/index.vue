<script setup lang="ts">
import { isNetworkError, isOutOfScope, errorMessage } from '~/utils/errors'
import { formatKobo } from '~/utils/money'
import { formatTimestamp, statusLabel } from '~/utils/display'
import type { ProviderProfile } from '~/types/console'

definePageMeta({
  middleware: ['auth', 'provider-role']
})

const { user } = useAuth()
const { online } = useOnline()
const service = useConsoleService()
const { data, error, pending, load } = useResource(() => service.myProvider())

const provider = computed<ProviderProfile | null>(() => data.value?.provider ?? null)

/** A provider returned outside the signed-in admin's scope is not displayed. */
const outOfScope = computed(() =>
  isOutOfScope(error.value) ||
  Boolean(provider.value && user.value?.providerId && provider.value.id !== user.value.providerId)
)

const offline = computed(() => !online.value || isNetworkError(error.value))

const view = computed(() => {
  if (offline.value) return 'offline'
  if (pending.value) return 'loading'
  if (error.value) return 'error'
  if (!provider.value || outOfScope.value) return 'empty'
  return 'data'
})

onMounted(() => {
  if (online.value) load()
})

watch(online, (nowOnline) => {
  if (nowOnline && !data.value) load()
})
</script>

<template>
  <div class="mm-page">
    <ModuleErrorBoundary module="Provider portal">
      <RoleGate :roles="['PROVIDER_ADMIN']" module="Provider portal">
        <UiPageHeader
          title="Provider portal"
          subtitle="Your provider profile, verification state and rate card as recorded by the server."
        >
          <UiScopeBadge :role="user?.role" :state-id="user?.stateId" />
        </UiPageHeader>

        <section class="mm-card" aria-labelledby="provider-profile-title">
          <h2 id="provider-profile-title" class="mm-card__title">Provider profile</h2>

          <UiStatePanel v-if="view === 'loading'" variant="loading" title="Loading provider profile…" />
          <UiStatePanel
            v-else-if="view === 'offline'"
            variant="offline"
            title="Profile unavailable offline"
            message="Reconnect to load your provider record."
            @retry="load"
          />
          <UiStatePanel
            v-else-if="view === 'error'"
            variant="error"
            title="Provider profile could not be loaded"
            :message="errorMessage(error, 'The server did not return a provider profile.')"
            @retry="load"
          />
          <UiStatePanel
            v-else-if="view === 'empty'"
            variant="empty"
            :title="outOfScope ? 'No provider in your scope' : 'No provider profile returned'"
            :message="outOfScope
              ? 'The server did not provide a provider for this account.'
              : 'Your provider record is not available yet.'"
          />
          <template v-else-if="provider">
            <div class="mm-filter-bar" style="margin-top: 0;">
              <UiStatusBadge :status="provider.status" label="Registration" />
              <UiStatusBadge :status="provider.verificationStatus" label="Verification" />
              <UiStatusBadge
                :status="provider.availableStatus ? 'AVAILABLE' : 'UNAVAILABLE'"
                label="Availability flag (server)"
              />
            </div>

            <dl class="mm-grid" style="margin: 8px 0 0;">
              <div class="mm-metric">
                <dt class="mm-metric__label">Provider</dt>
                <dd class="mm-metric__value" style="font-size: 19px; margin-left: 0;">{{ provider.name }}</dd>
                <dd class="mm-metric__hint mm-faint">{{ provider.id }}</dd>
              </div>
              <div class="mm-metric">
                <dt class="mm-metric__label">Vehicle type</dt>
                <dd class="mm-metric__value" style="font-size: 19px; margin-left: 0;">{{ statusLabel(provider.vehicleType) }}</dd>
              </div>
              <div class="mm-metric">
                <dt class="mm-metric__label">Base fare</dt>
                <dd class="mm-metric__value" style="font-size: 19px; margin-left: 0;">
                  {{ formatKobo(provider.baseFareKobo) }}
                </dd>
                <dd class="mm-metric__hint mm-faint">Formatted from kobo; the server computes booking fare.</dd>
              </div>
              <div class="mm-metric">
                <dt class="mm-metric__label">Per-km rate</dt>
                <dd class="mm-metric__value" style="font-size: 19px; margin-left: 0;">
                  {{ formatKobo(provider.ratePerKmKobo) }}
                </dd>
                <dd class="mm-metric__hint mm-faint">Formatted from kobo; never used to calculate a price here.</dd>
              </div>
              <div class="mm-metric">
                <dt class="mm-metric__label">Phone</dt>
                <dd class="mm-metric__value" style="font-size: 19px; margin-left: 0;">{{ provider.phone || 'Unavailable' }}</dd>
              </div>
              <div class="mm-metric">
                <dt class="mm-metric__label">Last server update</dt>
                <dd class="mm-metric__value" style="font-size: 19px; margin-left: 0;">
                  {{ formatTimestamp(provider.updatedAt) }}
                </dd>
              </div>
            </dl>
          </template>
        </section>
      </RoleGate>
    </ModuleErrorBoundary>
  </div>
</template>
