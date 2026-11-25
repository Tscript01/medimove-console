<script setup lang="ts">
import { ApiError } from '~/composables/useApi'
import type {
  BookingStatus,
  DispatchContactRecipient,
  DispatchContactTemplate,
  DispatchDetailResponse,
  DispatchRoundInput
} from '~/types/console'
import { errorMessage, isNetworkError, isOutOfScope } from '~/utils/errors'
import { formatEta, formatTimestamp, statusIsTerminal, statusLabel } from '~/utils/display'

definePageMeta({
  middleware: ['auth', 'dispatch-role']
})

const { user } = useAuth()
const { online } = useOnline()
const service = useConsoleService()

const BOOKING_STATUSES: BookingStatus[] = [
  'REQUESTED',
  'OFFERED',
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'PATIENT_ON_BOARD',
  'AT_HOSPITAL',
  'COMPLETED',
  'CANCELLED',
  'FAILED'
]
const ASSIGNABLE_STATUSES: BookingStatus[] = ['REQUESTED', 'OFFERED', 'ACCEPTED', 'EN_ROUTE']
const CONTACT_RECIPIENTS: DispatchContactRecipient[] = ['REQUESTER', 'CREW', 'HOSPITAL']
const CONTACT_TEMPLATES: DispatchContactTemplate[] = [
  'CALLBACK_REQUESTED',
  'ETA_UPDATE',
  'STATUS_UPDATE',
  'GENERAL'
]

// --- Queue -------------------------------------------------------------------

const statusFilter = ref<'' | BookingStatus>('')
const activeFilter = ref<'true' | 'false'>('true')
const escalatedFilter = ref<'' | 'true' | 'false'>('')

const queueQuery = computed(() => {
  const query: {
    status?: BookingStatus
    active?: 'true' | 'false'
    escalated?: 'true' | 'false'
  } = { active: activeFilter.value }
  if (statusFilter.value) query.status = statusFilter.value
  if (escalatedFilter.value) query.escalated = escalatedFilter.value
  return query
})

const queueState = useResource(() => service.dispatchQueue(queueQuery.value))
const queueOutOfScope = computed(() => isOutOfScope(queueState.error.value))
const queueOffline = computed(() => !online.value || isNetworkError(queueState.error.value))

/** Even if a response leaked another state's records, do not display them. */
const visibleBookings = computed(() =>
  (queueState.data.value?.bookings ?? []).filter((booking) =>
    !user.value?.stateId || !booking.stateId || booking.stateId === user.value.stateId
  )
)

const rows = computed<Record<string, unknown>[]>(() =>
  visibleBookings.value.map((booking) => ({
    id: booking.id,
    reference: booking.reference,
    status: booking.status,
    emergencyCategory: booking.emergencyCategory,
    pickupAddress: booking.pickupAddress,
    destAddress: booking.destAddress,
    requestedAt: booking.requestedAt,
    dispatchRound: booking.dispatchRound,
    escalation: booking.isEscalated ? 'Flagged' : 'Not flagged'
  }))
)

const queueView = computed(() => {
  if (queueOffline.value) return 'offline'
  if (queueState.pending.value && !queueState.data.value) return 'loading'
  if (queueOutOfScope.value) return 'empty'
  if (queueState.error.value) return 'error'
  if (!rows.value.length) return 'empty'
  return 'data'
})

function loadQueue(): void {
  if (online.value) void queueState.load()
}

function resetFilters(): void {
  statusFilter.value = ''
  activeFilter.value = 'true'
  escalatedFilter.value = ''
  loadQueue()
}

// --- Detail drawer -----------------------------------------------------------

const selectedId = ref<string | null>(null)
const detailState = useResource<DispatchDetailResponse | null>(async () => {
  const id = selectedId.value
  return id ? await service.dispatchBookingDetail(id) : null
})
const detail = computed(() => detailState.data.value)
const booking = computed(() => detail.value?.booking ?? null)

const candidateState = useResource(async () => {
  const id = selectedId.value
  return id ? await service.dispatchCandidates(id) : null
})
const ambulanceState = useResource(async () => {
  const current = booking.value
  return current ? await service.dispatchAmbulances({ providerId: current.providerId }) : null
})

