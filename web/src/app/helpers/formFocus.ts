type FocusCreateRefs = {
  createInstanceNameEl?: HTMLInputElement
  createSleepSecondsEl?: HTMLInputElement
  createMcEulaEl?: HTMLInputElement
  createMcMrpackEl?: HTMLInputElement
  createMcImportPackEl?: HTMLInputElement
  createMcCurseforgeEl?: HTMLInputElement
  createMcPortEl?: HTMLInputElement
  createMcMemoryEl?: HTMLInputElement
  createMcFrpConfigEl?: HTMLTextAreaElement
  createMcFrpNodeEl?: HTMLDivElement
  createTrPortEl?: HTMLInputElement
  createTrMaxPlayersEl?: HTMLInputElement
  createTrWorldNameEl?: HTMLInputElement
  createTrWorldSizeEl?: HTMLInputElement
  createTrPasswordEl?: HTMLInputElement
  createTrFrpConfigEl?: HTMLTextAreaElement
  createTrFrpNodeEl?: HTMLDivElement
  createDstClusterTokenEl?: HTMLInputElement
  createDstClusterNameEl?: HTMLInputElement
  createDstMaxPlayersEl?: HTMLInputElement
  createDstPasswordEl?: HTMLInputElement
  createDstPortEl?: HTMLInputElement
  createDstMasterPortEl?: HTMLInputElement
  createDstAuthPortEl?: HTMLInputElement
  createDspStartupModeEl?: HTMLDivElement
  createDspSaveNameEl?: HTMLInputElement
  createDspPortEl?: HTMLInputElement
  createDspServerPasswordEl?: HTMLInputElement
  createDspRemoteAccessPasswordEl?: HTMLInputElement
  createDspUpsEl?: HTMLInputElement
  createDspWineBinEl?: HTMLInputElement
}

type FocusEditRefs = {
  editDisplayNameEl?: HTMLInputElement
  editSleepSecondsEl?: HTMLInputElement
  editMcMemoryEl?: HTMLInputElement
  editMcPortEl?: HTMLInputElement
  editMcFrpConfigEl?: HTMLTextAreaElement
  editMcFrpNodeEl?: HTMLDivElement
  editTrPortEl?: HTMLInputElement
  editTrMaxPlayersEl?: HTMLInputElement
  editTrWorldNameEl?: HTMLInputElement
  editTrWorldSizeEl?: HTMLInputElement
  editTrPasswordEl?: HTMLInputElement
  editTrFrpConfigEl?: HTMLTextAreaElement
  editTrFrpNodeEl?: HTMLDivElement
}

type FrpMode = 'paste' | 'node'

function focusEl(el: HTMLElement | undefined): boolean {
  if (!el) return false
  try {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  } catch {
    // ignore
  }
  try {
    ;(el as any).focus?.()
  } catch {
    // ignore
  }
  return true
}

function focusDropdown(root: HTMLDivElement | undefined): boolean {
  if (!root) return false
  const btn = root.querySelector('button') as HTMLElement | null
  return focusEl(btn ?? undefined)
}

