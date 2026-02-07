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