const detailOutOfScope = computed(() => isOutOfScope(detailState.error.value))
const detailOffline = computed(() => !online.value || isNetworkError(detailState.error.value))

const detailView = computed(() => {
  if (!selectedId.value) return 'closed'
  if (detailOffline.value) return 'offline'
  if (detailState.pending.value && !detail.value) return 'loading'
  if (detailOutOfScope.value) return 'empty'
  if (detailState.error.value) return 'error'
  if (!detail.value || !booking.value) return 'empty'
  return 'data'
})

// --- Actions and form state --------------------------------------------------

type ActionName = 'offers' | 'retry' | 'assign' | 'escalate' | 'contact'

interface AssignmentOption {
  key: string
  crewProfileId: string
  ambulanceId: string
  label: string
  source: string
}

const activeAction = ref<ActionName | null>(null)
const actionError = ref<ApiError | null>(null)
const actionNotice = ref<string | null>(null)

const candidateLimit = ref('')
const ttlSeconds = ref('')
const assignmentReason = ref('')
const selectedAssignmentKey = ref('')
const escalationReason = ref('')
const contactRecipient = ref<DispatchContactRecipient>('REQUESTER')
const contactTemplate = ref<DispatchContactTemplate>('STATUS_UPDATE')

const bookingStatus = computed(() => booking.value?.status ?? null)
const actionDisabled = computed(() => !online.value || activeAction.value !== null)
const canOffer = computed(() => bookingStatus.value === 'REQUESTED' || bookingStatus.value === 'OFFERED')
const canRetry = computed(() => bookingStatus.value === 'OFFERED')
const canAssign = computed(() =>
  bookingStatus.value !== null && ASSIGNABLE_STATUSES.includes(bookingStatus.value)
)
const canEscalate = computed(() =>
  Boolean(booking.value && !booking.value.isEscalated && !statusIsTerminal(booking.value.status))
)
const canContact = computed(() => booking.value !== null)

const assignmentOptions = computed<AssignmentOption[]>(() => {
  const options = new Map<string, AssignmentOption>()

  function add(option: AssignmentOption): void {
    const existing = options.get(option.key)
    if (existing) {
      existing.source = `${existing.source} / ${option.source}`
      return
    }
    options.set(option.key, option)
  }

  for (const candidate of candidateState.data.value?.candidates ?? []) {
    const parts = [candidate.crewProfileId]
    if (candidate.vehicleCategory) parts.push(candidate.vehicleCategory)
    if (candidate.distanceKm !== null) parts.push(serverKm(candidate.distanceKm))
    if (candidate.capabilityMatch) parts.push('capability match')
    add({
      key: `${candidate.crewProfileId}:${candidate.ambulanceId}`,
      crewProfileId: candidate.crewProfileId,
      ambulanceId: candidate.ambulanceId,
      label: parts.join(' · '),
      source: 'Ranked candidate'
    })
  }

  for (const ambulance of ambulanceState.data.value?.ambulances ?? []) {
    if (!ambulance.crew?.crewProfileId) continue
    const parts = [ambulance.crew.crewProfileId, ambulance.registrationNumber]
    if (ambulance.vehicleType) parts.push(ambulance.vehicleType)
    if (ambulance.crew.availability) parts.push(ambulance.crew.availability)
    add({
      key: `${ambulance.crew.crewProfileId}:${ambulance.id}`,
      crewProfileId: ambulance.crew.crewProfileId,
      ambulanceId: ambulance.id,
      label: parts.join(' · '),
      source: 'Available vehicle'
    })
  }

  return [...options.values()]
})

const selectedAssignment = computed(() =>
  assignmentOptions.value.find((option) => option.key === selectedAssignmentKey.value) ?? null
)

const assignmentEmptyMessage = computed(() => booking.value?.isEscalated
  ? 'Escalated — manual assignment required. No ranked candidates were returned by the server.'
  : 'No assignable crew was returned. Load available vehicles or flag this request for manual assignment.'
)

const candidateView = computed(() => {
  if (!online.value) return 'offline'
  if (candidateState.pending.value && !candidateState.data.value) return 'loading'
  if (isOutOfScope(candidateState.error.value)) return 'empty'
  if (candidateState.error.value) return 'error'
  if (!candidateState.data.value) return 'idle'
  if (!candidateState.data.value.candidates.length) return 'empty'
  return 'data'
})

