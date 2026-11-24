<script setup lang="ts">
const props = defineProps<{ open: boolean; title: string }>()
const emit = defineEmits<{ close: [] }>()

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

watch(
  () => props.open,
  (open) => {
    if (import.meta.client) {
      if (open) window.addEventListener('keydown', onKeydown)
      else window.removeEventListener('keydown', onKeydown)
    }
  }
)

onBeforeUnmount(() => {
  if (import.meta.client) window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport v-if="open" to="body">
    <div class="mm-drawer-scrim" aria-hidden="true" @click="emit('close')" />
    <aside class="mm-drawer" role="dialog" aria-modal="true" :aria-label="title">
      <header>
        <h2>{{ title }}</h2>
        <button class="mm-btn mm-btn--secondary mm-drawer__close" type="button" aria-label="Close details" @click="emit('close')">
          Close
        </button>
      </header>
      <div class="mm-drawer__body"><slot /></div>
    </aside>
  </Teleport>
</template>
