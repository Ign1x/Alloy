import { DSP_DEFAULT_SOURCE_ROOT } from '../types'
import { connectHost, parseFrpEndpoint } from './network'

export type CreatePreviewRow = {
  label: string
  value: string
  isSecret?: boolean
}

export type CreatePreviewResult = {
  template_id: string
  templateLabel: string
  rows: CreatePreviewRow[]
  warnings: string[]
}

export type CreateAdvancedDirtyInput = {
  templateId: string
  mcPort: string
  mcFrpEnabled: boolean
  mcEffectiveFrpConfig: string
  trPort: string
  trWorldSize: string
  trPassword: string
  trFrpEnabled: boolean
  trEffectiveFrpConfig: string
  dstPort: string
  dstMasterPort: string
  dstAuthPort: string
  dspPort: string
  dspServerPassword: string
  dspRemoteAccessPassword: string
  dspAutoPauseEnabled: boolean
  dspUps: string
  dspWineBin: string
}

export type BuildCreatePreviewInput = {
  templateId: string
  templateLabel: string
  instanceName: string
  sleepSeconds: string
  createAdvanced: boolean
  createAdvancedDirty: boolean
  mcVersion: string
  mcMemory: string
  mcPort: string
  mcFrpEnabled: boolean
  mcEffectiveFrpConfig: string
  mcEula: boolean
  mcMrpack: string
  mcImportPack: string
  mcCurseforge: string
  curseforgeApiKeySet: boolean
  dstClusterToken: string
  dstClusterName: string
  dstMaxPlayers: string
  dstPassword: string
  dstPort: string
  dstMasterPort: string
  dstAuthPort: string
  dstDefaultKleiKeySet: boolean
  trVersion: string
  trPort: string
  trFrpEnabled: boolean
  trEffectiveFrpConfig: string
  trMaxPlayers: string
  trWorldName: string
  trWorldSize: string
  trPassword: string
  dspStartupMode: string
  dspSaveName: string
  dspPort: string
  dspServerPassword: string
  dspRemoteAccessPassword: string
  dspAutoPauseEnabled: boolean
  dspUps: string
  dspWineBin: string
}

function asPortLabel(raw: string): string {
  const portRaw = raw.trim()
  return !portRaw || portRaw === '0' ? 'auto' : portRaw
}

function connectValue(label: string): string {
  return label === 'auto' ? 'TBD (auto port)' : `${connectHost()}:${label}`
}

export function computeCreateAdvancedDirty(input: CreateAdvancedDirtyInput): boolean {
  const template = input.templateId

  if (template.startsWith('minecraft:')) {
    return input.mcPort.trim().length > 0 || input.mcFrpEnabled || input.mcEffectiveFrpConfig.trim().length > 0
  }

  if (template === 'terraria:vanilla') {
    if (input.trPort.trim()) return true
    const ws = input.trWorldSize.trim()
    if (ws && ws !== '1') return true
    if (input.trPassword.trim()) return true
    if (input.trFrpEnabled || input.trEffectiveFrpConfig.trim()) return true
    return false
  }

  if (template === 'dst:vanilla') {
    const p = input.dstPort.trim()
    const mp = input.dstMasterPort.trim()
    const ap = input.dstAuthPort.trim()
    if (p && p !== '0') return true
    if (mp && mp !== '0') return true
    if (ap && ap !== '0') return true
    return false
  }

  if (template === 'dsp:nebula') {
    const p = input.dspPort.trim()
    if (p && p !== '0') return true
    if (input.dspServerPassword.trim()) return true
    if (input.dspRemoteAccessPassword.trim()) return true
    if (input.dspAutoPauseEnabled) return true
    const ups = input.dspUps.trim()
    if (ups && ups !== '60') return true
    const wine = input.dspWineBin.trim()
    if (wine && wine !== 'wine64') return true
    return false
  }

  return false
}

