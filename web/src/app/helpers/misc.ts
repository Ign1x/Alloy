export async function safeCopy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // ignore clipboard errors
  }
}

export function isSecretParamKey(key: string) {
  const k = key.toLowerCase()
  if (k.includes('password') || k.includes('token') || k.includes('secret')) return true
  if (k.includes('api_key') || k.includes('apikey')) return true
  if (k.includes('frp') && k.includes('config')) return true
  return false
}

export function shortId(id: string, head = 8, tail = 4): string {
  const s = id.trim()
  if (s.length <= head + tail + 1) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}

export function optionsWithCurrentValue(
  options: { value: string; label: string; meta?: string }[],
  currentValue: string,
): { value: string; label: string; meta?: string }[] {
  const v = currentValue.trim()
  if (!v) return options
  if (options.some((o) => o.value === v)) return options
  return [{ value: v, label: v }, ...options]
}

export function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

