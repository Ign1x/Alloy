export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—'
  const sign = bytes < 0 ? '-' : ''
  let v = Math.abs(bytes)
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const decimals = i === 0 ? 0 : v >= 10 ? 1 : 2
  return `${sign}${v.toFixed(decimals)}${units[i]}`
}

export function parseU64(s: string | null | undefined): number | null {
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return n
}

export function formatCpuPercent(cpuX100: number | null | undefined): string {
  if (cpuX100 == null || !Number.isFinite(cpuX100)) return '—'
  const pct = cpuX100 / 100
  if (pct >= 10) return `${pct.toFixed(1)}%`
  if (pct >= 1) return `${pct.toFixed(2)}%`
  return `${pct.toFixed(2)}%`
}

export function formatRelativeTime(unixMs: number | null | undefined): string {
  if (!unixMs || !Number.isFinite(unixMs) || unixMs <= 0) return '—'
  const deltaMs = Date.now() - unixMs
  const sec = Math.floor(deltaMs / 1000)
  if (sec < 10) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 48) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

export function formatDateTime(unixMs: number | null | undefined): string {
  if (!unixMs || !Number.isFinite(unixMs) || unixMs <= 0) return '—'
  try {
    return new Date(unixMs).toLocaleString()
  } catch {
    return '—'
  }
}