export function buildCreatePreview(input: BuildCreatePreviewInput): CreatePreviewResult {
  const template_id = input.templateId
  const templateLabel = input.templateLabel

  const rows: CreatePreviewRow[] = []
  const warnings: string[] = []

  const name = input.instanceName.trim()
  if (name) rows.push({ label: 'Name', value: name })

  if (template_id === 'demo:sleep') {
    rows.push({ label: 'Seconds', value: input.sleepSeconds.trim() || '60' })
  }

  if (template_id === 'minecraft:vanilla') {
    const v = input.mcVersion.trim() || 'latest_release'
    rows.push({ label: 'Version', value: v })
    rows.push({ label: 'Memory (MB)', value: input.mcMemory.trim() || '2048' })

    const portLabel = asPortLabel(input.mcPort)
    rows.push({ label: 'Port', value: portLabel })
    rows.push({ label: 'Connect', value: connectValue(portLabel) })

    if (input.mcFrpEnabled) {
      const ep = parseFrpEndpoint(input.mcEffectiveFrpConfig)
      rows.push({ label: 'FRP', value: ep ?? '(enabled)' })
      if (!input.mcEffectiveFrpConfig.trim()) warnings.push('Paste FRP config or disable FRP.')
    }

    if (!input.mcEula) warnings.push('Accept the Minecraft EULA to start.')
  }

  if (template_id === 'minecraft:modrinth') {
    const src = input.mcMrpack.trim()
    rows.push({ label: 'Modpack', value: src || '(not set)' })
    rows.push({ label: 'Memory (MB)', value: input.mcMemory.trim() || '2048' })

    const portLabel = asPortLabel(input.mcPort)
    rows.push({ label: 'Port', value: portLabel })
    rows.push({ label: 'Connect', value: connectValue(portLabel) })

    if (input.mcFrpEnabled) {
      const ep = parseFrpEndpoint(input.mcEffectiveFrpConfig)
      rows.push({ label: 'FRP', value: ep ?? '(enabled)' })
      if (!input.mcEffectiveFrpConfig.trim()) warnings.push('Paste FRP config or disable FRP.')
    }

    if (!input.mcEula) warnings.push('Accept the Minecraft EULA to start.')
    if (!src) warnings.push('Paste a Modrinth version link or a direct .mrpack URL.')
  }

  if (template_id === 'minecraft:import') {
    const src = input.mcImportPack.trim()
    rows.push({ label: 'Pack', value: src || '(not set)' })
    rows.push({ label: 'Memory (MB)', value: input.mcMemory.trim() || '2048' })

    const portLabel = asPortLabel(input.mcPort)
    rows.push({ label: 'Port', value: portLabel })
    rows.push({ label: 'Connect', value: connectValue(portLabel) })

    if (input.mcFrpEnabled) {
      const ep = parseFrpEndpoint(input.mcEffectiveFrpConfig)
      rows.push({ label: 'FRP', value: ep ?? '(enabled)' })
      if (!input.mcEffectiveFrpConfig.trim()) warnings.push('Paste FRP config or disable FRP.')
    }

    if (!input.mcEula) warnings.push('Accept the Minecraft EULA to start.')
    if (!src) warnings.push('Provide a server pack zip URL, or a path under /data.')
  }

  if (template_id === 'minecraft:curseforge') {
    const src = input.mcCurseforge.trim()
    rows.push({ label: 'Modpack', value: src || '(not set)' })
    rows.push({ label: 'Memory (MB)', value: input.mcMemory.trim() || '2048' })

    const portLabel = asPortLabel(input.mcPort)
    rows.push({ label: 'Port', value: portLabel })
    rows.push({ label: 'Connect', value: connectValue(portLabel) })

    if (input.mcFrpEnabled) {
      const ep = parseFrpEndpoint(input.mcEffectiveFrpConfig)
      rows.push({ label: 'FRP', value: ep ?? '(enabled)' })
      if (!input.mcEffectiveFrpConfig.trim()) warnings.push('Paste FRP config or disable FRP.')
    }

    if (!input.mcEula) warnings.push('Accept the Minecraft EULA to start.')
    if (!src) warnings.push('Paste a CurseForge file URL, or modId:fileId.')
    if (!input.curseforgeApiKeySet) warnings.push('CurseForge API key is not configured (Settings).')
  }

  if (template_id === 'dst:vanilla') {
    rows.push({ label: 'Cluster token', value: input.dstClusterToken.trim() ? '(set)' : '(not set)', isSecret: true })
    rows.push({ label: 'Cluster name', value: input.dstClusterName.trim() || 'Alloy DST server' })
    rows.push({ label: 'Max players', value: input.dstMaxPlayers.trim() || '6' })
    rows.push({ label: 'Password', value: input.dstPassword.trim() ? '(set)' : '(none)', isSecret: true })

    const portLabel = asPortLabel(input.dstPort)
    rows.push({ label: 'UDP port', value: portLabel })
    rows.push({ label: 'Connect', value: connectValue(portLabel) })

    if (input.createAdvanced || input.createAdvancedDirty) {
      const masterLabel = asPortLabel(input.dstMasterPort)
      rows.push({ label: 'Master port', value: masterLabel })

      const authLabel = asPortLabel(input.dstAuthPort)
      rows.push({ label: 'Auth port', value: authLabel })
    }

    if (!input.dstClusterToken.trim()) {
      if (input.dstDefaultKleiKeySet) warnings.push('No cluster token provided; default key from Settings will be used.')
      else warnings.push('Paste your Klei cluster token to start (or set a default in Settings).')
    }
  }

  if (template_id === 'terraria:vanilla') {
    const v = input.trVersion.trim() || '1453'
    rows.push({ label: 'Version', value: v })

    const portLabel = asPortLabel(input.trPort)
    rows.push({ label: 'Port', value: portLabel })
    rows.push({ label: 'Connect', value: connectValue(portLabel) })

    if (input.trFrpEnabled) {
      const ep = parseFrpEndpoint(input.trEffectiveFrpConfig)
      rows.push({ label: 'FRP', value: ep ?? '(enabled)' })
      if (!input.trEffectiveFrpConfig.trim()) warnings.push('Paste FRP config or disable FRP.')
    }

    rows.push({ label: 'Max players', value: input.trMaxPlayers.trim() || '8' })
    rows.push({ label: 'World name', value: input.trWorldName.trim() || 'world' })
    rows.push({ label: 'World size', value: input.trWorldSize.trim() || '1' })
    rows.push({ label: 'Password', value: input.trPassword.trim() ? '(set)' : '(none)', isSecret: true })
  }

  if (template_id === 'dsp:nebula') {
    const mode = input.dspStartupMode.trim() || 'auto'
    const save = input.dspSaveName.trim()

    rows.push({ label: 'Server source', value: DSP_DEFAULT_SOURCE_ROOT })
    rows.push({ label: 'Startup mode', value: mode })
    if (mode === 'load') rows.push({ label: 'Save name', value: save || '(not set)' })
    else if (save) rows.push({ label: 'Save name', value: save })

    const portLabel = asPortLabel(input.dspPort)
    rows.push({ label: 'Port', value: portLabel })
    rows.push({ label: 'Connect', value: connectValue(portLabel) })

    if (input.createAdvanced || input.createAdvancedDirty) {
      rows.push({ label: 'Server password', value: input.dspServerPassword.trim() ? '(set)' : '(none)', isSecret: true })
      rows.push({ label: 'Remote password', value: input.dspRemoteAccessPassword.trim() ? '(set)' : '(none)', isSecret: true })
      rows.push({ label: 'Auto pause', value: input.dspAutoPauseEnabled ? 'enabled' : 'disabled' })
      rows.push({ label: 'UPS', value: input.dspUps.trim() || '60' })
      rows.push({ label: 'Wine', value: input.dspWineBin.trim() || 'wine64' })
    }

    if (mode === 'load' && !save) warnings.push('Provide Save name when startup mode is load.')
  }

  return { template_id, templateLabel, rows, warnings }
}
