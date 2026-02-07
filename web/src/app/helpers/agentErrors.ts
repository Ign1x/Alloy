import type { ProcessStatusDto } from '../../bindings'

const AGENT_ERROR_PREFIX = 'ALLOY_ERROR_JSON:'

export type AgentErrorPayload = {
  code: string
  message: string
  field_errors?: Record<string, string> | null
  hint?: string | null
}

export function parseAgentErrorPayload(raw: string | null | undefined): AgentErrorPayload | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s.startsWith(AGENT_ERROR_PREFIX)) return null
  try {
    const parsed = JSON.parse(s.slice(AGENT_ERROR_PREFIX.length)) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const p = parsed as Record<string, unknown>
    if (typeof p.code !== 'string' || typeof p.message !== 'string') return null
    return {
      code: p.code,
      message: p.message,
      field_errors: typeof p.field_errors === 'object' ? (p.field_errors as Record<string, string>) : null,
      hint: typeof p.hint === 'string' ? p.hint : null,
    }
  } catch {
    return null
  }
}

export function statusMessageParts(status: ProcessStatusDto | null): { text: string | null; code: string | null; hint: string | null } {
  const raw = status?.message ?? null
  const payload = parseAgentErrorPayload(raw)
  if (payload) return { text: payload.message, code: payload.code, hint: payload.hint ?? null }
  return { text: raw, code: null, hint: null }
}
