/** Reactive network state for honest offline states (no cached fake data). */
export function useOnline() {
  const online = useState<boolean>('medimove:online', () => true)
  const checked = useState<boolean>('medimove:online-checked', () => false)

  if (import.meta.client && !checked.value) {
    checked.value = true
    online.value = navigator.onLine
    window.addEventListener('online', () => { online.value = true })
    window.addEventListener('offline', () => { online.value = false })
  }

  return { online, readonlyOnline: computed(() => online.value) }
}
