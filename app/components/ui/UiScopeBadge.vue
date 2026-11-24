<script setup lang="ts">
import type { Role } from '~/types/auth'
import { roleLabel } from '~/utils/roleRouting'

const props = defineProps<{
  role: Role | null | undefined
  stateId?: string | null
}>()

const label = computed(() => {
  if (!props.role) return 'No scope'
  if (props.role === 'PLATFORM_ADMIN') return 'Platform'
  if (props.stateId) return `State · ${props.stateId}`
  return roleLabel(props.role)
})
</script>

<template>
  <span class="mm-badge mm-badge--neutral" :aria-label="`Data scope: ${label}`">
    {{ label }}
  </span>
</template>