export function focusFirstCreateError(options: {
  errors: Record<string, string>
  templateId: string
  createAdvanced: boolean
  setCreateAdvanced: (next: boolean) => void
  refs: FocusCreateRefs
  mcFrpEnabled: boolean
  mcFrpMode: FrpMode
  trFrpEnabled: boolean
  trFrpMode: FrpMode
}) {
  const { errors, templateId: template_id, createAdvanced, setCreateAdvanced, refs, mcFrpEnabled, mcFrpMode, trFrpEnabled, trFrpMode } = options

  const order: string[] =
    template_id === 'demo:sleep'
      ? ['seconds', 'display_name']
      : template_id === 'minecraft:vanilla'
        ? ['accept_eula', 'version', 'memory_mb', 'port', 'frp_config', 'display_name']
        : template_id === 'minecraft:modrinth'
          ? ['accept_eula', 'mrpack', 'memory_mb', 'port', 'frp_config', 'display_name']
          : template_id === 'minecraft:import'
            ? ['accept_eula', 'pack', 'memory_mb', 'port', 'frp_config', 'display_name']
            : template_id === 'minecraft:curseforge'
              ? ['accept_eula', 'curseforge', 'memory_mb', 'port', 'frp_config', 'display_name']
              : template_id === 'dst:vanilla'
                ? ['cluster_token', 'cluster_name', 'max_players', 'password', 'port', 'master_port', 'auth_port', 'display_name']
                : template_id === 'terraria:vanilla'
                  ? ['version', 'max_players', 'world_name', 'port', 'world_size', 'password', 'frp_config', 'display_name']
                  : template_id === 'dsp:nebula'
                    ? ['startup_mode', 'save_name', 'port', 'server_password', 'remote_access_password', 'ups', 'wine_bin', 'display_name']
                    : ['display_name']

  const needsAdvanced =
    !createAdvanced &&
    (Boolean(errors.port) ||
      Boolean(errors.master_port) ||
      Boolean(errors.auth_port) ||
      Boolean(errors.world_size) ||
      Boolean(errors.password) ||
      Boolean(errors.frp_config) ||
      Boolean(errors.server_password) ||
      Boolean(errors.remote_access_password) ||
      Boolean(errors.auto_pause_enabled) ||
      Boolean(errors.ups) ||
      Boolean(errors.wine_bin))
  if (needsAdvanced) setCreateAdvanced(true)

  const run = () => {
    for (const key of order) {
      if (!errors[key]) continue

      if (key === 'display_name' && focusEl(refs.createInstanceNameEl)) return
      if (key === 'seconds' && focusEl(refs.createSleepSecondsEl)) return

      if (
        template_id === 'minecraft:vanilla' ||
        template_id === 'minecraft:modrinth' ||
        template_id === 'minecraft:import' ||
        template_id === 'minecraft:curseforge'
      ) {
        if (key === 'accept_eula' && focusEl(refs.createMcEulaEl)) return
        if (key === 'mrpack' && focusEl(refs.createMcMrpackEl)) return
        if (key === 'pack' && focusEl(refs.createMcImportPackEl)) return
        if (key === 'curseforge' && focusEl(refs.createMcCurseforgeEl)) return
        if (key === 'port' && focusEl(refs.createMcPortEl)) return
        if (key === 'frp_config') {
          if (mcFrpEnabled && mcFrpMode === 'node' && focusDropdown(refs.createMcFrpNodeEl)) return
          if (focusEl(refs.createMcFrpConfigEl)) return
        }
        if (key === 'memory_mb' && focusEl(refs.createMcMemoryEl)) return
      }

      if (template_id === 'terraria:vanilla') {
        if (key === 'port' && focusEl(refs.createTrPortEl)) return
        if (key === 'world_size' && focusEl(refs.createTrWorldSizeEl)) return
        if (key === 'password' && focusEl(refs.createTrPasswordEl)) return
        if (key === 'frp_config') {
          if (trFrpEnabled && trFrpMode === 'node' && focusDropdown(refs.createTrFrpNodeEl)) return
          if (focusEl(refs.createTrFrpConfigEl)) return
        }
        if (key === 'world_name' && focusEl(refs.createTrWorldNameEl)) return
        if (key === 'max_players' && focusEl(refs.createTrMaxPlayersEl)) return
      }

      if (template_id === 'dst:vanilla') {
        if (key === 'cluster_token' && focusEl(refs.createDstClusterTokenEl)) return
        if (key === 'cluster_name' && focusEl(refs.createDstClusterNameEl)) return
        if (key === 'max_players' && focusEl(refs.createDstMaxPlayersEl)) return
        if (key === 'password' && focusEl(refs.createDstPasswordEl)) return
        if (key === 'port' && focusEl(refs.createDstPortEl)) return
        if (key === 'master_port' && focusEl(refs.createDstMasterPortEl)) return
        if (key === 'auth_port' && focusEl(refs.createDstAuthPortEl)) return
      }

      if (template_id === 'dsp:nebula') {
        if (key === 'startup_mode' && focusDropdown(refs.createDspStartupModeEl)) return
        if (key === 'save_name' && focusEl(refs.createDspSaveNameEl)) return
        if (key === 'port' && focusEl(refs.createDspPortEl)) return
        if (key === 'server_password' && focusEl(refs.createDspServerPasswordEl)) return
        if (key === 'remote_access_password' && focusEl(refs.createDspRemoteAccessPasswordEl)) return
        if (key === 'ups' && focusEl(refs.createDspUpsEl)) return
        if (key === 'wine_bin' && focusEl(refs.createDspWineBinEl)) return
      }
    }
  }

  if (needsAdvanced) requestAnimationFrame(run)
  else queueMicrotask(run)
}

