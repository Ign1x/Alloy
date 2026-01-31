export const CSRF_COOKIE_NAME = 'csrf'

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
