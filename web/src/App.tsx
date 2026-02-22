import { queryClient, rspc } from './rspc'
import { createEffect, createMemo, createSignal } from 'solid-js'
import { changeCredentials, ensureCsrfCookie } from './auth'
import AppModals from './components/AppModals'
import AppShell from './components/AppShell'
import { parseAgentErrorPayload } from './app/helpers/agentErrors'
import { buildCreatePreview, computeCreateAdvancedDirty } from './app/helpers/createInstancePreview'
import {
  focusFirstCreateError as focusFirstCreateErrorInForm,
  focusFirstEditError as focusFirstEditErrorInForm,
} from './app/helpers/formFocus'
import { optionsWithCurrentValue, safeCopy } from './app/helpers/misc'
import { useSidebarState } from './app/hooks/useSidebarState'
import { useAppLocale } from './app/hooks/useAppLocale'
import { useThemePreference } from './app/hooks/useThemePreference'
import { useToastBus } from './app/hooks/useToastBus'
import { useInstancesDomain } from './app/hooks/useInstancesDomain'
import { useAuthDomain } from './app/hooks/useAuthDomain'
import { useDownloadsDomain } from './app/hooks/useDownloadsDomain'
import { useNodesDomain } from './app/hooks/useNodesDomain'
import {
  buildTabUrl,
  coerceUiTabForRole,
  readUiRouteFromLocation,
  type UiRouteSelection,
  type UiTabRouteState,
} from './app/tabRegistry'
import {
  CREATE_TEMPLATE_MINECRAFT,
  MINECRAFT_MODE_BY_TEMPLATE_ID,
  MINECRAFT_TEMPLATE_ID_BY_MODE,
  type FrpConfigMode,
  type MinecraftCreateMode,
  type UiTab,
} from './app/types'
function App() {
  const initialRoute = readUiRouteFromLocation('instances')
  const [selectedInstanceId, setSelectedInstanceId] = createSignal<string | null>(initialRoute.tab === 'instances' ? initialRoute.instanceId : null)
  const [selectedFilePath, setSelectedFilePath] = createSignal<string | null>(initialRoute.tab === 'files' ? initialRoute.selectedFilePath : null)
  const [fsPath, setFsPath] = createSignal<string>(initialRoute.tab === 'files' ? (initialRoute.fsPath ?? '') : '')
  const { locale, setLocale, localeOptions, localeShort, t } = useAppLocale()

  const {
    me,
    setMe,
    authLoading,
    setAuthLoading,
    authError,
    setAuthError,
    loginUser,
    setLoginUser,
    loginPass,
    setLoginPass,
    showLoginModal,
    setShowLoginModal,
    refreshSession,
    handleLogout,
    isAuthed,
    openLoginModal,
    setLoginUsernameEl,
  } = useAuthDomain({
    t,
    onClearSelections: () => {
      setSelectedInstanceId(null)
      setSelectedFilePath(null)
    },
  })

  const [confirmDeleteInstanceId, setConfirmDeleteInstanceId] = createSignal<string | null>(null)
  const [confirmDeleteText, setConfirmDeleteText] = createSignal('')
  const [editingInstanceId, setEditingInstanceId] = createSignal<string | null>(null)
  const [showDiagnosticsModal, setShowDiagnosticsModal] = createSignal(false)
  const [showAccountMenu, setShowAccountMenu] = createSignal(false)
  const [showUpdateCenter, setShowUpdateCenter] = createSignal(false)
  const [showEventCenter, setShowEventCenter] = createSignal(false)
  const { themePref, setThemePref, themeButtonTitle, theme } = useThemePreference()
  const { sidebarExpanded, setSidebarExpanded } = useSidebarState()
  const [mobileNavOpen, setMobileNavOpen] = createSignal(false)
  const [tab, setTabSignal] = createSignal<UiTab>(initialRoute.tab)
  const currentUiRoute = (nextTab: UiTab = tab()): UiRouteSelection => ({
    tab: nextTab,
    instanceId: nextTab === 'instances' ? selectedInstanceId() : null,
    fsPath: nextTab === 'files' ? fsPath() || null : null,
    selectedFilePath: nextTab === 'files' ? selectedFilePath() : null,
  })
  const setTab: typeof setTabSignal = (next) => {
    const previous = tab()
    const resolved = (typeof next === 'function' ? next(previous) : next) as UiTab
    if (resolved !== previous && typeof window !== 'undefined') {
      try {
        const route = currentUiRoute(resolved)
        const nextUrl = buildTabUrl(route)
        const currentState = (window.history.state as UiTabRouteState | null) ?? {}
        window.history.pushState({ ...currentState, ...route }, '', nextUrl)
      } catch {}
    }
    setTabSignal(() => resolved)
    return resolved
  }
  const setTabSilently = (next: UiTab): UiTab => {
    setTabSignal(next)
    return next
  }
  const replaceTabInHistory = (next: UiTab): void => {
    if (typeof window === 'undefined') return
    const route = currentUiRoute(next)
    const nextUrl = buildTabUrl(route)
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (currentUrl === nextUrl) return
    try {
      const currentState = (window.history.state as UiTabRouteState | null) ?? {}
      window.history.replaceState({ ...currentState, ...route }, '', nextUrl)
    } catch {}
  }
  const {
    toasts,
    dismissToast,
    events,
    clearEvents,
    markAllEventsRead,
    runRetryAction,
    pushToast,
    toastError,
    toastSuccessFromRspc,
    friendlyErrorMessage,
  } = useToastBus(t)
  // Account menu uses a fixed overlay; refs are not needed.

  let createInstanceNameEl: HTMLInputElement | undefined
  let createSleepSecondsEl: HTMLInputElement | undefined
  let createMcEulaEl: HTMLInputElement | undefined
  let createMcImportPackEl: HTMLDivElement | undefined
  let createMcPortEl: HTMLInputElement | undefined
  let createMcMemoryEl: HTMLInputElement | undefined
  let createMcFrpConfigEl: HTMLTextAreaElement | undefined
  let createMcFrpNodeEl: HTMLDivElement | undefined
  let createTrPortEl: HTMLInputElement | undefined
  let createTrMaxPlayersEl: HTMLInputElement | undefined
  let createTrWorldNameEl: HTMLInputElement | undefined
  let createTrWorldSizeEl: HTMLInputElement | undefined
  let createTrPasswordEl: HTMLInputElement | undefined
  let createTrFrpConfigEl: HTMLTextAreaElement | undefined
  let createTrFrpNodeEl: HTMLDivElement | undefined
  let createPwPortEl: HTMLInputElement | undefined
  let createPwQueryPortEl: HTMLInputElement | undefined
  let createFxPortEl: HTMLInputElement | undefined
  let createFxRconPortEl: HTMLInputElement | undefined
  let createFxRconPasswordEl: HTMLInputElement | undefined
  let createDstClusterTokenEl: HTMLInputElement | undefined
  let createDstClusterNameEl: HTMLInputElement | undefined
  let createDstMaxPlayersEl: HTMLInputElement | undefined
  let createDstPasswordEl: HTMLInputElement | undefined
  let createDstPortEl: HTMLInputElement | undefined
  let createDstMasterPortEl: HTMLInputElement | undefined
  let createDstAuthPortEl: HTMLInputElement | undefined
  let createNodeSelectEl: HTMLDivElement | undefined
  let editDisplayNameEl: HTMLInputElement | undefined
  let editSleepSecondsEl: HTMLInputElement | undefined
  let editMcMemoryEl: HTMLInputElement | undefined
  let editMcPortEl: HTMLInputElement | undefined
  let editMcFrpConfigEl: HTMLTextAreaElement | undefined
  let editMcFrpNodeEl: HTMLDivElement | undefined
  let editTrPortEl: HTMLInputElement | undefined
  let editTrMaxPlayersEl: HTMLInputElement | undefined
  let editTrWorldNameEl: HTMLInputElement | undefined
  let editTrWorldSizeEl: HTMLInputElement | undefined
  let editTrPasswordEl: HTMLInputElement | undefined
  let editTrFrpConfigEl: HTMLTextAreaElement | undefined
  let editTrFrpNodeEl: HTMLDivElement | undefined

  async function handleChangeCredentials() {
    const current_password = settingsCurrentPassword()
    const new_username = settingsNewUsername().trim()
    const new_password = settingsNewPassword()

    if (!current_password.trim()) {
      pushToast('error', t('app.missingField'), t('app.currentPasswordRequired'))
      return
    }
    if (!new_username && !new_password) {
      pushToast('error', t('app.missingField'), t('app.enterUsernameOrPassword'))
      return
    }

    setChangeCredentialsPending(true)
    try {
      const updated = await changeCredentials({
        current_password,
        new_username: new_username || null,
        new_password: new_password || null,
      })

      setMe({ username: updated.username, is_admin: updated.is_admin })
      setSettingsCurrentPassword('')
      setSettingsNewUsername('')
      setSettingsNewPassword('')
      setSettingsCurrentPasswordVisible(false)
      setSettingsNewPasswordVisible(false)

      pushToast('success', t('app.saved'), t('app.controlCredentialsUpdated'))
    } catch (e) {
      toastError(t('app.saveFailed'), e)
    } finally {
      setChangeCredentialsPending(false)
    }
  }

  createEffect(() => {
    if (!showAccountMenu()) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setShowAccountMenu(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  createEffect(() => {
    if (!showUpdateCenter()) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setShowUpdateCenter(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const ping = rspc.createQuery(() => ['control.ping', null])

  const [lastBackendOkAtUnixMs, setLastBackendOkAtUnixMs] = createSignal<number | null>(null)

  createEffect(() => {
    if (ping.isError) return
    if (!ping.data) return
    setLastBackendOkAtUnixMs(Date.now())
  })

  const templates = rspc.createQuery(
    () => ['process.templates', null],
    () => ({ enabled: isAuthed() }),
  )

  type TemplateCatalogItem = { template_id: string; display_name: string }
  const FALLBACK_TEMPLATE_CATALOG: TemplateCatalogItem[] = [
    { template_id: 'demo:sleep', display_name: t('template.demoSleep') },
    { template_id: 'minecraft:vanilla', display_name: t('template.minecraftVanilla') },
    { template_id: 'minecraft:import', display_name: t('template.minecraftImportPack') },
    { template_id: 'terraria:vanilla', display_name: t('template.terrariaVanilla') },
    { template_id: 'dst:vanilla', display_name: t('template.dstVanilla') },
    { template_id: 'palworld:vanilla', display_name: t('template.palworldVanilla') },
    { template_id: 'factorio:vanilla', display_name: t('template.factorioVanilla') },
    { template_id: 'core_keeper:vanilla', display_name: t('template.coreKeeperDedicated') },
    { template_id: 'seven_days:vanilla', display_name: t('template.sevenDaysDedicated') },
    { template_id: 'the_forest:vanilla', display_name: t('template.theForestDedicated') },
    { template_id: 'sons_of_the_forest:vanilla', display_name: t('template.sonsOfTheForestDedicated') },
  ]

  const templateCatalog = createMemo<TemplateCatalogItem[]>(() => {
    const live = (templates.data ?? []) as TemplateCatalogItem[]
    const filteredLive = live.filter(
      (t) => t.template_id !== 'minecraft:modrinth' && t.template_id !== 'minecraft:curseforge',
    )
    return filteredLive.length > 0 ? filteredLive : FALLBACK_TEMPLATE_CATALOG
  })

  const templateDisplayName = (templateId: string) => {
    const id = templateId.trim()
    if (!id) return templateId
    return templateCatalog().find((t) => t.template_id === id)?.display_name ?? templateId
  }

  type TemplateOption = { value: string; label: string; meta: string }
  const templateOptions = createMemo<TemplateOption[]>(() => {
    const out: TemplateOption[] = []
    const list = templateCatalog()
    const groupedMinecraft = new Set(Object.values(MINECRAFT_TEMPLATE_ID_BY_MODE))
    let insertedMinecraft = false

    for (const item of list) {
      if (groupedMinecraft.has(item.template_id)) {
        if (!insertedMinecraft) {
          insertedMinecraft = true
          out.push({
            value: CREATE_TEMPLATE_MINECRAFT,
            label: t('template.minecraft'),
            meta: t('template.minecraftVanillaImport'),
          })
        }
        continue
      }
      out.push({
        value: item.template_id,
        label: item.display_name,
        meta: item.template_id,
      })
    }
    return out
  })

  const availableMinecraftCreateModes = createMemo<MinecraftCreateMode[]>(() => {
    const ids = new Set(templateCatalog().map((t) => t.template_id))
    const out: MinecraftCreateMode[] = []
    if (ids.has(MINECRAFT_TEMPLATE_ID_BY_MODE.vanilla)) out.push('vanilla')
    if (ids.has(MINECRAFT_TEMPLATE_ID_BY_MODE.import)) out.push('import')
    return out
  })

  createEffect(() => {
    const opts = templateOptions()
    if (!opts.length) return
    const hasMinecraftGroup = opts.some((o) => o.value === CREATE_TEMPLATE_MINECRAFT)
    if (hasMinecraftGroup) {
      const mappedMode = MINECRAFT_MODE_BY_TEMPLATE_ID[selectedTemplate()]
      if (mappedMode) {
        setSelectedTemplate(CREATE_TEMPLATE_MINECRAFT)
        setMcCreateMode(mappedMode)
        return
      }
    }
    if (!opts.some((o: { value: string }) => o.value === selectedTemplate())) {
      setSelectedTemplate(opts[0].value)
    }
  })

  const {
    activeInstanceViewPresetId,
    applyInstanceViewPreset,
    deleteInstanceViewPreset,
    filteredInstances,
    instanceCompact,
    instanceDisplayName,
    instanceViewPresets,
    instanceSearchInput,
    instanceSortKey,
    instanceSortOptions,
    instanceStatusFilter,
    instanceStatusFilterOptions,
    instanceStatusKeys,
    instanceTemplateFilter,
    instanceTemplateFilterOptions,
    instances,
    instancesLastUpdatedAtUnixMs,
    instancesPollErrorStreak,
    invalidateInstances,
    pinnedInstanceIds,
    setInstanceSearch,
    setInstanceSearchInput,
    setInstanceSortKey,
    setInstanceStatusFilter,
    setInstanceTemplateFilter,
    saveInstanceViewPreset,
    togglePinnedInstance,
  } = useInstancesDomain({ isAuthed, t })

  createEffect(() => {
    const req = pendingRevealInstance()
    if (!req) return

    filteredInstances().length

    requestAnimationFrame(() => {
      const el = instanceCardEls.get(req.id)
      if (el) {
        try {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        } catch {}
        const focusEl = el.querySelector<HTMLElement>('[data-instance-card-focus]') ?? null
        queueMicrotask(() => focusEl?.focus())
        setPendingRevealInstance(null)
        return
      }

      if (Date.now() - req.started_at_unix_ms > 2000) setPendingRevealInstance(null)
    })
  })

  function closeEditModal() {
    setEditingInstanceId(null)
    setEditBase(null)
    setEditFormError(null)
    setEditFieldErrors({})
    setEditAdvanced(false)
    setEditTrPasswordVisible(false)
    setEditMcFrpEnabled(false)
    setEditMcFrpConfig('')
    setEditMcFrpMode('paste')
    setEditMcFrpNodeId('')
    setEditTrFrpEnabled(false)
    setEditTrFrpConfig('')
    setEditTrFrpMode('paste')
    setEditTrFrpNodeId('')
  }

  function openEditModal(inst: { config: { instance_id: string; template_id: string; params: unknown; display_name: string | null } }) {
    const params = (inst.config.params as Record<string, string> | null | undefined) ?? {}
    const base = {
      instance_id: inst.config.instance_id,
      template_id: inst.config.template_id,
      display_name: inst.config.display_name ?? null,
      params: { ...params },
    }

    setEditingInstanceId(inst.config.instance_id)
    setEditBase(base)
    setEditFormError(null)
    setEditFieldErrors({})
    setEditAdvanced(false)
    setEditMcFrpEnabled(false)
    setEditMcFrpConfig('')
    setEditMcFrpMode('paste')
    setEditMcFrpNodeId('')
    setEditTrFrpEnabled(false)
    setEditTrFrpConfig('')
    setEditTrFrpMode('paste')
    setEditTrFrpNodeId('')

    setEditDisplayName(base.display_name ?? '')

    if (base.template_id === 'demo:sleep') {
      setEditSleepSeconds(params.seconds ?? '60')
    }

    if (base.template_id === 'minecraft:vanilla') {
      const v = (params.version ?? 'latest_release').trim() || 'latest_release'
      setEditMcVersion(v)

      const mem = (params.memory_mb ?? '2048').trim() || '2048'
      setEditMcMemory(mem)

      setEditMcPort((params.port ?? '').trim())
      const frp = (params.frp_config ?? '').trim()
      setEditMcFrpEnabled(Boolean(frp))
      setEditMcFrpConfig('')
    }

    if (base.template_id === 'terraria:vanilla') {
      const v = (params.version ?? '1453').trim() || '1453'
      setEditTrVersion(v)

      setEditTrPort((params.port ?? '').trim())
      setEditTrMaxPlayers((params.max_players ?? '8').trim() || '8')
      setEditTrWorldName((params.world_name ?? 'world').trim() || 'world')
      setEditTrWorldSize((params.world_size ?? '1').trim() || '1')
      setEditTrPassword(params.password ?? '')
      setEditTrPasswordVisible(false)
      const frp = (params.frp_config ?? '').trim()
      setEditTrFrpEnabled(Boolean(frp))
      setEditTrFrpConfig('')
    }
  }

  const createInstance = rspc.createMutation(() => 'instance.create')
  const updateInstance = rspc.createMutation(() => 'instance.update')
  const importSaveFromSearch = rspc.createMutation(() => 'instance.importSaveFromSearch')
  const startInstance = rspc.createMutation(() => 'instance.start')
  const restartInstance = rspc.createMutation(() => 'instance.restart')
  const stopInstance = rspc.createMutation(() => 'instance.stop')
  const deleteInstance = rspc.createMutation(() => 'instance.delete')
  const instanceDiagnostics = rspc.createMutation(() => 'instance.diagnostics')
  const controlDiagnostics = rspc.createQuery(
    () => ['control.diagnostics', null],
    () => ({
      enabled: isAuthed(),
      refetchOnWindowFocus: false,
      refetchInterval: isAuthed() ? (showDiagnosticsModal() ? 4000 : 20000) : false,
    }),
  )
  const [cacheSelection, setCacheSelection] = createSignal<Record<string, boolean>>({})
  const isReadOnly = createMemo(() => controlDiagnostics.data?.read_only ?? false)
  const fsWriteEnabled = createMemo(() => controlDiagnostics.data?.fs?.write_enabled ?? true)

  const settingsStatus = rspc.createQuery(
    () => ['settings.status', null],
    () => ({ enabled: isAuthed(), refetchOnWindowFocus: false }),
  )
  const hasSavedSteamcmdCreds = createMemo(
    () => Boolean(settingsStatus.data?.steamcmd_username_set && settingsStatus.data?.steamcmd_password_set),
  )

  const updateCheck = rspc.createQuery(
    () => ['update.check', null],
    () => ({
      enabled: isAuthed() && (me()?.is_admin ?? false),
      refetchOnWindowFocus: false,
      refetchInterval: isAuthed() && (me()?.is_admin ?? false) ? 10 * 60_000 : false,
    }),
  )
  const triggerUpdate = rspc.createMutation(() => 'update.trigger')

  createEffect(() => {
    if (!isAuthed()) return
    if (!(me()?.is_admin ?? false)) return
    void updateCheck.refetch()
  })

  const mcVersions = rspc.createQuery(
    () => ['minecraft.versions', null],
    () => ({ enabled: isAuthed(), refetchOnWindowFocus: false }),
  )

  const instanceDeletePreview = rspc.createQuery(
    () => [
      'instance.deletePreview',
      {
        instance_id: confirmDeleteInstanceId() ?? '',
      },
    ],
    () => ({
      enabled: isAuthed() && !!confirmDeleteInstanceId(),
      refetchOnWindowFocus: false,
    }),
  )

  const warmCache = rspc.createMutation(() => 'process.warmCache')
  const clearCache = rspc.createMutation(() => 'process.clearCache')

  const setDstDefaultKleiKey = rspc.createMutation(() => 'settings.setDstDefaultKleiKey')
  const setCurseforgeApiKey = rspc.createMutation(() => 'settings.setCurseforgeApiKey')
  const setSteamcmdCredentials = rspc.createMutation(() => 'settings.setSteamcmdCredentials')

  const [settingsDstKey, setSettingsDstKey] = createSignal('')
  const [settingsDstKeyVisible, setSettingsDstKeyVisible] = createSignal(false)
  const [settingsCurseforgeKey, setSettingsCurseforgeKey] = createSignal('')
  const [settingsCurseforgeKeyVisible, setSettingsCurseforgeKeyVisible] = createSignal(false)
  const [settingsSteamcmdUsername, setSettingsSteamcmdUsername] = createSignal('')
  const [settingsSteamcmdPassword, setSettingsSteamcmdPassword] = createSignal('')
  const [settingsSteamcmdPasswordVisible, setSettingsSteamcmdPasswordVisible] = createSignal(false)
  const [settingsSteamcmdGuardCode, setSettingsSteamcmdGuardCode] = createSignal('')
  const [settingsSteamcmdMaFile, setSettingsSteamcmdMaFile] = createSignal('')
  const [settingsCurrentPassword, setSettingsCurrentPassword] = createSignal('')
  const [settingsCurrentPasswordVisible, setSettingsCurrentPasswordVisible] = createSignal(false)
  const [settingsNewUsername, setSettingsNewUsername] = createSignal('')
  const [settingsNewPassword, setSettingsNewPassword] = createSignal('')
  const [settingsNewPasswordVisible, setSettingsNewPasswordVisible] = createSignal(false)
  const [changeCredentialsPending, setChangeCredentialsPending] = createSignal(false)

  type InstanceOp = 'starting' | 'stopping' | 'restarting' | 'deleting' | 'updating'
  const [instanceOpById, setInstanceOpById] = createSignal<Record<string, InstanceOp | undefined>>({})
  const [highlightInstanceId, setHighlightInstanceId] = createSignal<string | null>(null)
  const [pendingRevealInstance, setPendingRevealInstance] = createSignal<{ id: string; started_at_unix_ms: number } | null>(null)
  const instanceCardEls = new Map<string, HTMLDivElement>()

  function flashInstance(id: string) {
    setHighlightInstanceId(id)
    window.setTimeout(() => {
      setHighlightInstanceId((prev) => (prev === id ? null : prev))
    }, 1200)
  }

  function revealInstance(id: string) {
    flashInstance(id)
    setPendingRevealInstance({ id, started_at_unix_ms: Date.now() })
  }

  function setInstanceOp(id: string, op: InstanceOp | null) {
    setInstanceOpById((prev) => {
      const next = { ...prev }
      if (!op) delete next[id]
      else next[id] = op
      return next
    })
  }

  async function runInstanceOp<T>(id: string, op: InstanceOp, fn: () => Promise<T>): Promise<T> {
    setInstanceOp(id, op)
    try {
      const out = await fn()
      flashInstance(id)
      return out
    } finally {
      setInstanceOp(id, null)
    }
  }

  const [selectedTemplate, setSelectedTemplate] = createSignal<string>('demo:sleep')
  const [instanceName, setInstanceName] = createSignal<string>('')
  const [sleepSeconds, setSleepSeconds] = createSignal<string>('60')
  const [createFormError, setCreateFormError] = createSignal<{ message: string; requestId?: string } | null>(null)
  const [createFieldErrors, setCreateFieldErrors] = createSignal<Record<string, string>>({})
  const [, setWarmFormError] = createSignal<{ message: string; requestId?: string } | null>(null)
  const [, setWarmFieldErrors] = createSignal<Record<string, string>>({})
  const [editFormError, setEditFormError] = createSignal<{ message: string; requestId?: string } | null>(null)
  const [editFieldErrors, setEditFieldErrors] = createSignal<Record<string, string>>({})
  const [editBase, setEditBase] = createSignal<{
    instance_id: string
    template_id: string
    display_name: string | null
    params: Record<string, string>
  } | null>(null)

  const [editDisplayName, setEditDisplayName] = createSignal('')

  const [editSleepSeconds, setEditSleepSeconds] = createSignal('60')

  const [editMcVersion, setEditMcVersion] = createSignal('latest_release')
  const [editMcMemory, setEditMcMemory] = createSignal('2048')
  const [editMcPort, setEditMcPort] = createSignal('')
  const [editMcFrpEnabled, setEditMcFrpEnabled] = createSignal(false)
  const [editMcFrpConfig, setEditMcFrpConfig] = createSignal('')
  const [editMcFrpMode, setEditMcFrpMode] = createSignal<FrpConfigMode>('paste')
  const [editMcFrpNodeId, setEditMcFrpNodeId] = createSignal('')

  const [editTrVersion, setEditTrVersion] = createSignal('1453')
  const [editTrPort, setEditTrPort] = createSignal('')
  const [editTrMaxPlayers, setEditTrMaxPlayers] = createSignal('8')
  const [editTrWorldName, setEditTrWorldName] = createSignal('world')
  const [editTrWorldSize, setEditTrWorldSize] = createSignal('1')
  const [editTrPassword, setEditTrPassword] = createSignal('')
  const [editTrPasswordVisible, setEditTrPasswordVisible] = createSignal(false)
  const [editTrFrpEnabled, setEditTrFrpEnabled] = createSignal(false)
  const [editTrFrpConfig, setEditTrFrpConfig] = createSignal('')
  const [editTrFrpMode, setEditTrFrpMode] = createSignal<FrpConfigMode>('paste')
  const [editTrFrpNodeId, setEditTrFrpNodeId] = createSignal('')

  const [editAdvanced, setEditAdvanced] = createSignal(false)

  const editTemplateId = createMemo(() => editBase()?.template_id ?? null)

  const editMcEffectiveVersion = createMemo(() => editMcVersion())

  const editTrEffectiveVersion = createMemo(() => editTrVersion())

  const editOutgoingParams = createMemo(() => {
    const base = editBase()
    if (!base) return null
    const out: Record<string, string> = { ...base.params }

    if (base.template_id === 'demo:sleep') {
      out.seconds = editSleepSeconds().trim() || out.seconds || '60'
    }

    if (base.template_id === 'minecraft:vanilla') {
      out.accept_eula = 'true'
      out.version = editMcEffectiveVersion().trim() || out.version || 'latest_release'
      out.memory_mb = editMcMemory().trim() || out.memory_mb || '2048'
      out.port = editMcPort().trim() || out.port || ''
      if (!editMcFrpEnabled()) delete out.frp_config
      else {
        const nodeCfg = editMcFrpMode() === 'node' ? frpNodeConfigById(editMcFrpNodeId()) : null
        if (nodeCfg) out.frp_config = nodeCfg
        else if (editMcFrpConfig().trim()) out.frp_config = editMcFrpConfig().trim()
      }
    }

    if (base.template_id === 'terraria:vanilla') {
      out.version = editTrEffectiveVersion().trim() || out.version || '1453'
      out.port = editTrPort().trim() || out.port || ''
      out.max_players = editTrMaxPlayers().trim() || out.max_players || '8'
      out.world_name = editTrWorldName().trim() || out.world_name || 'world'
      out.world_size = editTrWorldSize().trim() || out.world_size || '1'
      // Keep existing password unless explicitly changed/cleared.
      if (editTrPassword().trim()) out.password = editTrPassword()
      if (!editTrPassword().trim() && 'password' in base.params && base.params.password) out.password = base.params.password
      if (!editTrPassword().trim() && !('password' in base.params)) delete out.password
      if (!editTrFrpEnabled()) delete out.frp_config
      else {
        const nodeCfg = editTrFrpMode() === 'node' ? frpNodeConfigById(editTrFrpNodeId()) : null
        if (nodeCfg) out.frp_config = nodeCfg
        else if (editTrFrpConfig().trim()) out.frp_config = editTrFrpConfig().trim()
      }
    }

    return out
  })

  const editChangedKeys = createMemo(() => {
    const base = editBase()
    const out = editOutgoingParams()
    if (!base || !out) return []
    const keys = new Set([...Object.keys(base.params), ...Object.keys(out)])
    const changed: string[] = []
    for (const k of keys) {
      if ((base.params[k] ?? '') !== (out[k] ?? '')) changed.push(k)
    }
    if ((base.display_name ?? '') !== editDisplayName().trim()) changed.push('display_name')
    changed.sort()
    return changed
  })

  const editAdvancedDirty = createMemo(() => {
    const template = editTemplateId()
    const changed = editChangedKeys()
    if (template === 'minecraft:vanilla') return changed.includes('port') || changed.includes('frp_config')
    if (template === 'terraria:vanilla') return changed.includes('port') || changed.includes('world_size') || changed.includes('password') || changed.includes('frp_config')
    return false
  })

  const editHasChanges = createMemo(() => editChangedKeys().length > 0)

  const editRisk = createMemo(() => {
    const template = editTemplateId()
    const changed = editChangedKeys()
    const risky = new Set<string>()
    if (template === 'minecraft:vanilla') {
      if (changed.includes('version')) risky.add(t('instances.edit.risk.minecraftVersion'))
      if (changed.includes('memory_mb')) risky.add(t('instances.edit.risk.minecraftMemory'))
      if (changed.includes('port')) risky.add(t('instances.edit.risk.port'))
    }
    if (template === 'terraria:vanilla') {
      if (changed.includes('version')) risky.add(t('instances.edit.risk.terrariaVersion'))
      if (changed.includes('world_name')) risky.add(t('instances.edit.risk.worldName'))
      if (changed.includes('port')) risky.add(t('instances.edit.risk.port'))
    }
    return Array.from(risky)
  })

  const [mcCreateMode, setMcCreateMode] = createSignal<MinecraftCreateMode>('vanilla')
  const [mcEula, setMcEula] = createSignal(false)
  const [mcVersion, setMcVersion] = createSignal('latest_release')
  const [mcImportPack, setMcImportPack] = createSignal('')
  const [mcImportPacks, setMcImportPacks] = createSignal<
    { name: string; path: string; size_bytes: string; modified_unix_ms: string }[]
  >([])
  const [mcImportPacksPending, setMcImportPacksPending] = createSignal(false)
  const [mcImportUploadPending, setMcImportUploadPending] = createSignal(false)
  const [mcMemory, setMcMemory] = createSignal('2048')
  const [mcPort, setMcPort] = createSignal('')
  const [mcFrpEnabled, setMcFrpEnabled] = createSignal(false)
  const [mcFrpConfig, setMcFrpConfig] = createSignal('')
  const [mcFrpMode, setMcFrpMode] = createSignal<FrpConfigMode>('paste')
  const [mcFrpNodeId, setMcFrpNodeId] = createSignal('')

  const [trVersion, setTrVersion] = createSignal('1453')

  const [trPort, setTrPort] = createSignal('')
  const [trMaxPlayers, setTrMaxPlayers] = createSignal('8')
  const [trWorldName, setTrWorldName] = createSignal('world')
  const [trWorldSize, setTrWorldSize] = createSignal('1')
  const [trPassword, setTrPassword] = createSignal('')
  const [trPasswordVisible, setTrPasswordVisible] = createSignal(false)
  const [trFrpEnabled, setTrFrpEnabled] = createSignal(false)
  const [trFrpConfig, setTrFrpConfig] = createSignal('')
  const [trFrpMode, setTrFrpMode] = createSignal<FrpConfigMode>('paste')
  const [trFrpNodeId, setTrFrpNodeId] = createSignal('')

  const mcEffectiveFrpConfig = createMemo(() =>
    !mcFrpEnabled()
      ? ''
      : mcFrpMode() === 'node'
        ? frpNodeConfigById(mcFrpNodeId()) ?? ''
        : mcFrpConfig().trim(),
  )
  const trEffectiveFrpConfig = createMemo(() =>
    !trFrpEnabled()
      ? ''
      : trFrpMode() === 'node'
        ? frpNodeConfigById(trFrpNodeId()) ?? ''
        : trFrpConfig().trim(),
  )

  const [dstClusterToken, setDstClusterToken] = createSignal('')
  const [dstClusterTokenVisible, setDstClusterTokenVisible] = createSignal(false)
  const [dstClusterName, setDstClusterName] = createSignal(t('template.defaultDstServerName'))
  const [dstMaxPlayers, setDstMaxPlayers] = createSignal('6')
  const [dstPassword, setDstPassword] = createSignal('')
  const [dstPasswordVisible, setDstPasswordVisible] = createSignal(false)
  const [dstPort, setDstPort] = createSignal('0')
  const [dstMasterPort, setDstMasterPort] = createSignal('0')
  const [dstAuthPort, setDstAuthPort] = createSignal('0')

  async function loadMcImportPacks() {
    if (!isAuthed()) {
      setMcImportPacks([])
      return
    }
    setMcImportPacksPending(true)
    try {
      const node_id = createNodeId().trim()
      const params = new URLSearchParams()
      if (node_id) params.set('node_id', node_id)
      const qs = params.toString()
      const resp = await fetch(`/instance/modpack-packs${qs ? `?${qs}` : ''}`, {
        method: 'GET',
        credentials: 'include',
      })
      const payload = (await resp.json().catch(() => null)) as
        | { entries?: { name: string; path: string; size_bytes: string; modified_unix_ms: string }[]; message?: string }
        | null
      if (!resp.ok) throw new Error(payload?.message || `list packs failed: ${resp.status}`)
      setMcImportPacks(Array.isArray(payload?.entries) ? payload!.entries! : [])
    } catch (e) {
      setMcImportPacks([])
      toastError(t('app.loadUploadedPacksFailed'), e)
    } finally {
      setMcImportPacksPending(false)
    }
  }

  async function uploadMcImportPackFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      pushToast('error', t('app.invalidFile'), t('app.onlyZipSupported'))
      return
    }

    setMcImportUploadPending(true)
    try {
      const csrf = await ensureCsrfCookie()
      const form = new FormData()
      const node_id = createNodeId().trim()
      if (node_id) form.append('node_id', node_id)
      form.append('file', file)

      const resp = await fetch('/instance/upload-modpack', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'x-csrf-token': csrf,
        },
        body: form,
      })

      const payload = (await resp.json().catch(() => null)) as
        | { path?: string; message?: string }
        | null
      if (!resp.ok) throw new Error(payload?.message || `upload failed: ${resp.status}`)

      const path = (payload?.path || '').trim()
      if (path) setMcImportPack(path)
      await loadMcImportPacks()
      pushToast('success', t('app.uploadComplete'), path || file.name)
    } catch (e) {
      toastError(t('app.uploadFailed'), e)
    } finally {
      setMcImportUploadPending(false)
    }
  }

  const mcImportPackOptions = createMemo(() => {
    const current = mcImportPack().trim()
    const options = mcImportPacks().map((p) => ({
      value: p.path,
      label: p.name,
      meta: `${p.path} · ${p.size_bytes} B`,
    }))
    const withCurrent = optionsWithCurrentValue(options, current)
    return [
      {
        value: '__upload__',
        label: t('app.uploadZipOption'),
        meta: mcImportUploadPending() ? t('app.uploading') : undefined,
      },
      ...withCurrent,
    ]
  })

  const [pwServerName, setPwServerName] = createSignal(t('template.defaultPalworldServerName'))
  const [pwServerDescription, setPwServerDescription] = createSignal('')
  const [pwMaxPlayers, setPwMaxPlayers] = createSignal('32')
  const [pwPassword, setPwPassword] = createSignal('')
  const [pwAdminPassword, setPwAdminPassword] = createSignal('')
  const [pwPublic, setPwPublic] = createSignal(false)
  const [pwPort, setPwPort] = createSignal('8211')
  const [pwQueryPort, setPwQueryPort] = createSignal('27015')

  const [fxVersion, setFxVersion] = createSignal('stable')
  const [fxServerName, setFxServerName] = createSignal(t('template.defaultFactorioServerName'))
  const [fxServerDescription, setFxServerDescription] = createSignal('')
  const [fxMaxPlayers, setFxMaxPlayers] = createSignal('8')
  const [fxPublic, setFxPublic] = createSignal(false)
  const [fxPort, setFxPort] = createSignal('34197')
  const [fxRconEnabled, setFxRconEnabled] = createSignal(false)
  const [fxRconPort, setFxRconPort] = createSignal('27015')
  const [fxRconPassword, setFxRconPassword] = createSignal('')


  const createTemplateId = createMemo(() => {
    const raw = selectedTemplate()
    if (raw !== CREATE_TEMPLATE_MINECRAFT) return raw
    const avail = availableMinecraftCreateModes()
    const mode = mcCreateMode()
    const chosen = avail.includes(mode) ? mode : avail[0] ?? 'vanilla'
    return MINECRAFT_TEMPLATE_ID_BY_MODE[chosen]
  })

  const minecraftCreateModeOptions = createMemo(() => {
    const labels: Record<MinecraftCreateMode, string> = {
      vanilla: t('template.mode.vanilla'),
      import: t('template.mode.import'),
    }
    return availableMinecraftCreateModes().map((value) => ({ value, label: labels[value] }))
  })

  createEffect(() => {
    if (selectedTemplate() !== CREATE_TEMPLATE_MINECRAFT) return
    const avail = availableMinecraftCreateModes()
    if (!avail.length) return
    if (!avail.includes(mcCreateMode())) setMcCreateMode(avail[0])
  })

  const [createAdvanced, setCreateAdvanced] = createSignal(false)
  const createAdvancedDirty = createMemo(() =>
    computeCreateAdvancedDirty({
      templateId: createTemplateId(),
      mcPort: mcPort(),
      mcFrpEnabled: mcFrpEnabled(),
      mcEffectiveFrpConfig: mcEffectiveFrpConfig(),
      trPort: trPort(),
      trWorldSize: trWorldSize(),
      trPassword: trPassword(),
      trFrpEnabled: trFrpEnabled(),
      trEffectiveFrpConfig: trEffectiveFrpConfig(),
      pwPort: pwPort(),
      pwQueryPort: pwQueryPort(),
      fxPort: fxPort(),
      fxRconEnabled: fxRconEnabled(),
      fxRconPort: fxRconPort(),
      fxRconPassword: fxRconPassword(),
      dstPort: dstPort(),
      dstMasterPort: dstMasterPort(),
      dstAuthPort: dstAuthPort(),
    }),
  )

  const createPreview = createMemo(() =>
    buildCreatePreview({
      t,
      templateId: createTemplateId(),
      templateLabel: templateDisplayName(createTemplateId()),
      instanceName: instanceName(),
      nodeName: createSelectedNode()?.enabled ? (createSelectedNode()?.name ?? '') : '',
      sleepSeconds: sleepSeconds(),
      createAdvanced: createAdvanced(),
      createAdvancedDirty: createAdvancedDirty(),
      mcVersion: mcVersion(),
      mcMemory: mcMemory(),
      mcPort: mcPort(),
      mcFrpEnabled: mcFrpEnabled(),
      mcEffectiveFrpConfig: mcEffectiveFrpConfig(),
      mcEula: mcEula(),
      mcImportPack: mcImportPack(),
      dstClusterToken: dstClusterToken(),
      dstClusterName: dstClusterName(),
      dstMaxPlayers: dstMaxPlayers(),
      dstPassword: dstPassword(),
      dstPort: dstPort(),
      dstMasterPort: dstMasterPort(),
      dstAuthPort: dstAuthPort(),
      dstDefaultKleiKeySet: Boolean(settingsStatus.data?.dst_default_klei_key_set),
      trVersion: trVersion(),
      trPort: trPort(),
      trFrpEnabled: trFrpEnabled(),
      trEffectiveFrpConfig: trEffectiveFrpConfig(),
      trMaxPlayers: trMaxPlayers(),
      trWorldName: trWorldName(),
      trWorldSize: trWorldSize(),
      trPassword: trPassword(),
      pwServerName: pwServerName(),
      pwServerDescription: pwServerDescription(),
      pwMaxPlayers: pwMaxPlayers(),
      pwPassword: pwPassword(),
      pwAdminPassword: pwAdminPassword(),
      pwPublic: pwPublic(),
      pwPort: pwPort(),
      pwQueryPort: pwQueryPort(),
      fxVersion: fxVersion(),
      fxServerName: fxServerName(),
      fxServerDescription: fxServerDescription(),
      fxMaxPlayers: fxMaxPlayers(),
      fxPublic: fxPublic(),
      fxPort: fxPort(),
      fxRconEnabled: fxRconEnabled(),
      fxRconPort: fxRconPort(),
      fxRconPassword: fxRconPassword(),
    }),
  )
  createEffect(() => {
    // Clear create-form errors when switching templates.
    selectedTemplate()
    setCreateFormError(null)
    setCreateFieldErrors({})
    setWarmFormError(null)
    setWarmFieldErrors({})
    setCreateAdvanced(false)
    setMcFrpEnabled(false)
    setMcFrpConfig('')
    setMcFrpMode('paste')
    setMcFrpNodeId('')
    setTrFrpEnabled(false)
    setTrFrpConfig('')
    setTrFrpMode('paste')
    setTrFrpNodeId('')
    setDstClusterTokenVisible(false)
    setDstPasswordVisible(false)
  })

  function focusFirstCreateError(errors: Record<string, string>) {
    focusFirstCreateErrorInForm({
      errors,
      templateId: createTemplateId(),
      createAdvanced: createAdvanced(),
      setCreateAdvanced,
        refs: {
          createInstanceNameEl,
          createSleepSecondsEl,
          createMcEulaEl,
          createMcImportPackEl,
          createMcPortEl,
          createMcMemoryEl,
        createMcFrpConfigEl,
        createMcFrpNodeEl,
        createTrPortEl,
        createTrMaxPlayersEl,
        createTrWorldNameEl,
        createTrWorldSizeEl,
        createTrPasswordEl,
        createTrFrpConfigEl,
        createTrFrpNodeEl,
        createPwPortEl,
        createPwQueryPortEl,
        createFxPortEl,
        createFxRconPortEl,
        createFxRconPasswordEl,
        createDstClusterTokenEl,
        createDstClusterNameEl,
        createDstMaxPlayersEl,
        createDstPasswordEl,
        createDstPortEl,
        createDstMasterPortEl,
        createDstAuthPortEl,
        createNodeSelectEl,
      },
      mcFrpEnabled: mcFrpEnabled(),
      mcFrpMode: mcFrpMode(),
      trFrpEnabled: trFrpEnabled(),
      trFrpMode: trFrpMode(),
    })
  }
  const {
    cancelDownloadJob,
    clearDownloadHistory,
    copyDownloadFailureReason,
    copyDownloadJobDetails,
    downloadCenterView,
    downloadEnqueueTarget,
    downloadFxVersion,
    downloadJobs,
    downloadMcVersion,
    downloadNowUnixMs,
    downloadQueueEnqueue,
    downloadQueuePaused,
    downloadSevenDaysVersion,
    downloadSonsOfTheForestVersion,
    downloadStatus,
    downloadTheForestVersion,
    downloadTrVersion,
    downloadDstVersion,
    downloadPwVersion,
    downloadCoreKeeperVersion,
    enqueueDownloadWarm,
    hasRunningDownloadJobs,
    latestDownloadFailureByTarget,
    moveDownloadJob,
    pauseDownloadJob,
    resumeDownloadJob,
    retryDownloadJob,
    selectedDownloadJob,
    selectedDownloadJobId,
    setDownloadCenterView,
    setDownloadFxVersion,
    setDownloadMcVersion,
    setDownloadSevenDaysVersion,
    setDownloadSonsOfTheForestVersion,
    setDownloadTheForestVersion,
    setDownloadTrVersion,
    setDownloadDstVersion,
    setDownloadPwVersion,
    setDownloadCoreKeeperVersion,
    setSelectedDownloadJobId,
    toggleDownloadQueuePaused,
  } = useDownloadsDomain({
    isAuthed,
    tab,
    isReadOnly,
    t,
    pushToast,
    toastError,
    friendlyErrorMessage,
  })

  function focusFirstEditError(errors: Record<string, string>) {
    focusFirstEditErrorInForm({
      errors,
      templateId: editTemplateId(),
      editAdvanced: editAdvanced(),
      setEditAdvanced,
      refs: {
        editDisplayNameEl,
        editSleepSecondsEl,
        editMcMemoryEl,
        editMcPortEl,
        editMcFrpConfigEl,
        editMcFrpNodeEl,
        editTrPortEl,
        editTrMaxPlayersEl,
        editTrWorldNameEl,
        editTrWorldSizeEl,
        editTrPasswordEl,
        editTrFrpConfigEl,
        editTrFrpNodeEl,
      },
      editMcFrpEnabled: editMcFrpEnabled(),
      editMcFrpMode: editMcFrpMode(),
      editTrFrpEnabled: editTrFrpEnabled(),
      editTrFrpMode: editTrFrpMode(),
    })
  }
  const trVersionOptions = createMemo(() => [
    { value: '1453', label: '1.4.5.3 (1453)', meta: t('template.latest') },
    { value: '1452', label: '1.4.5.2 (1452)' },
    { value: '1451', label: '1.4.5.1 (1451)' },
    { value: '1450', label: '1.4.5.0 (1450)' },
    { value: '1449', label: '1.4.4.9 (1449)' },
    { value: '1448', label: '1.4.4.8 (1448)' },
    { value: '1447', label: '1.4.4.7 (1447)' },
    { value: '1436', label: '1.4.3.6 (1436)' },
    { value: '1435', label: '1.4.3.5 (1435)' },
    { value: '1434', label: '1.4.3.4 (1434)' },
    { value: '1423', label: '1.4.2.3 (1423)' },
  ])

  const fxVersionOptions = createMemo(() => [
    { value: 'stable', label: t('template.factorioStableLatest') },
    { value: 'experimental', label: t('template.factorioExperimentalLatest') },
  ])

  const pwVersionOptions = createMemo(() => [{ value: 'latest', label: t('template.latestSteamcmdAppUpdate') }])
  const dstVersionOptions = createMemo(() => [{ value: 'latest', label: t('template.latestSteamcmdAppUpdate') }])
  const coreKeeperVersionOptions = createMemo(() => [{ value: 'latest', label: t('template.latestSteamcmdAppUpdate') }])
  const sevenDaysVersionOptions = createMemo(() => [{ value: 'latest', label: t('template.latestSteamcmdAppUpdate') }])
  const theForestVersionOptions = createMemo(() => [{ value: 'latest', label: t('template.latestSteamcmdAppUpdate') }])
  const sonsOfTheForestVersionOptions = createMemo(() => [{ value: 'latest', label: t('template.latestSteamcmdAppUpdate') }])

  const mcVersionOptions = createMemo(() => {
    const data = mcVersions.data
    if (!data) {
      return [
        { value: 'latest_release', label: t('template.latestRelease'), meta: t('template.recommended') },
        { value: 'latest_snapshot', label: t('template.latestSnapshot'), meta: t('template.unstable') },
      ]
    }

    const out: { value: string; label: string; meta?: string }[] = [
      {
        value: 'latest_release',
        label: t('template.latestReleaseWithVersion', { version: data.latest_release }),
        meta: t('template.recommended'),
      },
      {
        value: 'latest_snapshot',
        label: t('template.latestSnapshotWithVersion', { version: data.latest_snapshot }),
        meta: t('template.unstable'),
      },
    ]

    // Show a curated list of recent releases (no manual typing).
    const releases = data.versions.filter((v: { kind: string }) => v.kind === 'release').slice(0, 60)
    for (const v of releases) {
      out.push({ value: v.id, label: v.id })
    }
    return out
  })

  createEffect(() => {
    if (authLoading()) return
    const nextTab = coerceUiTabForRole(tab(), Boolean(me()?.is_admin))
    if (nextTab !== tab()) {
      setTabSilently(nextTab)
      replaceTabInHistory(nextTab)
    }
  })

  createEffect(() => {
    if (typeof window === 'undefined') return
    const onPopState = () => {
      const fromUrl = readUiRouteFromLocation('instances')
      const nextTab = coerceUiTabForRole(fromUrl.tab, Boolean(me()?.is_admin))
      setTabSilently(nextTab)
      if (nextTab === 'instances') {
        setSelectedInstanceId(fromUrl.instanceId)
      }
      if (nextTab === 'files') {
        setFsPath(fromUrl.fsPath ?? '')
        setSelectedFilePath(fromUrl.selectedFilePath)
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  })

  createEffect(() => {
    if (typeof window === 'undefined') return
    const route = currentUiRoute(tab())
    const nextUrl = buildTabUrl(route)
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (currentUrl === nextUrl) return
    const currentState = (window.history.state as UiTabRouteState | null) ?? {}
    window.history.replaceState({ ...currentState, ...route }, '', nextUrl)
  })

  // Nodes state/queries will be moved into NodesPage next.

  const selectedInstance = createMemo(() => {
    const id = selectedInstanceId()
    if (!id) return null
    return (instances.data ?? []).find((x: { config: { instance_id: string } }) => x.config.instance_id === id) ?? null
  })
  const selectedInstanceStatus = createMemo(() => selectedInstance()?.status ?? null)
  const canTailProcessLogs = createMemo(() => {
    const state = selectedInstanceStatus()?.state
    return !!state && state !== 'PROCESS_STATE_EXITED'
  })
  const selectedInstanceDisplayName = createMemo(() => {
    const inst = selectedInstance() as any
    if (!inst) return null
    const params = inst.config?.params as Record<string, unknown> | null | undefined
    const paramName = params?.name
    if (typeof inst.config?.display_name === 'string' && inst.config.display_name.trim()) return inst.config.display_name.trim()
    if (typeof paramName === 'string' && paramName.trim()) return paramName.trim()
    const templateId = inst.config?.template_id
    if (typeof templateId === 'string' && templateId.trim()) {
      return templateDisplayName(templateId)
    }
    return inst.config?.instance_id ?? null
  })

  const [showInstanceModal, setShowInstanceModal] = createSignal(false)
  type InstanceDetailTab = 'overview' | 'logs' | 'files' | 'config'
  const [instanceDetailTab, setInstanceDetailTab] = createSignal<InstanceDetailTab>('logs')

  const selectedTemplateSupportsSaveSearch = createMemo(() => {
    const templateId = selectedInstance()?.config?.template_id ?? ''
    return (
      templateId === 'minecraft:vanilla' ||
      templateId === 'minecraft:modrinth' ||
      templateId === 'minecraft:import' ||
      templateId === 'minecraft:curseforge'
    )
  })

  const [saveSearchQuery, setSaveSearchQuery] = createSignal('')

  type TailLine = { text: string; received_at_unix_ms: number }
  const MAX_PROCESS_LOG_LINES = 400
  const [processLogCursor, setProcessLogCursor] = createSignal<string | null>(null)
  const [processLogLive, setProcessLogLive] = createSignal(true)
  const [processLogLines, setProcessLogLines] = createSignal<TailLine[]>([])

  createEffect(() => {
    // Reset log tail state when switching instance.
    selectedInstanceId()
    setProcessLogCursor(null)
    setProcessLogLines([])
    setProcessLogLive(true)
    setSaveSearchQuery('')
  })

  const instanceSaveSearch = rspc.createQuery(
    () => [
      'instance.searchSaves',
      {
        instance_id: selectedInstanceId() ?? '',
        query: saveSearchQuery().trim(),
        limit: 8,
      },
    ],
    () => ({
      enabled:
        isAuthed() &&
        showInstanceModal() &&
        !!selectedInstanceId() &&
        selectedTemplateSupportsSaveSearch() &&
        saveSearchQuery().trim().length >= 2,
      refetchOnWindowFocus: false,
    }),
  )

  const processLogsTail = rspc.createQuery(
    () => [
      'process.logsTail',
      {
        process_id: canTailProcessLogs() ? (selectedInstanceId() ?? '') : '',
        cursor: processLogCursor(),
        limit: 400,
      },
    ],
    () => ({
      enabled: isAuthed() && showInstanceModal() && !!selectedInstanceId() && instanceDetailTab() === 'logs' && canTailProcessLogs(),
      refetchInterval: processLogLive() ? 1000 : false,
      refetchOnWindowFocus: false,
    }),
  )

  createEffect(() => {
    if (processLogCursor() !== null) return
    setProcessLogLines([])
  })

  createEffect(() => {
    const lines = processLogsTail.data?.lines
    if (!lines || lines.length === 0) return
    const now = Date.now()
    setProcessLogLines((prev) => {
      const next = [...prev, ...lines.map((text: string) => ({ text, received_at_unix_ms: now }))]
      if (next.length <= MAX_PROCESS_LOG_LINES) return next
      return next.slice(next.length - MAX_PROCESS_LOG_LINES)
    })
  })

  createEffect(() => {
    if (!processLogLive()) return
    const next = processLogsTail.data?.next_cursor
    if (next) setProcessLogCursor(next)
  })

  const {
    closeCreateNode,
    closeFrpNodeModal,
    createNode,
    createNodeComposeYaml,
    createNodeControlWsUrl,
    createNodeId,
    createNodeDropdownOptions,
    createNodeFieldErrors,
    createNodeFormError,
    createNodeInstallCommand,
    createNodeName,
    createNodeResult,
    createSelectedNode,
    defaultCreateNodeControlWsUrl,
    deleteNode,
    editingFrpNodeId,
    frpCreateNode,
    frpDeleteNode,
    frpNodeCanSave,
    frpNodeConfig,
    frpNodeConfigById,
    frpNodeDetectedFormat,
    frpNodeDropdownOptions,
    frpNodeFieldErrors,
    frpNodeFormError,
    frpNodeName,
    frpNodeServerAddr,
    frpNodeServerPort,
    frpNodeAllocatablePorts,
    frpNodeToken,
    frpNodeTokenVisible,
    frpNodes,
    frpUpdateNode,
    invalidateFrpNodes,
    invalidateNodes,
    nodeAgentOutdatedCount,
    nodeCount,
    nodeEnabledOverride,
    nodeSelfUpdateStatus,
    nodes,
    nodesLastUpdatedAtUnixMs,
    openCreateFrpNodeModal,
    openCreateNode,
    openEditFrpNodeModal,
    selectedNode,
    selectedNodeId,
    setCreateNodeControlWsUrl,
    setCreateNodeId,
    setCreateNodeFieldErrors,
    setCreateNodeFormError,
    setCreateNodeName,
    setCreateNodeResult,
    setFrpNodeAllocatablePorts,
    setFrpNodeConfig,
    setFrpNodeFieldErrors,
    setFrpNodeFormError,
    setFrpNodeName,
    setFrpNodeServerAddr,
    setFrpNodeServerPort,
    setFrpNodeToken,
    setFrpNodeTokenVisible,
    setNodeEnabled,
    setNodeEnabledOverride,
    setSelectedNodeId,
    showCreateNodeModal,
    showFrpNodeModal,
    triggerNodeSelfUpdate,
  } = useNodesDomain({
    isAuthed,
    me,
    tab,
    t,
    updateCheck,
    controlDiagnostics,
  })

  createEffect(() => {
    if (!isAuthed()) return
    if (createTemplateId() !== 'minecraft:import') return
    createNodeId()
    void loadMcImportPacks()
  })

  const selectedInstanceError = createMemo(() => parseAgentErrorPayload(selectedInstanceStatus()?.message ?? null))
  const selectedInstanceMessage = createMemo(() => selectedInstanceError()?.message ?? selectedInstanceStatus()?.message ?? null)

  createEffect(() => {
    const id = confirmDeleteInstanceId()
    if (!id) {
      setConfirmDeleteText('')
      return
    }
    setConfirmDeleteText('')
  })

  createEffect(() => {
    if (!showDiagnosticsModal()) return
    const entries = controlDiagnostics.data?.cache?.entries ?? []
    setCacheSelection((prev) => {
      const next = { ...prev }
      for (const e of entries) {
        if (typeof next[e.key] !== 'boolean') next[e.key] = false
      }
      return next
    })
  })

  function openInFiles(path: string) {
    setFsPath(path)
    setSelectedFilePath(null)
    setTab('files')
  }

  function openFileInFiles(filePath: string) {
    const cleaned = filePath.replace(/\/+$/, '')
    const idx = cleaned.lastIndexOf('/')
    const dir = idx <= 0 ? '' : cleaned.slice(0, idx)
    setFsPath(dir)
    setSelectedFilePath(cleaned)
    setTab('files')
  }

  // selectedInstance UI is handled by the terminal modal.

  // Files state/queries will be moved into FilesPage next.

  const instancesTabProps = {
    createNodeDropdownOptions,
    createSelectedNode,
    createNodeId,
    createAdvanced,
    createAdvancedDirty,
    createFieldErrors,
    createFormError,
    createInstance,
    createPreview,
    createTemplateId,
    dstAuthPort,
    dstClusterName,
    dstClusterToken,
    dstClusterTokenVisible,
    dstMasterPort,
    dstMaxPlayers,
    dstPassword,
    dstPasswordVisible,
    dstPort,
    filteredInstances,
    focusFirstCreateError,
    friendlyErrorMessage,
    frpNodeDropdownOptions,
    hasSavedSteamcmdCreds,
    highlightInstanceId,
    instanceCardEls,
    instanceCompact,
    instanceDisplayName,
    instanceViewPresets,
    instanceName,
    instanceOpById,
    instanceSearchInput,
    instanceSortKey,
    instanceSortOptions,
    instanceStatusFilter,
    instanceStatusFilterOptions,
    instanceStatusKeys,
    instanceTemplateFilter,
    instanceTemplateFilterOptions,
    instances,
    instancesPollErrorStreak,
    instancesLastUpdatedAtUnixMs,
    invalidateInstances,
    isReadOnly,
    activeInstanceViewPresetId,
    applyInstanceViewPreset,
    deleteInstanceViewPreset,
    mcCreateMode,
    mcEffectiveFrpConfig,
    mcEula,
    mcFrpConfig,
    mcFrpEnabled,
    mcFrpMode,
    mcFrpNodeId,
    mcImportPack,
    mcImportPackOptions,
    mcImportPacksPending,
    mcImportUploadPending,
    mcMemory,
    mcPort,
    mcVersion,
    mcVersionOptions,
    me,
    minecraftCreateModeOptions,
    openEditModal,
    openFileInFiles,
    openInFiles,
    openSettingsTab: () => setTab('settings'),
    pinnedInstanceIds,
    pushToast,
    toastSuccessFromRspc,
    restartInstance,
    revealInstance,
    runInstanceOp,
    uploadMcImportPackFile,
    selectedInstanceId,
    selectedTemplate,
    setConfirmDeleteInstanceId,
    setCreateAdvanced,
    setCreateDstAuthPortEl: (el: HTMLInputElement) => (createDstAuthPortEl = el),
    setCreateDstClusterNameEl: (el: HTMLInputElement) => (createDstClusterNameEl = el),
    setCreateDstClusterTokenEl: (el: HTMLInputElement) => (createDstClusterTokenEl = el),
    setCreateDstMasterPortEl: (el: HTMLInputElement) => (createDstMasterPortEl = el),
    setCreateDstMaxPlayersEl: (el: HTMLInputElement) => (createDstMaxPlayersEl = el),
    setCreateDstPasswordEl: (el: HTMLInputElement) => (createDstPasswordEl = el),
    setCreateDstPortEl: (el: HTMLInputElement) => (createDstPortEl = el),
    setCreateFieldErrors,
    setCreateFormError,
    setCreateInstanceNameEl: (el: HTMLInputElement) => (createInstanceNameEl = el),
    setCreateNodeId,
    setCreateNodeSelectEl: (el: HTMLDivElement) => (createNodeSelectEl = el),
    setCreateMcEulaEl: (el: HTMLInputElement) => (createMcEulaEl = el),
    setCreateMcFrpConfigEl: (el: HTMLTextAreaElement) => (createMcFrpConfigEl = el),
    setCreateMcFrpNodeEl: (el: HTMLDivElement) => (createMcFrpNodeEl = el),
    setCreateMcImportPackEl: (el: HTMLDivElement) => (createMcImportPackEl = el),
    setCreateMcMemoryEl: (el: HTMLInputElement) => (createMcMemoryEl = el),
    setCreateMcPortEl: (el: HTMLInputElement) => (createMcPortEl = el),
    setCreateSleepSecondsEl: (el: HTMLInputElement) => (createSleepSecondsEl = el),
    setCreateTrFrpConfigEl: (el: HTMLTextAreaElement) => (createTrFrpConfigEl = el),
    setCreateTrFrpNodeEl: (el: HTMLDivElement) => (createTrFrpNodeEl = el),
    setCreateTrMaxPlayersEl: (el: HTMLInputElement) => (createTrMaxPlayersEl = el),
    setCreateTrPasswordEl: (el: HTMLInputElement) => (createTrPasswordEl = el),
    setCreateTrPortEl: (el: HTMLInputElement) => (createTrPortEl = el),
    setCreateTrWorldNameEl: (el: HTMLInputElement) => (createTrWorldNameEl = el),
    setCreateTrWorldSizeEl: (el: HTMLInputElement) => (createTrWorldSizeEl = el),
    setCreatePwPortEl: (el: HTMLInputElement) => (createPwPortEl = el),
    setCreatePwQueryPortEl: (el: HTMLInputElement) => (createPwQueryPortEl = el),
    setCreateFxPortEl: (el: HTMLInputElement) => (createFxPortEl = el),
    setCreateFxRconPortEl: (el: HTMLInputElement) => (createFxRconPortEl = el),
    setCreateFxRconPasswordEl: (el: HTMLInputElement) => (createFxRconPasswordEl = el),
    setDstAuthPort,
    setDstClusterName,
    setDstClusterToken,
    setDstClusterTokenVisible,
    setDstMasterPort,
    setDstMaxPlayers,
    setDstPassword,
    setDstPasswordVisible,
    setDstPort,
    setInstanceDetailTab,
    setInstanceName,
    setInstanceSearch,
    setInstanceSearchInput,
    setInstanceSortKey,
    setInstanceStatusFilter,
    setInstanceTemplateFilter,
    saveInstanceViewPreset,
    setMcCreateMode,
    setMcEula,
    setMcFrpConfig,
    setMcFrpEnabled,
    setMcFrpMode,
    setMcFrpNodeId,
    setMcImportPack,
    setMcMemory,
    setMcPort,
    setMcVersion,
    setSelectedInstanceId,
    setSelectedTemplate,
    setShowInstanceModal,
    setSleepSeconds,
    setTab,
    setTrFrpConfig,
    setTrFrpEnabled,
    setTrFrpMode,
    setTrFrpNodeId,
    setTrMaxPlayers,
    setTrPassword,
    setTrPasswordVisible,
    setTrPort,
    setTrVersion,
    setTrWorldName,
    setTrWorldSize,
    pwServerName,
    setPwServerName,
    pwServerDescription,
    setPwServerDescription,
    pwMaxPlayers,
    setPwMaxPlayers,
    pwPassword,
    setPwPassword,
    pwAdminPassword,
    setPwAdminPassword,
    pwPublic,
    setPwPublic,
    pwPort,
    setPwPort,
    pwQueryPort,
    setPwQueryPort,
    fxVersion,
    setFxVersion,
    fxVersionOptions,
    fxServerName,
    setFxServerName,
    fxServerDescription,
    setFxServerDescription,
    fxMaxPlayers,
    setFxMaxPlayers,
    fxPublic,
    setFxPublic,
    fxPort,
    setFxPort,
    fxRconEnabled,
    setFxRconEnabled,
    fxRconPort,
    setFxRconPort,
    fxRconPassword,
    setFxRconPassword,
    setWarmFieldErrors,
    setWarmFormError,
    settingsStatus,
    sleepSeconds,
    startInstance,
    stopInstance,
    tab,
    t,
    templateOptions,
    templates,
    toastError,
    togglePinnedInstance,
    trEffectiveFrpConfig,
    trFrpConfig,
    trFrpEnabled,
    trFrpMode,
    trFrpNodeId,
    trMaxPlayers,
    trPassword,
    trPasswordVisible,
    trPort,
    trVersion,
    trVersionOptions,
    trWorldName,
    trWorldSize,
    warmCache,
  }

  const downloadsTabProps = {
    tab,
    t,
    hasRunningDownloadJobs,
    downloadQueuePaused,
    downloadJobs,
    downloadCenterView,
    setDownloadCenterView,
    toggleDownloadQueuePaused,
    clearDownloadHistory,
    moveDownloadJob,
    pauseDownloadJob,
    resumeDownloadJob,
    cancelDownloadJob,
    retryDownloadJob,
    setSelectedDownloadJobId,
    enqueueDownloadWarm,
    downloadNowUnixMs,
    isReadOnly,
    downloadEnqueueTarget,
    downloadStatus,
    controlDiagnostics,
    clearCache,
    pushToast,
    toastError,
    downloadMcVersion,
    setDownloadMcVersion,
    mcVersionOptions,
    downloadTrVersion,
    setDownloadTrVersion,
    trVersionOptions,
    downloadDstVersion,
    setDownloadDstVersion,
    dstVersionOptions,
    downloadPwVersion,
    setDownloadPwVersion,
    pwVersionOptions,
    downloadFxVersion,
    setDownloadFxVersion,
    fxVersionOptions,
    downloadCoreKeeperVersion,
    setDownloadCoreKeeperVersion,
    coreKeeperVersionOptions,
    downloadSevenDaysVersion,
    setDownloadSevenDaysVersion,
    sevenDaysVersionOptions,
    downloadTheForestVersion,
    setDownloadTheForestVersion,
    theForestVersionOptions,
    downloadSonsOfTheForestVersion,
    setDownloadSonsOfTheForestVersion,
    sonsOfTheForestVersionOptions,
    downloadQueueEnqueue,
    openSettingsTab: () => setTab('settings'),
  }

  const frpTabProps = {
    tab,
    t,
    frpNodes,
    isAuthed,
    isReadOnly,
    openCreateFrpNodeModal,
    openEditFrpNodeModal,
    frpDeleteNode,
    invalidateFrpNodes,
    openSettingsTab: () => setTab('settings'),
    pushToast,
    toastError,
  }

  const settingsTabProps = {
    tab,
    t,
    settingsStatus,
    me,
    settingsDstKeyVisible,
    settingsDstKey,
    setSettingsDstKey,
    setSettingsDstKeyVisible,
    setDstDefaultKleiKey,
    isReadOnly,
    pushToast,
    toastError,
    settingsCurseforgeKeyVisible,
    settingsCurseforgeKey,
    setSettingsCurseforgeKey,
    setSettingsCurseforgeKeyVisible,
    setCurseforgeApiKey,
    settingsSteamcmdUsername,
    setSettingsSteamcmdUsername,
    settingsSteamcmdPasswordVisible,
    settingsSteamcmdPassword,
    setSettingsSteamcmdPassword,
    setSettingsSteamcmdPasswordVisible,
    settingsSteamcmdGuardCode,
    setSettingsSteamcmdGuardCode,
    settingsSteamcmdMaFile,
    setSettingsSteamcmdMaFile,
    setSteamcmdCredentials,
    settingsCurrentPassword,
    setSettingsCurrentPassword,
    settingsCurrentPasswordVisible,
    setSettingsCurrentPasswordVisible,
    settingsNewUsername,
    setSettingsNewUsername,
    settingsNewPassword,
    setSettingsNewPassword,
    settingsNewPasswordVisible,
    setSettingsNewPasswordVisible,
    changeCredentialsPending,
    handleChangeCredentials,
    openUpdateCenter: () => {
      setShowAccountMenu(false)
      setShowUpdateCenter(true)
    },
  }

  const nodesTabProps = {
    tab,
    t,
    me,
    openCreateNode,
    nodesLastUpdatedAtUnixMs,
    nodes,
    invalidateNodes,
    selectedNodeId,
    setSelectedNodeId,
    selectedNode,
    setNodeEnabled,
    deleteNode,
    triggerNodeSelfUpdate,
    nodeSelfUpdateStatus,
    nodeEnabledOverride,
    setNodeEnabledOverride,
    updateCheck,
    openSettingsTab: () => setTab('settings'),
    pushToast,
    toastError,
  }

  const downloadTaskModalProps = {
    t,
    selectedDownloadJobId,
    setSelectedDownloadJobId,
    selectedDownloadJob,
    latestDownloadFailureByTarget,
    copyDownloadJobDetails,
    copyDownloadFailureReason,
  }

  const loginModalProps = {
    showLoginModal,
    me,
    setShowLoginModal,
    authLoading,
    authError,
    setAuthError,
    setAuthLoading,
    loginUser,
    setLoginUser,
    loginPass,
    setLoginPass,
    refreshSession,
    setLoginUsernameEl,
    t,
  }

  const addNodeModalProps = {
    showCreateNodeModal,
    closeCreateNode,
    createNodeResult,
    createNode,
    createNodeName,
    setCreateNodeName,
    createNodeFieldErrors,
    setCreateNodeFieldErrors,
    createNodeFormError,
    setCreateNodeFormError,
    createNodeControlWsUrl,
    defaultCreateNodeControlWsUrl,
    setCreateNodeControlWsUrl,
    setCreateNodeResult,
    pushToast,
    invalidateNodes,
    setSelectedNodeId,
    createNodeComposeYaml,
    createNodeInstallCommand,
    t,
  }

  const frpNodeModalProps = {
    showFrpNodeModal,
    closeFrpNodeModal,
    editingFrpNodeId,
    frpCreateNode,
    frpUpdateNode,
    isReadOnly,
    frpNodeCanSave,
    frpNodeFieldErrors,
    setFrpNodeFieldErrors,
    frpNodeFormError,
    setFrpNodeFormError,
    frpNodeName,
    setFrpNodeName,
    frpNodeServerAddr,
    setFrpNodeServerAddr,
    frpNodeServerPort,
    setFrpNodeServerPort,
    frpNodeAllocatablePorts,
    setFrpNodeAllocatablePorts,
    frpNodeToken,
    setFrpNodeToken,
    frpNodeTokenVisible,
    setFrpNodeTokenVisible,
    frpNodeConfig,
    setFrpNodeConfig,
    frpNodeDetectedFormat,
    invalidateFrpNodes,
    pushToast,
    t,
  }

  const deleteInstanceModalProps = {
    confirmDeleteInstanceId,
    setConfirmDeleteInstanceId,
    deleteInstance,
    confirmDeleteText,
    selectedInstanceId,
    setSelectedInstanceId,
    pushToast,
    invalidateInstances,
    toastError,
    instanceDeletePreview,
    setConfirmDeleteText,
    toastSuccessFromRspc,
    t,
  }

  const editInstanceModalProps = {
    editingInstanceId,
    editBase,
    closeEditModal,
    setEditDisplayNameEl: (el: HTMLInputElement) => {
      editDisplayNameEl = el
    },
    setEditSleepSecondsEl: (el: HTMLInputElement) => {
      editSleepSecondsEl = el
    },
    setEditMcMemoryEl: (el: HTMLInputElement) => {
      editMcMemoryEl = el
    },
    setEditMcPortEl: (el: HTMLInputElement) => {
      editMcPortEl = el
    },
    setEditMcFrpNodeEl: (el: HTMLDivElement) => {
      editMcFrpNodeEl = el
    },
    setEditMcFrpConfigEl: (el: HTMLTextAreaElement) => {
      editMcFrpConfigEl = el
    },
    setEditTrMaxPlayersEl: (el: HTMLInputElement) => {
      editTrMaxPlayersEl = el
    },
    setEditTrWorldNameEl: (el: HTMLInputElement) => {
      editTrWorldNameEl = el
    },
    setEditTrPortEl: (el: HTMLInputElement) => {
      editTrPortEl = el
    },
    setEditTrWorldSizeEl: (el: HTMLInputElement) => {
      editTrWorldSizeEl = el
    },
    setEditTrPasswordEl: (el: HTMLInputElement) => {
      editTrPasswordEl = el
    },
    setEditTrFrpNodeEl: (el: HTMLDivElement) => {
      editTrFrpNodeEl = el
    },
    setEditTrFrpConfigEl: (el: HTMLTextAreaElement) => {
      editTrFrpConfigEl = el
    },
    setEditDisplayName,
    editDisplayName,
    editTemplateId,
    editSleepSeconds,
    setEditSleepSeconds,
    editFieldErrors,
    editFormError,
    setEditFieldErrors,
    setEditFormError,
    updateInstance,
    editOutgoingParams,
    invalidateInstances,
    revealInstance,
    pushToast,
    focusFirstEditError,
    friendlyErrorMessage,
    editAdvanced,
    setEditAdvanced,
    editAdvancedDirty,
    editHasChanges,
    editChangedKeys,
    editRisk,
    safeCopy,
    setTab,
    editMcVersion,
    setEditMcVersion,
    mcVersionOptions,
    optionsWithCurrentValue,
    editMcMemory,
    setEditMcMemory,
    editMcPort,
    setEditMcPort,
    editMcFrpEnabled,
    setEditMcFrpEnabled,
    setEditMcFrpMode,
    setEditMcFrpNodeId,
    editMcFrpMode,
    editMcFrpNodeId,
    frpNodeDropdownOptions,
    editMcFrpConfig,
    setEditMcFrpConfig,
    editTrVersion,
    setEditTrVersion,
    trVersionOptions,
    editTrMaxPlayers,
    setEditTrMaxPlayers,
    editTrWorldName,
    setEditTrWorldName,
    editTrPort,
    setEditTrPort,
    editTrWorldSize,
    setEditTrWorldSize,
    editTrPasswordVisible,
    setEditTrPasswordVisible,
    editTrPassword,
    setEditTrPassword,
    editTrFrpEnabled,
    setEditTrFrpEnabled,
    setEditTrFrpMode,
    setEditTrFrpNodeId,
    editTrFrpMode,
    editTrFrpNodeId,
    editTrFrpConfig,
    setEditTrFrpConfig,
    frpNodeConfigById,
    t,
  }

  const controlDiagnosticsModalProps = {
    showDiagnosticsModal,
    setShowDiagnosticsModal,
    controlDiagnostics,
    pushToast,
    clearCache,
    cacheSelection,
    setCacheSelection,
    toastError,
    t,
  }

  const instanceDetailsModalProps = {
    showInstanceModal,
    selectedInstanceId,
    setShowInstanceModal,
    selectedInstanceDisplayName,
    selectedInstance,
    instanceDisplayName,
    pushToast,
    instanceDiagnostics,
    processLogLines,
    toastError,
    toastSuccessFromRspc,
    instanceOpById,
    isReadOnly,
    runInstanceOp,
    stopInstance,
    invalidateInstances,
    startInstance,
    restartInstance,
    openEditModal,
    setConfirmDeleteInstanceId,
    instanceDetailTab,
    setInstanceDetailTab,
    selectedInstanceMessage,
    saveSearchQuery,
    setSaveSearchQuery,
    importSaveFromSearch,
    instanceSaveSearch,
    processLogsTail,
    canTailProcessLogs,
    processLogLive,
    setProcessLogLive,
    setProcessLogLines,
    isAuthed,
    t,
    locale,
  }

  const toastPortalProps = {
    toasts,
    dismissToast,
    t,
  }

  const eventCenterDrawerProps = {
    get open() {
      return showEventCenter()
    },
    onClose: () => setShowEventCenter(false),
    events,
    markAllEventsRead,
    clearEvents,
    runRetryAction,
    pushToast,
    t,
  }

  const openDiagnostics = () => setShowDiagnosticsModal(true)
  const retryBackend = () => void queryClient.invalidateQueries({ queryKey: ['control.ping', null] })
  const copyFsWriteEnv = () => {
    void safeCopy('ALLOY_FS_WRITE_ENABLED=true')
    pushToast('success', t('toast.copied'), t('toast.fsWriteEnvCopied'))
  }

  const sidebarNavProps = {
    get sidebarExpanded() {
      return sidebarExpanded()
    },
    setSidebarExpanded,
    get tab() {
      return tab()
    },
    setTab,
    get me() {
      return me()
    },
    get themePref() {
      return themePref()
    },
    setThemePref,
    get themeButtonTitle() {
      return themeButtonTitle()
    },
    t,
  }

  const topHeaderProps = {
    setMobileNavOpen,
    get backendPending() {
      return ping.isPending
    },
    get backendError() {
      return ping.isError
    },
    get isReadOnly() {
      return isReadOnly()
    },
    get themeButtonTitle() {
      return themeButtonTitle()
    },
    get themePref() {
      return themePref()
    },
    setThemePref,
    get authLoading() {
      return authLoading()
    },
    get me() {
      return me()
    },
    get locale() {
      return locale()
    },
    setLocale,
    localeOptions,
    get localeShort() {
      return localeShort()
    },
    t,
    openLoginModal,
    get showAccountMenu() {
      return showAccountMenu()
    },
    setShowAccountMenu,
    get showUpdateCenter() {
      return showUpdateCenter()
    },
    setShowUpdateCenter,
    updateCheck,
    triggerUpdate,
    get controlVersion() {
      return controlDiagnostics.data?.control_version ?? updateCheck.data?.current_version ?? ping.data?.version ?? null
    },
    get agentOutdatedCount() {
      return nodeAgentOutdatedCount()
    },
    get agentNodeCount() {
      return nodeCount()
    },
    openNodesTab: () => setTab('nodes'),
    openSettingsTab: () => setTab('settings'),
    get eventUnreadCount() {
      return events().filter((event) => !event.isRead).length
    },
    openEventCenter: () => setShowEventCenter(true),
    pushToast,
    toastError,
    openDiagnostics,
    handleLogout,
  }

  const mobileDrawerProps = {
    get mobileNavOpen() {
      return mobileNavOpen()
    },
    setMobileNavOpen,
    get tab() {
      return tab()
    },
    setTab,
    get me() {
      return me()
    },
    get themePref() {
      return themePref()
    },
    setThemePref,
    get isReadOnly() {
      return isReadOnly()
    },
    get themeApplied() {
      return theme()
    },
    t,
    openLoginModal,
    handleLogout,
  }

  const authOverlayProps = {
    get authError() {
      return authError()
    },
    t,
    openLoginModal,
  }

  const statusBannersProps = {
    get pingError() {
      return ping.isError
    },
    get isReadOnly() {
      return isReadOnly()
    },
    get fsWriteEnabled() {
      return fsWriteEnabled()
    },
    get tab() {
      return tab()
    },
    get lastBackendOkAtUnixMs() {
      return lastBackendOkAtUnixMs()
    },
    retryBackend,
    openDiagnostics,
    copyFsWriteEnv,
    t,
  }

  const mainPanelsProps = {
    tab,
    setTab,
    isAuthed,
    fsPath,
    selectedFilePath,
    instancesTabProps,
    downloadsTabProps,
    frpTabProps,
    settingsTabProps,
    nodesTabProps,
    t,
  }

  const appModalsProps = {
    downloadTaskModalProps,
    loginModalProps,
    addNodeModalProps,
    frpNodeModalProps,
    deleteInstanceModalProps,
    editInstanceModalProps,
    controlDiagnosticsModalProps,
    instanceDetailsModalProps,
    toastPortalProps,
    eventCenterDrawerProps,
  }

  return (
    <div class="h-screen w-screen overflow-hidden bg-gradient-to-br from-slate-50 via-white to-amber-50 text-slate-900 dark:from-slate-950 dark:via-slate-950 dark:to-amber-950/25 dark:text-slate-200">
      <AppShell
        isAuthed={isAuthed()}
        sidebarNavProps={sidebarNavProps}
        topHeaderProps={topHeaderProps}
        mobileDrawerProps={mobileDrawerProps}
        authOverlayProps={authOverlayProps}
        statusBannersProps={statusBannersProps}
        mainPanelsProps={mainPanelsProps}
      />
      <AppModals {...appModalsProps} />
    </div>
  )
}

export default App
