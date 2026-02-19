import { parseFrpEndpoint, parseFrpPublicEndpoint } from './network'

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
  pwPort: string
  pwQueryPort: string
  fxPort: string
  fxRconEnabled: boolean
  fxRconPort: string
  fxRconPassword: string
  dstPort: string
  dstMasterPort: string
  dstAuthPort: string
}

export type BuildCreatePreviewInput = {
  templateId: string
  templateLabel: string
  instanceName: string
  nodeName: string
  sleepSeconds: string
  createAdvanced: boolean
  createAdvancedDirty: boolean
  mcVersion: string
  mcMemory: string
  mcPort: string
  mcFrpEnabled: boolean
  mcEffectiveFrpConfig: string
  mcEula: boolean
  mcImportPack: string
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
  pwServerName: string
  pwServerDescription: string
  pwMaxPlayers: string
  pwPassword: string
  pwAdminPassword: string
  pwPublic: boolean
  pwPort: string
  pwQueryPort: string
  fxVersion: string
  fxServerName: string
  fxServerDescription: string
  fxMaxPlayers: string
  fxPublic: boolean
  fxPort: string
  fxRconEnabled: boolean
  fxRconPort: string
  fxRconPassword: string
}

function asPortLabel(raw: string): string {
  const portRaw = raw.trim()
  return !portRaw || portRaw === '0' ? 'auto' : portRaw
}

function connectValue(label: string): string {
  return label === 'auto' ? 'TBD (auto port)' : `127.0.0.1:${label}`
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

  if (template === 'palworld:vanilla') {
    const p = input.pwPort.trim()
    const qp = input.pwQueryPort.trim()
    if (p && p !== '8211') return true
    if (qp && qp !== '27015') return true
    return false
  }

  if (template === 'factorio:vanilla') {
    if (input.fxRconEnabled) return true
    const rp = input.fxRconPort.trim()
    if (rp && rp !== '27015') return true
    if (input.fxRconPassword.trim()) return true
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

  return false
}

export function buildCreatePreview(input: BuildCreatePreviewInput): CreatePreviewResult {
  const template_id = input.templateId
  const templateLabel = input.templateLabel

  const rows: CreatePreviewRow[] = []
  const warnings: string[] = []

  const name = input.instanceName.trim()
  if (name) rows.push({ label: 'Name', value: name })

  const nodeName = input.nodeName.trim()
  if (nodeName) rows.push({ label: 'Node', value: nodeName })

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
      const ep = parseFrpPublicEndpoint(input.mcEffectiveFrpConfig, Number.parseInt(portLabel, 10)) ?? parseFrpEndpoint(input.mcEffectiveFrpConfig)
      rows.push({ label: 'Tunnel', value: ep ?? '(enabled)' })
      if (!input.mcEffectiveFrpConfig.trim()) warnings.push('Paste tunnel config or disable tunnels.')
    }

    if (!input.mcEula) warnings.push('Accept the Minecraft EULA to start.')
  }

  if (template_id === 'minecraft:import') {
    const src = input.mcImportPack.trim()
    rows.push({ label: 'Pack', value: src || '(not set)' })
    rows.push({ label: 'Memory (MB)', value: input.mcMemory.trim() || '2048' })

    const portLabel = asPortLabel(input.mcPort)
    rows.push({ label: 'Port', value: portLabel })
    rows.push({ label: 'Connect', value: connectValue(portLabel) })

    if (input.mcFrpEnabled) {
      const ep = parseFrpPublicEndpoint(input.mcEffectiveFrpConfig, Number.parseInt(portLabel, 10)) ?? parseFrpEndpoint(input.mcEffectiveFrpConfig)
      rows.push({ label: 'Tunnel', value: ep ?? '(enabled)' })
      if (!input.mcEffectiveFrpConfig.trim()) warnings.push('Paste tunnel config or disable tunnels.')
    }

    if (!input.mcEula) warnings.push('Accept the Minecraft EULA to start.')
    if (!src) warnings.push('Provide an uploaded server pack zip path under /data.')
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
      const ep = parseFrpPublicEndpoint(input.trEffectiveFrpConfig, Number.parseInt(portLabel, 10)) ?? parseFrpEndpoint(input.trEffectiveFrpConfig)
      rows.push({ label: 'Tunnel', value: ep ?? '(enabled)' })
      if (!input.trEffectiveFrpConfig.trim()) warnings.push('Paste tunnel config or disable tunnels.')
    }

    rows.push({ label: 'Max players', value: input.trMaxPlayers.trim() || '8' })
    rows.push({ label: 'World name', value: input.trWorldName.trim() || 'world' })
    rows.push({ label: 'World size', value: input.trWorldSize.trim() || '1' })
    rows.push({ label: 'Password', value: input.trPassword.trim() ? '(set)' : '(none)', isSecret: true })
  }

  if (template_id === 'palworld:vanilla') {
    rows.push({ label: 'Server name', value: input.pwServerName.trim() || 'Alloy Palworld server' })
    rows.push({ label: 'Max players', value: input.pwMaxPlayers.trim() || '32' })
    rows.push({ label: 'Public', value: input.pwPublic ? 'yes' : 'no' })

    const portLabel = asPortLabel(input.pwPort)
    rows.push({ label: 'Port', value: portLabel })
    rows.push({ label: 'Connect', value: connectValue(portLabel) })

    if (input.createAdvanced || input.createAdvancedDirty) {
      rows.push({ label: 'Query port', value: asPortLabel(input.pwQueryPort) })
      rows.push({ label: 'Password', value: input.pwPassword.trim() ? '(set)' : '(none)', isSecret: true })
      rows.push({ label: 'Admin password', value: input.pwAdminPassword.trim() ? '(set)' : '(none)', isSecret: true })
      if (input.pwServerDescription.trim()) rows.push({ label: 'Description', value: input.pwServerDescription.trim() })
    }
  }

  if (template_id === 'factorio:vanilla') {
    rows.push({ label: 'Version', value: input.fxVersion.trim() || 'stable' })
    rows.push({ label: 'Server name', value: input.fxServerName.trim() || 'Alloy Factorio server' })
    rows.push({ label: 'Max players', value: input.fxMaxPlayers.trim() || '8' })
    rows.push({ label: 'Public', value: input.fxPublic ? 'yes' : 'no' })

    const portLabel = asPortLabel(input.fxPort)
    rows.push({ label: 'Port (UDP)', value: portLabel })
    rows.push({ label: 'Connect', value: connectValue(portLabel) })

    if (input.createAdvanced || input.createAdvancedDirty) {
      rows.push({ label: 'RCON', value: input.fxRconEnabled ? 'enabled' : 'disabled' })
      if (input.fxRconEnabled) {
        rows.push({ label: 'RCON port', value: asPortLabel(input.fxRconPort) })
        rows.push({ label: 'RCON password', value: input.fxRconPassword.trim() ? '(set)' : '(not set)', isSecret: true })
        if (!input.fxRconPassword.trim()) warnings.push('Set RCON password or disable RCON.')
      }
      if (input.fxServerDescription.trim()) rows.push({ label: 'Description', value: input.fxServerDescription.trim() })
    }
  }

  return { template_id, templateLabel, rows, warnings }
}
