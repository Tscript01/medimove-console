<script setup lang="ts">
import { statusLabel, statusTone } from '~/utils/display'

const props = withDefaults(defineProps<{
  status: string | null | undefined
  /** Override only when the enum needs extra context, e.g. "Last known". */
  label?: string
  tone?: 'success' | 'warning' | 'danger' | 'neutral'
}>(), { label: undefined, tone: undefined })

const resolvedTone = computed(() => props.tone ?? statusTone(props.status))
const resolvedLabel = computed(() => props.label ?? statusLabel(props.status))
</script>

<template>
  <span class="mm-badge" :class="`mm-badge--${resolvedTone}`">
    <span aria-hidden="true">●</span>
    {{ resolvedLabel }}
  </span>
</template>
