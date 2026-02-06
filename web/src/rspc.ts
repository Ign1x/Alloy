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

const API_ERROR_JSON_PREFIX = 'ALLOY_API_ERROR_JSON:'

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

function parseApiErrorFromLegacyMessage(raw: string): AlloyApiErrorData | null {
  const s = raw.trim()
  if (!s.startsWith(API_ERROR_JSON_PREFIX)) return null
  const json = s.slice(API_ERROR_JSON_PREFIX.length).trim()
  if (!json) return null
  try {
    const value = JSON.parse(json) as unknown
    if (!isPlainObject(value)) return null
    if (typeof value.code !== 'string' || typeof value.message !== 'string') return null
    const request_id = typeof value.request_id === 'string' ? value.request_id : ''
    const field_errors = parseFieldErrors((value as any).field_errors ?? (value as any).fieldErrors)
    const hint = typeof (value as any).hint === 'string' ? (value as any).hint : null
    return { code: value.code, message: value.message, request_id, field_errors, hint }
  } catch {
    return null
  }
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

  private normalizeRspcError(
    data: unknown,
    meta: { key: string; operation: OperationType; httpStatus: number; requestId: string },
  ): AlloyApiError {
    if (isPlainObject(data)) {
      const legacyMsg =
        typeof data.message === 'string'
          ? data.message
          : typeof data.error === 'string'
            ? data.error
            : ''
      if (legacyMsg.trim()) {
        const parsed = parseApiErrorFromLegacyMessage(legacyMsg)
        if (parsed) {
          return new AlloyApiError({
            ...parsed,
            request_id: parsed.request_id || meta.requestId,
          })
        }
        const raw = legacyMsg.trim()
        if (raw.startsWith('Resolver(') || raw.includes('ResolverError')) {
          return new AlloyApiError({
            code: 'internal',
            message: 'Backend resolver error. Please retry.',
            request_id: meta.requestId,
            hint: raw,
          })
        }
      }

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

      const request_id_raw =
        typeof data.request_id === 'string'
          ? data.request_id
          : typeof data.requestId === 'string'
            ? data.requestId
            : ''
      const request_id = request_id_raw || meta.requestId

      const field_errors = parseFieldErrors((data as any).field_errors ?? (data as any).fieldErrors)
      const hint = typeof data.hint === 'string' ? data.hint : null

      return new AlloyApiError({ code, message, request_id, field_errors, hint })
    }

    if (typeof data === 'string' && data.trim()) {
      const raw = data.trim()
      const parsed = parseApiErrorFromLegacyMessage(raw)
      if (parsed) {
        return new AlloyApiError({
          ...parsed,
          request_id: parsed.request_id || meta.requestId,
        })
      }
      if (raw.startsWith('Resolver(') || raw.includes('ResolverError')) {
        return new AlloyApiError({
          code: 'internal',
          message: 'Backend resolver error. Please retry.',
          request_id: meta.requestId,
          hint: raw,
        })
      }
      return new AlloyApiError({ code: 'rspc_error', message: raw, request_id: meta.requestId, hint: null })
    }

    return new AlloyApiError({
      code: 'rspc_error',
      message: `RSPC error (${meta.operation} ${meta.key}, HTTP ${meta.httpStatus})`,
      request_id: meta.requestId,
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
    const requestId = (resp.headers.get('x-request-id') || '').trim()

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
        throw new AlloyApiError({ code: 'http_error', message: msg, request_id: requestId, hint: null })
      }
    })()) as unknown
    if (!isPlainObject(respBody) || !isPlainObject(respBody.result)) {
      throw new AlloyApiError({
        code: 'invalid_rspc_response',
        message: `Invalid RSPC response (HTTP ${resp.status} ${resp.statusText})`,
        request_id: requestId,
        hint: null,
      })
    }

    const { type, data } = respBody.result as { type?: unknown; data?: unknown }
    if (type === 'error') {
      throw this.normalizeRspcError(data, { key, operation, httpStatus: resp.status, requestId })
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
