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

export function metricLevelByPercent(percent: number | null | undefined): 'unknown' | 'low' | 'medium' | 'high' | 'critical' {
  if (percent == null || !Number.isFinite(percent)) return 'unknown'
  if (percent < 50) return 'low'
  if (percent < 75) return 'medium'
  if (percent < 90) return 'high'
  return 'critical'
}

export function metricLevelClass(level: 'unknown' | 'low' | 'medium' | 'high' | 'critical'): string {
  if (level === 'low') return 'text-emerald-700 dark:text-emerald-300'
  if (level === 'medium') return 'text-sky-700 dark:text-sky-300'
  if (level === 'high') return 'text-amber-700 dark:text-amber-300'
  if (level === 'critical') return 'text-rose-700 dark:text-rose-300'
  return 'text-slate-600 dark:text-slate-400'
}

export function formatRelativeTime(unixMs: number | null | undefined): string {
  if (!unixMs || !Number.isFinite(unixMs) || unixMs <= 0) return '—'

  const docLang = typeof document !== 'undefined' ? document.documentElement.lang : ''
  const locale = (docLang || 'en').trim() || 'en'
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  const diffSec = Math.round((unixMs - Date.now()) / 1000)
  const absSec = Math.abs(diffSec)

  if (absSec < 10) return rtf.format(0, 'second')
  if (absSec < 60) return rtf.format(diffSec, 'second')

  const diffMin = Math.round(diffSec / 60)
  const absMin = Math.abs(diffMin)
  if (absMin < 60) return rtf.format(diffMin, 'minute')

  const diffHr = Math.round(diffMin / 60)
  const absHr = Math.abs(diffHr)
  if (absHr < 48) return rtf.format(diffHr, 'hour')

  const diffDay = Math.round(diffHr / 24)
  return rtf.format(diffDay, 'day')
}

export function formatDateTime(unixMs: number | null | undefined): string {
  if (!unixMs || !Number.isFinite(unixMs) || unixMs <= 0) return '—'
  try {
    return new Date(unixMs).toLocaleString()
  } catch {
    return '—'
  }
}
