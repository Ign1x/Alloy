import type { I18nTranslate } from '../i18n'

export type CreateFieldErrorKey =
  | 'node_id'
  | 'seconds'
  | 'accept_eula'
  | 'pack'
  | 'memory_mb'
  | 'port'
  | 'frp_config'
  | 'version'
  | 'max_players'
  | 'world_name'
  | 'world_size'
  | 'password'
  | 'query_port'
  | 'rcon_port'
  | 'rcon_password'
  | 'cluster_token'
  | 'cluster_name'
  | 'master_port'
  | 'auth_port'
  | 'server_name'
  | 'server_description'
  | 'admin_password'
  | 'public'

export type CreateFieldErrors = Partial<Record<CreateFieldErrorKey, string>>

export type CreateDraft = {
  template_id: string
  node_id: string
  display_name: string | null
  params: Record<string, string>
  errors: CreateFieldErrors
}

export type BuildCreateDraftInput = {
  t: I18nTranslate
  templateId: string
  instanceName: string
  nodeId: string
  selectedNodeId: string | null
  selectedNodeLastSeenAt: string | null

  sleepSeconds: string

  mcEula: boolean
  mcFrpEnabled: boolean
  mcFrpMode: 'paste' | 'node'
  mcEffectiveFrpConfig: string
  mcVersion: string
  mcMemory: string
  mcPort: string
  mcImportPack: string

  trVersion: string
  trPort: string
  trMaxPlayers: string
  trWorldName: string
  trWorldSize: string
  trPassword: string
  trFrpEnabled: boolean
  trFrpMode: 'paste' | 'node'
  trEffectiveFrpConfig: string

  dstClusterToken: string
  dstClusterName: string
  dstMaxPlayers: string
  dstPassword: string
  dstPort: string
  dstMasterPort: string
  dstAuthPort: string

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

export function buildCreateDraft(input: BuildCreateDraftInput): CreateDraft {
  const t = input.t
  const template_id = input.templateId
  const params: Record<string, string> = {}
  const display_name = input.instanceName.trim() ? input.instanceName.trim() : null
  const errors: CreateFieldErrors = {}

  const node_id = input.nodeId.trim()
  if (!node_id) {
    errors.node_id = t('instancesCreate.errors.nodeRequired')
  } else if (input.selectedNodeId === node_id && !input.selectedNodeLastSeenAt) {
    errors.node_id = t('instancesCreate.errors.nodeUnreachable')
  }

  const mcFrpCfg = input.mcEffectiveFrpConfig.trim()
  const trFrpCfg = input.trEffectiveFrpConfig.trim()

  if (template_id === 'demo:sleep') {
    params.seconds = input.sleepSeconds
  } else if (template_id === 'minecraft:vanilla') {
    if (!input.mcEula) errors.accept_eula = t('instancesCreate.errors.minecraftEulaRequired')
    if (input.mcFrpEnabled && !mcFrpCfg) {
      errors.frp_config =
        input.mcFrpMode === 'node'
          ? t('instancesCreate.errors.tunnelNodeRequired')
          : t('instancesCreate.errors.tunnelConfigRequired')
    }
    params.accept_eula = 'true'
    params.version = input.mcVersion.trim() || 'latest_release'
    params.memory_mb = input.mcMemory || '2048'
    if (input.mcPort.trim()) params.port = input.mcPort.trim()
    if (input.mcFrpEnabled && mcFrpCfg) params.frp_config = mcFrpCfg
  } else if (template_id === 'minecraft:import') {
    if (!input.mcEula) errors.accept_eula = t('instancesCreate.errors.minecraftEulaRequired')
    if (!input.mcImportPack.trim()) errors.pack = t('instancesCreate.errors.minecraftPackRequired')
    if (input.mcFrpEnabled && !mcFrpCfg) {
      errors.frp_config =
        input.mcFrpMode === 'node'
          ? t('instancesCreate.errors.tunnelNodeRequired')
          : t('instancesCreate.errors.tunnelConfigRequired')
    }
    params.accept_eula = 'true'
    params.pack = input.mcImportPack.trim()
    params.memory_mb = input.mcMemory || '2048'
    if (input.mcPort.trim()) params.port = input.mcPort.trim()
    if (input.mcFrpEnabled && mcFrpCfg) params.frp_config = mcFrpCfg
  } else if (template_id === 'terraria:vanilla') {
    params.version = input.trVersion.trim() || '1453'
    if (input.trPort.trim()) params.port = input.trPort.trim()
    params.max_players = input.trMaxPlayers.trim() || '8'
    params.world_name = input.trWorldName.trim() || 'world'
    params.world_size = input.trWorldSize.trim() || '1'
    if (input.trPassword.trim()) params.password = input.trPassword.trim()
    if (input.trFrpEnabled && !trFrpCfg) {
      errors.frp_config =
        input.trFrpMode === 'node'
          ? t('instancesCreate.errors.tunnelNodeRequired')
          : t('instancesCreate.errors.tunnelConfigRequired')
    }
    if (input.trFrpEnabled && trFrpCfg) params.frp_config = trFrpCfg
  } else if (template_id === 'dst:vanilla') {
    params.cluster_token = input.dstClusterToken.trim()
    params.cluster_name = input.dstClusterName.trim() || t('instancesCreate.dst.defaultClusterNamePlaceholder')
    params.max_players = input.dstMaxPlayers.trim() || '6'
    if (input.dstPassword.trim()) params.password = input.dstPassword.trim()
    if (input.dstPort.trim()) params.port = input.dstPort.trim()
    if (input.dstMasterPort.trim()) params.master_port = input.dstMasterPort.trim()
    if (input.dstAuthPort.trim()) params.auth_port = input.dstAuthPort.trim()
  } else if (template_id === 'palworld:vanilla') {
    params.server_name = input.pwServerName.trim() || t('instancesCreate.palworld.defaultServerNamePlaceholder')
    params.max_players = input.pwMaxPlayers.trim() || '32'
    params.public = input.pwPublic ? 'true' : 'false'
    if (input.pwServerDescription.trim()) params.server_description = input.pwServerDescription.trim()
    if (input.pwPassword.trim()) params.password = input.pwPassword.trim()
    if (input.pwAdminPassword.trim()) params.admin_password = input.pwAdminPassword.trim()
    if (input.pwPort.trim()) params.port = input.pwPort.trim()
    if (input.pwQueryPort.trim()) params.query_port = input.pwQueryPort.trim()
  } else if (template_id === 'factorio:vanilla') {
    params.version = input.fxVersion.trim() || 'stable'
    params.server_name = input.fxServerName.trim() || t('instancesCreate.factorio.defaultServerNamePlaceholder')
    params.max_players = input.fxMaxPlayers.trim() || '8'
    params.public = input.fxPublic ? 'true' : 'false'
    if (input.fxPort.trim()) params.port = input.fxPort.trim()
    if (input.fxServerDescription.trim()) params.server_description = input.fxServerDescription.trim()
    if (input.fxRconEnabled) {
      params.rcon_enabled = 'true'
      if (input.fxRconPort.trim()) params.rcon_port = input.fxRconPort.trim()
      if (input.fxRconPassword.trim()) params.rcon_password = input.fxRconPassword.trim()
      else errors.rcon_password = t('instancesCreate.errors.factorioRconPasswordRequired')
    }
  }

  return { template_id, node_id, display_name, params, errors }
}
