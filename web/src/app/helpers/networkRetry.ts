export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms))
  })
}

export function retryBackoffMs(attempt: number, baseMs = 400, capMs = 4000): number {
  const safeAttempt = Math.max(0, Math.floor(attempt))
  return Math.min(baseMs * Math.pow(2, safeAttempt), capMs)
}

export function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

export function isRetryableNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes('network error') ||
    msg.includes('failed to fetch') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('connection reset') ||
    msg.includes('econnreset')
  )
}
