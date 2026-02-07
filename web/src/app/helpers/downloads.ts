import type { DownloadJob, DownloadJobState, DownloadTarget } from '../types'

export function parseUnixMs(value: unknown): number {
  const raw = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '0'
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : 0
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

export function mapDownloadJobFromServer(raw: unknown): DownloadJob | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>

  const id = typeof row.id === 'string' ? row.id : ''
  const targetRaw = row.target
  const templateId = typeof row.template_id === 'string' ? row.template_id : ''
  const version = typeof row.version === 'string' ? row.version : ''
  const stateRaw = row.state
  const message = typeof row.message === 'string' ? row.message : ''
  if (!id || !templateId) return null
  if (targetRaw !== 'minecraft_vanilla' && targetRaw !== 'terraria_vanilla') return null
  if (
    stateRaw !== 'queued' &&
    stateRaw !== 'running' &&
    stateRaw !== 'paused' &&
    stateRaw !== 'success' &&
    stateRaw !== 'error' &&
    stateRaw !== 'canceled'
  ) {
    return null
  }
  const target: DownloadTarget = targetRaw
  const state: DownloadJobState = stateRaw

  const paramsRaw = typeof row.params === 'object' && row.params ? (row.params as Record<string, unknown>) : {}
  const params: Record<string, string> = {}
  for (const [k, v] of Object.entries(paramsRaw)) {
    if (!k || v == null) continue
    params[k] = String(v)
  }

  return {
    id,
    target,
    templateId,
    version,
    params,
    state,
    message,
    requestId: typeof row.request_id === 'string' ? row.request_id : undefined,
    startedAtUnixMs: parseUnixMs(row.started_at_unix_ms) || parseUnixMs(row.created_at_unix_ms),
    updatedAtUnixMs: parseUnixMs(row.updated_at_unix_ms),
    progressStage: typeof row.progress_stage === 'string' ? row.progress_stage : undefined,
    progressDownloadedBytes: parseOptionalNumber(row.progress_downloaded_bytes),
    progressTotalBytes: parseOptionalNumber(row.progress_total_bytes),
    progressSpeedBytesPerSec: parseOptionalNumber(row.progress_speed_bytes_per_sec),
    progressPercentX100: parseOptionalNumber(row.progress_percent_x100),
    progressEtaSec: parseOptionalNumber(row.progress_eta_sec),
  }
}

export function downloadTargetLabel(target: DownloadTarget): string {
  if (target === 'minecraft_vanilla') return 'Minecraft (Vanilla)'
  return 'Terraria (Vanilla)'
}

export function downloadProgressSteps(templateId: string): string[] {
  if (templateId === 'minecraft:vanilla') return ['Resolve', 'Download', 'Verify', 'Ready']
  if (templateId === 'terraria:vanilla') return ['Resolve', 'Download', 'Extract', 'Ready']
  return ['Queue', 'Run', 'Ready']
}

export function downloadProgressIndex(templateId: string, message: string): number {
  const m = message.toLowerCase()
  const steps = downloadProgressSteps(templateId)

  const find = (label: string) => steps.findIndex((s) => s.toLowerCase() === label)
  const clamp = (idx: number) => Math.max(0, Math.min(steps.length - 1, idx))

  if (m.includes('resolve')) return clamp(find('resolve'))
  if (m.includes('login')) return clamp(find('login'))
  if (m.includes('download')) return clamp(find('download'))
  if (m.includes('extract')) return clamp(find('extract'))
  if (m.includes('install')) return clamp(find('install'))
  if (m.includes('verify')) return clamp(find('verify'))
  if (m.includes('ready') || m.includes('warmed') || m.includes('completed')) return clamp(find('ready'))
  return 0
}

export function downloadEstimatedMessage(templateId: string, elapsedMs: number): string {
  if (templateId === 'minecraft:vanilla') {
    if (elapsedMs < 2_000) return 'resolving minecraft version metadata…'
    if (elapsedMs < 15_000) return 'downloading minecraft server files…'
    return 'verifying cache and preparing ready state…'
  }
  if (templateId === 'terraria:vanilla') {
    if (elapsedMs < 2_000) return 'resolving terraria release metadata…'
    if (elapsedMs < 15_000) return 'downloading terraria server package…'
    return 'extracting and verifying terraria server files…'
  }
  return 'preparing files…'
}

export function downloadJobProgressMessage(job: DownloadJob, nowUnixMs: number): string {
  if (job.state !== 'running') return job.message
  if (job.message?.trim()) return job.message
  const elapsed = Math.max(0, nowUnixMs - job.startedAtUnixMs)
  return downloadEstimatedMessage(job.templateId, elapsed)
}

export function downloadJobPercent(job: DownloadJob): number | null {
  const percentX100 = job.progressPercentX100
  if (typeof percentX100 === 'number' && Number.isFinite(percentX100)) {
    return Math.max(0, Math.min(100, percentX100 / 100))
  }

  const downloaded = job.progressDownloadedBytes
  const total = job.progressTotalBytes
  if (typeof downloaded === 'number' && typeof total === 'number' && Number.isFinite(downloaded) && Number.isFinite(total) && total > 0) {
    return Math.max(0, Math.min(100, (downloaded / total) * 100))
  }
  return null
}

export function downloadJobStatusVariant(state: DownloadJobState): 'warning' | 'neutral' | 'success' | 'danger' {
  if (state === 'running') return 'warning'
  if (state === 'queued' || state === 'paused') return 'neutral'
  if (state === 'success') return 'success'
  return 'danger'
}

export function downloadJobStatusLabel(state: DownloadJobState): string {
  if (state === 'running') return 'Running'
  if (state === 'queued') return 'Queued'
  if (state === 'paused') return 'Paused'
  if (state === 'success') return 'Success'
  if (state === 'canceled') return 'Canceled'
  return 'Failed'
}
