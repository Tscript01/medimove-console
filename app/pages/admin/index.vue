<script setup lang="ts">
import { isNetworkError, isOutOfScope, errorMessage } from '~/utils/errors'
import { formatKobo } from '~/utils/money'
import { formatTimestamp, statusLabel } from '~/utils/display'
import { roleLabel } from '~/utils/roleRouting'
import type { OperationalReport } from '~/types/console'

definePageMeta({
  middleware: ['auth', 'admin-role']
})

const { user } = useAuth()
const { online } = useOnline()
const service = useConsoleService()
const { data, error, pending, load } = useResource(() => service.overview())

const report = computed<OperationalReport | null>(() => data.value?.report ?? null)

/** The server scopes the report; never show a mismatched scope in the UI. */
const outOfScope = computed(() => {
  if (isOutOfScope(error.value)) return true
  if (!report.value || !user.value) return false
  if (report.value.scope?.role && report.value.scope.role !== user.value.role) return true
  return Boolean(
    user.value.role === 'STATE_ADMIN' &&
    user.value.stateId &&
    report.value.scope?.stateId &&
    report.value.scope.stateId !== user.value.stateId
  )
})

const offline = computed(() => !online.value || isNetworkError(error.value))

const view = computed(() => {
  if (offline.value) return 'offline'
  if (pending.value) return 'loading'
  if (error.value) return 'error'
  if (!report.value || outOfScope.value) return 'empty'
  return 'data'
})

const statusBreakdown = computed<Record<string, unknown>[]>(() =>
  Object.entries(report.value?.bookings?.byStatus ?? {}).map(([status, count]) => ({
    status,
    count
  }))
)

onMounted(() => {
  if (online.value) load()
})

watch(online, (nowOnline) => {
  if (nowOnline && !data.value) load()
})
</script>

<template>
  <div class="mm-page">
    <ModuleErrorBoundary module="Administration">
      <RoleGate :roles="['STATE_ADMIN', 'PLATFORM_ADMIN']" module="Administration">
        <UiPageHeader
          title="Administration"
          subtitle="Aggregate operational counts only — no individual user or patient data."
        >
          <UiScopeBadge :role="user?.role" :state-id="user?.stateId" />
        </UiPageHeader>

        <section class="mm-card" aria-labelledby="overview-title">
          <h2 id="overview-title" class="mm-card__title">Operational overview</h2>

          <UiStatePanel v-if="view === 'loading'" variant="loading" title="Loading overview…" />
          <UiStatePanel
            v-else-if="view === 'offline'"
            variant="offline"
            title="Overview unavailable offline"
            message="Reconnect to load the server's aggregate report."
            @retry="load"
          />
          <UiStatePanel
            v-else-if="view === 'error'"
            variant="error"
            title="Overview could not be loaded"
            :message="errorMessage(error, 'The server did not return a report.')"
            @retry="load"
          />
          <UiStatePanel
            v-else-if="view === 'empty'"
            variant="empty"
            :title="outOfScope ? 'No report in your scope' : 'No overview returned'"
            :message="outOfScope
              ? 'The server did not provide an aggregate report for this role and state.'
              : 'The report is not available yet.'"
          />
          <template v-else-if="report">
            <p class="mm-muted" style="margin-top: 0;">
              Generated {{ formatTimestamp(report.generatedAt) }} · scope
              {{ roleLabel(report.scope?.role) }}{{ report.scope?.stateId ? ` · ${report.scope.stateId}` : '' }}
              · range {{ report.range?.from ? formatTimestamp(report.range.from) : 'all time' }}
              to {{ report.range?.to ? formatTimestamp(report.range.to) : 'now (server)' }}
            </p>

            <div class="mm-grid" style="margin-top: 16px;">
              <UiMetricCard label="Bookings" :value="report.bookings?.total ?? 0" hint="Server aggregate" />
              <UiMetricCard
                label="Successful payments"
                :value="report.payments?.successfulCount ?? 0"
                hint="Server aggregate"
              />
              <UiMetricCard
                label="Successful amount"
                :value="formatKobo(report.payments?.successfulAmountKobo)"
                hint="Formatted from kobo"
              />
              <UiMetricCard label="Providers" :value="report.providers?.total ?? 0" hint="Server aggregate" />
              <UiMetricCard
                label="Verified crew"
                :value="`${report.crew?.verified ?? 0} / ${report.crew?.total ?? 0}`"
                hint="Server aggregate"
              />
              <UiMetricCard
                label="Hospitals"
                :value="`${report.hospitals?.active ?? 0} / ${report.hospitals?.total ?? 0}`"
                hint="Active / total"
              />
              <UiMetricCard label="Users" :value="report.users?.total ?? 0" hint="Server aggregate" />
              <UiMetricCard
                label="Feedback"
                :value="report.feedback?.averageRating ?? 'Unavailable'"
                hint="Average rating from server"
              />
            </div>

            <div v-if="statusBreakdown.length" style="margin-top: 24px;">
              <h3 style="margin-bottom: 12px;">Booking status breakdown</h3>
              <UiDataTable
                caption="Booking counts by status from the server report"
                :columns="[
                  { key: 'status', label: 'Status' },
                  { key: 'count', label: 'Count' }
                ]"
                :rows="statusBreakdown"
              >
                <template #cell-status="{ value }">
                  {{ statusLabel(String(value ?? '')) }}
                </template>
              </UiDataTable>
            </div>

            <p class="mm-backend-gap" style="margin-top: 20px;">
              BACKEND GAP: fleet, crew-document and pending-document lists are not exposed by a
              documented admin list endpoint, so those screens are not expanded or invented here.
            </p>
          </template>
        </section>
      </RoleGate>
    </ModuleErrorBoundary>
  </div>
</template>
