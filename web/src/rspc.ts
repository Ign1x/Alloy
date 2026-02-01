import { createClient, FetchTransport } from '@rspc/client'
import { QueryClient } from '@tanstack/solid-query'
import { createSolidQueryHooks } from '@rspc/solid-query'

import type { ProceduresLegacy } from './bindings'
import { getCsrfTokenFromCookie, refreshSession } from './auth'

export type AuthEvent = { type: 'auth-expired' }
const authEvents = new EventTarget()

export function onAuthEvent(cb: (e: AuthEvent) => void): () => void {
  const handler = (ev: Event) => cb((ev as CustomEvent<AuthEvent>).detail)
  authEvents.addEventListener('auth', handler)
  return () => authEvents.removeEventListener('auth', handler)
}

function emitAuthExpired() {
  authEvents.dispatchEvent(new CustomEvent<AuthEvent>('auth', { detail: { type: 'auth-expired' } }))
}

export const client = createClient<ProceduresLegacy>({
  // Use same-origin by default; Vite proxies /rspc in dev.
  transport: new FetchTransport('/rspc', (url, init) => {
    const headers = new Headers(init?.headers)
    const csrf = getCsrfTokenFromCookie()
    if (csrf) headers.set('x-csrf-token', csrf)

    const doFetch = (attempt: number): Promise<Response> =>
      fetch(url, {
        ...init,
        credentials: 'include',
        headers,
      }).then(async (resp) => {
        if (resp.status !== 401) return resp

        // Only retry once; if refresh fails, let the UI handle re-auth.
        if (attempt >= 1) {
          emitAuthExpired()
          return resp
        }

        try {
          await refreshSession()
        } catch {
          emitAuthExpired()
          return resp
        }
        return doFetch(attempt + 1)
      })

    return doFetch(0)
  }),
})

export const queryClient = new QueryClient()

export const rspc = createSolidQueryHooks<ProceduresLegacy>()
