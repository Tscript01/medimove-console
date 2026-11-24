/** Tiny event bus so the HTTP layer can end a session without touching UI. */
type Listener = (reason: string) => void

const listeners = new Set<Listener>()

export function onAuthExpired(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emitAuthExpired(reason = 'Your session has ended. Please sign in again.'): void {
  for (const listener of listeners) listener(reason)
}
