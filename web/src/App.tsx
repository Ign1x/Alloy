import { isAlloyApiError, onAuthEvent, queryClient, rspc } from './rspc'
import { createEffect, createMemo, createSignal, Show, onCleanup } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { ProcessStatusDto } from './bindings'
import { ensureCsrfCookie, logout, whoami } from './auth'
import { Banner } from './components/ui/Banner'
import { Badge } from './components/ui/Badge'
import { Button } from './components/ui/Button'
import { Drawer } from './components/ui/Drawer'
import { IconButton } from './components/ui/IconButton'
import AddNodeModal from './components/AddNodeModal'
import DeleteInstanceModal from './components/DeleteInstanceModal'
import ControlDiagnosticsModal from './components/ControlDiagnosticsModal'
import DspInitModal from './components/DspInitModal'
import EditInstanceModal from './components/EditInstanceModal'
import { FileBrowser } from './components/FileBrowser'
import DownloadTaskModal from './components/DownloadTaskModal'
import FrpNodeModal from './components/FrpNodeModal'
import LoginModal from './components/LoginModal'
import InstanceDetailsModal from './components/InstanceDetailsModal'
import ToastPortal from './components/ToastPortal'
import { StatusPill } from './app/primitives/StatusPill'
import { parseAgentErrorPayload } from './app/helpers/agentErrors'
import { mapDownloadJobFromServer, downloadTargetLabel } from './app/helpers/downloads'
import { buildCreatePreview, computeCreateAdvancedDirty } from './app/helpers/createInstancePreview'
import { formatRelativeTime } from './app/helpers/format'
import {
  focusFirstCreateError as focusFirstCreateErrorInForm,
  focusFirstEditError as focusFirstEditErrorInForm,
} from './app/helpers/formFocus'
import { defaultControlWsUrl, detectFrpConfigFormat, instancePort, parseFrpEndpoint } from './app/helpers/network'
import { optionsWithCurrentValue, safeCopy } from './app/helpers/misc'
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
  type Toast,
  type ToastVariant,
  type UiTab,
} from './app/types'
import DownloadsTab from './pages/DownloadsTab'
import FrpTab from './pages/FrpTab'
import InstancesTab from './pages/InstancesTab'
import NodesTab from './pages/NodesTab'
import SettingsTab from './pages/SettingsTab'
import { Moon, Monitor, Sun } from 'lucide-solid'

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
  const [showDspInitModal, setShowDspInitModal] = createSignal(false)
  const [confirmDeleteInstanceId, setConfirmDeleteInstanceId] = createSignal<string | null>(null)
  const [confirmDeleteText, setConfirmDeleteText] = createSignal('')
  const [editingInstanceId, setEditingInstanceId] = createSignal<string | null>(null)
  const [showDiagnosticsModal, setShowDiagnosticsModal] = createSignal(false)
  const [toasts, setToasts] = createSignal<Toast[]>([])
  const [showAccountMenu, setShowAccountMenu] = createSignal(false)
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
  let createDspStartupModeEl: HTMLDivElement | undefined
  let createDspSaveNameEl: HTMLInputElement | undefined
  let createDspPortEl: HTMLInputElement | undefined
  let createDspServerPasswordEl: HTMLInputElement | undefined
  let createDspRemoteAccessPasswordEl: HTMLInputElement | undefined
  let createDspUpsEl: HTMLInputElement | undefined
  let createDspWineBinEl: HTMLInputElement | undefined
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

  const THEME_STORAGE_KEY = 'alloy.theme'
  type ThemePreference = 'system' | 'light' | 'dark'
  const [themePref, setThemePref] = createSignal<ThemePreference>((() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY)
      if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
    } catch {
      // ignore
    }
    return 'system'
  })())

  const [systemPrefersDark, setSystemPrefersDark] = createSignal<boolean>((() => {
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    } catch {
      return false
    }
  })())

  createEffect(() => {
    const mql = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mql) return

    const onChange = (ev: MediaQueryListEvent) => setSystemPrefersDark(ev.matches)
    setSystemPrefersDark(mql.matches)

    try {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    } catch {
      mql.addListener(onChange)
      return () => mql.removeListener(onChange)
    }
  })

  const theme = createMemo<'light' | 'dark'>(() => {
    const pref = themePref()
    if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light'
    return pref
  })

  const themeButtonTitle = createMemo(() => {
    const pref = themePref()
    const applied = theme()
    const appliedLabel = applied === 'dark' ? 'Dark' : 'Light'
    const current = pref === 'system' ? `System (${appliedLabel})` : pref === 'dark' ? 'Dark' : 'Light'
    const next = pref === 'system' ? 'Light' : pref === 'light' ? 'Dark' : 'System'
    return `Theme: ${current}. Click to switch to ${next}.`
  })

  createEffect(() => {
    document.documentElement.classList.toggle('dark', theme() === 'dark')
  })

  createEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themePref())
    } catch {
      // ignore
    }
  })

  const SIDEBAR_STORAGE_KEY = 'alloy.sidebar'
  const [sidebarExpanded, setSidebarExpanded] = createSignal<boolean>((() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY)
      if (saved === 'expanded') return true
      if (saved === 'collapsed') return false
    } catch {
      // ignore
    }
    // Default to collapsed for a console-like feel.
    return false
  })())

  createEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarExpanded() ? 'expanded' : 'collapsed')
    } catch {
      // ignore
    }
  })

  const [mobileNavOpen, setMobileNavOpen] = createSignal(false)

  // Prevent out-of-order session fetches from clobbering newer state.
  let sessionFetchToken = 0

  function pushToast(variant: ToastVariant, title: string, message?: string, requestId?: string) {
    const id = (() => {
      try {
        return crypto.randomUUID()
      } catch {
        return Math.random().toString(36).slice(2)
      }
    })()

    setToasts((prev) => [...prev, { id, variant, title, message, requestId }].slice(-4))
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 6500)
  }

  function friendlyErrorMessage(err: unknown): string {
    const raw = err instanceof Error ? err.message : 'unknown error'
    const lower = raw.toLowerCase()
    if (lower.includes('504 gateway time-out') || lower.includes('504 gateway timeout')) {
      return 'Gateway timed out, but backend may still be downloading. Open Downloads, warm files first, then retry.'
    }
    return raw
  }

  function toastError(title: string, err: unknown) {
    if (isAlloyApiError(err)) {
      pushToast('error', title, err.data.message, err.data.request_id)
      return
    }
    pushToast('error', title, friendlyErrorMessage(err))
  }

  function dspSourceInitRequired(
    message: string | null | undefined,
    fieldErrors: Record<string, string> | null | undefined,
  ): boolean {
    if (fieldErrors?.server_root) return true
    const m = (message ?? '').toLowerCase()
    return m.includes('dsp source files are not initialized') || m.includes('not initialized')
  }

  function dspSteamcmdSettingsRequiredMessage() {
    return 'SteamCMD credentials are not configured. Open Settings → SteamCMD credentials, Login successfully, then retry.'
  }

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
      const latency = n.latency_ms != null ? `${n.latency_ms}ms` : 'offline'
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
  const [warmFormError, setWarmFormError] = createSignal<{ message: string; requestId?: string } | null>(null)
  const [warmFieldErrors, setWarmFieldErrors] = createSignal<Record<string, string>>({})
  const [pendingCreateAfterDspInit, setPendingCreateAfterDspInit] = createSignal<{
    template_id: string
    params: Record<string, string>
    display_name: string | null
  } | null>(null)
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
  const [downloadDspGuardCode, setDownloadDspGuardCode] = createSignal('')
  const [downloadCenterView, setDownloadCenterView] = createSignal<DownloadCenterView>((() => {
    try {
      const v = localStorage.getItem(DOWNLOAD_VIEW_STORAGE_KEY)
      if (v === 'library' || v === 'queue' || v === 'installed' || v === 'updates') return v
    } catch {
      // ignore
    }
    return 'queue'
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

  const [dspPort, setDspPort] = createSignal('')
  const [dspStartupMode, setDspStartupMode] = createSignal('auto')
  const [dspSaveName, setDspSaveName] = createSignal('')
  const [dspServerPassword, setDspServerPassword] = createSignal('')
  const [dspServerPasswordVisible, setDspServerPasswordVisible] = createSignal(false)
  const [dspRemoteAccessPassword, setDspRemoteAccessPassword] = createSignal('')
  const [dspRemoteAccessPasswordVisible, setDspRemoteAccessPasswordVisible] = createSignal(false)
  const [dspAutoPauseEnabled, setDspAutoPauseEnabled] = createSignal(false)
  const [dspUps, setDspUps] = createSignal('60')
  const [dspWineBin, setDspWineBin] = createSignal('wine64')
  const [dspWarmNeedsInit, setDspWarmNeedsInit] = createSignal(false)
  const [dspSteamGuardCode, setDspSteamGuardCode] = createSignal('')

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
      dspPort: dspPort(),
      dspServerPassword: dspServerPassword(),
      dspRemoteAccessPassword: dspRemoteAccessPassword(),
      dspAutoPauseEnabled: dspAutoPauseEnabled(),
      dspUps: dspUps(),
      dspWineBin: dspWineBin(),
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
      dspStartupMode: dspStartupMode(),
      dspSaveName: dspSaveName(),
      dspPort: dspPort(),
      dspServerPassword: dspServerPassword(),
      dspRemoteAccessPassword: dspRemoteAccessPassword(),
      dspAutoPauseEnabled: dspAutoPauseEnabled(),
      dspUps: dspUps(),
      dspWineBin: dspWineBin(),
    }),
  )
  createEffect(() => {
    // Clear create-form errors when switching templates.
    selectedTemplate()
    setCreateFormError(null)
    setCreateFieldErrors({})
    setWarmFormError(null)
    setWarmFieldErrors({})
    setPendingCreateAfterDspInit(null)
    setShowDspInitModal(false)
    setDspWarmNeedsInit(false)
    setDspSteamGuardCode('')
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
    setDspServerPasswordVisible(false)
    setDspRemoteAccessPasswordVisible(false)
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
        createDspStartupModeEl,
        createDspSaveNameEl,
        createDspPortEl,
        createDspServerPasswordEl,
        createDspRemoteAccessPasswordEl,
        createDspUpsEl,
        createDspWineBinEl,
      },
      mcFrpEnabled: mcFrpEnabled(),
      mcFrpMode: mcFrpMode(),
      trFrpEnabled: trFrpEnabled(),
      trFrpMode: trFrpMode(),
    })
  }
  function closeDspInitModal() {
    setShowDspInitModal(false)
    setPendingCreateAfterDspInit(null)
    setWarmFormError(null)
    setWarmFieldErrors({})
  }

  async function runDspInitAndMaybeCreate() {
    const template_id = createTemplateId()
    if (template_id !== 'dsp:nebula') return

    if (!hasSavedSteamcmdCreds()) {
      setPendingCreateAfterDspInit(null)
      setShowDspInitModal(false)
      setWarmFieldErrors({})
      setWarmFormError(null)
      setCreateFieldErrors({})
      setCreateFormError({ message: dspSteamcmdSettingsRequiredMessage() })
      pushToast('error', 'SteamCMD not configured', dspSteamcmdSettingsRequiredMessage())
      return
    }

    const guardCode = dspSteamGuardCode().trim()

    setWarmFormError(null)
    setWarmFieldErrors({})

    try {
      const warmParams: Record<string, string> = {}
      if (guardCode) warmParams.steam_guard_code = guardCode

      const warmOut = await warmCache.mutateAsync({ template_id: 'dsp:nebula', params: warmParams })
      setDspWarmNeedsInit(false)
      setDspSteamGuardCode('')
      pushToast('success', 'DSP source initialized', warmOut.message)

      const pending = pendingCreateAfterDspInit()
      if (!pending) {
        setShowDspInitModal(false)
        return
      }

      const out = await createInstance.mutateAsync(pending)
      setPendingCreateAfterDspInit(null)
      setShowDspInitModal(false)
      setCreateFormError(null)
      setCreateFieldErrors({})
      pushToast('success', 'Instance created', pending.display_name ?? undefined)
      await invalidateInstances()
      revealInstance(out.instance_id)
      setSelectedInstanceId(out.instance_id)
    } catch (e) {
      if (isAlloyApiError(e)) {
        const fieldErrors = e.data.field_errors ?? {}
        if (fieldErrors.steam_guard_code) {
          setWarmFieldErrors({ steam_guard_code: fieldErrors.steam_guard_code })
          setWarmFormError({ message: e.data.message, requestId: e.data.request_id })
          setShowDspInitModal(true)
        } else if (fieldErrors.steam_username || fieldErrors.steam_password) {
          setWarmFieldErrors({})
          setWarmFormError(null)
          setShowDspInitModal(false)
          setCreateFieldErrors({})
          setCreateFormError({ message: dspSteamcmdSettingsRequiredMessage(), requestId: e.data.request_id })
        } else {
          setCreateFieldErrors(fieldErrors)
          setCreateFormError({ message: e.data.message, requestId: e.data.request_id })
        }

        if (dspSourceInitRequired(e.data.message, fieldErrors)) {
          setDspWarmNeedsInit(true)
        }
        if (e.data.hint) pushToast('info', 'Hint', e.data.hint, e.data.request_id)
        return
      }

      setWarmFormError({ message: friendlyErrorMessage(e) })
    }
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

    if (target === 'dsp_nebula') {
      version = 'steamcmd'
      templateId = 'dsp:nebula'
      if (!hasSavedSteamcmdCreds()) {
        const msg = dspSteamcmdSettingsRequiredMessage()
        pushToast('error', 'SteamCMD not configured', msg)
        setTab('settings')
        return null
      }
      const guard = downloadDspGuardCode().trim()
      if (guard) params.steam_guard_code = guard
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
      if (target === 'dsp_nebula') {
        setDownloadDspGuardCode('')
      }
      setDownloadCenterView('queue')
      pushToast('info', 'Added to queue', `${downloadTargetLabel(target)} · ${req.version}`)
      await invalidateDownloadQueue()
    } catch (e) {
      if (isAlloyApiError(e)) {
        const fieldErrors = e.data.field_errors ?? {}
        if (target === 'dsp_nebula' && (fieldErrors.steam_username || fieldErrors.steam_password)) {
          pushToast('error', 'SteamCMD not configured', dspSteamcmdSettingsRequiredMessage(), e.data.request_id)
          setTab('settings')
        } else {
          pushToast('error', 'Add to queue failed', e.data.message, e.data.request_id)
        }
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

  const downloadLastSuccessVersionByTarget = createMemo(() => {
    const out = new Map<DownloadTarget, string>()
    for (const job of downloadJobs()) {
      if (job.state !== 'success') continue
      if (!out.has(job.target)) out.set(job.target, job.version)
    }
    return out
  })

  const downloadCacheByKey = createMemo(() => {
    const map = new Map<string, { key: string; path: string; size_bytes: string; last_used_unix_ms: string }>()
    for (const entry of controlDiagnostics.data?.cache?.entries ?? []) {
      map.set(entry.key, entry as { key: string; path: string; size_bytes: string; last_used_unix_ms: string })
    }
    return map
  })

  const downloadInstalledRows = createMemo(() => {
    const targets: DownloadTarget[] = ['minecraft_vanilla', 'terraria_vanilla', 'dsp_nebula']
    return targets.map((target) => {
      const templateId =
        target === 'minecraft_vanilla'
          ? 'minecraft:vanilla'
          : target === 'terraria_vanilla'
            ? 'terraria:vanilla'
            : 'dsp:nebula'
      const cache = downloadCacheByKey().get(templateId)
      const installed = Number(cache?.size_bytes ?? '0') > 0
      const installedVersion = downloadLastSuccessVersionByTarget().get(target) ?? (installed ? 'cached' : 'not installed')
      return {
        target,
        templateId,
        installed,
        installedVersion,
        sizeBytes: Number(cache?.size_bytes ?? '0'),
        lastUsedUnixMs: Number(cache?.last_used_unix_ms ?? '0'),
      }
    })
  })

  const downloadUpdateRows = createMemo(() => {
    const mcLatest = mcVersions.data?.latest_release ?? 'latest_release'
    const trLatest = '1453'
    const dspLatest = 'steamcmd-source'

    return downloadInstalledRows().map((row) => {
      const latestVersion =
        row.target === 'minecraft_vanilla' ? mcLatest : row.target === 'terraria_vanilla' ? trLatest : dspLatest
      const installedVersion = row.installedVersion
      const updateAvailable = row.installed && installedVersion !== 'cached' && installedVersion !== latestVersion
      return {
        ...row,
        latestVersion,
        updateAvailable,
      }
    })
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
        process_id: selectedInstanceId() ?? '',
        cursor: processLogCursor(),
        limit: 400,
      },
    ],
    () => ({
      enabled: isAuthed() && showInstanceModal() && !!selectedInstanceId() && instanceDetailTab() === 'logs',
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
    setFrpNodeAllocatablePorts(node.allocatable_ports ?? '')
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

  return (
    <div class="h-screen w-screen overflow-hidden bg-gradient-to-br from-slate-50 via-white to-amber-50 text-slate-900 dark:from-slate-950 dark:via-slate-950 dark:to-amber-950/25 dark:text-slate-200">
      <div class="flex h-full">
        <nav
          class={`hidden sm:flex ${sidebarExpanded() ? 'w-56' : 'w-16'} flex-none flex-col gap-3 border-r border-slate-200 bg-white px-2 py-4 dark:border-slate-800 dark:bg-slate-950`}
          aria-label="Primary navigation"
        >
          <button
            type="button"
            class={`mt-1 flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-900/60 ${
              sidebarExpanded() ? '' : 'justify-center'
            }`}
            onClick={() => setTab('instances')}
            aria-label="Go to Instances"
            title="Alloy"
          >
            <img src="/logo.svg" class="h-9 w-9 rounded-xl" alt="Alloy" />
            <Show when={sidebarExpanded()}>
              <div class="min-w-0">
                <div class="truncate font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Alloy</div>
                <div class="text-[10px] uppercase tracking-[0.2em] text-slate-500">control plane</div>
              </div>
            </Show>
          </button>

          <div class="mt-2 flex w-full flex-col gap-1">
            <button
              type="button"
              class={`group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors ${
                tab() === 'instances'
                  ? 'bg-amber-500/10 text-amber-800 ring-1 ring-inset ring-amber-500/20 dark:text-amber-200'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-900/60 dark:hover:text-slate-100'
              } ${sidebarExpanded() ? '' : 'justify-center'}`}
              onClick={() => setTab('instances')}
              aria-label="Instances"
              title="Instances"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
                <path d="M3 4.75A1.75 1.75 0 014.75 3h2.5A1.75 1.75 0 019 4.75v2.5A1.75 1.75 0 017.25 9h-2.5A1.75 1.75 0 013 7.25v-2.5zM11 4.75A1.75 1.75 0 0112.75 3h2.5A1.75 1.75 0 0117 4.75v2.5A1.75 1.75 0 0115.25 9h-2.5A1.75 1.75 0 0111 7.25v-2.5zM3 12.75A1.75 1.75 0 014.75 11h2.5A1.75 1.75 0 019 12.75v2.5A1.75 1.75 0 017.25 17h-2.5A1.75 1.75 0 013 15.25v-2.5zM11 12.75A1.75 1.75 0 0112.75 11h2.5A1.75 1.75 0 0117 12.75v2.5A1.75 1.75 0 0115.25 17h-2.5A1.75 1.75 0 0111 15.25v-2.5z" />
              </svg>
              <Show when={sidebarExpanded()}>
                <span class="text-sm font-medium">Instances</span>
              </Show>
            </button>

            <button
              type="button"
              class={`group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors ${
                tab() === 'downloads'
                  ? 'bg-amber-500/10 text-amber-800 ring-1 ring-inset ring-amber-500/20 dark:text-amber-200'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-900/60 dark:hover:text-slate-100'
              } ${sidebarExpanded() ? '' : 'justify-center'}`}
              onClick={() => setTab('downloads')}
              aria-label="Downloads"
              title="Downloads"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
                <path
                  fill-rule="evenodd"
                  d="M10 2.75a.75.75 0 01.75.75v8.19l2.22-2.22a.75.75 0 111.06 1.06l-3.5 3.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 111.06-1.06l2.22 2.22V3.5a.75.75 0 01.75-.75zM3.5 14.25a.75.75 0 01.75.75v.75c0 .69.56 1.25 1.25 1.25h9c.69 0 1.25-.56 1.25-1.25V15a.75.75 0 011.5 0v.75A2.75 2.75 0 0114.5 18h-9a2.75 2.75 0 01-2.75-2.75V15a.75.75 0 01.75-.75z"
                  clip-rule="evenodd"
                />
              </svg>
              <Show when={sidebarExpanded()}>
                <span class="text-sm font-medium">Downloads</span>
              </Show>
            </button>

            <button
              type="button"
              class={`group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors ${
                tab() === 'files'
                  ? 'bg-amber-500/10 text-amber-800 ring-1 ring-inset ring-amber-500/20 dark:text-amber-200'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-900/60 dark:hover:text-slate-100'
              } ${sidebarExpanded() ? '' : 'justify-center'}`}
              onClick={() => setTab('files')}
              aria-label="Files"
              title="Files"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
                <path d="M2 5.75A2.75 2.75 0 014.75 3h4.19a2.75 2.75 0 011.944.806l.56.56c.215.215.507.334.812.334h2.994A2.75 2.75 0 0118 7.45v6.8A2.75 2.75 0 0115.25 17H4.75A2.75 2.75 0 012 14.25v-8.5z" />
              </svg>
              <Show when={sidebarExpanded()}>
                <span class="text-sm font-medium">Files</span>
              </Show>
            </button>

            <button
              type="button"
              class={`group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors ${
                tab() === 'nodes'
                  ? 'bg-amber-500/10 text-amber-800 ring-1 ring-inset ring-amber-500/20 dark:text-amber-200'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-900/60 dark:hover:text-slate-100'
              } ${sidebarExpanded() ? '' : 'justify-center'}`}
              onClick={() => setTab('nodes')}
              aria-label="Nodes"
              title="Nodes"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
                <path d="M4.75 3A2.75 2.75 0 002 5.75v.5A2.75 2.75 0 004.75 9h10.5A2.75 2.75 0 0018 6.25v-.5A2.75 2.75 0 0015.25 3H4.75z" />
                <path d="M4.75 11A2.75 2.75 0 002 13.75v.5A2.75 2.75 0 004.75 17h10.5A2.75 2.75 0 0018 14.25v-.5A2.75 2.75 0 0015.25 11H4.75z" />
              </svg>
              <Show when={sidebarExpanded()}>
                <span class="text-sm font-medium">Nodes</span>
              </Show>
            </button>

            <button
              type="button"
              class={`group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors ${
                tab() === 'frp'
                  ? 'bg-amber-500/10 text-amber-800 ring-1 ring-inset ring-amber-500/20 dark:text-amber-200'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-900/60 dark:hover:text-slate-100'
              } ${sidebarExpanded() ? '' : 'justify-center'}`}
              onClick={() => setTab('frp')}
              aria-label="FRP"
              title="FRP"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
                <path d="M4.75 4A1.75 1.75 0 003 5.75v8.5C3 15.216 3.784 16 4.75 16h1.5C7.216 16 8 15.216 8 14.25V11h4v3.25c0 .966.784 1.75 1.75 1.75h1.5c.966 0 1.75-.784 1.75-1.75v-8.5A1.75 1.75 0 0015.25 4h-1.5A1.75 1.75 0 0012 5.75V9H8V5.75A1.75 1.75 0 006.25 4h-1.5z" />
              </svg>
              <Show when={sidebarExpanded()}>
                <span class="text-sm font-medium">FRP</span>
              </Show>
            </button>

            <Show when={me()?.is_admin}>
              <button
                type="button"
                class={`group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors ${
                  tab() === 'settings'
                    ? 'bg-amber-500/10 text-amber-800 ring-1 ring-inset ring-amber-500/20 dark:text-amber-200'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-900/60 dark:hover:text-slate-100'
                } ${sidebarExpanded() ? '' : 'justify-center'}`}
                onClick={() => setTab('settings')}
                aria-label="Settings"
                title="Settings"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5" aria-hidden="true">
                  <path
                    fill-rule="evenodd"
                    clip-rule="evenodd"
                    d="M7.83922 1.80388C7.93271 1.33646 8.34312 1 8.81981 1H11.1802C11.6569 1 12.0673 1.33646 12.1608 1.80388L12.4913 3.45629C13.1956 3.72458 13.8454 4.10332 14.4196 4.57133L16.0179 4.03065C16.4694 3.8779 16.966 4.06509 17.2043 4.47791L18.3845 6.52207C18.6229 6.93489 18.5367 7.45855 18.1786 7.77322L16.9119 8.88645C16.9699 9.24909 17 9.62103 17 10C17 10.379 16.9699 10.7509 16.9119 11.1135L18.1786 12.2268C18.5367 12.5414 18.6229 13.0651 18.3845 13.4779L17.2043 15.5221C16.966 15.9349 16.4694 16.1221 16.0179 15.9693L14.4196 15.4287C13.8454 15.8967 13.1956 16.2754 12.4913 16.5437L12.1608 18.1961C12.0673 18.6635 11.6569 19 11.1802 19H8.81981C8.34312 19 7.93271 18.6635 7.83922 18.1961L7.50874 16.5437C6.80443 16.2754 6.1546 15.8967 5.58043 15.4287L3.98214 15.9694C3.5306 16.1221 3.03401 15.9349 2.79567 15.5221L1.61547 13.4779C1.37713 13.0651 1.4633 12.5415 1.82136 12.2268L3.08808 11.1135C3.03012 10.7509 3 10.379 3 10C3 9.62103 3.03012 9.2491 3.08808 8.88647L1.82136 7.77324C1.46331 7.45857 1.37713 6.93491 1.61547 6.52209L2.79567 4.47793C3.03401 4.06511 3.5306 3.87791 3.98214 4.03066L5.58042 4.57134C6.15459 4.10332 6.80442 3.72459 7.50874 3.45629L7.83922 1.80388ZM10 13C11.6569 13 13 11.6569 13 10C13 8.34315 11.6569 7 10 7C8.34315 7 7 8.34315 7 10C7 11.6569 8.34315 13 10 13Z"
                  />
                </svg>
                <Show when={sidebarExpanded()}>
                  <span class="text-sm font-medium">Settings</span>
                </Show>
              </button>
            </Show>
          </div>

          <div class={`mt-auto flex w-full flex-col items-center gap-2 pb-2 ${sidebarExpanded() ? 'px-1' : ''}`}>
            <IconButton
              label={sidebarExpanded() ? 'Collapse sidebar' : 'Expand sidebar'}
              variant="ghost"
              onClick={() => setSidebarExpanded((v) => !v)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                <Show
                  when={sidebarExpanded()}
                  fallback={
                    <path
                      fill-rule="evenodd"
                      d="M8.22 4.47a.75.75 0 011.06 0l5 5a.75.75 0 010 1.06l-5 5a.75.75 0 11-1.06-1.06L12.69 10 8.22 5.53a.75.75 0 010-1.06z"
                      clip-rule="evenodd"
                    />
                  }
                >
                  <path
                    fill-rule="evenodd"
                    d="M11.78 15.53a.75.75 0 01-1.06 0l-5-5a.75.75 0 010-1.06l5-5a.75.75 0 111.06 1.06L7.31 10l4.47 4.47a.75.75 0 010 1.06z"
                    clip-rule="evenodd"
                  />
                </Show>
              </svg>
            </IconButton>
            <IconButton
              label={themeButtonTitle()}
              variant="secondary"
              onClick={() => setThemePref((prev) => (prev === 'system' ? 'light' : prev === 'light' ? 'dark' : 'system'))}
            >
              <Show
                when={themePref() === 'dark'}
                fallback={
                  <Show when={themePref() === 'light'} fallback={<Monitor class="h-4 w-4" strokeWidth={1.9} />}>
                    <Sun class="h-4 w-4" strokeWidth={1.9} />
                  </Show>
                }
              >
                <Moon class="h-4 w-4" strokeWidth={1.9} />
              </Show>
            </IconButton>
          </div>
        </nav>

        <div class="flex min-w-0 flex-1 flex-col">
  <header class="relative z-50 flex h-14 flex-none items-center justify-between border-b border-slate-200 bg-white/70 px-5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/70">
            <div class="flex items-center gap-4">
              <IconButton label="Open menu" class="sm:hidden" variant="secondary" onClick={() => setMobileNavOpen(true)}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                  <path
                    fill-rule="evenodd"
                    d="M3 5.75A.75.75 0 013.75 5h12.5a.75.75 0 010 1.5H3.75A.75.75 0 013 5.75zm0 4A.75.75 0 013.75 9h12.5a.75.75 0 010 1.5H3.75A.75.75 0 013 9.75zm0 4a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H3.75a.75.75 0 01-.75-.75z"
                    clip-rule="evenodd"
                  />
                </svg>
              </IconButton>
              <div class="flex items-center gap-2">
  <img src="/logo.svg" class="h-7 w-7 rounded-lg" alt="Alloy" />
                <div class="leading-none">
  <div class="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">ALLOY</div>
                  <div class="text-[10px] uppercase tracking-[0.2em] text-slate-500">control plane</div>
                </div>
              </div>

              <div class="hidden md:flex items-center gap-2 text-[11px] text-slate-500">
                <StatusPill label="Backend" state={{ loading: ping.isPending, error: ping.isError }} status={ping.isError ? 'offline' : ping.isPending ? '...' : 'ok'} />
                <StatusPill label="Agent" state={{ loading: agentHealth.isPending, error: agentHealth.isError }} status={agentHealth.isError ? 'offline' : agentHealth.isPending ? '...' : 'ok'} />
              </div>
            </div>

            <div class="flex items-center gap-3">
              <Show when={import.meta.env.MODE !== 'production'}>
                <Badge variant="warning" title="Environment">
                  {import.meta.env.MODE.toUpperCase()}
                </Badge>
              </Show>
              <Show when={isReadOnly()}>
                <Badge variant="danger" title="Read-only mode">
                  READ-ONLY
                </Badge>
              </Show>
              <button
                class="sm:hidden rounded-xl border border-slate-200 bg-white/70 p-2 text-slate-700 shadow-sm transition-colors hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:bg-slate-900"
                title={themeButtonTitle()}
                onClick={() =>
                  setThemePref((prev) => (prev === 'system' ? 'light' : prev === 'light' ? 'dark' : 'system'))
                }
              >
                {themePref() === 'dark' ? (
                  <Moon class="h-4 w-4" strokeWidth={1.9} />
                ) : themePref() === 'light' ? (
                  <Sun class="h-4 w-4" strokeWidth={1.9} />
                ) : (
                  <Monitor class="h-4 w-4" strokeWidth={1.9} />
                )}
              </button>

              <Show when={!authLoading()} fallback={<div class="h-8 w-28 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />}>
                <Show
                  when={me()}
                  fallback={
                    <button
                      class="rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-500/20 hover:bg-amber-500/15 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/20"
                      onClick={() => {
                        setAuthError(null)
                        setShowLoginModal(true)
                        setFocusLoginUsername(true)
                      }}
                    >
                      INITIALIZE_SESSION
                    </button>
                  }
                >
                  <div class="relative">
                    <button
                      type="button"
                      class="group inline-flex h-8 w-8 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/70 p-1 shadow-sm backdrop-blur-sm transition-all duration-150 hover:bg-white hover:shadow active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:border-slate-800 dark:bg-slate-950/60 dark:hover:bg-slate-950/80 dark:shadow-none dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950 sm:w-auto sm:justify-start sm:px-2 sm:py-1"
                      onPointerDown={(ev) => ev.stopPropagation()}
                      onClick={() => setShowAccountMenu((v) => !v)}
                      aria-expanded={showAccountMenu()}
                      aria-haspopup="menu"
                    >
                      <div class="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/10 text-[10px] font-semibold text-amber-900 ring-1 ring-inset ring-amber-500/20 dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-500/25 sm:text-[11px]">
                        {me()!.username.slice(0, 1).toUpperCase()}
                      </div>
                      <span class="hidden max-w-[11rem] truncate text-sm font-medium text-slate-900 dark:text-slate-100 sm:inline">
                        {me()!.username}
                      </span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        class="hidden h-4 w-4 text-slate-500 transition-transform group-hover:translate-y-0.5 sm:block"
                      >
                          <path
                            fill-rule="evenodd"
                            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                            clip-rule="evenodd"
                          />
                        </svg>
                    </button>

                    <Show when={showAccountMenu()}>
                      <Portal>
                        <div class="fixed inset-0 z-[9999]" onPointerDown={() => setShowAccountMenu(false)}>
                          <div
                            class="absolute right-5 top-14 mt-2 w-56 origin-top-right overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10 backdrop-blur transition-all duration-150 animate-in fade-in zoom-in-95 dark:border-slate-800 dark:bg-slate-950"
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            <div class="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
                              <div class="flex items-center gap-3">
                                <div class="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/10 text-xs font-semibold text-amber-900 ring-1 ring-inset ring-amber-500/20 dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-500/25">
                                  {me()!.username.slice(0, 1).toUpperCase()}
                                </div>
                                <div class="min-w-0">
                                  <div class="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{me()!.username}</div>
                                  <div class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                    {me()!.is_admin ? 'Administrator' : 'User'}
                                  </div>
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              class="flex w-full items-center px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 active:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900/50 dark:active:bg-slate-900"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={() => {
                                setShowAccountMenu(false)
                                setShowDiagnosticsModal(true)
                              }}
                            >
                              <span>Diagnostics</span>
                            </button>
                            <button
                              type="button"
                              class="flex w-full items-center px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 active:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900/50 dark:active:bg-slate-900"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={async () => {
                                setShowAccountMenu(false)
                                await handleLogout()
                              }}
                            >
                              <span>Logout</span>
                            </button>
                          </div>
                        </div>
                      </Portal>
                    </Show>
                  </div>
                </Show>
              </Show>
            </div>
          </header>

          <Drawer open={mobileNavOpen()} onClose={() => setMobileNavOpen(false)} title="Menu">
            <div class="space-y-2">
              <button
                type="button"
                class={`w-full rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors ${
                  tab() === 'instances'
                    ? 'border-amber-500/20 bg-amber-500/10 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-100'
                    : 'border-slate-200 bg-white/70 text-slate-800 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900'
                }`}
                onClick={() => {
                  setTab('instances')
                  setMobileNavOpen(false)
                }}
              >
                Instances
              </button>
              <button
                type="button"
                class={`w-full rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors ${
                  tab() === 'downloads'
                    ? 'border-amber-500/20 bg-amber-500/10 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-100'
                    : 'border-slate-200 bg-white/70 text-slate-800 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900'
                }`}
                onClick={() => {
                  setTab('downloads')
                  setMobileNavOpen(false)
                }}
              >
                Downloads
              </button>
              <button
                type="button"
                class={`w-full rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors ${
                  tab() === 'files'
                    ? 'border-amber-500/20 bg-amber-500/10 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-100'
                    : 'border-slate-200 bg-white/70 text-slate-800 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900'
                }`}
                onClick={() => {
                  setTab('files')
                  setMobileNavOpen(false)
                }}
              >
                Files
              </button>
              <button
                type="button"
                class={`w-full rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors ${
                  tab() === 'nodes'
                    ? 'border-amber-500/20 bg-amber-500/10 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-100'
                    : 'border-slate-200 bg-white/70 text-slate-800 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900'
                }`}
                onClick={() => {
                  setTab('nodes')
                  setMobileNavOpen(false)
                }}
              >
                Nodes
              </button>
              <button
                type="button"
                class={`w-full rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors ${
                  tab() === 'frp'
                    ? 'border-amber-500/20 bg-amber-500/10 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-100'
                    : 'border-slate-200 bg-white/70 text-slate-800 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900'
                }`}
                onClick={() => {
                  setTab('frp')
                  setMobileNavOpen(false)
                }}
              >
                FRP
              </button>
              <Show when={me()?.is_admin}>
                <button
                  type="button"
                  class={`w-full rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors ${
                    tab() === 'settings'
                      ? 'border-amber-500/20 bg-amber-500/10 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-100'
                      : 'border-slate-200 bg-white/70 text-slate-800 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900'
                  }`}
                  onClick={() => {
                    setTab('settings')
                    setMobileNavOpen(false)
                  }}
                >
                  Settings
                </button>
              </Show>
            </div>

            <div class="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setThemePref((prev) => (prev === 'system' ? 'light' : prev === 'light' ? 'dark' : 'system'))}
              >
                Theme: {themePref()}
              </Button>
              <Show when={import.meta.env.MODE !== 'production'}>
                <Badge variant="warning">{import.meta.env.MODE.toUpperCase()}</Badge>
              </Show>
              <Show when={isReadOnly()}>
                <Badge variant="danger">READ-ONLY</Badge>
              </Show>
            </div>

            <div class="mt-4">
              <Show
                when={me()}
                fallback={
                  <Button
                    variant="primary"
                    size="md"
                    class="w-full"
                    onClick={() => {
                      setMobileNavOpen(false)
                      setAuthError(null)
                      setShowLoginModal(true)
                      setFocusLoginUsername(true)
                    }}
                  >
                    Sign in
                  </Button>
                }
              >
                <Button
                  variant="secondary"
                  size="md"
                  class="w-full"
                  onClick={async () => {
                    setMobileNavOpen(false)
                    await handleLogout()
                  }}
                >
                  Logout
                </Button>
              </Show>
            </div>
          </Drawer>

          <main class="relative flex min-h-0 flex-1 overflow-hidden">
            <Show when={!isAuthed()}>
              <div class="absolute inset-0 z-40 flex items-center justify-center bg-white/70 backdrop-blur-sm dark:bg-slate-950/70">
                <div class="w-full max-w-md rounded-2xl border border-slate-200 bg-white/80 p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950/80">
                  <div class="font-mono text-[11px] uppercase tracking-wider text-amber-400">
                    SYSTEM_LOCKED // AUTH_REQUIRED
                  </div>
                  <div class="mt-2 text-sm text-slate-900 dark:text-slate-200">Workspace is locked.</div>
                  <div class="mt-1 text-xs text-slate-600 dark:text-slate-500">Sign in to manage instances, browse files, and view nodes.</div>
                  <Show when={authError()}>
                    <div class="mt-3 rounded-lg border border-rose-900/40 bg-rose-950/20 p-3 text-xs text-rose-200">
                      {authError()}
                    </div>
                  </Show>
                  <div class="mt-5 flex gap-3">
                    <button
                      class="flex-1 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-500/20 hover:bg-amber-500/15 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/20"
                      onClick={() => {
                        setAuthError(null)
                        setShowLoginModal(true)
                        setFocusLoginUsername(true)
                      }}
                    >
                      INITIALIZE_SESSION
                    </button>
                    {/* no manual refresh here; keep the locked state deterministic */}
                  </div>
                </div>
              </div>
            </Show>

            <div class={`flex min-h-0 flex-1 flex-col ${!isAuthed() ? 'pointer-events-none blur-sm grayscale opacity-50' : ''}`}>
              <div class="flex-none px-4 pt-4">
                <div class="space-y-3">
                  <Show when={ping.isError}>
                    <Banner
                      variant="danger"
                      title="Backend offline"
                      message={`Last ok: ${formatRelativeTime(lastBackendOkAtUnixMs())}.`}
                      actions={
                        <Button
                          size="xs"
                          variant="secondary"
                          onClick={() => void queryClient.invalidateQueries({ queryKey: ['control.ping', null] })}
                        >
                          Retry
                        </Button>
                      }
                    />
                  </Show>
                  <Show when={agentHealth.isError}>
                    <Banner
                      variant="danger"
                      title="Agent unreachable"
                      message={`Last ok: ${formatRelativeTime(lastAgentOkAtUnixMs())}.`}
                      actions={
                        <Button
                          size="xs"
                          variant="secondary"
                          onClick={() => void queryClient.invalidateQueries({ queryKey: ['agent.health', null] })}
                        >
                          Retry
                        </Button>
                      }
                    />
                  </Show>
                  <Show when={isReadOnly()}>
                    <Banner
                      variant="warning"
                      title="Read-only mode"
                      message="Instance actions and filesystem writes are disabled."
                      actions={
                        <Button size="xs" variant="secondary" onClick={() => setShowDiagnosticsModal(true)}>
                          Details
                        </Button>
                      }
                    />
                  </Show>
                  <Show when={!fsWriteEnabled() && tab() === 'files'}>
                    <Banner
                      variant="info"
                      title="Read-only filesystem"
                      message="Enable with ALLOY_FS_WRITE_ENABLED=true."
                      actions={
                        <div class="flex flex-wrap items-center gap-2">
                          <Button size="xs" variant="secondary" onClick={() => setShowDiagnosticsModal(true)}>
                            Details
                          </Button>
                          <IconButton
                            size="sm"
                            variant="secondary"
                            label="Copy env var"
                            onClick={() => {
                              void safeCopy('ALLOY_FS_WRITE_ENABLED=true')
                              pushToast('success', 'Copied', 'ALLOY_FS_WRITE_ENABLED=true')
                            }}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                              <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
                              <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
                            </svg>
                          </IconButton>
                        </div>
                      }
                    />
                  </Show>
                </div>
              </div>

              <div class="flex min-h-0 flex-1">
              <InstancesTab
          createAdvanced={createAdvanced}
          createAdvancedDirty={createAdvancedDirty}
          createFieldErrors={createFieldErrors}
          createFormError={createFormError}
          createInstance={createInstance}
          createPreview={createPreview}
          createTemplateId={createTemplateId}
          dspAutoPauseEnabled={dspAutoPauseEnabled}
          dspPort={dspPort}
          dspRemoteAccessPassword={dspRemoteAccessPassword}
          dspRemoteAccessPasswordVisible={dspRemoteAccessPasswordVisible}
          dspSaveName={dspSaveName}
          dspServerPassword={dspServerPassword}
          dspServerPasswordVisible={dspServerPasswordVisible}
          dspSourceInitRequired={dspSourceInitRequired}
          dspStartupMode={dspStartupMode}
          dspSteamGuardCode={dspSteamGuardCode}
          dspSteamcmdSettingsRequiredMessage={dspSteamcmdSettingsRequiredMessage}
          dspUps={dspUps}
          dspWarmNeedsInit={dspWarmNeedsInit}
          dspWineBin={dspWineBin}
          dstAuthPort={dstAuthPort}
          dstClusterName={dstClusterName}
          dstClusterToken={dstClusterToken}
          dstClusterTokenVisible={dstClusterTokenVisible}
          dstMasterPort={dstMasterPort}
          dstMaxPlayers={dstMaxPlayers}
          dstPassword={dstPassword}
          dstPasswordVisible={dstPasswordVisible}
          dstPort={dstPort}
          filteredInstances={filteredInstances}
          focusFirstCreateError={focusFirstCreateError}
          friendlyErrorMessage={friendlyErrorMessage}
          frpNodeDropdownOptions={frpNodeDropdownOptions}
          hasSavedSteamcmdCreds={hasSavedSteamcmdCreds}
          highlightInstanceId={highlightInstanceId}
          instanceCardEls={instanceCardEls}
          instanceCompact={instanceCompact}
          instanceDisplayName={instanceDisplayName}
          instanceName={instanceName}
          instanceOpById={instanceOpById}
          instanceSearchInput={instanceSearchInput}
          instanceSortKey={instanceSortKey}
          instanceSortOptions={instanceSortOptions}
          instanceStatusFilter={instanceStatusFilter}
          instanceStatusFilterOptions={instanceStatusFilterOptions}
          instanceStatusKeys={instanceStatusKeys}
          instanceTemplateFilter={instanceTemplateFilter}
          instanceTemplateFilterOptions={instanceTemplateFilterOptions}
          instances={instances}
          instancesLastUpdatedAtUnixMs={instancesLastUpdatedAtUnixMs}
          invalidateInstances={invalidateInstances}
          isReadOnly={isReadOnly}
          mcCreateMode={mcCreateMode}
          mcCurseforge={mcCurseforge}
          mcEffectiveFrpConfig={mcEffectiveFrpConfig}
          mcEula={mcEula}
          mcFrpConfig={mcFrpConfig}
          mcFrpEnabled={mcFrpEnabled}
          mcFrpMode={mcFrpMode}
          mcFrpNodeId={mcFrpNodeId}
          mcImportPack={mcImportPack}
          mcMemory={mcMemory}
          mcMrpack={mcMrpack}
          mcPort={mcPort}
          mcVersion={mcVersion}
          mcVersionOptions={mcVersionOptions}
          me={me}
          minecraftCreateModeOptions={minecraftCreateModeOptions}
          openEditModal={openEditModal}
          openFileInFiles={openFileInFiles}
          openInFiles={openInFiles}
          pinnedInstanceIds={pinnedInstanceIds}
          pushToast={pushToast}
          restartInstance={restartInstance}
          revealInstance={revealInstance}
          runDspInitAndMaybeCreate={runDspInitAndMaybeCreate}
          runInstanceOp={runInstanceOp}
          selectedInstanceId={selectedInstanceId}
          selectedTemplate={selectedTemplate}
          setConfirmDeleteInstanceId={setConfirmDeleteInstanceId}
          setCreateAdvanced={setCreateAdvanced}
          setCreateDspPortEl={(el: HTMLInputElement) => {
            createDspPortEl = el
          }}
          setCreateDspRemoteAccessPasswordEl={(el: HTMLInputElement) => {
            createDspRemoteAccessPasswordEl = el
          }}
          setCreateDspSaveNameEl={(el: HTMLInputElement) => {
            createDspSaveNameEl = el
          }}
          setCreateDspServerPasswordEl={(el: HTMLInputElement) => {
            createDspServerPasswordEl = el
          }}
          setCreateDspStartupModeEl={(el: HTMLDivElement) => {
            createDspStartupModeEl = el
          }}
          setCreateDspUpsEl={(el: HTMLInputElement) => {
            createDspUpsEl = el
          }}
          setCreateDspWineBinEl={(el: HTMLInputElement) => {
            createDspWineBinEl = el
          }}
          setCreateDstAuthPortEl={(el: HTMLInputElement) => {
            createDstAuthPortEl = el
          }}
          setCreateDstClusterNameEl={(el: HTMLInputElement) => {
            createDstClusterNameEl = el
          }}
          setCreateDstClusterTokenEl={(el: HTMLInputElement) => {
            createDstClusterTokenEl = el
          }}
          setCreateDstMasterPortEl={(el: HTMLInputElement) => {
            createDstMasterPortEl = el
          }}
          setCreateDstMaxPlayersEl={(el: HTMLInputElement) => {
            createDstMaxPlayersEl = el
          }}
          setCreateDstPasswordEl={(el: HTMLInputElement) => {
            createDstPasswordEl = el
          }}
          setCreateDstPortEl={(el: HTMLInputElement) => {
            createDstPortEl = el
          }}
          setCreateFieldErrors={setCreateFieldErrors}
          setCreateFormError={setCreateFormError}
          setCreateInstanceNameEl={(el: HTMLInputElement) => {
            createInstanceNameEl = el
          }}
          setCreateMcCurseforgeEl={(el: HTMLInputElement) => {
            createMcCurseforgeEl = el
          }}
          setCreateMcEulaEl={(el: HTMLInputElement) => {
            createMcEulaEl = el
          }}
          setCreateMcFrpConfigEl={(el: HTMLTextAreaElement) => {
            createMcFrpConfigEl = el
          }}
          setCreateMcFrpNodeEl={(el: HTMLDivElement) => {
            createMcFrpNodeEl = el
          }}
          setCreateMcImportPackEl={(el: HTMLInputElement) => {
            createMcImportPackEl = el
          }}
          setCreateMcMemoryEl={(el: HTMLInputElement) => {
            createMcMemoryEl = el
          }}
          setCreateMcMrpackEl={(el: HTMLInputElement) => {
            createMcMrpackEl = el
          }}
          setCreateMcPortEl={(el: HTMLInputElement) => {
            createMcPortEl = el
          }}
          setCreateSleepSecondsEl={(el: HTMLInputElement) => {
            createSleepSecondsEl = el
          }}
          setCreateTrFrpConfigEl={(el: HTMLTextAreaElement) => {
            createTrFrpConfigEl = el
          }}
          setCreateTrFrpNodeEl={(el: HTMLDivElement) => {
            createTrFrpNodeEl = el
          }}
          setCreateTrMaxPlayersEl={(el: HTMLInputElement) => {
            createTrMaxPlayersEl = el
          }}
          setCreateTrPasswordEl={(el: HTMLInputElement) => {
            createTrPasswordEl = el
          }}
          setCreateTrPortEl={(el: HTMLInputElement) => {
            createTrPortEl = el
          }}
          setCreateTrWorldNameEl={(el: HTMLInputElement) => {
            createTrWorldNameEl = el
          }}
          setCreateTrWorldSizeEl={(el: HTMLInputElement) => {
            createTrWorldSizeEl = el
          }}
          setDspAutoPauseEnabled={setDspAutoPauseEnabled}
          setDspPort={setDspPort}
          setDspRemoteAccessPassword={setDspRemoteAccessPassword}
          setDspRemoteAccessPasswordVisible={setDspRemoteAccessPasswordVisible}
          setDspSaveName={setDspSaveName}
          setDspServerPassword={setDspServerPassword}
          setDspServerPasswordVisible={setDspServerPasswordVisible}
          setDspStartupMode={setDspStartupMode}
          setDspSteamGuardCode={setDspSteamGuardCode}
          setDspUps={setDspUps}
          setDspWarmNeedsInit={setDspWarmNeedsInit}
          setDspWineBin={setDspWineBin}
          setDstAuthPort={setDstAuthPort}
          setDstClusterName={setDstClusterName}
          setDstClusterToken={setDstClusterToken}
          setDstClusterTokenVisible={setDstClusterTokenVisible}
          setDstMasterPort={setDstMasterPort}
          setDstMaxPlayers={setDstMaxPlayers}
          setDstPassword={setDstPassword}
          setDstPasswordVisible={setDstPasswordVisible}
          setDstPort={setDstPort}
          setInstanceDetailTab={setInstanceDetailTab}
          setInstanceName={setInstanceName}
          setInstanceSearch={setInstanceSearch}
          setInstanceSearchInput={setInstanceSearchInput}
          setInstanceSortKey={setInstanceSortKey}
          setInstanceStatusFilter={setInstanceStatusFilter}
          setInstanceTemplateFilter={setInstanceTemplateFilter}
          setMcCreateMode={setMcCreateMode}
          setMcCurseforge={setMcCurseforge}
          setMcEula={setMcEula}
          setMcFrpConfig={setMcFrpConfig}
          setMcFrpEnabled={setMcFrpEnabled}
          setMcFrpMode={setMcFrpMode}
          setMcFrpNodeId={setMcFrpNodeId}
          setMcImportPack={setMcImportPack}
          setMcMemory={setMcMemory}
          setMcMrpack={setMcMrpack}
          setMcPort={setMcPort}
          setMcVersion={setMcVersion}
          setPendingCreateAfterDspInit={setPendingCreateAfterDspInit}
          setSelectedInstanceId={setSelectedInstanceId}
          setSelectedTemplate={setSelectedTemplate}
          setShowDspInitModal={setShowDspInitModal}
          setShowInstanceModal={setShowInstanceModal}
          setSleepSeconds={setSleepSeconds}
          setTab={setTab}
          setTrFrpConfig={setTrFrpConfig}
          setTrFrpEnabled={setTrFrpEnabled}
          setTrFrpMode={setTrFrpMode}
          setTrFrpNodeId={setTrFrpNodeId}
          setTrMaxPlayers={setTrMaxPlayers}
          setTrPassword={setTrPassword}
          setTrPasswordVisible={setTrPasswordVisible}
          setTrPort={setTrPort}
          setTrVersion={setTrVersion}
          setTrWorldName={setTrWorldName}
          setTrWorldSize={setTrWorldSize}
          setWarmFieldErrors={setWarmFieldErrors}
          setWarmFormError={setWarmFormError}
          settingsStatus={settingsStatus}
          sleepSeconds={sleepSeconds}
          startInstance={startInstance}
          stopInstance={stopInstance}
          tab={tab}
          templateOptions={templateOptions}
          templates={templates}
          toastError={toastError}
          togglePinnedInstance={togglePinnedInstance}
          trEffectiveFrpConfig={trEffectiveFrpConfig}
          trFrpConfig={trFrpConfig}
          trFrpEnabled={trFrpEnabled}
          trFrpMode={trFrpMode}
          trFrpNodeId={trFrpNodeId}
          trMaxPlayers={trMaxPlayers}
          trPassword={trPassword}
          trPasswordVisible={trPasswordVisible}
          trPort={trPort}
          trVersion={trVersion}
          trVersionOptions={trVersionOptions}
          trWorldName={trWorldName}
          trWorldSize={trWorldSize}
          warmCache={warmCache}
              />
              <DownloadsTab
                tab={tab}
                hasRunningDownloadJobs={hasRunningDownloadJobs}
                downloadQueuePaused={downloadQueuePaused}
                downloadJobs={downloadJobs}
                downloadCenterView={downloadCenterView}
                setDownloadCenterView={setDownloadCenterView}
                toggleDownloadQueuePaused={toggleDownloadQueuePaused}
                clearDownloadHistory={clearDownloadHistory}
                moveDownloadJob={moveDownloadJob}
                pauseDownloadJob={pauseDownloadJob}
                resumeDownloadJob={resumeDownloadJob}
                cancelDownloadJob={cancelDownloadJob}
                retryDownloadJob={retryDownloadJob}
                setSelectedDownloadJobId={setSelectedDownloadJobId}
                enqueueDownloadWarm={enqueueDownloadWarm}
                downloadInstalledRows={downloadInstalledRows}
                downloadUpdateRows={downloadUpdateRows}
                downloadNowUnixMs={downloadNowUnixMs}
                isReadOnly={isReadOnly}
                downloadEnqueueTarget={downloadEnqueueTarget}
                downloadStatus={downloadStatus}
                controlDiagnostics={controlDiagnostics}
                downloadMcVersion={downloadMcVersion}
                setDownloadMcVersion={setDownloadMcVersion}
                mcVersionOptions={mcVersionOptions}
                downloadTrVersion={downloadTrVersion}
                setDownloadTrVersion={setDownloadTrVersion}
                trVersionOptions={trVersionOptions}
                downloadDspGuardCode={downloadDspGuardCode}
                setDownloadDspGuardCode={setDownloadDspGuardCode}
                hasSavedSteamcmdCreds={hasSavedSteamcmdCreds}
                setTab={setTab}
                downloadQueueEnqueue={downloadQueueEnqueue}
              />

              <Show when={tab() === 'files'}>
                <FileBrowser
                  enabled={isAuthed() && tab() === 'files'}
                  title="Files"
                  initialPath={fsPath()}
                  initialSelectedFile={selectedFilePath()}
                  rootLabel="/data"
                />
              </Show>

              <FrpTab
                tab={tab}
                frpNodes={frpNodes}
                isAuthed={isAuthed}
                isReadOnly={isReadOnly}
                openCreateFrpNodeModal={openCreateFrpNodeModal}
                openEditFrpNodeModal={openEditFrpNodeModal}
                frpDeleteNode={frpDeleteNode}
                invalidateFrpNodes={invalidateFrpNodes}
                pushToast={pushToast}
                toastError={toastError}
              />
              <SettingsTab
                tab={tab}
                settingsStatus={settingsStatus}
                me={me}
                settingsDstKeyVisible={settingsDstKeyVisible}
                settingsDstKey={settingsDstKey}
                setSettingsDstKey={setSettingsDstKey}
                setSettingsDstKeyVisible={setSettingsDstKeyVisible}
                setDstDefaultKleiKey={setDstDefaultKleiKey}
                isReadOnly={isReadOnly}
                pushToast={pushToast}
                toastError={toastError}
                settingsCurseforgeKeyVisible={settingsCurseforgeKeyVisible}
                settingsCurseforgeKey={settingsCurseforgeKey}
                setSettingsCurseforgeKey={setSettingsCurseforgeKey}
                setSettingsCurseforgeKeyVisible={setSettingsCurseforgeKeyVisible}
                setCurseforgeApiKey={setCurseforgeApiKey}
                settingsSteamcmdUsername={settingsSteamcmdUsername}
                setSettingsSteamcmdUsername={setSettingsSteamcmdUsername}
                settingsSteamcmdPasswordVisible={settingsSteamcmdPasswordVisible}
                settingsSteamcmdPassword={settingsSteamcmdPassword}
                setSettingsSteamcmdPassword={setSettingsSteamcmdPassword}
                setSettingsSteamcmdPasswordVisible={setSettingsSteamcmdPasswordVisible}
                settingsSteamcmdGuardCode={settingsSteamcmdGuardCode}
                setSettingsSteamcmdGuardCode={setSettingsSteamcmdGuardCode}
                settingsSteamcmdMaFile={settingsSteamcmdMaFile}
                setSettingsSteamcmdMaFile={setSettingsSteamcmdMaFile}
                setSteamcmdCredentials={setSteamcmdCredentials}
                updateCheck={updateCheck}
                triggerUpdate={triggerUpdate}
                controlDiagnostics={controlDiagnostics}
              />
              <NodesTab
                tab={tab}
                me={me}
                openCreateNode={openCreateNode}
                nodesLastUpdatedAtUnixMs={nodesLastUpdatedAtUnixMs}
                nodes={nodes}
                invalidateNodes={invalidateNodes}
                selectedNodeId={selectedNodeId}
                setSelectedNodeId={setSelectedNodeId}
                selectedNode={selectedNode}
                setNodeEnabled={setNodeEnabled}
                nodeEnabledOverride={nodeEnabledOverride}
                setNodeEnabledOverride={setNodeEnabledOverride}
              />
              </div>
            </div>
          </main>

        </div>
      </div>


        {/* Legacy UI below the new console layout was accidentally left in place.
            Keep return() to the new layout + modals only. */}

        <DownloadTaskModal
          selectedDownloadJobId={selectedDownloadJobId}
          setSelectedDownloadJobId={setSelectedDownloadJobId}
          selectedDownloadJob={selectedDownloadJob}
          latestDownloadFailureByTarget={latestDownloadFailureByTarget}
          copyDownloadJobDetails={copyDownloadJobDetails}
          copyDownloadFailureReason={copyDownloadFailureReason}
        />

        <DspInitModal
          showDspInitModal={showDspInitModal}
          closeDspInitModal={closeDspInitModal}
          warmCache={warmCache}
          createInstance={createInstance}
          pendingCreateAfterDspInit={pendingCreateAfterDspInit}
          runDspInitAndMaybeCreate={runDspInitAndMaybeCreate}
          warmFieldErrors={warmFieldErrors}
          dspSteamGuardCode={dspSteamGuardCode}
          setDspSteamGuardCode={setDspSteamGuardCode}
          warmFormError={warmFormError}
        />

        <LoginModal
          showLoginModal={showLoginModal}
          me={me}
          setShowLoginModal={setShowLoginModal}
          authLoading={authLoading}
          authError={authError}
          setAuthError={setAuthError}
          setAuthLoading={setAuthLoading}
          loginUser={loginUser}
          setLoginUser={setLoginUser}
          loginPass={loginPass}
          setLoginPass={setLoginPass}
          refreshSession={refreshSession}
          setLoginUsernameEl={(el: HTMLInputElement) => {
            loginUsernameEl = el
          }}
        />


        <AddNodeModal
          showCreateNodeModal={showCreateNodeModal}
          closeCreateNode={closeCreateNode}
          createNodeResult={createNodeResult}
          createNode={createNode}
          createNodeName={createNodeName}
          setCreateNodeName={setCreateNodeName}
          createNodeFieldErrors={createNodeFieldErrors}
          setCreateNodeFieldErrors={setCreateNodeFieldErrors}
          createNodeFormError={createNodeFormError}
          setCreateNodeFormError={setCreateNodeFormError}
          createNodeControlWsUrl={createNodeControlWsUrl}
          setCreateNodeControlWsUrl={setCreateNodeControlWsUrl}
          setCreateNodeResult={setCreateNodeResult}
          pushToast={pushToast}
          invalidateNodes={invalidateNodes}
          setSelectedNodeId={setSelectedNodeId}
          createNodeComposeYaml={createNodeComposeYaml}
        />

        <FrpNodeModal
          showFrpNodeModal={showFrpNodeModal}
          closeFrpNodeModal={closeFrpNodeModal}
          editingFrpNodeId={editingFrpNodeId}
          frpCreateNode={frpCreateNode}
          frpUpdateNode={frpUpdateNode}
          isReadOnly={isReadOnly}
          frpNodeCanSave={frpNodeCanSave}
          frpNodeFieldErrors={frpNodeFieldErrors}
          setFrpNodeFieldErrors={setFrpNodeFieldErrors}
          frpNodeFormError={frpNodeFormError}
          setFrpNodeFormError={setFrpNodeFormError}
          frpNodeName={frpNodeName}
          setFrpNodeName={setFrpNodeName}
          frpNodeServerAddr={frpNodeServerAddr}
          setFrpNodeServerAddr={setFrpNodeServerAddr}
          frpNodeServerPort={frpNodeServerPort}
          setFrpNodeServerPort={setFrpNodeServerPort}
          frpNodeAllocatablePorts={frpNodeAllocatablePorts}
          setFrpNodeAllocatablePorts={setFrpNodeAllocatablePorts}
          frpNodeToken={frpNodeToken}
          setFrpNodeToken={setFrpNodeToken}
          frpNodeTokenVisible={frpNodeTokenVisible}
          setFrpNodeTokenVisible={setFrpNodeTokenVisible}
          frpNodeConfig={frpNodeConfig}
          setFrpNodeConfig={setFrpNodeConfig}
          frpNodeDetectedFormat={frpNodeDetectedFormat}
          invalidateFrpNodes={invalidateFrpNodes}
          pushToast={pushToast}
        />

        <DeleteInstanceModal
          confirmDeleteInstanceId={confirmDeleteInstanceId}
          setConfirmDeleteInstanceId={setConfirmDeleteInstanceId}
          deleteInstance={deleteInstance}
          confirmDeleteText={confirmDeleteText}
          selectedInstanceId={selectedInstanceId}
          setSelectedInstanceId={setSelectedInstanceId}
          pushToast={pushToast}
          invalidateInstances={invalidateInstances}
          toastError={toastError}
          instanceDeletePreview={instanceDeletePreview}
          setConfirmDeleteText={setConfirmDeleteText}
        />


        <EditInstanceModal
          editingInstanceId={editingInstanceId}
          editBase={editBase}
          closeEditModal={closeEditModal}
          setEditDisplayNameEl={(el: HTMLInputElement) => {
            editDisplayNameEl = el
          }}
          setEditSleepSecondsEl={(el: HTMLInputElement) => {
            editSleepSecondsEl = el
          }}
          setEditMcMemoryEl={(el: HTMLInputElement) => {
            editMcMemoryEl = el
          }}
          setEditMcPortEl={(el: HTMLInputElement) => {
            editMcPortEl = el
          }}
          setEditMcFrpNodeEl={(el: HTMLDivElement) => {
            editMcFrpNodeEl = el
          }}
          setEditMcFrpConfigEl={(el: HTMLTextAreaElement) => {
            editMcFrpConfigEl = el
          }}
          setEditTrMaxPlayersEl={(el: HTMLInputElement) => {
            editTrMaxPlayersEl = el
          }}
          setEditTrWorldNameEl={(el: HTMLInputElement) => {
            editTrWorldNameEl = el
          }}
          setEditTrPortEl={(el: HTMLInputElement) => {
            editTrPortEl = el
          }}
          setEditTrWorldSizeEl={(el: HTMLInputElement) => {
            editTrWorldSizeEl = el
          }}
          setEditTrPasswordEl={(el: HTMLInputElement) => {
            editTrPasswordEl = el
          }}
          setEditTrFrpNodeEl={(el: HTMLDivElement) => {
            editTrFrpNodeEl = el
          }}
          setEditTrFrpConfigEl={(el: HTMLTextAreaElement) => {
            editTrFrpConfigEl = el
          }}
          setEditDisplayName={setEditDisplayName}
          editDisplayName={editDisplayName}
          editTemplateId={editTemplateId}
          editSleepSeconds={editSleepSeconds}
          setEditSleepSeconds={setEditSleepSeconds}
          editFieldErrors={editFieldErrors}
          editFormError={editFormError}
          setEditFieldErrors={setEditFieldErrors}
          setEditFormError={setEditFormError}
          updateInstance={updateInstance}
          editOutgoingParams={editOutgoingParams}
          invalidateInstances={invalidateInstances}
          revealInstance={revealInstance}
          pushToast={pushToast}
          focusFirstEditError={focusFirstEditError}
          friendlyErrorMessage={friendlyErrorMessage}
          editAdvanced={editAdvanced}
          setEditAdvanced={setEditAdvanced}
          editAdvancedDirty={editAdvancedDirty}
          editHasChanges={editHasChanges}
          editChangedKeys={editChangedKeys}
          editRisk={editRisk}
          safeCopy={safeCopy}
          setTab={setTab}
          editMcVersion={editMcVersion}
          setEditMcVersion={setEditMcVersion}
          mcVersionOptions={mcVersionOptions}
          optionsWithCurrentValue={optionsWithCurrentValue}
          editMcMemory={editMcMemory}
          setEditMcMemory={setEditMcMemory}
          editMcPort={editMcPort}
          setEditMcPort={setEditMcPort}
          editMcFrpEnabled={editMcFrpEnabled}
          setEditMcFrpEnabled={setEditMcFrpEnabled}
          setEditMcFrpMode={setEditMcFrpMode}
          setEditMcFrpNodeId={setEditMcFrpNodeId}
          editMcFrpMode={editMcFrpMode}
          editMcFrpNodeId={editMcFrpNodeId}
          frpNodeDropdownOptions={frpNodeDropdownOptions}
          editMcFrpConfig={editMcFrpConfig}
          setEditMcFrpConfig={setEditMcFrpConfig}
          editTrVersion={editTrVersion}
          setEditTrVersion={setEditTrVersion}
          trVersionOptions={trVersionOptions}
          editTrMaxPlayers={editTrMaxPlayers}
          setEditTrMaxPlayers={setEditTrMaxPlayers}
          editTrWorldName={editTrWorldName}
          setEditTrWorldName={setEditTrWorldName}
          editTrPort={editTrPort}
          setEditTrPort={setEditTrPort}
          editTrWorldSize={editTrWorldSize}
          setEditTrWorldSize={setEditTrWorldSize}
          editTrPasswordVisible={editTrPasswordVisible}
          setEditTrPasswordVisible={setEditTrPasswordVisible}
          editTrPassword={editTrPassword}
          setEditTrPassword={setEditTrPassword}
          editTrFrpEnabled={editTrFrpEnabled}
          setEditTrFrpEnabled={setEditTrFrpEnabled}
          setEditTrFrpMode={setEditTrFrpMode}
          setEditTrFrpNodeId={setEditTrFrpNodeId}
          editTrFrpMode={editTrFrpMode}
          editTrFrpNodeId={editTrFrpNodeId}
          editTrFrpConfig={editTrFrpConfig}
          setEditTrFrpConfig={setEditTrFrpConfig}
          frpNodeConfigById={frpNodeConfigById}
        />

        <ControlDiagnosticsModal
          showDiagnosticsModal={showDiagnosticsModal}
          setShowDiagnosticsModal={setShowDiagnosticsModal}
          controlDiagnostics={controlDiagnostics}
          pushToast={pushToast}
          clearCache={clearCache}
          cacheSelection={cacheSelection}
          setCacheSelection={setCacheSelection}
          toastError={toastError}
        />



        <InstanceDetailsModal
          showInstanceModal={showInstanceModal}
          selectedInstanceId={selectedInstanceId}
          setShowInstanceModal={setShowInstanceModal}
          selectedInstanceDisplayName={selectedInstanceDisplayName}
          selectedInstance={selectedInstance}
          instanceDisplayName={instanceDisplayName}
          pushToast={pushToast}
          instanceDiagnostics={instanceDiagnostics}
          processLogLines={processLogLines}
          toastError={toastError}
          instanceOpById={instanceOpById}
          isReadOnly={isReadOnly}
          runInstanceOp={runInstanceOp}
          stopInstance={stopInstance}
          invalidateInstances={invalidateInstances}
          startInstance={startInstance}
          restartInstance={restartInstance}
          openEditModal={openEditModal}
          setConfirmDeleteInstanceId={setConfirmDeleteInstanceId}
          instanceDetailTab={instanceDetailTab}
          setInstanceDetailTab={setInstanceDetailTab}
          selectedInstanceMessage={selectedInstanceMessage}
          importSaveUrl={importSaveUrl}
          setImportSaveUrl={setImportSaveUrl}
          importSaveFromUrl={importSaveFromUrl}
          processLogsTail={processLogsTail}
          processLogLive={processLogLive}
          setProcessLogLive={setProcessLogLive}
          setProcessLogLines={setProcessLogLines}
          isAuthed={isAuthed}
        />

        <ToastPortal toasts={toasts} setToasts={setToasts} />

    </div>
  )
}

export default App
