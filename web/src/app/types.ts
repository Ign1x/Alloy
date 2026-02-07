export type UiTab = 'instances' | 'downloads' | 'files' | 'nodes' | 'frp' | 'settings'

export type MinecraftCreateMode = 'vanilla' | 'modrinth' | 'import' | 'curseforge'
export type FrpConfigMode = 'paste' | 'node'
export type DownloadTarget = 'minecraft_vanilla' | 'terraria_vanilla'
export type DownloadCenterView = 'tasks' | 'minecraft' | 'terraria' | 'cache'
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
export type Toast = {
  id: string
  variant: ToastVariant
  title: string
  message?: string
  requestId?: string
}

export const DOWNLOAD_VIEW_STORAGE_KEY = 'alloy.download.view.v2'
export const CREATE_TEMPLATE_MINECRAFT = '__minecraft__'

export const MINECRAFT_TEMPLATE_ID_BY_MODE: Record<MinecraftCreateMode, string> = {
  vanilla: 'minecraft:vanilla',
  modrinth: 'minecraft:modrinth',
  import: 'minecraft:import',
  curseforge: 'minecraft:curseforge',
}

export const MINECRAFT_MODE_BY_TEMPLATE_ID: Partial<Record<string, MinecraftCreateMode>> = {
  'minecraft:vanilla': 'vanilla',
  'minecraft:modrinth': 'modrinth',
  'minecraft:import': 'import',
  'minecraft:curseforge': 'curseforge',
}
