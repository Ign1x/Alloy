export type UiTab = 'instances' | 'downloads' | 'files' | 'nodes' | 'frp' | 'settings'
export type FilesTarget = 'control' | 'node'

export type MinecraftCreateMode = 'vanilla' | 'import'
export type FrpConfigMode = 'paste' | 'node'
export type DownloadTarget =
  | 'minecraft_vanilla'
  | 'terraria_vanilla'
  | 'dst_vanilla'
  | 'palworld_vanilla'
  | 'factorio_vanilla'
  | 'core_keeper_vanilla'
  | 'seven_days_vanilla'
  | 'the_forest_vanilla'
  | 'sons_of_the_forest_vanilla'
export type DownloadCenterView =
  | 'tasks'
  | 'minecraft'
  | 'terraria'
  | 'dst'
  | 'palworld'
  | 'factorio'
  | 'core_keeper'
  | 'seven_days'
  | 'the_forest'
  | 'sons_of_the_forest'
  | 'cache'
export type DownloadJobState = 'queued' | 'running' | 'paused' | 'success' | 'error' | 'canceled'
export type DownloadJob = {
  id: string
  target: DownloadTarget
  templateId: string
  version: string
  params: Record<string, string>
  state: DownloadJobState
  message: string
  requestId?: string
  startedAtUnixMs: number
  updatedAtUnixMs: number
  progressStage?: string
  progressDownloadedBytes?: number
  progressTotalBytes?: number
  progressSpeedBytesPerSec?: number
  progressPercentX100?: number
  progressEtaSec?: number
}

export type ToastVariant = 'info' | 'success' | 'error'
export type ToastContextScope = 'instance' | 'node' | 'job' | 'system'
export type ToastContext = {
  scope: ToastContextScope
  id?: string
  label?: string
}
export type ToastRetryAction = {
  key: string
}
export type ToastPushOptions = {
  context?: ToastContext
  sticky?: boolean
  groupKey?: string
  retry?: ToastRetryAction
  onRetry?: () => void | Promise<void>
}
export type Toast = {
  id: string
  variant: ToastVariant
  title: string
  message?: string
  requestId?: string
  createdAtUnixMs: number
  updatedAtUnixMs: number
  count: number
  groupKey: string
  context?: ToastContext
  sticky?: boolean
  retry?: ToastRetryAction
  isRead?: boolean
}

export const DOWNLOAD_VIEW_STORAGE_KEY = 'alloy.download.view.v2'
export const CREATE_TEMPLATE_MINECRAFT = '__minecraft__'

export const MINECRAFT_TEMPLATE_ID_BY_MODE: Record<MinecraftCreateMode, string> = {
  vanilla: 'minecraft:vanilla',
  import: 'minecraft:import',
}

export const MINECRAFT_MODE_BY_TEMPLATE_ID: Partial<Record<string, MinecraftCreateMode>> = {
  'minecraft:vanilla': 'vanilla',
  'minecraft:import': 'import',
}
