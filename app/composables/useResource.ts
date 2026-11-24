import { ApiError } from './useApi'

/**
 * Small, honest fetch state machine for read-only dashboard stubs.
 * It never fabricates data: an error clears the previous response so the
 * module shows the backend envelope message instead of stale numbers.
 */
export function useResource<T>(fetcher: () => Promise<T>) {
  const data = ref<T | null>(null)
  const error = ref<ApiError | null>(null)
  const pending = ref(false)

  async function load(): Promise<void> {
    pending.value = true
    error.value = null
    try {
      data.value = await fetcher()
    } catch (caught) {
      data.value = null
      error.value = caught instanceof ApiError
        ? caught
        : new ApiError('Unable to load this section.', { code: 'UNEXPECTED_ERROR' })
    } finally {
      pending.value = false
    }
  }

  return { data, error, pending, load }
}
