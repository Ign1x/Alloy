export function parsePort(value: unknown): number | null {
  if (value == null) return null
  const n = Number.parseInt(String(value), 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

export function instancePort(info: { config: { template_id: string; params: unknown } }): number | null {
  const params = info.config.params as Record<string, unknown> | null | undefined
  return parsePort(params?.port)
}

export function connectHost() {
  try {
    return window.location.hostname || 'localhost'
  } catch {
    return 'localhost'
  }
}

export function defaultControlWsUrl() {
  try {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const host = window.location.host || 'localhost'
    return `${proto}://${host}/agent/ws`
  } catch {
    return 'ws://<panel-host>/agent/ws'
  }
}

export type FrpConfigFormat = 'ini' | 'json' | 'toml' | 'yaml' | 'unknown'

export function detectFrpConfigFormat(config: string | null | undefined): FrpConfigFormat {
  const raw = (config ?? '').trim()
  if (!raw) return 'unknown'

  try {
    const v = JSON.parse(raw) as unknown
    if (v && typeof v === 'object') return 'json'
  } catch {
    // ignore
  }

  if (/^\s*common\s*:/m.test(raw) || /^\s*proxies\s*:/m.test(raw)) return 'yaml'
  if (/^\s*\[\[\s*proxies\s*\]\]/m.test(raw)) return 'toml'
  if (/^\s*\[\s*common\s*\]/m.test(raw)) return 'ini'
  if (/^\s*\[\s*[A-Za-z0-9_.-]+\s*\]\s*$/m.test(raw)) return 'toml'

  return 'unknown'
}

export function parseFrpEndpoint(config: string | null | undefined): string | null {
  const raw = (config ?? '').trim()
  if (!raw) return null

  try {
    const v = JSON.parse(raw) as unknown as {
      common?: { server_addr?: unknown; server_port?: unknown }
    }
    const addr = typeof v?.common?.server_addr === 'string' ? v.common.server_addr.trim() : ''
    const portRaw = v?.common?.server_port
    const port = typeof portRaw === 'number' || typeof portRaw === 'string' ? String(portRaw).trim() : ''
    if (addr && port) return `${addr}:${port}`
  } catch {
    // ignore
  }

  if (/^\s*common\s*:/m.test(raw)) {
    const addr = /^\s*server_addr\s*:\s*(.+)$/m.exec(raw)?.[1]?.trim() ?? ''
    const port = /^\s*server_port\s*:\s*(.+)$/m.exec(raw)?.[1]?.trim() ?? ''
    if (addr && port) return `${addr}:${port}`
  }

  if (/^\s*\[\s*common\s*\]/m.test(raw)) {
    let serverAddr: string | null = null
    let serverPort: string | null = null
    let section: string | null = null

    for (const lineRaw of raw.split('\n')) {
      const line = lineRaw.trim()
      if (!line || line.startsWith('#') || line.startsWith(';')) continue

      const sec = /^\[(.+)\]$/.exec(line)
      if (sec) {
        section = sec[1].trim().toLowerCase()
        continue
      }

      const kv = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)\s*$/.exec(line)
      if (!kv) continue
      const key = kv[1].trim().toLowerCase()
      let val = kv[2].trim()
      val = val.replace(/\s*[#;].*$/, '').trim()
      val = val.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')

      if (section !== 'common') continue
      if (key === 'server_addr') serverAddr = val
      if (key === 'server_port') serverPort = val
    }

    if (serverAddr && serverPort) return `${serverAddr}:${serverPort}`
  }

  return null
}

function parsePortInRange(raw: string): number | null {
  const text = raw.trim()
  if (!/^\d+$/.test(text)) return null
  const port = Number.parseInt(text, 10)
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null
  return port
}

export function compactAllocatablePortsSpec(value: string | null | undefined): string {
  const raw = (value ?? '').trim()
  if (!raw) return ''

  const expanded = new Set<number>()
  for (const seg of raw.split(',')) {
    const token = seg.trim()
    if (!token) continue

    const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)$/)
    if (rangeMatch) {
      const a = parsePortInRange(rangeMatch[1])
      const b = parsePortInRange(rangeMatch[2])
      if (a == null || b == null) continue
      const lo = Math.min(a, b)
      const hi = Math.max(a, b)
      if (hi - lo > 4000) continue
      for (let p = lo; p <= hi; p++) {
        expanded.add(p)
        if (expanded.size > 4000) break
      }
      continue
    }

    const port = parsePortInRange(token)
    if (port != null) {
      expanded.add(port)
      if (expanded.size > 4000) break
    }
  }

  if (expanded.size === 0) return ''

  const sorted = [...expanded].sort((a, b) => a - b)
  const out: string[] = []
  let start = sorted[0]
  let prev = sorted[0]

  for (let i = 1; i < sorted.length; i++) {
    const port = sorted[i]
    if (port === prev + 1) {
      prev = port
      continue
    }
    out.push(start === prev ? `${start}` : `${start}-${prev}`)
    start = port
    prev = port
  }
  out.push(start === prev ? `${start}` : `${start}-${prev}`)
  return out.join(',')
}

export function formatLatencyMs(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'offline'
  if (value <= 0) return '<1 ms'
  return `${Math.floor(value)} ms`
}