export function focusFirstEditError(options: {
  errors: Record<string, string>
  templateId: string | null
  editAdvanced: boolean
  setEditAdvanced: (next: boolean) => void
  refs: FocusEditRefs
  editMcFrpEnabled: boolean
  editMcFrpMode: FrpMode
  editTrFrpEnabled: boolean
  editTrFrpMode: FrpMode
}) {
  const {
    errors,
    templateId: template_id,
    editAdvanced,
    setEditAdvanced,
    refs,
    editMcFrpEnabled,
    editMcFrpMode,
    editTrFrpEnabled,
    editTrFrpMode,
  } = options

  if (!template_id) return

  const order: string[] =
    template_id === 'demo:sleep'
      ? ['display_name', 'seconds']
      : template_id === 'minecraft:vanilla'
        ? ['display_name', 'version', 'memory_mb', 'port', 'frp_config']
        : template_id === 'terraria:vanilla'
          ? ['display_name', 'version', 'max_players', 'world_name', 'port', 'world_size', 'password', 'frp_config']
          : ['display_name']

  const needsAdvanced = !editAdvanced && (Boolean(errors.port) || Boolean(errors.world_size) || Boolean(errors.password) || Boolean(errors.frp_config))
  if (needsAdvanced) setEditAdvanced(true)

  const run = () => {
    for (const key of order) {
      if (!errors[key]) continue

      if (key === 'display_name' && focusEl(refs.editDisplayNameEl)) return
      if (key === 'seconds' && focusEl(refs.editSleepSecondsEl)) return

      if (template_id === 'minecraft:vanilla') {
        if (key === 'port' && focusEl(refs.editMcPortEl)) return
        if (key === 'frp_config') {
          if (editMcFrpEnabled && editMcFrpMode === 'node' && focusDropdown(refs.editMcFrpNodeEl)) return
          if (focusEl(refs.editMcFrpConfigEl)) return
        }
        if (key === 'memory_mb' && focusEl(refs.editMcMemoryEl)) return
      }

      if (template_id === 'terraria:vanilla') {
        if (key === 'port' && focusEl(refs.editTrPortEl)) return
        if (key === 'max_players' && focusEl(refs.editTrMaxPlayersEl)) return
        if (key === 'world_name' && focusEl(refs.editTrWorldNameEl)) return
        if (key === 'world_size' && focusEl(refs.editTrWorldSizeEl)) return
        if (key === 'password' && focusEl(refs.editTrPasswordEl)) return
        if (key === 'frp_config') {
          if (editTrFrpEnabled && editTrFrpMode === 'node' && focusDropdown(refs.editTrFrpNodeEl)) return
          if (focusEl(refs.editTrFrpConfigEl)) return
        }
      }
    }
  }

  if (needsAdvanced) requestAnimationFrame(run)
  else queueMicrotask(run)
}
