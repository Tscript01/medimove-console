<script setup lang="ts">
import { isNetworkError, isOutOfScope, errorMessage } from '~/utils/errors'
import { formatEta, formatTimestamp, statusLabel } from '~/utils/display'

definePageMeta({
  middleware: ['auth', 'hospital-role']
})

const { online } = useOnline()
const service = useConsoleService()
const { data, error, pending, load } = useResource(() => service.incomingPatients())

const incoming = computed(() => data.value?.incoming ?? [])

const rows = computed<Record<string, unknown>[]>(() =>
  incoming.value.map((entry) => ({
    reference: entry.reference,
    emergencyCategory: entry.emergencyCategory,
    status: entry.status,
    distanceRemainingKm: entry.distanceRemainingKm,
    eta: formatEta(entry.etaMinutes, entry.etaAt),
    requestedAt: entry.requestedAt
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
    <ModuleErrorBoundary module="Hospital portal">
      <RoleGate :roles="['HOSPITAL_STAFF']" module="Hospital portal">
        <UiPageHeader
          title="Hospital portal"
          subtitle="Inbound alerts only. Patient identifiers and medical notes are not shown in this console."
        />

        <section class="mm-card" aria-labelledby="incoming-title">
          <h2 id="incoming-title" class="mm-card__title">Inbound patients</h2>

          <UiStatePanel v-if="view === 'loading'" variant="loading" title="Loading inbound alerts…" />
          <UiStatePanel
            v-else-if="view === 'offline'"
            variant="offline"
            title="Inbound alerts unavailable offline"
            message="Reconnect to load alerts from the server."
            @retry="load"
          />
          <UiStatePanel
            v-else-if="view === 'error'"
            variant="error"
            title="Inbound alerts could not be loaded"
            :message="errorMessage(error, 'The server did not return inbound alerts.')"
            @retry="load"
          />
          <UiStatePanel
            v-else-if="view === 'empty'"
            variant="empty"
            :title="outOfScope ? 'No inbound alerts in your scope' : 'No inbound patients'"
            :message="outOfScope
              ? 'The server did not provide inbound alerts for this hospital.'
              : 'When a patient is inbound to your hospital, the alert will appear here.'"
          />
          <template v-else>
            <p class="mm-muted" style="margin-top: 0;">
              Showing {{ rows.length }} alert{{ rows.length === 1 ? '' : 's' }} returned by the server.
            </p>
            <UiDataTable
              caption="Inbound patient alerts for your hospital"
              :columns="[
                { key: 'reference', label: 'Reference' },
                { key: 'emergencyCategory', label: 'Category' },
                { key: 'status', label: 'Status' },
                { key: 'distanceRemainingKm', label: 'Distance remaining (server)' },
                { key: 'eta', label: 'ETA (server)' },
                { key: 'requestedAt', label: 'Requested at (UTC)' }
              ]"
              :rows="rows"
            >
              <template #cell-status="{ value }">
                <UiStatusBadge :status="String(value ?? '')" />
              </template>
              <template #cell-emergencyCategory="{ value }">
                {{ statusLabel(String(value ?? '')) }}
              </template>
              <template #cell-distanceRemainingKm="{ value }">
                {{ typeof value === 'number' ? `${value} km (server provided)` : 'Unavailable' }}
              </template>
              <template #cell-requestedAt="{ value }">
                {{ formatTimestamp(String(value ?? '')) }}
              </template>
            </UiDataTable>
          </template>
        </section>
      </RoleGate>
    </ModuleErrorBoundary>
  </div>
</template>
