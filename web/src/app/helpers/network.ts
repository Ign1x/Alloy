export function parsePort(value: unknown): number | null {
  if (value == null) return null
  const n = Number.parseInt(String(value), 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function normalizeHost(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  if (v.startsWith('[') && v.endsWith(']')) return v.slice(1, -1).trim().toLowerCase() || null
  return v.toLowerCase()
}

function isLoopbackOrUnspecifiedHost(host: string | null | undefined): boolean {
  const h = normalizeHost(host)
  if (!h) return true
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0' || h === '::'
}

function parseIpv4(host: string | null | undefined): [number, number, number, number] | null {
  const h = normalizeHost(host)
  if (!h) return null
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return null
  const out = [Number.parseInt(m[1], 10), Number.parseInt(m[2], 10), Number.parseInt(m[3], 10), Number.parseInt(m[4], 10)]
  if (out.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null
  return out as [number, number, number, number]
}

function isPrivateIpv4(host: string | null | undefined): boolean {
  const ip = parseIpv4(host)
  if (!ip) return false
  const [a, b] = ip
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  return false
}

function endpointHost(endpoint: string | null | undefined): string | null {
  const raw = (endpoint ?? '').trim()
  if (!raw) return null
  if (raw.startsWith('tunnel://')) return null
  try {
    const u = new URL(raw)
    return normalizeHost(u.hostname)
  } catch {
    const value = normalizeHost(raw)
    if (!value) return null
    const noPath = value.split('/')[0]?.trim() ?? value
    if (!noPath) return null
    if (noPath.startsWith('[') && noPath.includes(']')) {
      const end = noPath.indexOf(']')
      if (end > 1) return normalizeHost(noPath.slice(0, end + 1))
      return null
    }
    const idx = noPath.indexOf(':')
    if (idx <= 0) return noPath
    return noPath.slice(0, idx)
  }
}

export type NodeAddressHints = {
  public_ip?: string | null
  private_ip?: string | null
  endpoint?: string | null
}

export function preferredNodeHost(node?: NodeAddressHints | null): string | null {
  const publicIp = normalizeHost(node?.public_ip)
  if (publicIp && !isLoopbackOrUnspecifiedHost(publicIp) && !isPrivateIpv4(publicIp)) return publicIp

  const privateIp = normalizeHost(node?.private_ip)
  if (privateIp && !isLoopbackOrUnspecifiedHost(privateIp)) return privateIp

  const fromEndpoint = endpointHost(node?.endpoint)
  if (fromEndpoint && !isLoopbackOrUnspecifiedHost(fromEndpoint)) return fromEndpoint

  return null
}

export function buildDirectConnectAddress(port: number, node?: NodeAddressHints | null): string {
  const host = preferredNodeHost(node) ?? '127.0.0.1'
  return `${host}:${port}`
}

export function instancePort(info: { config: { template_id: string; params: unknown } }): number | null {
  const params = info.config.params as Record<string, unknown> | null | undefined
  const templateId = String(info.config.template_id || '')
  if (templateId === 'dst:vanilla') return parsePort(params?.port)
  if (templateId === 'palworld:vanilla') return parsePort(params?.port)
  if (templateId === 'factorio:vanilla') return parsePort(params?.port)
  return parsePort(params?.port)
}

function normalizeControlWsUrl(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim()
  if (!raw) return null

  const [proto, rest] = raw.startsWith('wss://')
    ? ['wss', raw.slice('wss://'.length)]
    : raw.startsWith('ws://')
      ? ['ws', raw.slice('ws://'.length)]
      : raw.startsWith('https://')
        ? ['wss', raw.slice('https://'.length)]
        : raw.startsWith('http://')
          ? ['ws', raw.slice('http://'.length)]
          : ['', '']

  if (!proto || !rest) return null

  const sanitized = rest.split('#')[0]?.split('?')[0]?.trim().replace(/\/+$/, '')
  if (!sanitized) return null

  const authority = sanitized.split('/')[0]?.trim()
  if (!authority) return null

  const path = sanitized.endsWith('/agent/ws') ? sanitized : `${sanitized}/agent/ws`
  return `${proto}://${path}`
}

export function defaultControlWsUrl(preferred?: string | null) {
  const suggested = normalizeControlWsUrl(preferred)
  if (suggested) return suggested

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

function parseAllocatablePortsSpec(raw: string): number[] {
  const out = new Set<number>()
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
        out.add(p)
        if (out.size > 4000) break
      }
      continue
    }

    const port = parsePortInRange(token)
    if (port != null) {
      out.add(port)
      if (out.size > 4000) break
    }
  }
  return [...out].sort((a, b) => a - b)
}

function pickRemotePort(remotePort: number | null, allocPorts: number[], localPort: number | null): number | null {
  if (allocPorts.length > 0 && localPort != null && localPort > 0) {
    return allocPorts[localPort % allocPorts.length] ?? null
  }
  if (remotePort != null && remotePort > 0) return remotePort
  if (localPort != null && localPort > 0) return localPort
  return null
}

export function parseFrpPublicEndpoint(config: string | null | undefined, localPort?: number | null): string | null {
  const raw = (config ?? '').trim()
  if (!raw) return null

  const serverEndpoint = parseFrpEndpoint(raw)
  if (!serverEndpoint) return null
  const split = serverEndpoint.lastIndexOf(':')
  if (split <= 0) return null
  const serverAddr = serverEndpoint.slice(0, split).trim()
  if (!serverAddr) return null

  const remoteByEq = /(?:^|\s)remote_port\s*[=:]\s*['"]?(\d+)['"]?/im.exec(raw)?.[1] ?? null
  const remoteByCamel = /(?:^|\s)remotePort\s*[=:]\s*['"]?(\d+)['"]?/im.exec(raw)?.[1] ?? null
  const parsedRemote = parsePort(remoteByEq ?? remoteByCamel)

  const allocRaw =
    /(?:^|\s)(?:alloy_alloc_ports|allocatable_ports)\s*[=:]\s*(.+)$/im.exec(raw)?.[1]?.trim() ?? ''
  const allocPorts = allocRaw ? parseAllocatablePortsSpec(allocRaw) : []

  const picked = pickRemotePort(parsedRemote, allocPorts, localPort ?? null)
  if (picked == null) return null
  return `${serverAddr}:${picked}`
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