const ambulanceView = computed(() => {
  if (!online.value) return 'offline'
  if (ambulanceState.pending.value && !ambulanceState.data.value) return 'loading'
  if (isOutOfScope(ambulanceState.error.value)) return 'empty'
  if (ambulanceState.error.value) return 'error'
  if (!ambulanceState.data.value) return 'idle'
  if (!ambulanceState.data.value.ambulances.length) return 'empty'
  return 'data'
})

function serverKm(value: number | null): string {
  return value === null ? 'Unavailable' : `${value} km (server)`
}

function coordinates(lat: number | null, lng: number | null): string {
  if (lat === null || lng === null) return 'Unavailable'
  return `${lat}, ${lng}`
}

function errorDetail(error: ApiError | null): string {
  if (!error?.details) return ''
  if (typeof error.details === 'string') return error.details
  try {
    return JSON.stringify(error.details) ?? ''
  } catch {
    return ''
  }
}

function resetForms(): void {
  candidateLimit.value = ''
  ttlSeconds.value = ''
  assignmentReason.value = ''
  selectedAssignmentKey.value = ''
  escalationReason.value = ''
  contactRecipient.value = 'REQUESTER'
  contactTemplate.value = 'STATUS_UPDATE'
}

function loadDetail(): void {
  if (selectedId.value && online.value) void detailState.load()
}

function openDetail(id: string): void {
  selectedId.value = id
  detailState.data.value = null
  detailState.error.value = null
  candidateState.data.value = null
  candidateState.error.value = null
  ambulanceState.data.value = null
  ambulanceState.error.value = null
  actionError.value = null
  actionNotice.value = null
  activeAction.value = null
  resetForms()
  loadDetail()
}

function closeDetail(): void {
  selectedId.value = null
  detailState.data.value = null
  detailState.error.value = null
  candidateState.data.value = null
  ambulanceState.data.value = null
  actionError.value = null
  actionNotice.value = null
  activeAction.value = null
  resetForms()
}

function loadCandidates(): void {
  if (selectedId.value && online.value) void candidateState.load()
}

function loadAmbulances(): void {
  if (booking.value && online.value) void ambulanceState.load()
}

function confirmAction(message: string): boolean {
  return import.meta.client ? window.confirm(message) : false
}

function parseRoundInput(): DispatchRoundInput {
  const input: DispatchRoundInput = {}

  const limitRaw = candidateLimit.value.trim()
  if (limitRaw) {
    const limit = Number(limitRaw)
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new ApiError('Candidate limit must be a whole number between 1 and 20.', { field: 'candidateLimit' })
    }
    input.candidateLimit = limit
  }

  const ttlRaw = ttlSeconds.value.trim()
  if (ttlRaw) {
    const ttl = Number(ttlRaw)
    if (!Number.isInteger(ttl) || ttl < 10 || ttl > 300) {
      throw new ApiError('Offer lifetime must be a whole number between 10 and 300 seconds.', { field: 'ttlSeconds' })
    }
    input.ttlSeconds = ttl
  }

  return input
}

async function runAction(
  name: ActionName,
  confirmation: string,
  task: (id: string) => Promise<unknown>,
  successMessage = 'The server accepted the update.'
): Promise<void> {
  const id = selectedId.value
  if (!id) return
  if (!online.value) {
    actionError.value = new ApiError('You are offline. Reconnect before changing dispatch state.', {
      code: 'NETWORK_ERROR',
      isNetworkError: true
    })
    return
  }
  if (!confirmAction(confirmation)) return

  activeAction.value = name
  actionError.value = null
  actionNotice.value = null

  try {
    await task(id)
    await Promise.all([detailState.load(), queueState.load()])
    candidateState.data.value = null
    ambulanceState.data.value = null
    actionNotice.value = successMessage
  } catch (caught) {
    actionError.value = caught instanceof ApiError
      ? caught
      : new ApiError('Unable to complete this action.', { code: 'UNEXPECTED_ERROR' })
    // The backend can escalate a booking while reporting that no offers were sent.
    const code = actionError.value.code
    if (code === 'DISPATCH_ESCALATED' || code === 'NO_DISPATCH_CANDIDATES') {
      void detailState.load()
      void queueState.load()
    }
  } finally {
    activeAction.value = null
  }
}

