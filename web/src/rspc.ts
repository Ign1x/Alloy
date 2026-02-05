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

function toErrorString(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  if (value instanceof Error) return value.message
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function parseFieldErrors(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
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

  private normalizeRspcError(data: unknown, meta: { key: string; operation: OperationType; httpStatus: number }): AlloyApiError {
    if (isPlainObject(data)) {
      const code =
        typeof data.code === 'string'
          ? data.code
          : typeof data.error === 'string'
            ? data.error
            : typeof data.type === 'string'
              ? data.type
              : 'rspc_error'

      const message =
        typeof data.message === 'string'
          ? data.message
          : typeof data.error === 'string'
            ? data.error
            : toErrorString(data)

      const request_id =
        typeof data.request_id === 'string'
          ? data.request_id
          : typeof data.requestId === 'string'
            ? data.requestId
            : ''

      const field_errors = parseFieldErrors((data as any).field_errors ?? (data as any).fieldErrors)
      const hint = typeof data.hint === 'string' ? data.hint : null

      return new AlloyApiError({ code, message, request_id, field_errors, hint })
    }

    if (typeof data === 'string' && data.trim()) {
      return new AlloyApiError({ code: 'rspc_error', message: data, request_id: '', hint: null })
    }

    return new AlloyApiError({
      code: 'rspc_error',
      message: `RSPC error (${meta.operation} ${meta.key}, HTTP ${meta.httpStatus})`,
      request_id: '',
      hint: null,
    })
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

    const respBody = (await (async () => {
      try {
        // Use a clone so we can still read text for better errors if JSON parsing fails.
        return (await resp.clone().json()) as unknown
      } catch {
        let text = ''
        try {
          text = await resp.text()
        } catch {
          // ignore
        }
        const msg = text.trim()
          ? `HTTP ${resp.status} ${resp.statusText}: ${text.slice(0, 240)}`
          : `HTTP ${resp.status} ${resp.statusText}: non-JSON response`
        throw new AlloyApiError({ code: 'http_error', message: msg, request_id: '', hint: null })
      }
    })()) as unknown
    if (!isPlainObject(respBody) || !isPlainObject(respBody.result)) {
      throw new AlloyApiError({
        code: 'invalid_rspc_response',
        message: `Invalid RSPC response (HTTP ${resp.status} ${resp.statusText})`,
        request_id: '',
        hint: null,
      })
    }

    const { type, data } = respBody.result as { type?: unknown; data?: unknown }
    if (type === 'error') {
      throw this.normalizeRspcError(data, { key, operation, httpStatus: resp.status })
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
