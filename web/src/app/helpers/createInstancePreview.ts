import { parseFrpEndpoint, parseFrpPublicEndpoint } from './network'
import type { I18nTranslate } from '../i18n'

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
  t: I18nTranslate
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

function asPortLabel(raw: string, t: I18nTranslate): string {
  const portRaw = raw.trim()
  return !portRaw || portRaw === '0' ? t('instancesCreate.preview.value.auto') : portRaw
}

function connectValue(rawPort: string, label: string, t: I18nTranslate): string {
  const portRaw = rawPort.trim()
  return !portRaw || portRaw === '0' ? t('instancesCreate.preview.value.tbdAutoPort') : `127.0.0.1:${label}`
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
  const tt = input.t
  const template_id = input.templateId
  const templateLabel = input.templateLabel

  const rows: CreatePreviewRow[] = []
  const warnings: string[] = []

  const name = input.instanceName.trim()
  if (name) rows.push({ label: tt('instancesCreate.preview.label.name'), value: name })

  const nodeName = input.nodeName.trim()
  if (nodeName) rows.push({ label: tt('instancesCreate.preview.label.node'), value: nodeName })

  if (template_id === 'demo:sleep') {
    rows.push({ label: tt('instancesCreate.preview.label.seconds'), value: input.sleepSeconds.trim() || '60' })
  }

  if (template_id === 'minecraft:vanilla') {
    const v = input.mcVersion.trim() || 'latest_release'
    rows.push({ label: tt('instancesCreate.preview.label.version'), value: v })
    rows.push({ label: tt('instancesCreate.preview.label.memoryMb'), value: input.mcMemory.trim() || '2048' })

    const portLabel = asPortLabel(input.mcPort, tt)
    rows.push({ label: tt('instancesCreate.preview.label.port'), value: portLabel })
    rows.push({ label: tt('instancesCreate.preview.label.connect'), value: connectValue(input.mcPort, portLabel, tt) })

    if (input.mcFrpEnabled) {
      const ep = parseFrpPublicEndpoint(input.mcEffectiveFrpConfig, Number.parseInt(portLabel, 10)) ?? parseFrpEndpoint(input.mcEffectiveFrpConfig)
      rows.push({ label: tt('instancesCreate.preview.label.tunnel'), value: ep ?? tt('instancesCreate.preview.value.enabled') })
      if (!input.mcEffectiveFrpConfig.trim()) warnings.push(tt('instancesCreate.preview.warning.pasteTunnelOrDisable'))
    }

    if (!input.mcEula) warnings.push(tt('instancesCreate.preview.warning.acceptMinecraftEula'))
  }

  if (template_id === 'minecraft:import') {
    const src = input.mcImportPack.trim()
    rows.push({ label: tt('instancesCreate.preview.label.pack'), value: src || tt('instancesCreate.preview.value.notSet') })
    rows.push({ label: tt('instancesCreate.preview.label.memoryMb'), value: input.mcMemory.trim() || '2048' })

    const portLabel = asPortLabel(input.mcPort, tt)
    rows.push({ label: tt('instancesCreate.preview.label.port'), value: portLabel })
    rows.push({ label: tt('instancesCreate.preview.label.connect'), value: connectValue(input.mcPort, portLabel, tt) })

    if (input.mcFrpEnabled) {
      const ep = parseFrpPublicEndpoint(input.mcEffectiveFrpConfig, Number.parseInt(portLabel, 10)) ?? parseFrpEndpoint(input.mcEffectiveFrpConfig)
      rows.push({ label: tt('instancesCreate.preview.label.tunnel'), value: ep ?? tt('instancesCreate.preview.value.enabled') })
      if (!input.mcEffectiveFrpConfig.trim()) warnings.push(tt('instancesCreate.preview.warning.pasteTunnelOrDisable'))
    }

    if (!input.mcEula) warnings.push(tt('instancesCreate.preview.warning.acceptMinecraftEula'))
    if (!src) warnings.push(tt('instancesCreate.preview.warning.provideServerPackPath'))
  }

  if (template_id === 'dst:vanilla') {
    rows.push({ label: tt('instancesCreate.preview.label.clusterToken'), value: input.dstClusterToken.trim() ? tt('instancesCreate.preview.value.set') : tt('instancesCreate.preview.value.notSet'), isSecret: true })
    rows.push({ label: tt('instancesCreate.preview.label.clusterName'), value: input.dstClusterName.trim() || tt('instancesCreate.dst.defaultClusterNamePlaceholder') })
    rows.push({ label: tt('instancesCreate.preview.label.maxPlayers'), value: input.dstMaxPlayers.trim() || '6' })
    rows.push({ label: tt('instancesCreate.preview.label.password'), value: input.dstPassword.trim() ? tt('instancesCreate.preview.value.set') : tt('instancesCreate.preview.value.none'), isSecret: true })

    const portLabel = asPortLabel(input.dstPort, tt)
    rows.push({ label: tt('instancesCreate.preview.label.udpPort'), value: portLabel })
    rows.push({ label: tt('instancesCreate.preview.label.connect'), value: connectValue(input.dstPort, portLabel, tt) })

    if (input.createAdvanced || input.createAdvancedDirty) {
      const masterLabel = asPortLabel(input.dstMasterPort, tt)
      rows.push({ label: tt('instancesCreate.preview.label.masterPort'), value: masterLabel })

      const authLabel = asPortLabel(input.dstAuthPort, tt)
      rows.push({ label: tt('instancesCreate.preview.label.authPort'), value: authLabel })
    }

    if (!input.dstClusterToken.trim()) {
      if (input.dstDefaultKleiKeySet) warnings.push(tt('instancesCreate.preview.warning.noClusterTokenUseDefault'))
      else warnings.push(tt('instancesCreate.preview.warning.pasteKleiTokenOrSetDefault'))
    }
  }

  if (template_id === 'terraria:vanilla') {
    const v = input.trVersion.trim() || '1453'
    rows.push({ label: tt('instancesCreate.preview.label.version'), value: v })

    const portLabel = asPortLabel(input.trPort, tt)
    rows.push({ label: tt('instancesCreate.preview.label.port'), value: portLabel })
    rows.push({ label: tt('instancesCreate.preview.label.connect'), value: connectValue(input.trPort, portLabel, tt) })

    if (input.trFrpEnabled) {
      const ep = parseFrpPublicEndpoint(input.trEffectiveFrpConfig, Number.parseInt(portLabel, 10)) ?? parseFrpEndpoint(input.trEffectiveFrpConfig)
      rows.push({ label: tt('instancesCreate.preview.label.tunnel'), value: ep ?? tt('instancesCreate.preview.value.enabled') })
      if (!input.trEffectiveFrpConfig.trim()) warnings.push(tt('instancesCreate.preview.warning.pasteTunnelOrDisable'))
    }

    rows.push({ label: tt('instancesCreate.preview.label.maxPlayers'), value: input.trMaxPlayers.trim() || '8' })
    rows.push({ label: tt('instancesCreate.preview.label.worldName'), value: input.trWorldName.trim() || 'world' })
    rows.push({ label: tt('instancesCreate.preview.label.worldSize'), value: input.trWorldSize.trim() || '1' })
    rows.push({ label: tt('instancesCreate.preview.label.password'), value: input.trPassword.trim() ? tt('instancesCreate.preview.value.set') : tt('instancesCreate.preview.value.none'), isSecret: true })
  }

  if (template_id === 'palworld:vanilla') {
    rows.push({ label: tt('instancesCreate.preview.label.serverName'), value: input.pwServerName.trim() || tt('instancesCreate.palworld.defaultServerNamePlaceholder') })
    rows.push({ label: tt('instancesCreate.preview.label.maxPlayers'), value: input.pwMaxPlayers.trim() || '32' })
    rows.push({ label: tt('instancesCreate.preview.label.public'), value: input.pwPublic ? tt('instancesCreate.preview.value.yes') : tt('instancesCreate.preview.value.no') })

    const portLabel = asPortLabel(input.pwPort, tt)
    rows.push({ label: tt('instancesCreate.preview.label.port'), value: portLabel })
    rows.push({ label: tt('instancesCreate.preview.label.connect'), value: connectValue(input.pwPort, portLabel, tt) })

    if (input.createAdvanced || input.createAdvancedDirty) {
      rows.push({ label: tt('instancesCreate.preview.label.queryPort'), value: asPortLabel(input.pwQueryPort, tt) })
      rows.push({ label: tt('instancesCreate.preview.label.password'), value: input.pwPassword.trim() ? tt('instancesCreate.preview.value.set') : tt('instancesCreate.preview.value.none'), isSecret: true })
      rows.push({ label: tt('instancesCreate.preview.label.adminPassword'), value: input.pwAdminPassword.trim() ? tt('instancesCreate.preview.value.set') : tt('instancesCreate.preview.value.none'), isSecret: true })
      if (input.pwServerDescription.trim()) rows.push({ label: tt('instancesCreate.preview.label.description'), value: input.pwServerDescription.trim() })
    }
  }

  if (template_id === 'factorio:vanilla') {
    rows.push({ label: tt('instancesCreate.preview.label.version'), value: input.fxVersion.trim() || 'stable' })
    rows.push({ label: tt('instancesCreate.preview.label.serverName'), value: input.fxServerName.trim() || tt('instancesCreate.factorio.defaultServerNamePlaceholder') })
    rows.push({ label: tt('instancesCreate.preview.label.maxPlayers'), value: input.fxMaxPlayers.trim() || '8' })
    rows.push({ label: tt('instancesCreate.preview.label.public'), value: input.fxPublic ? tt('instancesCreate.preview.value.yes') : tt('instancesCreate.preview.value.no') })

    const portLabel = asPortLabel(input.fxPort, tt)
    rows.push({ label: tt('instancesCreate.preview.label.portUdp'), value: portLabel })
    rows.push({ label: tt('instancesCreate.preview.label.connect'), value: connectValue(input.fxPort, portLabel, tt) })

    if (input.createAdvanced || input.createAdvancedDirty) {
      rows.push({ label: tt('instancesCreate.preview.label.rcon'), value: input.fxRconEnabled ? tt('instancesCreate.preview.value.enabled') : tt('instancesCreate.preview.value.disabled') })
      if (input.fxRconEnabled) {
        rows.push({ label: tt('instancesCreate.preview.label.rconPort'), value: asPortLabel(input.fxRconPort, tt) })
        rows.push({ label: tt('instancesCreate.preview.label.rconPassword'), value: input.fxRconPassword.trim() ? tt('instancesCreate.preview.value.set') : tt('instancesCreate.preview.value.notSet'), isSecret: true })
        if (!input.fxRconPassword.trim()) warnings.push(tt('instancesCreate.preview.warning.setRconPasswordOrDisable'))
      }
      if (input.fxServerDescription.trim()) rows.push({ label: tt('instancesCreate.preview.label.description'), value: input.fxServerDescription.trim() })
    }
  }

  return { template_id, templateLabel, rows, warnings }
}