function sendOffers(): void {
  void runAction(
    'offers',
    'Send dispatch offers to the best-ranked eligible crew for this request?',
    async (id) => {
      await service.startDispatch(id, parseRoundInput())
    },
    'Offer round created by the server. Crew acceptance is still required.'
  )
}

function retryOffers(): void {
  void runAction(
    'retry',
    'Offer this request to the next batch of eligible crew?',
    async (id) => {
      await service.retryDispatch(id, parseRoundInput())
    },
    'Next offer round created by the server. Crew acceptance is still required.'
  )
}

function assignSelected(): void {
  const option = selectedAssignment.value
  if (!option) return
  const reason = assignmentReason.value.trim()

  void runAction(
    'assign',
    `Assign crew ${option.crewProfileId} to this request? This changes the booking state.`,
    async (id) => {
      await service.manualAssign(id, {
        crewProfileId: option.crewProfileId,
        ambulanceId: option.ambulanceId,
        reason: reason || undefined
      })
    },
    'Crew assigned by the server.'
  )
}

function escalate(): void {
  const reason = escalationReason.value.trim()

  void runAction(
    'escalate',
    'Flag this request for manual assignment? This does not change its status.',
    async (id) => {
      if (reason && reason.length < 3) {
        throw new ApiError('Reason must be at least 3 characters.', { field: 'reason' })
      }
      await service.escalateBooking(id, reason ? { reason } : {})
    },
    'Request flagged for manual assignment. Status was not changed.'
  )
}

function sendContact(): void {
  const recipient = contactRecipient.value
  const template = contactTemplate.value

  void runAction(
    'contact',
    `Send the approved ${template} template to ${recipient}?`,
    async (id) => {
      await service.contactParty(id, { recipient, template })
    },
    'Approved contact request accepted by the server.'
  )
}

watch(online, (nowOnline) => {
  if (!nowOnline) return
  if (!queueState.data.value) loadQueue()
  if (selectedId.value && !detail.value) loadDetail()
})

