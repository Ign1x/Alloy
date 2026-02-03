import { createClient } from '@rspc/client'
import { QueryClient } from '@tanstack/solid-query'
import { createSolidQueryHooks } from '@rspc/solid-query'

import type { ProceduresLegacy } from './bindings'
import { getCsrfTokenFromCookie, refreshSession } from './auth'

export type AlloyApiErrorData = {
  code: string
  message: string
  request_id: string
  field_errors?: Record<string, string>
  hint?: string | null
}

export class AlloyApiError extends Error {
  data: AlloyApiErrorData
  constructor(data: AlloyApiErrorData) {
    super(data.message)
    this.name = 'AlloyApiError'
    this.data = data
  }
}

export function isAlloyApiError(err: unknown): err is AlloyApiError {
  return err instanceof AlloyApiError
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

type OperationType = 'query' | 'mutation' | 'subscription' | 'subscriptionStop'

class AlloyFetchTransport {
  private url: string
  private fetch: typeof globalThis.fetch
  clientSubscriptionCallback?: (id: string, key: string, value: any) => void

  constructor(url: string, fetch?: typeof globalThis.fetch) {
    this.url = url
    this.fetch = fetch || globalThis.fetch.bind(globalThis)
  }

  async doRequest(operation: OperationType, key: string, input: any): Promise<any> {
    if (operation === 'subscription' || operation === 'subscriptionStop') {
      throw new Error(
        `Subscribing to '${key}' failed as the HTTP transport does not support subscriptions! Maybe try using the websocket transport?`,
      )
    }

    let method = 'GET'
    let body: string | undefined
    const headers = new Headers()
    const params = new URLSearchParams()

    if (operation === 'query') {
      if (input !== undefined) {
        params.append('input', JSON.stringify(input))
      }
    } else if (operation === 'mutation') {
      method = 'POST'
      body = JSON.stringify(input || {})
      headers.set('Content-Type', 'application/json')
    }

    const paramsStr = params.toString()
    const resp = await this.fetch(`${this.url}/${key}${paramsStr.length > 0 ? `?${paramsStr}` : ''}`, {
      method,
      body,
      headers,
    })

    const respBody = (await resp.json()) as unknown
    if (!isPlainObject(respBody) || !isPlainObject(respBody.result)) {
      throw new Error('invalid rspc response')
    }

    const { type, data } = respBody.result as { type?: unknown; data?: unknown }
    if (type === 'error') {
      if (isPlainObject(data) && typeof data.code === 'string' && typeof data.message === 'string') {
        throw new AlloyApiError({
          code: data.code,
          message: data.message,
          request_id: typeof data.request_id === 'string' ? data.request_id : '',
          field_errors: isPlainObject(data.field_errors) ? (data.field_errors as Record<string, string>) : undefined,
          hint: typeof data.hint === 'string' ? data.hint : null,
        })
      }
      throw new Error('rspc error')
    }

    return data
  }
}

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
  transport: new AlloyFetchTransport('/rspc', (url, init) => {
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
