<script setup lang="ts">
import { isNetworkError, isOutOfScope, errorMessage } from '~/utils/errors'
import { formatTimestamp, statusLabel } from '~/utils/display'

definePageMeta({
  middleware: ['auth', 'dispatch-role']
})

const { user } = useAuth()
const { online } = useOnline()
const service = useConsoleService()
const { data, error, pending, load } = useResource(() => service.dispatchQueue())

/** Even if a response leaked another state's records, do not display them. */
const visibleBookings = computed(() =>
  (data.value?.bookings ?? []).filter((booking) =>
    !user.value?.stateId || !booking.stateId || booking.stateId === user.value.stateId
  )
)

const rows = computed<Record<string, unknown>[]>(() =>
  visibleBookings.value.map((booking) => ({
    reference: booking.reference,
    status: booking.status,
    emergencyCategory: booking.emergencyCategory,
    requestedAt: booking.requestedAt,
    dispatchRound: booking.dispatchRound,
    escalation: booking.isEscalated ? 'Escalated' : 'Not escalated'
  }))
)

const outOfScope = computed(() => isOutOfScope(error.value))
const offline = computed(() => !online.value || isNetworkError(error.value))

const view = computed(() => {
  if (offline.value) return 'offline'
  if (pending.value) return 'loading'
  if (error.value) return 'error'
  if (!rows.value.length) return 'empty'
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
    <ModuleErrorBoundary module="Dispatch console">
      <RoleGate :roles="['DISPATCHER']" module="Dispatch console">
        <UiPageHeader
          title="Dispatch console"
          subtitle="Requests in your state queue. Patient contact details are intentionally not shown here."
        >
          <UiScopeBadge :role="user?.role" :state-id="user?.stateId" />
        </UiPageHeader>

        <section class="mm-card" aria-labelledby="dispatch-queue-title">
          <h2 id="dispatch-queue-title" class="mm-card__title">Request queue</h2>

          <UiStatePanel v-if="view === 'loading'" variant="loading" title="Loading request queue…" />
          <UiStatePanel
            v-else-if="view === 'offline'"
            variant="offline"
            title="Queue unavailable offline"
            message="Reconnect to load requests from the server."
            @retry="load"
          />
          <UiStatePanel
            v-else-if="view === 'error'"
            variant="error"
            title="Request queue could not be loaded"
            :message="errorMessage(error, 'The server did not return a queue.')"
            @retry="load"
          />
          <UiStatePanel
            v-else-if="view === 'empty'"
            variant="empty"
            :title="outOfScope ? 'No dispatch data in your scope' : 'No requests in your queue'"
            :message="outOfScope
              ? 'The server did not provide dispatch data for this role and state.'
              : 'When a request arrives, it will appear here from the server queue.'"
          />
          <template v-else>
            <p class="mm-muted" style="margin-top: 0;">
              Showing {{ rows.length }} request{{ rows.length === 1 ? '' : 's' }} returned by the server.
            </p>
            <UiDataTable
              caption="Dispatch requests in your state"
              :columns="[
                { key: 'reference', label: 'Reference' },
                { key: 'status', label: 'Status' },
                { key: 'emergencyCategory', label: 'Emergency category' },
                { key: 'requestedAt', label: 'Requested at (UTC)' },
                { key: 'dispatchRound', label: 'Round' },
                { key: 'escalation', label: 'Escalation' }
              ]"
              :rows="rows"
            >
              <template #cell-status="{ value }">
                <UiStatusBadge :status="String(value ?? '')" />
              </template>
              <template #cell-emergencyCategory="{ value }">
                {{ statusLabel(String(value ?? '')) }}
              </template>
              <template #cell-requestedAt="{ value }">
                {{ formatTimestamp(String(value ?? '')) }}
              </template>
            </UiDataTable>
            <p class="mm-backend-gap" style="margin-top: 16px;">
              BACKEND GAP: there is no global live-fleet endpoint. A live map is outside this stub;
              no vehicle positions or ETAs are inferred here.
            </p>
          </template>
        </section>
      </RoleGate>
    </ModuleErrorBoundary>
  </div>
</template>