onMounted(() => {
  if (online.value) loadQueue()
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
          <button
            class="mm-btn mm-btn--secondary"
            type="button"
            :disabled="!online || queueState.pending.value"
            @click="loadQueue"
          >
            Refresh
          </button>
        </UiPageHeader>

        <section class="mm-card" aria-labelledby="dispatch-queue-title">
          <h2 id="dispatch-queue-title" class="mm-card__title">Request queue</h2>

          <UiFilterBar label="Queue filters">
            <label>
              Status
              <select v-model="statusFilter">
                <option value="">Any status</option>
                <option v-for="status in BOOKING_STATUSES" :key="status" :value="status">
                  {{ statusLabel(status) }}
                </option>
              </select>
            </label>
            <label>
              Activity
              <select v-model="activeFilter">
                <option value="true">Active only</option>
                <option value="false">All requests</option>
              </select>
            </label>
            <label>
              Escalation
              <select v-model="escalatedFilter">
                <option value="">Any</option>
                <option value="true">Flagged for manual assignment</option>
                <option value="false">Not flagged</option>
              </select>
            </label>
            <button
              class="mm-btn"
              type="button"
              :disabled="!online || queueState.pending.value"
              @click="loadQueue"
            >
              Apply filters
            </button>
            <button class="mm-btn mm-btn--secondary" type="button" @click="resetFilters">
              Reset
            </button>
          </UiFilterBar>

          <UiStatePanel v-if="queueView === 'loading'" variant="loading" title="Loading request queue…" />
          <UiStatePanel
            v-else-if="queueView === 'offline'"
            variant="offline"
            title="Queue unavailable offline"
            message="Reconnect to load requests from the server."
            @retry="loadQueue"
          />
          <UiStatePanel
            v-else-if="queueView === 'error'"
            variant="error"
            title="Request queue could not be loaded"
            :message="errorMessage(queueState.error.value, 'The server did not return a queue.')"
            @retry="loadQueue"
          />
          <UiStatePanel
            v-else-if="queueView === 'empty'"
            variant="empty"
            :title="queueOutOfScope ? 'No dispatch data in your scope' : 'No requests match these filters'"
            :message="queueOutOfScope
              ? 'The server did not provide dispatch data for this role and state.'
              : 'Change the filters or wait for the server queue to receive a request.'"
          />
          <template v-else>
            <p class="mm-muted" style="margin-top: 0;">
              Showing {{ rows.length }} request{{ rows.length === 1 ? '' : 's' }} returned by the server.
              Open a request to review offers, candidates and dispatch actions.
            </p>
            <UiDataTable
              caption="Dispatch requests in your state"
              :columns="[
                { key: 'reference', label: 'Reference' },
                { key: 'status', label: 'Status' },
                { key: 'emergencyCategory', label: 'Emergency category' },
                { key: 'pickupAddress', label: 'Pickup' },
                { key: 'destAddress', label: 'Destination' },
                { key: 'requestedAt', label: 'Requested at (UTC)' },
                { key: 'dispatchRound', label: 'Round' },
                { key: 'escalation', label: 'Escalation' },
                { key: 'actions', label: 'Details' }
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
              <template #cell-escalation="{ value }">
                <span
                  class="mm-badge"
                  :class="value === 'Flagged' ? 'mm-badge--warning' : 'mm-badge--neutral'"
                >
                  {{ String(value) }}
                </span>
              </template>
              <template #cell-actions="{ row }">
                <button
                  class="mm-btn mm-btn--secondary"
                  type="button"
                  :aria-label="`Open details for ${String(row.reference)}`"
                  @click="openDetail(String(row.id))"
                >
                  Open
                </button>
              </template>
            </UiDataTable>
            <p class="mm-backend-gap" style="margin-top: 16px;">
              BACKEND GAP: there is no global live-fleet endpoint. A live map is outside this console;
              no vehicle positions or ETAs are inferred here.
            </p>
          </template>
        </section>

        <UiDetailDrawer
          :open="selectedId !== null"
          :title="booking ? `Request ${booking.reference}` : 'Request details'"
          @close="closeDetail"
        >
          <UiStatePanel v-if="detailView === 'loading'" variant="loading" title="Loading request details…" />
          <UiStatePanel
            v-else-if="detailView === 'offline'"
            variant="offline"
            title="Request details unavailable offline"
            message="Reconnect to load this request from the server."
            @retry="loadDetail"
          />
          <UiStatePanel
            v-else-if="detailView === 'error'"
            variant="error"
            title="Request details could not be loaded"
            :message="errorMessage(detailState.error.value, 'The server did not return request details.')"
            @retry="loadDetail"
          />
          <UiStatePanel
            v-else-if="detailView === 'empty'"
            variant="empty"
            :title="detailOutOfScope ? 'Request outside your scope' : 'Request details unavailable'"
            :message="detailOutOfScope
              ? 'The server did not provide this request for your role and state.'
              : 'Select a request from the queue to see its server-backed details.'"
          />
          <template v-else-if="detail && booking">
            <section class="mm-detail-section" aria-labelledby="dispatch-summary-title">
              <h3 id="dispatch-summary-title">Summary</h3>
              <div class="mm-inline-badges">
                <UiStatusBadge :status="booking.status" />
                <span
                  v-if="booking.isEscalated"
                  class="mm-badge mm-badge--warning"
                >
                  Flagged for manual assignment
                </span>
              </div>
              <dl class="mm-detail-list">
                <div>
                  <dt>Reference</dt>
                  <dd class="mm-mono">{{ booking.reference }}</dd>
                </div>
                <div>
                  <dt>Emergency category</dt>
                  <dd>{{ statusLabel(booking.emergencyCategory) }}</dd>
                </div>
                <div>
                  <dt>Requested</dt>
                  <dd>{{ formatTimestamp(booking.requestedAt) }}</dd>
                </div>
                <div>
                  <dt>Dispatch round</dt>
                  <dd>{{ booking.dispatchRound }}</dd>
                </div>
                <div>
                  <dt>Pickup</dt>
                  <dd>{{ booking.pickupAddress }}</dd>
                </div>
                <div>
                  <dt>Pickup coordinates</dt>
                  <dd class="mm-mono">{{ coordinates(booking.pickupLat, booking.pickupLng) }}</dd>
                </div>
                <div>
                  <dt>Destination</dt>
                  <dd>{{ booking.destAddress }}</dd>
                </div>
                <div>
                  <dt>Provider</dt>
                  <dd class="mm-mono">{{ booking.providerId }}</dd>
                </div>
                <div>
                  <dt>Assigned vehicle</dt>
                  <dd class="mm-mono">{{ booking.assignedAmbulanceId ?? 'Unavailable' }}</dd>
                </div>
                <div>
                  <dt>State</dt>
                  <dd class="mm-mono">{{ booking.stateId ?? 'Unavailable' }}</dd>
                </div>
              </dl>
              <p class="mm-muted">
                Patient identifiers, notes and medical detail are deliberately omitted by this endpoint.
              </p>
            </section>

            <section class="mm-detail-section" aria-labelledby="dispatch-tracking-title">
              <h3 id="dispatch-tracking-title">Dispatch and ETA</h3>
              <dl class="mm-detail-list">
                <div>
                  <dt>Tracking</dt>
                  <dd>{{ detail.tracking.isLive ? 'Live (server)' : 'Last known / not live' }}</dd>
                </div>
                <div>
                  <dt>ETA</dt>
                  <dd>{{ formatEta(detail.tracking.etaMinutes, detail.tracking.etaAt) }}</dd>
                </div>
                <div>
                  <dt>Distance remaining</dt>
                  <dd>{{ serverKm(detail.tracking.distanceRemainingKm) }}</dd>
                </div>
                <div>
                  <dt>Last fix recorded</dt>
                  <dd>{{ formatTimestamp(detail.tracking.location?.recordedAt) }}</dd>
                </div>
                <div>
                  <dt>Last fix status</dt>
                  <dd>{{ detail.tracking.location?.status ?? 'Unavailable' }}</dd>
                </div>
                <div>
                  <dt>Last fix source</dt>
                  <dd>{{ detail.tracking.lastKnownSource ?? detail.tracking.location?.source ?? 'Unavailable' }}</dd>
                </div>
              </dl>
              <p v-if="!detail.tracking.isLive" class="mm-muted">
                No live position is reported by the server. Last-known data is shown with its recorded time.
              </p>

              <div v-if="detail.tripLocations.length" class="mm-table-wrap">
                <table class="mm-table mm-table--compact">
                  <caption class="sr-only">Trip fixes recorded by the server</caption>
                  <thead>
                    <tr>
                      <th scope="col">Recorded (UTC)</th>
                      <th scope="col">Status</th>
                      <th scope="col">Source</th>
                      <th scope="col">Coordinates</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="fix in detail.tripLocations" :key="fix.id ?? String(fix.recordedAt)">
                      <td>{{ formatTimestamp(fix.recordedAt) }}</td>
                      <td>{{ fix.status }}</td>
                      <td>{{ fix.source }}</td>
                      <td class="mm-mono">{{ coordinates(fix.latitude, fix.longitude) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="mm-muted">No trip fixes have been recorded for this request.</p>
            </section>

            <section class="mm-detail-section" aria-labelledby="dispatch-history-title">
              <h3 id="dispatch-history-title">Status history</h3>
              <ol v-if="detail.history.length" class="mm-timeline">
                <li
                  v-for="entry in detail.history"
                  :key="entry.id ?? `${entry.createdAt}-${entry.toStatus}`"
                >
                  <strong>{{ statusLabel(entry.toStatus) }}</strong>
                  <span v-if="entry.fromStatus && entry.fromStatus !== entry.toStatus" class="mm-muted">
                    From {{ statusLabel(entry.fromStatus) }}
                  </span>
                  <span v-if="entry.reason">{{ entry.reason }}</span>
                  <small v-if="entry.actorRole">Actor: {{ entry.actorRole }}</small>
                  <time v-if="entry.createdAt" :datetime="entry.createdAt">
                    {{ formatTimestamp(entry.createdAt) }}
                  </time>
                </li>
              </ol>
              <p v-else class="mm-muted">The server returned no status history for this request.</p>
            </section>

            <section class="mm-detail-section" aria-labelledby="dispatch-offers-title">
              <h3 id="dispatch-offers-title">Offers</h3>
              <div v-if="detail.offers.length" class="mm-table-wrap">
                <table class="mm-table mm-table--compact">
                  <caption class="sr-only">Dispatch offers for this request</caption>
                  <thead>
                    <tr>
                      <th scope="col">Status</th>
                      <th scope="col">Round</th>
                      <th scope="col">Crew</th>
                      <th scope="col">Distance</th>
                      <th scope="col">Expires (UTC)</th>
                      <th scope="col">Responded</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="offer in detail.offers" :key="offer.id">
                      <td>
                        <span class="mm-mono">{{ offer.status }}</span>
                        <span v-if="offer.isLive" class="mm-badge mm-badge--success">Live</span>
                      </td>
                      <td>{{ offer.round }}</td>
                      <td class="mm-mono">{{ offer.crewProfileId }}</td>
                      <td>{{ serverKm(offer.distanceKm) }}</td>
                      <td>{{ formatTimestamp(offer.expiresAt) }}</td>
                      <td>
                        <span v-if="offer.respondedAt">{{ formatTimestamp(offer.respondedAt) }}</span>
                        <span v-else class="mm-muted">No response</span>
                        <span v-if="offer.rejectionReason" class="mm-muted">
                          {{ offer.rejectionReason }}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="mm-muted">No offers have been sent for this request.</p>
              <p class="mm-muted">
                An offer is not an assignment. Status changes only when crew accepts or a dispatcher assigns.
              </p>
            </section>

            <section class="mm-detail-section" aria-labelledby="dispatch-actions-title">
              <h3 id="dispatch-actions-title">Dispatch actions</h3>

              <p v-if="actionNotice" class="mm-notice" role="status">{{ actionNotice }}</p>
              <div v-if="actionError" class="mm-notice mm-notice--error" role="alert">
                <strong>{{ errorMessage(actionError, 'Unable to complete this action.') }}</strong>
                <span v-if="actionError.field" class="mm-field-error">Field: {{ actionError.field }}</span>
                <span v-if="errorDetail(actionError)" class="mm-mono">{{ errorDetail(actionError) }}</span>
              </div>

              <div class="mm-action-grid">
                <h4>Send offers</h4>
                <div class="mm-action-grid__row">
                  <label>
                    Candidate limit (1–20)
                    <input
                      v-model="candidateLimit"
                      type="number"
                      min="1"
                      max="20"
                      inputmode="numeric"
                      :disabled="actionDisabled"
                    />
                  </label>
                  <label>
                    Offer lifetime in seconds (10–300)
                    <input
                      v-model="ttlSeconds"
                      type="number"
                      min="10"
                      max="300"
                      inputmode="numeric"
                      :disabled="actionDisabled"
                    />
                  </label>
                </div>
                <div class="mm-action-grid__row">
                  <button
                    class="mm-btn"
                    type="button"
                    :disabled="!canOffer || actionDisabled"
                    @click="sendOffers"
                  >
                    {{ activeAction === 'offers' ? 'Sending…' : 'Send offers' }}
                  </button>
                  <button
                    class="mm-btn mm-btn--secondary"
                    type="button"
                    :disabled="!canRetry || actionDisabled"
                    @click="retryOffers"
                  >
                    {{ activeAction === 'retry' ? 'Retrying…' : 'Retry next batch' }}
                  </button>
                  <span class="mm-muted">Leave both fields blank to use the server defaults.</span>
                </div>
              </div>

              <div class="mm-action-grid">
                <h4>Manual assignment</h4>
                <div class="mm-action-grid__row">
                  <button
                    class="mm-btn mm-btn--secondary"
                    type="button"
                    :disabled="!online || candidateState.pending.value"
                    @click="loadCandidates"
                  >
                    Load ranked candidates
                  </button>
                  <button
                    class="mm-btn mm-btn--secondary"
                    type="button"
                    :disabled="!online || ambulanceState.pending.value"
                    @click="loadAmbulances"
                  >
                    Load available vehicles
                  </button>
                </div>

                <UiStatePanel
                  v-if="candidateView === 'loading'"
                  variant="loading"
                  title="Loading ranked candidates…"
                />
                <UiStatePanel
                  v-else-if="candidateView === 'error'"
                  variant="error"
                  title="Candidates could not be loaded"
                  :message="errorMessage(candidateState.error.value, 'The server did not return candidates.')"
                  @retry="loadCandidates"
                />
                <UiStatePanel
                  v-else-if="candidateView === 'offline'"
                  variant="offline"
                  title="Candidates unavailable offline"
                  message="Reconnect to load candidates."
                  @retry="loadCandidates"
                />
                <UiStatePanel
                  v-else-if="candidateView === 'empty'"
                  variant="empty"
                  title="No ranked candidates returned"
                  :message="assignmentEmptyMessage"
                />

                <UiStatePanel
                  v-if="ambulanceView === 'loading'"
                  variant="loading"
                  title="Loading available vehicles…"
                />
                <UiStatePanel
                  v-else-if="ambulanceView === 'error'"
                  variant="error"
                  title="Available vehicles could not be loaded"
                  :message="errorMessage(ambulanceState.error.value, 'The server did not return vehicles.')"
                  @retry="loadAmbulances"
                />
                <UiStatePanel
                  v-else-if="ambulanceView === 'offline'"
                  variant="offline"
                  title="Available vehicles unavailable offline"
                  message="Reconnect to load vehicles."
                  @retry="loadAmbulances"
                />
                <UiStatePanel
                  v-else-if="ambulanceView === 'empty'"
                  variant="empty"
                  title="No assignable vehicles returned"
                  message="Only verified, available vehicles with crew can be assigned by the server."
                />

                <label v-if="assignmentOptions.length">
                  Crew and vehicle
                  <select v-model="selectedAssignmentKey" :disabled="actionDisabled">
                    <option value="">Select a crew member…</option>
                    <option v-for="option in assignmentOptions" :key="option.key" :value="option.key">
                      [{{ option.source }}] {{ option.label }}
                    </option>
                  </select>
                </label>
                <label>
                  Reason (optional)
                  <input
                    v-model="assignmentReason"
                    type="text"
                    maxlength="500"
                    placeholder="Reason recorded in the status history"
                    :disabled="actionDisabled"
                  />
                </label>
                <button
                  class="mm-btn"
                  type="button"
                  :disabled="!canAssign || !selectedAssignment || actionDisabled"
                  @click="assignSelected"
                >
                  {{ activeAction === 'assign' ? 'Assigning…' : 'Assign / reassign crew' }}
                </button>
                <p class="mm-muted">
                  Manual assignment moves a REQUESTED or OFFERED booking to ACCEPTED. It cancels live offers.
                </p>
              </div>

              <div class="mm-action-grid">
                <h4>Escalation</h4>
                <label>
                  Reason (optional, minimum 3 characters)
                  <input
                    v-model="escalationReason"
                    type="text"
                    maxlength="500"
                    placeholder="Reason recorded in the status trail"
                    :disabled="actionDisabled"
                  />
                </label>
                <button
                  class="mm-btn mm-btn--secondary"
                  type="button"
                  :disabled="!canEscalate || actionDisabled"
                  @click="escalate"
                >
                  {{ activeAction === 'escalate' ? 'Flagging…' : 'Flag for manual assignment' }}
                </button>
                <p v-if="booking.isEscalated" class="mm-notice mm-notice--warning">
                  Already flagged. Escalation does not change booking status.
                </p>
                <p v-else class="mm-muted">
                  Escalation does not change booking status. It only flags the request for manual assignment.
                </p>
              </div>

              <div class="mm-action-grid">
                <h4>Approved contact</h4>
                <div class="mm-action-grid__row">
                  <label>
                    Recipient
                    <select v-model="contactRecipient" :disabled="actionDisabled">
                      <option v-for="recipient in CONTACT_RECIPIENTS" :key="recipient" :value="recipient">
                        {{ recipient }}
                      </option>
                    </select>
                  </label>
                  <label>
                    Template
                    <select v-model="contactTemplate" :disabled="actionDisabled">
                      <option v-for="template in CONTACT_TEMPLATES" :key="template" :value="template">
                        {{ template }}
                      </option>
                    </select>
                  </label>
                </div>
                <button
                  class="mm-btn mm-btn--secondary"
                  type="button"
                  :disabled="!canContact || actionDisabled"
                  @click="sendContact"
                >
                  {{ activeAction === 'contact' ? 'Sending…' : 'Send approved notification' }}
                </button>
                <p class="mm-muted">
                  Only a fixed recipient and template are sent. No free-text message or PHI is accepted.
                </p>
              </div>
            </section>
          </template>
        </UiDetailDrawer>
      </RoleGate>
    </ModuleErrorBoundary>
  </div>
</template>
