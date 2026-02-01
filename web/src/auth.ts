export const CSRF_COOKIE_NAME = 'csrf'
const CSRF_HEADER_NAME = 'x-csrf-token'

function getCookie(name: string): string | null {
  // Basic cookie parsing; sufficient for our short random tokens.
  const parts = document.cookie.split(';')
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const k = trimmed.slice(0, eq)
    const v = trimmed.slice(eq + 1)
    if (k === name) return decodeURIComponent(v)
  }
  return null
}

export function getCsrfTokenFromCookie(): string | null {
  return getCookie(CSRF_COOKIE_NAME)
}

export async function ensureCsrfCookie(): Promise<string> {
  const existing = getCsrfTokenFromCookie()
  if (existing) return existing

  const resp = await fetch('/auth/csrf', {
    method: 'GET',
    credentials: 'include',
  })
  if (!resp.ok) throw new Error(`csrf failed: ${resp.status}`)
  const data = (await resp.json()) as { token?: string }
  const token = data.token
  if (!token) throw new Error('csrf failed: missing token')
  return token
}

export type WhoamiResponse = {
  user_id: string
  username: string
  is_admin: boolean
}

export type LoginRequest = {
  username: string
  password: string
}

async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const csrf = await ensureCsrfCookie()
  const headers = new Headers(init?.headers)
  headers.set(CSRF_HEADER_NAME, csrf)

  return fetch(input, {
    ...init,
    credentials: 'include',
    headers,
  })
}

export async function whoami(): Promise<WhoamiResponse | null> {
  const resp = await fetch('/auth/whoami', { method: 'GET', credentials: 'include' })
  if (resp.status === 401) return null
  if (!resp.ok) throw new Error(`whoami failed: ${resp.status}`)
  return (await resp.json()) as WhoamiResponse
}

export async function login(req: LoginRequest): Promise<WhoamiResponse> {
  const resp = await authFetch('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (resp.status === 401) throw new Error('invalid username or password')
  if (!resp.ok) throw new Error(`login failed: ${resp.status}`)
  return (await resp.json()) as WhoamiResponse
}

export async function logout(): Promise<void> {
  const resp = await authFetch('/auth/logout', { method: 'POST' })
  if (!resp.ok && resp.status !== 401) throw new Error(`logout failed: ${resp.status}`)
}

let refreshInFlight: Promise<void> | null = null

export async function refreshSession(): Promise<void> {
  // Refresh rotates the refresh token; guard against concurrent calls.
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const resp = await authFetch('/auth/refresh', { method: 'POST' })
      if (resp.status === 401) return
      if (!resp.ok) throw new Error(`refresh failed: ${resp.status}`)
    })().finally(() => {
      refreshInFlight = null
    })
  }
  await refreshInFlight
}
