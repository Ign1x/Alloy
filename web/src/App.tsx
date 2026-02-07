import { isAlloyApiError, onAuthEvent, queryClient, rspc } from './rspc'
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import type { ProcessStatusDto } from './bindings'
import { ensureCsrfCookie, logout, whoami } from './auth'
import AppModals from './components/AppModals'
import AppShell from './components/AppShell'
import { parseAgentErrorPayload } from './app/helpers/agentErrors'
import { mapDownloadJobFromServer, downloadTargetLabel } from './app/helpers/downloads'
import { buildCreatePreview, computeCreateAdvancedDirty } from './app/helpers/createInstancePreview'
import {
  focusFirstCreateError as focusFirstCreateErrorInForm,
  focusFirstEditError as focusFirstEditErrorInForm,
} from './app/helpers/formFocus'
import { compactAllocatablePortsSpec, defaultControlWsUrl, detectFrpConfigFormat, formatLatencyMs, instancePort, parseFrpEndpoint } from './app/helpers/network'
import { optionsWithCurrentValue, safeCopy } from './app/helpers/misc'
import { useSidebarState } from './app/hooks/useSidebarState'
import { useThemePreference } from './app/hooks/useThemePreference'
import { useToastBus } from './app/hooks/useToastBus'
import {
  CREATE_TEMPLATE_MINECRAFT,
  DOWNLOAD_VIEW_STORAGE_KEY,
  MINECRAFT_MODE_BY_TEMPLATE_ID,
  MINECRAFT_TEMPLATE_ID_BY_MODE,
  type DownloadCenterView,
  type DownloadJob,
  type DownloadTarget,
  type FrpConfigMode,
  type MinecraftCreateMode,
  type UiTab,
} from './app/types'
function App() {
  // Ensure CSRF cookie exists early so authenticated POSTs (auth/rspc mutations)
  // can always attach x-csrf-token.
  createEffect(() => {
    void ensureCsrfCookie()
  })

  const [me, setMe] = createSignal<{ username: string; is_admin: boolean } | null>(null)
  const [authLoading, setAuthLoading] = createSignal(true)
  const [authError, setAuthError] = createSignal<string | null>(null)
  const [loginUser, setLoginUser] = createSignal('admin')
  const [loginPass, setLoginPass] = createSignal('admin')
  const [showLoginModal, setShowLoginModal] = createSignal(false)
  const [confirmDeleteInstanceId, setConfirmDeleteInstanceId] = createSignal<string | null>(null)
  const [confirmDeleteText, setConfirmDeleteText] = createSignal('')
  const [editingInstanceId, setEditingInstanceId] = createSignal<string | null>(null)
  const [showDiagnosticsModal, setShowDiagnosticsModal] = createSignal(false)
  const [showAccountMenu, setShowAccountMenu] = createSignal(false)
  const { toasts, setToasts, pushToast, toastError, friendlyErrorMessage } = useToastBus()
  // Account menu uses a fixed overlay; refs are not needed.

  const [focusLoginUsername, setFocusLoginUsername] = createSignal(false)
  let loginUsernameEl: HTMLInputElement | undefined
  let createInstanceNameEl: HTMLInputElement | undefined
  let createSleepSecondsEl: HTMLInputElement | undefined
  let createMcEulaEl: HTMLInputElement | undefined
  let createMcMrpackEl: HTMLInputElement | undefined
  let createMcImportPackEl: HTMLInputElement | undefined
  let createMcCurseforgeEl: HTMLInputElement | undefined
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
  let createDstClusterTokenEl: HTMLInputElement | undefined
  let createDstClusterNameEl: HTMLInputElement | undefined
  let createDstMaxPlayersEl: HTMLInputElement | undefined
  let createDstPasswordEl: HTMLInputElement | undefined
  let createDstPortEl: HTMLInputElement | undefined
  let createDstMasterPortEl: HTMLInputElement | undefined
  let createDstAuthPortEl: HTMLInputElement | undefined
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

  const { themePref, setThemePref, themeButtonTitle } = useThemePreference()
  const { sidebarExpanded, setSidebarExpanded } = useSidebarState()
  const [mobileNavOpen, setMobileNavOpen] = createSignal(false)

  // Prevent out-of-order session fetches from clobbering newer state.
  let sessionFetchToken = 0

  async function refreshSession() {
    const token = ++sessionFetchToken
    setAuthLoading(true)
    setAuthError(null)
    try {
      const res = await whoami()
      if (token !== sessionFetchToken) return
      setMe(res ? { username: res.username, is_admin: res.is_admin } : null)
    } catch (e) {
      if (token !== sessionFetchToken) return
      setAuthError(e instanceof Error ? e.message : 'auth error')
      setMe(null)
    } finally {
      if (token === sessionFetchToken) setAuthLoading(false)
    }
  }

  async function handleLogout() {
    try {
      setAuthError(null)
      await logout()
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'logout error')
    } finally {
      setMe(null)
      setSelectedInstanceId(null)
      setSelectedFilePath(null)
      // Ensure we don't show stale data in a "logged-out" state.
      queryClient.clear()
    }
  }

  createEffect(() => {
    const off = onAuthEvent((e) => {
      if (e.type !== 'auth-expired') return
      // Session expired (access token missing/expired and refresh failed).
      setMe(null)
      setSelectedInstanceId(null)
      setSelectedFilePath(null)
      queryClient.clear()
      setAuthError('Session expired. Please sign in again.')
      setShowLoginModal(true)
      setFocusLoginUsername(true)
    })
    return off
  })

  createEffect(() => {
    if (!showLoginModal()) return
    if (!focusLoginUsername()) return
    setFocusLoginUsername(false)
    queueMicrotask(() => loginUsernameEl?.focus())
  })

  createEffect(() => {
    if (!showAccountMenu()) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setShowAccountMenu(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  createEffect(() => {
    if (!showLoginModal()) return
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      setShowLoginModal(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  createEffect(() => {
    void refreshSession()
    return () => {
      // Invalidate any in-flight `whoami`.
      sessionFetchToken++
    }
  })

  const isAuthed = createMemo(() => !!me())

  const ping = rspc.createQuery(() => ['control.ping', null])
  const agentHealth = rspc.createQuery(() => ['agent.health', null])

  const [lastBackendOkAtUnixMs, setLastBackendOkAtUnixMs] = createSignal<number | null>(null)
  const [lastAgentOkAtUnixMs, setLastAgentOkAtUnixMs] = createSignal<number | null>(null)

  createEffect(() => {
    if (ping.isError) return
    if (!ping.data) return
    setLastBackendOkAtUnixMs(Date.now())
  })

  createEffect(() => {
    if (agentHealth.isError) return
    if (!agentHealth.data) return
    if (agentHealth.data.status !== 'ok') return
    setLastAgentOkAtUnixMs(Date.now())
  })

  const templates = rspc.createQuery(
    () => ['process.templates', null],
    () => ({ enabled: isAuthed() }),
  )

  const templateDisplayName = (templateId: string) => {
    const id = templateId.trim()
    if (!id) return templateId
    return (
      (templates.data ?? []).find(
        (t: { template_id: string; display_name: string }) => t.template_id === id,
      )?.display_name ?? templateId
    )
  }

  type TemplateOption = { value: string; label: string; meta: string }
  const templateOptions = createMemo<TemplateOption[]>(() => {
    const out: TemplateOption[] = []
    const list = (templates.data ?? []) as Array<{ template_id: string; display_name: string }>
    const groupedMinecraft = new Set(Object.values(MINECRAFT_TEMPLATE_ID_BY_MODE))
    let insertedMinecraft = false

    for (const t of list) {
      if (groupedMinecraft.has(t.template_id)) {
        if (!insertedMinecraft) {
          insertedMinecraft = true
          out.push({
            value: CREATE_TEMPLATE_MINECRAFT,
            label: 'Minecraft',
            meta: 'Vanilla / Modrinth / Import / CurseForge',
          })
        }
        continue
      }
      out.push({
        value: t.template_id,
        label: t.display_name,
        meta: t.template_id,
      })
    }
    return out
  })

  const availableMinecraftCreateModes = createMemo<MinecraftCreateMode[]>(() => {
    const ids = new Set((templates.data ?? []).map((t: { template_id: string }) => t.template_id))
    const out: MinecraftCreateMode[] = []
    if (ids.has(MINECRAFT_TEMPLATE_ID_BY_MODE.vanilla)) out.push('vanilla')
    if (ids.has(MINECRAFT_TEMPLATE_ID_BY_MODE.modrinth)) out.push('modrinth')
    if (ids.has(MINECRAFT_TEMPLATE_ID_BY_MODE.import)) out.push('import')
    if (ids.has(MINECRAFT_TEMPLATE_ID_BY_MODE.curseforge)) out.push('curseforge')
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

  const [instancesPollMs, setInstancesPollMs] = createSignal<number | false>(false)
  const [instancesPollErrorStreak, setInstancesPollErrorStreak] = createSignal(0)
  const instances = rspc.createQuery(
    () => ['instance.list', null],
    () => ({
      enabled: isAuthed(),
      refetchInterval: instancesPollMs(),
      refetchOnWindowFocus: false,
      retry: 3,
      retryDelay: (attempt) => Math.min(400 * Math.pow(2, attempt), 4000),
    }),
  )

  const [instancesLastUpdatedAtUnixMs, setInstancesLastUpdatedAtUnixMs] = createSignal<number | null>(null)
  createEffect(() => {
    // Treat any successful data arrival as a refresh.
    if (!instances.data) return
    setInstancesLastUpdatedAtUnixMs(Date.now())
  })

  type InstanceStatusFilter = 'all' | 'running' | 'stopped' | 'starting' | 'stopping' | 'failed'
  type InstanceSortKey = 'name' | 'updated' | 'status' | 'port'

  const INSTANCE_VIEW_STORAGE_KEY = 'alloy.instances.view'
  const [instanceSearchInput, setInstanceSearchInput] = createSignal('')
  const [instanceSearch, setInstanceSearch] = createSignal('')
  const [instanceStatusFilter, setInstanceStatusFilter] = createSignal<InstanceStatusFilter>('all')
  const [instanceTemplateFilter, setInstanceTemplateFilter] = createSignal<string>('all')
  const [instanceSortKey, setInstanceSortKey] = createSignal<InstanceSortKey>('updated')
  const instanceCompact = () => true
  const [pinnedInstanceIds, setPinnedInstanceIds] = createSignal<Record<string, boolean>>({})

  createEffect(() => {
    // Debounced search input.
    const v = instanceSearchInput()
    const handle = window.setTimeout(() => setInstanceSearch(v.trim().toLowerCase()), 180)
    return () => window.clearTimeout(handle)
  })

  createEffect(() => {
    // Load view preferences once after mount.
    try {
      const raw = localStorage.getItem(INSTANCE_VIEW_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as any
      if (typeof parsed?.q === 'string') setInstanceSearchInput(parsed.q)
      if (
        parsed?.status === 'all' ||
        parsed?.status === 'running' ||
        parsed?.status === 'stopped' ||
        parsed?.status === 'starting' ||
        parsed?.status === 'stopping' ||
        parsed?.status === 'failed'
      ) {
        setInstanceStatusFilter(parsed.status)
      }
      if (typeof parsed?.template === 'string') setInstanceTemplateFilter(parsed.template)
      if (parsed?.sort_key === 'name' || parsed?.sort_key === 'updated' || parsed?.sort_key === 'status' || parsed?.sort_key === 'port') {
        setInstanceSortKey(parsed.sort_key)
      }
      if (parsed?.pinned && typeof parsed.pinned === 'object') {
        const next: Record<string, boolean> = {}
        for (const [k, v] of Object.entries(parsed.pinned as Record<string, unknown>)) {
          if (typeof v === 'boolean') next[k] = v
        }
        setPinnedInstanceIds(next)
      }
    } catch {
      // ignore
    }
  })

  createEffect(() => {
    try {
      localStorage.setItem(
        INSTANCE_VIEW_STORAGE_KEY,
        JSON.stringify({
          q: instanceSearchInput(),
          status: instanceStatusFilter(),
          template: instanceTemplateFilter(),
          sort_key: instanceSortKey(),
          pinned: pinnedInstanceIds(),
        }),
      )
    } catch {
      // ignore
    }
  })

  createEffect(() => {
    if (!isAuthed()) {
      setInstancesPollMs(false)
      setInstancesPollErrorStreak(0)
      return
    }

    const list = instances.data ?? []
    const count = list.length
    const anyStartingOrStopping = list.some((i: { status?: { state?: string } | null }) => {
      const s = i.status?.state
      return s === 'PROCESS_STATE_STARTING' || s === 'PROCESS_STATE_STOPPING'
    })
    const anyRunning = list.some((i: { status?: { state?: string } | null }) => i.status?.state === 'PROCESS_STATE_RUNNING')

    let base = anyStartingOrStopping ? 800 : anyRunning ? 2000 : 5000
    if (count >= 20) base = Math.min(base * 2, 15_000)
    if (count >= 60) base = Math.min(base * 2, 30_000)

    // On first load, transient backend/agent startup can fail once; retry quickly so users
    // don't need to click "Retry" after refresh.
    if (instances.isError && instances.data == null) {
      base = 800
    }

    const nextStreak = instances.isError ? Math.min(instancesPollErrorStreak() + 1, 6) : 0
    setInstancesPollErrorStreak(nextStreak)
    const backoff = Math.min(base * Math.pow(2, nextStreak), 30_000)

    // Add a small jitter to avoid thundering herd.
    const jitter = Math.floor(Math.random() * 200)
    setInstancesPollMs(backoff + jitter)
  })

  type InstanceListItem = { config: { instance_id: string; template_id: string; params: unknown; display_name: string | null }; status: ProcessStatusDto | null }
  const [instanceStatusKeys, setInstanceStatusKeys] = createSignal<Record<string, { key: string; updated_at_unix_ms: number }>>({})

  createEffect(() => {
    const list = (instances.data ?? []) as InstanceListItem[]
    setInstanceStatusKeys((prev) => {
      const next: Record<string, { key: string; updated_at_unix_ms: number }> = { ...prev }
      const seen = new Set<string>()
      const now = Date.now()
      for (const inst of list) {
        const id = inst.config.instance_id
        seen.add(id)
        const s = inst.status
        const key = s ? `${s.state}|${s.exit_code ?? ''}|${s.message ?? ''}` : 'PROCESS_STATE_EXITED||'
        const existing = next[id]
        if (!existing) next[id] = { key, updated_at_unix_ms: now }
        else if (existing.key !== key) next[id] = { key, updated_at_unix_ms: now }
      }
      for (const id of Object.keys(next)) {
        if (!seen.has(id)) delete next[id]
      }
      return next
    })
  })

  function instanceDisplayName(i: InstanceListItem): string {
    const params = i.config.params as Record<string, unknown> | null | undefined
    const paramName = params?.name
    if (typeof i.config.display_name === 'string' && i.config.display_name.trim()) return i.config.display_name
    if (typeof paramName === 'string' && paramName.trim()) return paramName
    return i.config.instance_id
  }

  function instanceStateForFilter(status: ProcessStatusDto | null): InstanceStatusFilter {
    const s = status?.state ?? 'PROCESS_STATE_EXITED'
    if (s === 'PROCESS_STATE_RUNNING') return 'running'
    if (s === 'PROCESS_STATE_STARTING') return 'starting'
    if (s === 'PROCESS_STATE_STOPPING') return 'stopping'
    if (s === 'PROCESS_STATE_FAILED') return 'failed'
    return 'stopped'
  }

  const instanceTemplateFilterOptions = createMemo(() => {
    const list = (instances.data ?? []) as InstanceListItem[]
    const set = new Set<string>()
    for (const i of list) set.add(i.config.template_id)
    const opts = [{ value: 'all', label: 'All' }]
    for (const id of Array.from(set).sort()) opts.push({ value: id, label: id })
    return opts
  })

  const instanceSortOptions = createMemo(() => [
    { value: 'updated', label: 'Last update' },
    { value: 'name', label: 'Name' },
    { value: 'status', label: 'Status' },
    { value: 'port', label: 'Port' },
  ])

  const instanceStatusFilterOptions = createMemo(() => [
    { value: 'all', label: 'All' },
    { value: 'running', label: 'Running' },
    { value: 'starting', label: 'Starting' },
    { value: 'stopping', label: 'Stopping' },
    { value: 'failed', label: 'Failed' },
    { value: 'stopped', label: 'Stopped' },
  ])

  function togglePinnedInstance(id: string) {
    setPinnedInstanceIds((prev) => {
      const next = { ...prev }
      if (next[id]) delete next[id]
      else next[id] = true
      return next
    })
  }

  function compareLabel(aRaw: string, bRaw: string): number {
    const a = aRaw.trim()
    const b = bRaw.trim()
    const aNum = a.length > 0 && a.charCodeAt(0) >= 48 && a.charCodeAt(0) <= 57
    const bNum = b.length > 0 && b.charCodeAt(0) >= 48 && b.charCodeAt(0) <= 57
    if (aNum !== bNum) return aNum ? -1 : 1
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  }

  const filteredInstances = createMemo(() => {
    const list = (instances.data ?? []) as InstanceListItem[]
    const q = instanceSearch()
    const statusFilter = instanceStatusFilter()
    const templateFilter = instanceTemplateFilter()
    const pinned = pinnedInstanceIds()
    const sortKey = instanceSortKey()

    const out = list.filter((i) => {
      if (templateFilter !== 'all' && i.config.template_id !== templateFilter) return false
      const st = instanceStateForFilter(i.status)
      if (statusFilter !== 'all' && st !== statusFilter) return false
      if (!q) return true
      const hay = `${instanceDisplayName(i)} ${i.config.instance_id} ${i.config.template_id}`.toLowerCase()
      return hay.includes(q)
    })

    const statusRank: Record<string, number> = {
      PROCESS_STATE_RUNNING: 5,
      PROCESS_STATE_STARTING: 4,
      PROCESS_STATE_STOPPING: 3,
      PROCESS_STATE_FAILED: 2,
      PROCESS_STATE_EXITED: 1,
    }

    out.sort((a, b) => {
      const ap = pinned[a.config.instance_id] ? 1 : 0
      const bp = pinned[b.config.instance_id] ? 1 : 0
      // Pinning always wins regardless of chosen sort direction.
      if (ap !== bp) return bp - ap

      if (sortKey === 'name') return compareLabel(instanceDisplayName(a), instanceDisplayName(b))
      if (sortKey === 'port') {
        const aPort = instancePort(a) ?? 0
        const bPort = instancePort(b) ?? 0
        if (aPort !== bPort) return aPort - bPort
        return compareLabel(instanceDisplayName(a), instanceDisplayName(b))
      }
      if (sortKey === 'status') {
        const ar = statusRank[a.status?.state ?? 'PROCESS_STATE_EXITED'] ?? 0
        const br = statusRank[b.status?.state ?? 'PROCESS_STATE_EXITED'] ?? 0
        if (ar !== br) return br - ar
        return compareLabel(instanceDisplayName(a), instanceDisplayName(b))
      }

      const au = instanceStatusKeys()[a.config.instance_id]?.updated_at_unix_ms ?? 0
      const bu = instanceStatusKeys()[b.config.instance_id]?.updated_at_unix_ms ?? 0
      if (au !== bu) return bu - au
      return compareLabel(instanceDisplayName(a), instanceDisplayName(b))
    })
    return out
  })

  createEffect(() => {
    const req = pendingRevealInstance()
    if (!req) return

    // Re-run when the instance list changes.
    filteredInstances().length

    requestAnimationFrame(() => {
      const el = instanceCardEls.get(req.id)
      if (el) {
        try {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        } catch {
          // ignore
        }
        const focusEl = el.querySelector<HTMLElement>('[data-instance-card-focus]') ?? null
        queueMicrotask(() => focusEl?.focus())
        setPendingRevealInstance(null)
        return
      }

      // Give up after a short window (filters may hide it).
      if (Date.now() - req.started_at_unix_ms > 2000) setPendingRevealInstance(null)
    })
  })

  async function invalidateInstances() {
    await queryClient.invalidateQueries({ queryKey: ['instance.list', null] })
  }

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
  const importSaveFromUrl = rspc.createMutation(() => 'instance.importSaveFromUrl')
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
    () => ({ enabled: isAuthed() && (me()?.is_admin ?? false), refetchOnWindowFocus: false }),
  )
  const triggerUpdate = rspc.createMutation(() => 'update.trigger')

  const mcVersions = rspc.createQuery(
    () => ['minecraft.versions', null],
    () => ({ enabled: isAuthed(), refetchOnWindowFocus: false }),
  )

  const frpNodes = rspc.createQuery(
    () => ['frp.list', null],
    () => ({
      enabled: isAuthed(),
      refetchOnWindowFocus: false,
      refetchInterval: isAuthed() && tab() === 'frp' ? 5000 : false,
    }),
  )
  const frpCreateNode = rspc.createMutation(() => 'frp.create')
  const frpUpdateNode = rspc.createMutation(() => 'frp.update')
  const frpDeleteNode = rspc.createMutation(() => 'frp.delete')

  async function invalidateFrpNodes() {
    await queryClient.invalidateQueries({ queryKey: ['frp.list', null] })
  }

  const frpNodeDropdownOptions = createMemo(() => {
    const list = (frpNodes.data ?? []) as unknown as FrpNodeDto[]
    const out: { value: string; label: string; meta?: string }[] = []
    out.push({
      value: '',
      label: list.length > 0 ? 'Select node…' : 'No nodes yet',
      meta: list.length > 0 ? undefined : "Open FRP tab to add one.",
    })
    for (const n of list) {
      const endpoint =
        n.server_addr && n.server_port ? `${n.server_addr}:${n.server_port}` : parseFrpEndpoint(n.config)
      const latency = formatLatencyMs(n.latency_ms)
      out.push({ value: n.id, label: n.name, meta: endpoint ? `${endpoint} · ${latency}` : latency })
    }
    return out
  })

  function frpNodeConfigById(nodeId: string): string | null {
    const id = nodeId.trim()
    if (!id) return null
    const list = (frpNodes.data ?? []) as unknown as FrpNodeDto[]
    const n = list.find((x) => x.id === id) ?? null
    if (!n) return null

    const cfg = (n.config ?? '').trim()
    if (cfg) return cfg

    if (!n.server_addr || !n.server_port) return null
    const lines = ['[common]', `server_addr = ${n.server_addr}`, `server_port = ${n.server_port}`]
    const token = (n.token ?? '').trim()
    const allocPorts = (n.allocatable_ports ?? '').trim()
    if (token) lines.push(`token = ${token}`)
    if (allocPorts) lines.push(`# alloy_alloc_ports = ${allocPorts}`)
    lines.push('', '[alloy]', 'type = tcp', 'local_ip = 127.0.0.1', 'local_port = 0', 'remote_port = 0')
    return lines.join('\n')
  }

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
  const downloadQueue = rspc.createQuery(
    () => ['process.downloadQueue', null],
    () => ({
      enabled: isAuthed(),
      refetchOnWindowFocus: false,
      refetchInterval: isAuthed() && tab() === 'downloads' ? 1500 : false,
    }),
  )
  const downloadQueueEnqueue = rspc.createMutation(() => 'process.downloadQueueEnqueue')
  const downloadQueueSetPaused = rspc.createMutation(() => 'process.downloadQueueSetPaused')
  const downloadQueueMove = rspc.createMutation(() => 'process.downloadQueueMove')
  const downloadQueuePauseJob = rspc.createMutation(() => 'process.downloadQueuePauseJob')
  const downloadQueueResumeJob = rspc.createMutation(() => 'process.downloadQueueResumeJob')
  const downloadQueueCancelJob = rspc.createMutation(() => 'process.downloadQueueCancelJob')
  const downloadQueueRetryJob = rspc.createMutation(() => 'process.downloadQueueRetryJob')
  const downloadQueueClearHistory = rspc.createMutation(() => 'process.downloadQueueClearHistory')

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
      if (changed.includes('version')) risky.add('Changing Minecraft version may trigger downloads and mod/world incompatibilities.')
      if (changed.includes('memory_mb')) risky.add('Changing memory affects JVM heap; take care on low-RAM hosts.')
      if (changed.includes('port')) risky.add('Changing port affects client connection address.')
    }
    if (template === 'terraria:vanilla') {
      if (changed.includes('version')) risky.add('Changing Terraria version may require a re-download and can affect world compatibility.')
      if (changed.includes('world_name')) risky.add('Changing world name may switch to a different world file (old world is not deleted).')
      if (changed.includes('port')) risky.add('Changing port affects client connection address.')
    }
    return Array.from(risky)
  })

  const [mcCreateMode, setMcCreateMode] = createSignal<MinecraftCreateMode>('vanilla')
  const [mcEula, setMcEula] = createSignal(false)
  const [mcVersion, setMcVersion] = createSignal('latest_release')
  const [mcMrpack, setMcMrpack] = createSignal('')
  const [mcImportPack, setMcImportPack] = createSignal('')
  const [mcCurseforge, setMcCurseforge] = createSignal('')
  const [mcMemory, setMcMemory] = createSignal('2048')
  const [mcPort, setMcPort] = createSignal('')
  const [mcFrpEnabled, setMcFrpEnabled] = createSignal(false)
  const [mcFrpConfig, setMcFrpConfig] = createSignal('')
  const [mcFrpMode, setMcFrpMode] = createSignal<FrpConfigMode>('paste')
  const [mcFrpNodeId, setMcFrpNodeId] = createSignal('')

  const [trVersion, setTrVersion] = createSignal('1453')
  const [downloadMcVersion, setDownloadMcVersion] = createSignal('latest_release')
  const [downloadTrVersion, setDownloadTrVersion] = createSignal('1453')
  const [downloadCenterView, setDownloadCenterView] = createSignal<DownloadCenterView>((() => {
    try {
      const v = localStorage.getItem(DOWNLOAD_VIEW_STORAGE_KEY)
      if (v === 'tasks' || v === 'minecraft' || v === 'terraria' || v === 'cache') return v
    } catch {
      // ignore
    }
    return 'tasks'
  })())
  const [downloadEnqueueTarget, setDownloadEnqueueTarget] = createSignal<DownloadTarget | null>(null)
  const [downloadNowUnixMs, setDownloadNowUnixMs] = createSignal(Date.now())

  createEffect(() => {
    try {
      localStorage.setItem(DOWNLOAD_VIEW_STORAGE_KEY, downloadCenterView())
    } catch {
      // ignore
    }
  })

  const downloadJobs = createMemo<DownloadJob[]>(() => {
    const rows = (downloadQueue.data?.jobs ?? []) as unknown[]
    const out: DownloadJob[] = []
    for (const row of rows) {
      const mapped = mapDownloadJobFromServer(row)
      if (mapped) out.push(mapped)
    }
    return out
  })
  const downloadQueuePaused = createMemo(() => Boolean(downloadQueue.data?.queue_paused))

  const downloadStatus = createMemo(() => {
    const out = new Map<DownloadTarget, { ok: boolean; message: string; requestId?: string; atUnixMs: number }>()
    for (const job of downloadJobs()) {
      if (job.state !== 'success' && job.state !== 'error' && job.state !== 'canceled') continue
      if (out.has(job.target)) continue
      out.set(job.target, {
        ok: job.state === 'success',
        message: job.message,
        requestId: job.requestId,
        atUnixMs: job.updatedAtUnixMs,
      })
    }
    return out
  })

  const [selectedDownloadJobId, setSelectedDownloadJobId] = createSignal<string | null>(null)
  const selectedDownloadJob = createMemo(() => {
    const id = selectedDownloadJobId()
    if (!id) return null
    return downloadJobs().find((job) => job.id === id) ?? null
  })

  const latestDownloadFailureByTarget = createMemo(() => {
    const out = new Map<DownloadTarget, DownloadJob>()
    for (const job of downloadJobs()) {
      if (job.state !== 'error') continue
      const prev = out.get(job.target)
      if (!prev || job.updatedAtUnixMs > prev.updatedAtUnixMs) {
        out.set(job.target, job)
      }
    }
    return out
  })

  createEffect(() => {
    const selectedId = selectedDownloadJobId()
    if (!selectedId) return
    if (!downloadJobs().some((job) => job.id === selectedId)) {
      setSelectedDownloadJobId(null)
    }
  })

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
  const [dstClusterName, setDstClusterName] = createSignal('Alloy DST server')
  const [dstMaxPlayers, setDstMaxPlayers] = createSignal('6')
  const [dstPassword, setDstPassword] = createSignal('')
  const [dstPasswordVisible, setDstPasswordVisible] = createSignal(false)
  const [dstPort, setDstPort] = createSignal('0')
  const [dstMasterPort, setDstMasterPort] = createSignal('0')
  const [dstAuthPort, setDstAuthPort] = createSignal('0')


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
      vanilla: 'Vanilla',
      modrinth: 'Modrinth',
      import: 'Import',
      curseforge: 'CurseForge',
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
      dstPort: dstPort(),
      dstMasterPort: dstMasterPort(),
      dstAuthPort: dstAuthPort(),
    }),
  )

  const createPreview = createMemo(() =>
    buildCreatePreview({
      templateId: createTemplateId(),
      templateLabel: templateDisplayName(createTemplateId()),
      instanceName: instanceName(),
      sleepSeconds: sleepSeconds(),
      createAdvanced: createAdvanced(),
      createAdvancedDirty: createAdvancedDirty(),
      mcVersion: mcVersion(),
      mcMemory: mcMemory(),
      mcPort: mcPort(),
      mcFrpEnabled: mcFrpEnabled(),
      mcEffectiveFrpConfig: mcEffectiveFrpConfig(),
      mcEula: mcEula(),
      mcMrpack: mcMrpack(),
      mcImportPack: mcImportPack(),
      mcCurseforge: mcCurseforge(),
      curseforgeApiKeySet: Boolean(settingsStatus.data?.curseforge_api_key_set),
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
        createMcMrpackEl,
        createMcImportPackEl,
        createMcCurseforgeEl,
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
        createDstClusterTokenEl,
        createDstClusterNameEl,
        createDstMaxPlayersEl,
        createDstPasswordEl,
        createDstPortEl,
        createDstMasterPortEl,
        createDstAuthPortEl,
      },
      mcFrpEnabled: mcFrpEnabled(),
      mcFrpMode: mcFrpMode(),
      trFrpEnabled: trFrpEnabled(),
      trFrpMode: trFrpMode(),
    })
  }
  const hasRunningDownloadJobs = createMemo(() => downloadJobs().some((j) => j.state === 'running'))

  createEffect(() => {
    if (!hasRunningDownloadJobs()) return
    setDownloadNowUnixMs(Date.now())
    const timer = window.setInterval(() => setDownloadNowUnixMs(Date.now()), 1000)
    onCleanup(() => window.clearInterval(timer))
  })

  async function invalidateDownloadQueue() {
    await queryClient.invalidateQueries({ queryKey: ['process.downloadQueue', null] })
  }

  async function toggleDownloadQueuePaused() {
    try {
      await downloadQueueSetPaused.mutateAsync({ paused: !downloadQueuePaused() })
      await invalidateDownloadQueue()
    } catch (e) {
      toastError('Queue update failed', e)
    }
  }

  async function clearDownloadHistory() {
    try {
      await downloadQueueClearHistory.mutateAsync(null)
      await invalidateDownloadQueue()
    } catch (e) {
      toastError('Clear history failed', e)
    }
  }

  async function moveDownloadJob(jobId: string, direction: -1 | 1) {
    try {
      await downloadQueueMove.mutateAsync({ job_id: jobId, direction })
      await invalidateDownloadQueue()
    } catch (e) {
      toastError('Reorder failed', e)
    }
  }

  async function pauseDownloadJob(jobId: string) {
    try {
      await downloadQueuePauseJob.mutateAsync({ job_id: jobId })
      await invalidateDownloadQueue()
    } catch (e) {
      toastError('Pause failed', e)
    }
  }

  async function resumeDownloadJob(jobId: string) {
    try {
      await downloadQueueResumeJob.mutateAsync({ job_id: jobId })
      await invalidateDownloadQueue()
    } catch (e) {
      toastError('Resume failed', e)
    }
  }

  async function cancelDownloadJob(jobId: string) {
    try {
      await downloadQueueCancelJob.mutateAsync({ job_id: jobId })
      await invalidateDownloadQueue()
    } catch (e) {
      toastError('Cancel failed', e)
    }
  }

  async function retryDownloadJob(jobId: string) {
    try {
      await downloadQueueRetryJob.mutateAsync({ job_id: jobId })
      await invalidateDownloadQueue()
    } catch (e) {
      toastError('Retry failed', e)
    }
  }

  async function copyDownloadFailureReason(job: DownloadJob) {
    const latestFailure = latestDownloadFailureByTarget().get(job.target)
    const message = (latestFailure?.message ?? '').trim() || (job.message ?? '').trim()
    if (!message) {
      pushToast('info', 'Nothing to copy', 'No failure reason found for this task yet.')
      return
    }
    await safeCopy(message)
    pushToast('success', 'Copied', 'Failure reason copied.')
  }

  async function copyDownloadJobDetails(job: DownloadJob) {
    await safeCopy(
      JSON.stringify(
        {
          id: job.id,
          target: job.target,
          template_id: job.templateId,
          version: job.version,
          state: job.state,
          message: job.message,
          request_id: job.requestId ?? null,
          started_at_unix_ms: job.startedAtUnixMs,
          updated_at_unix_ms: job.updatedAtUnixMs,
          params: job.params,
        },
        null,
        2,
      ),
    )
    pushToast('success', 'Copied', 'Task details copied as JSON.')
  }

  function buildDownloadRequest(
    target: DownloadTarget,
  ): { templateId: string; version: string; params: Record<string, string> } | null {
    let templateId = 'minecraft:vanilla'
    let version = 'latest'
    const params: Record<string, string> = {}

    if (target === 'minecraft_vanilla') {
      const v = downloadMcVersion().trim()
      params.version = v || 'latest_release'
      version = params.version
      templateId = 'minecraft:vanilla'
    }

    if (target === 'terraria_vanilla') {
      const v = downloadTrVersion().trim()
      params.version = v || '1453'
      version = params.version
      templateId = 'terraria:vanilla'
    }

    return { templateId, version, params }
  }

  async function enqueueDownloadWarm(target: DownloadTarget) {
    if (isReadOnly()) {
      pushToast('error', 'Read-only mode', 'Enable write mode before downloading server files.')
      return
    }

    const req = buildDownloadRequest(target)
    if (!req) return

    try {
      setDownloadEnqueueTarget(target)
      await downloadQueueEnqueue.mutateAsync({
        target,
        template_id: req.templateId,
        version: req.version,
        params: req.params,
      })
      pushToast('info', 'Added to queue', `${downloadTargetLabel(target)} · ${req.version}`)
      await invalidateDownloadQueue()
    } catch (e) {
      if (isAlloyApiError(e)) {
        const fieldErrors = e.data.field_errors ?? {}
        pushToast('error', 'Add to queue failed', e.data.message, e.data.request_id)
        if (fieldErrors.steam_guard_code) {
          pushToast('info', 'Steam Guard required', 'Enter latest Steam Guard code or enable Auto 2FA.', e.data.request_id)
        }
        if (e.data.hint) pushToast('info', 'Hint', e.data.hint, e.data.request_id)
        return
      }
      pushToast('error', 'Add to queue failed', friendlyErrorMessage(e))
    } finally {
      setDownloadEnqueueTarget(null)
    }
  }

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
    { value: '1453', label: '1.4.5.3 (1453)', meta: 'latest' },
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

  const mcVersionOptions = createMemo(() => {
    const data = mcVersions.data
    if (!data) {
      return [
        { value: 'latest_release', label: 'Latest release', meta: 'recommended' },
        { value: 'latest_snapshot', label: 'Latest snapshot', meta: 'unstable' },
      ]
    }

    const out: { value: string; label: string; meta?: string }[] = [
      { value: 'latest_release', label: `Latest release (${data.latest_release})`, meta: 'recommended' },
      { value: 'latest_snapshot', label: `Latest snapshot (${data.latest_snapshot})`, meta: 'unstable' },
    ]

    // Show a curated list of recent releases (no manual typing).
    const releases = data.versions.filter((v: { kind: string }) => v.kind === 'release').slice(0, 60)
    for (const v of releases) {
      out.push({ value: v.id, label: v.id })
    }
    return out
  })

  const [tab, setTab] = createSignal<UiTab>('instances')

  // Nodes state/queries will be moved into NodesPage next.

  const [selectedInstanceId, setSelectedInstanceId] = createSignal<string | null>(null)
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

  const [importSaveUrl, setImportSaveUrl] = createSignal('')

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
    setImportSaveUrl('')
  })

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

  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null)

  const nodes = rspc.createQuery(
    () => ['node.list', null],
    () => ({ enabled: isAuthed() && tab() === 'nodes', refetchInterval: 5000, refetchOnWindowFocus: false }),
  )

  const [nodesLastUpdatedAtUnixMs, setNodesLastUpdatedAtUnixMs] = createSignal<number | null>(null)
  createEffect(() => {
    if (!nodes.data) return
    setNodesLastUpdatedAtUnixMs(Date.now())
  })

  const setNodeEnabled = rspc.createMutation(() => 'node.setEnabled')
  const [nodeEnabledOverride, setNodeEnabledOverride] = createSignal<Record<string, boolean>>({})

  type NodeDto = {
    id: string
    name: string
    endpoint: string
    enabled: boolean
    last_seen_at: string | null
    agent_version: string | null
    last_error: string | null
    has_connect_token?: boolean
  }
  type NodeCreateResult = { node: NodeDto; connect_token: string }

  type FrpNodeDto = {
    id: string
    name: string
    server_addr: string | null
    server_port: number | null
    allocatable_ports: string | null
    token: string | null
    config: string
    latency_ms: number | null
    created_at: string
    updated_at: string
  }

  const [showFrpNodeModal, setShowFrpNodeModal] = createSignal(false)
  const [editingFrpNodeId, setEditingFrpNodeId] = createSignal<string | null>(null)
  const [frpNodeName, setFrpNodeName] = createSignal('')
  const [frpNodeServerAddr, setFrpNodeServerAddr] = createSignal('')
  const [frpNodeServerPort, setFrpNodeServerPort] = createSignal('')
  const [frpNodeAllocatablePorts, setFrpNodeAllocatablePorts] = createSignal('')
  const [frpNodeToken, setFrpNodeToken] = createSignal('')
  const [frpNodeTokenVisible, setFrpNodeTokenVisible] = createSignal(false)
  const [frpNodeConfig, setFrpNodeConfig] = createSignal('')
  const [frpNodeFieldErrors, setFrpNodeFieldErrors] = createSignal<Record<string, string>>({})
  const [frpNodeFormError, setFrpNodeFormError] = createSignal<string | null>(null)

  function closeFrpNodeModal() {
    setShowFrpNodeModal(false)
    setEditingFrpNodeId(null)
    setFrpNodeName('')
    setFrpNodeServerAddr('')
    setFrpNodeServerPort('')
    setFrpNodeAllocatablePorts('')
    setFrpNodeToken('')
    setFrpNodeTokenVisible(false)
    setFrpNodeConfig('')
    setFrpNodeFieldErrors({})
    setFrpNodeFormError(null)
  }

  function openCreateFrpNodeModal() {
    setEditingFrpNodeId(null)
    setFrpNodeName('')
    setFrpNodeServerAddr('')
    setFrpNodeServerPort('7000')
    setFrpNodeAllocatablePorts('')
    setFrpNodeToken('')
    setFrpNodeTokenVisible(false)
    setFrpNodeConfig('')
    setFrpNodeFieldErrors({})
    setFrpNodeFormError(null)
    setShowFrpNodeModal(true)
  }

  function openEditFrpNodeModal(node: FrpNodeDto) {
    setEditingFrpNodeId(node.id)
    setFrpNodeName(node.name)
    setFrpNodeServerAddr(node.server_addr ?? '')
    setFrpNodeServerPort(node.server_port != null ? String(node.server_port) : '')
    setFrpNodeAllocatablePorts(compactAllocatablePortsSpec(node.allocatable_ports))
    setFrpNodeToken(node.token ?? '')
    setFrpNodeTokenVisible(false)
    setFrpNodeConfig(node.config)
    setFrpNodeFieldErrors({})
    setFrpNodeFormError(null)
    setShowFrpNodeModal(true)
  }

  const frpNodeDetectedFormat = createMemo(() => detectFrpConfigFormat(frpNodeConfig()))
  const frpNodeCanSave = createMemo(() => {
    if (!frpNodeName().trim()) return false
    if (frpNodeConfig().trim()) return true

    const addr = frpNodeServerAddr().trim()
    const port = Number.parseInt(frpNodeServerPort().trim(), 10)
    return Boolean(addr) && Number.isFinite(port) && port > 0 && port <= 65535
  })

  const createNode = rspc.createMutation(() => 'node.create')
  const [showCreateNodeModal, setShowCreateNodeModal] = createSignal(false)
  const [createNodeName, setCreateNodeName] = createSignal('')
  const [createNodeControlWsUrl, setCreateNodeControlWsUrl] = createSignal(defaultControlWsUrl())
  const [createNodeFieldErrors, setCreateNodeFieldErrors] = createSignal<Record<string, string>>({})
  const [createNodeFormError, setCreateNodeFormError] = createSignal<string | null>(null)
  const [createNodeResult, setCreateNodeResult] = createSignal<NodeCreateResult | null>(null)

  const createNodeComposeYaml = createMemo(() => {
    const r = createNodeResult()
    if (!r) return ''
    const url = createNodeControlWsUrl().trim() || defaultControlWsUrl()
    const name = r.node.name
    const token = r.connect_token

    return [
      'services:',
      '  alloy-agent:',
      '    build:',
      '      context: .',
      '      dockerfile: deploy/agent.Dockerfile',
      '    network_mode: \"host\"',
      '    restart: unless-stopped',
      '    environment:',
      '      - RUST_LOG=info',
      '      - ALLOY_DATA_ROOT=/data',
      '      - ALLOY_FS_WRITE_ENABLED=true',
      `      - ALLOY_CONTROL_WS_URL=${url}`,
      `      - ALLOY_NODE_NAME=${name}`,
      `      - ALLOY_NODE_TOKEN=${token}`,
      '    volumes:',
      '      - alloy-agent-data:/data',
      'volumes:',
      '  alloy-agent-data:',
      '',
    ].join('\n')
  })

  function openCreateNode() {
    setCreateNodeName('')
    setCreateNodeControlWsUrl(defaultControlWsUrl())
    setCreateNodeFieldErrors({})
    setCreateNodeFormError(null)
    setCreateNodeResult(null)
    setShowCreateNodeModal(true)
  }

  function closeCreateNode() {
    setShowCreateNodeModal(false)
    setCreateNodeFieldErrors({})
    setCreateNodeFormError(null)
    setCreateNodeResult(null)
  }

  createEffect(() => {
    if (tab() !== 'nodes') return
    const list = nodes.data ?? []
    if (!list.length) return
    const current = selectedNodeId()
    if (!current || !list.some((n: { id: string }) => n.id === current)) {
      setSelectedNodeId(list[0].id)
    }
  })

  async function invalidateNodes() {
    await queryClient.invalidateQueries({ queryKey: ['node.list', null] })
  }

  const selectedNode = createMemo(() => {
    const id = selectedNodeId()
    if (!id) return null
    return (nodes.data ?? []).find((n: { id: string }) => n.id === id) ?? null
  })

  const [fsPath, setFsPath] = createSignal<string>('')
  const [selectedFilePath, setSelectedFilePath] = createSignal<string | null>(null)

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
    setTab('files')
    setFsPath(path)
    setSelectedFilePath(null)
  }

  function openFileInFiles(filePath: string) {
    const cleaned = filePath.replace(/\/+$/, '')
    const idx = cleaned.lastIndexOf('/')
    const dir = idx <= 0 ? '' : cleaned.slice(0, idx)
    setTab('files')
    setFsPath(dir)
    setSelectedFilePath(cleaned)
  }

  // selectedInstance UI is handled by the terminal modal.

  // Files state/queries will be moved into FilesPage next.

  const instancesTabProps = {
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
    instancesLastUpdatedAtUnixMs,
    invalidateInstances,
    isReadOnly,
    mcCreateMode,
    mcCurseforge,
    mcEffectiveFrpConfig,
    mcEula,
    mcFrpConfig,
    mcFrpEnabled,
    mcFrpMode,
    mcFrpNodeId,
    mcImportPack,
    mcMemory,
    mcMrpack,
    mcPort,
    mcVersion,
    mcVersionOptions,
    me,
    minecraftCreateModeOptions,
    openEditModal,
    openFileInFiles,
    openInFiles,
    pinnedInstanceIds,
    pushToast,
    restartInstance,
    revealInstance,
    runInstanceOp,
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
    setCreateMcCurseforgeEl: (el: HTMLInputElement) => (createMcCurseforgeEl = el),
    setCreateMcEulaEl: (el: HTMLInputElement) => (createMcEulaEl = el),
    setCreateMcFrpConfigEl: (el: HTMLTextAreaElement) => (createMcFrpConfigEl = el),
    setCreateMcFrpNodeEl: (el: HTMLDivElement) => (createMcFrpNodeEl = el),
    setCreateMcImportPackEl: (el: HTMLInputElement) => (createMcImportPackEl = el),
    setCreateMcMemoryEl: (el: HTMLInputElement) => (createMcMemoryEl = el),
    setCreateMcMrpackEl: (el: HTMLInputElement) => (createMcMrpackEl = el),
    setCreateMcPortEl: (el: HTMLInputElement) => (createMcPortEl = el),
    setCreateSleepSecondsEl: (el: HTMLInputElement) => (createSleepSecondsEl = el),
    setCreateTrFrpConfigEl: (el: HTMLTextAreaElement) => (createTrFrpConfigEl = el),
    setCreateTrFrpNodeEl: (el: HTMLDivElement) => (createTrFrpNodeEl = el),
    setCreateTrMaxPlayersEl: (el: HTMLInputElement) => (createTrMaxPlayersEl = el),
    setCreateTrPasswordEl: (el: HTMLInputElement) => (createTrPasswordEl = el),
    setCreateTrPortEl: (el: HTMLInputElement) => (createTrPortEl = el),
    setCreateTrWorldNameEl: (el: HTMLInputElement) => (createTrWorldNameEl = el),
    setCreateTrWorldSizeEl: (el: HTMLInputElement) => (createTrWorldSizeEl = el),
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
    setMcCreateMode,
    setMcCurseforge,
    setMcEula,
    setMcFrpConfig,
    setMcFrpEnabled,
    setMcFrpMode,
    setMcFrpNodeId,
    setMcImportPack,
    setMcMemory,
    setMcMrpack,
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
    setWarmFieldErrors,
    setWarmFormError,
    settingsStatus,
    sleepSeconds,
    startInstance,
    stopInstance,
    tab,
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
    hasSavedSteamcmdCreds,
    setTab,
    downloadQueueEnqueue,
  }

  const frpTabProps = {
    tab,
    frpNodes,
    isAuthed,
    isReadOnly,
    openCreateFrpNodeModal,
    openEditFrpNodeModal,
    frpDeleteNode,
    invalidateFrpNodes,
    pushToast,
    toastError,
  }

  const settingsTabProps = {
    tab,
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
    updateCheck,
    triggerUpdate,
    controlDiagnostics,
  }

  const nodesTabProps = {
    tab,
    me,
    openCreateNode,
    nodesLastUpdatedAtUnixMs,
    nodes,
    invalidateNodes,
    selectedNodeId,
    setSelectedNodeId,
    selectedNode,
    setNodeEnabled,
    nodeEnabledOverride,
    setNodeEnabledOverride,
  }

  const openLoginModal = () => {
    setAuthError(null)
    setShowLoginModal(true)
    setFocusLoginUsername(true)
  }

  const downloadTaskModalProps = {
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
    setLoginUsernameEl: (el: HTMLInputElement) => {
      loginUsernameEl = el
    },
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
    setCreateNodeControlWsUrl,
    setCreateNodeResult,
    pushToast,
    invalidateNodes,
    setSelectedNodeId,
    createNodeComposeYaml,
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
    importSaveUrl,
    setImportSaveUrl,
    importSaveFromUrl,
    processLogsTail,
    canTailProcessLogs,
    processLogLive,
    setProcessLogLive,
    setProcessLogLines,
    isAuthed,
  }

  const toastPortalProps = {
    toasts,
    setToasts,
  }

  const openDiagnostics = () => setShowDiagnosticsModal(true)
  const retryBackend = () => void queryClient.invalidateQueries({ queryKey: ['control.ping', null] })
  const retryAgent = () => void queryClient.invalidateQueries({ queryKey: ['agent.health', null] })
  const copyFsWriteEnv = () => {
    void safeCopy('ALLOY_FS_WRITE_ENABLED=true')
    pushToast('success', 'Copied', 'ALLOY_FS_WRITE_ENABLED=true')
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
  }

  const topHeaderProps = {
    setMobileNavOpen,
    backendPending: ping.isPending,
    backendError: ping.isError,
    agentPending: agentHealth.isPending,
    agentError: agentHealth.isError,
    isReadOnly: isReadOnly(),
    themeButtonTitle: themeButtonTitle(),
    themePref: themePref(),
    setThemePref,
    authLoading: authLoading(),
    me: me(),
    openLoginModal,
    showAccountMenu: showAccountMenu(),
    setShowAccountMenu,
    openDiagnostics,
    handleLogout,
  }

  const mobileDrawerProps = {
    mobileNavOpen: mobileNavOpen(),
    setMobileNavOpen,
    tab: tab(),
    setTab,
    me: me(),
    themePref: themePref(),
    setThemePref,
    isReadOnly: isReadOnly(),
    openLoginModal,
    handleLogout,
  }

  const authOverlayProps = {
    authError: authError(),
    openLoginModal,
  }

  const statusBannersProps = {
    pingError: ping.isError,
    agentError: agentHealth.isError,
    isReadOnly: isReadOnly(),
    fsWriteEnabled: fsWriteEnabled(),
    tab: tab(),
    lastBackendOkAtUnixMs: lastBackendOkAtUnixMs(),
    lastAgentOkAtUnixMs: lastAgentOkAtUnixMs(),
    retryBackend,
    retryAgent,
    openDiagnostics,
    copyFsWriteEnv,
  }

  const mainPanelsProps = {
    tab,
    isAuthed,
    fsPath,
    selectedFilePath,
    instancesTabProps,
    downloadsTabProps,
    frpTabProps,
    settingsTabProps,
    nodesTabProps,
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
