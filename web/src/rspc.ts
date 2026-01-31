import { createClient, FetchTransport } from '@rspc/client'
import { QueryClient } from '@tanstack/solid-query'
import { createSolidQueryHooks } from '@rspc/solid-query'

import type { ProceduresLegacy } from './bindings'
import { getCsrfTokenFromCookie } from './auth'

export const client = createClient<ProceduresLegacy>({
  // Use same-origin by default; Vite proxies /rspc in dev.
  transport: new FetchTransport('/rspc', (url, init) => {
    const headers = new Headers(init?.headers)
    const csrf = getCsrfTokenFromCookie()
    if (csrf) headers.set('x-csrf-token', csrf)

    return fetch(url, {
      ...init,
      credentials: 'include',
      headers,
    })
  }),
})

export const queryClient = new QueryClient()

export const rspc = createSolidQueryHooks<ProceduresLegacy>()
