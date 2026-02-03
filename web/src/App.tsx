import { isAlloyApiError, onAuthEvent, queryClient, rspc } from './rspc'
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { ProcessStatusDto } from './bindings'
import { ensureCsrfCookie, login, logout, whoami } from './auth'
import { Dropdown } from './components/Dropdown'
import InstancesPage from './pages/InstancesPage'
import FilesPage from './pages/FilesPage'
import NodesPage from './pages/NodesPage'

function statusDotClass(state: { loading: boolean; error: boolean }) {
  if (state.loading) return 'bg-slate-600 animate-pulse'
  if (state.error) return 'bg-rose-500'
  return 'bg-emerald-400'
}

const AGENT_ERROR_PREFIX = 'ALLOY_ERROR_JSON:'
type AgentErrorPayload = {
  code: string
  message: string
  field_errors?: Record<string, string> | null
  hint?: string | null
}

function parseAgentErrorPayload(raw: string | null | undefined): AgentErrorPayload | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s.startsWith(AGENT_ERROR_PREFIX)) return null
  try {
    const parsed = JSON.parse(s.slice(AGENT_ERROR_PREFIX.length)) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const p = parsed as Record<string, unknown>
    if (typeof p.code !== 'string' || typeof p.message !== 'string') return null
    return {
      code: p.code,
      message: p.message,
      field_errors: typeof p.field_errors === 'object' ? (p.field_errors as Record<string, string>) : null,
      hint: typeof p.hint === 'string' ? p.hint : null,
    }
  } catch {
    return null
  }
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—'
  const sign = bytes < 0 ? '-' : ''
  let v = Math.abs(bytes)
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const decimals = i === 0 ? 0 : v >= 10 ? 1 : 2
  return `${sign}${v.toFixed(decimals)}${units[i]}`
}

function parseU64(s: string | null | undefined): number | null {
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return n
}

function formatCpuPercent(cpuX100: number | null | undefined): string {
  if (cpuX100 == null || !Number.isFinite(cpuX100)) return '—'
  const pct = cpuX100 / 100
  if (pct >= 10) return `${pct.toFixed(1)}%`
  if (pct >= 1) return `${pct.toFixed(2)}%`
  return `${pct.toFixed(2)}%`
}

function formatRelativeTime(unixMs: number | null | undefined): string {
  if (!unixMs || !Number.isFinite(unixMs) || unixMs <= 0) return '—'
  const deltaMs = Date.now() - unixMs
  const sec = Math.floor(deltaMs / 1000)
  if (sec < 10) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 48) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

function StatusPill(props: {
  label: string
  status: string
  state: { loading: boolean; error: boolean }
}) {
  return (
    <div class="flex items-center gap-2 rounded-full border border-slate-200 bg-white/60 px-2.5 py-1 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/60">
      <span class={`h-1.5 w-1.5 rounded-full ${statusDotClass(props.state)}`} />
      <span class="font-display text-[11px] tracking-wide text-slate-600 dark:text-slate-300">{props.label}</span>
      <span class="font-mono text-[11px] text-slate-500">{props.status}</span>
    </div>
  )
}

function instanceStateLabel(status: ProcessStatusDto | null) {
  if (!status) return 'Stopped'
  switch (status.state) {
    case 'PROCESS_STATE_STARTING':
      return 'Starting'
    case 'PROCESS_STATE_RUNNING':
      return 'Running'
    case 'PROCESS_STATE_STOPPING':
      return 'Stopping'
    case 'PROCESS_STATE_EXITED':
      return 'Stopped'
    case 'PROCESS_STATE_FAILED':
      return 'Failed'
    default:
      return status.state
  }
}

function canStartInstance(status: ProcessStatusDto | null) {
  if (!status) return true
  return status.state === 'PROCESS_STATE_EXITED' || status.state === 'PROCESS_STATE_FAILED'
}

function isStopping(status: ProcessStatusDto | null) {
  return status?.state === 'PROCESS_STATE_STOPPING'
}

async function safeCopy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // ignore clipboard errors
  }
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function statusMessageParts(status: ProcessStatusDto | null): { text: string | null; code: string | null; hint: string | null } {
  const raw = status?.message ?? null
  const payload = parseAgentErrorPayload(raw)
  if (payload) return { text: payload.message, code: payload.code, hint: payload.hint ?? null }
  return { text: raw, code: null, hint: null }
}

function defaultPortForTemplate(templateId: string): number | null {
  if (templateId === 'minecraft:vanilla') return 25565
  if (templateId === 'terraria:vanilla') return 7777
  return null
}

function parsePort(value: unknown): number | null {
  if (value == null) return null
  const n = Number.parseInt(String(value), 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function instancePort(info: { config: { template_id: string; params: unknown } }): number | null {
  const params = info.config.params as Record<string, unknown> | null | undefined
  return parsePort(params?.port) ?? defaultPortForTemplate(info.config.template_id)
}

function connectHost() {
  try {
    return window.location.hostname || 'localhost'
  } catch {
    return 'localhost'
  }
}

type UiTab = 'instances' | 'files' | 'nodes'

type ToastVariant = 'info' | 'success' | 'error'
type Toast = {
  id: string
  variant: ToastVariant
  title: string
  message?: string
  requestId?: string
}

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
  const [toasts, setToasts] = createSignal<Toast[]>([])
  const [showAccountMenu, setShowAccountMenu] = createSignal(false)
  // Account menu uses a fixed overlay; refs are not needed.

  const [focusLoginUsername, setFocusLoginUsername] = createSignal(false)
  let loginUsernameEl: HTMLInputElement | undefined

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

  function toastError(title: string, err: unknown) {
    if (isAlloyApiError(err)) {
      pushToast('error', title, err.data.message, err.data.request_id)
      return
    }
    pushToast('error', title, err instanceof Error ? err.message : 'unknown error')
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

  const templates = rspc.createQuery(
    () => ['process.templates', null],
    () => ({ enabled: isAuthed() }),
  )

  const templateOptions = createMemo(() =>
    (templates.data ?? []).map((t: { template_id: string; display_name: string }) => ({
      value: t.template_id,
      label: t.display_name,
      meta: t.template_id,
    })),
  )

  createEffect(() => {
    const opts = templateOptions()
    if (!opts.length) return
    if (!opts.some((o: { value: string }) => o.value === selectedTemplate())) {
      setSelectedTemplate(opts[0].value)
    }
  })

  const [instancesPollMs, setInstancesPollMs] = createSignal<number | false>(false)
  const [instancesPollErrorStreak, setInstancesPollErrorStreak] = createSignal(0)
  const instances = rspc.createQuery(
    () => ['instance.list', null],
    () => ({ enabled: isAuthed(), refetchInterval: instancesPollMs(), refetchOnWindowFocus: false }),
  )

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

    const nextStreak = instances.isError ? Math.min(instancesPollErrorStreak() + 1, 6) : 0
    setInstancesPollErrorStreak(nextStreak)
    const backoff = Math.min(base * Math.pow(2, nextStreak), 30_000)

    // Add a small jitter to avoid thundering herd.
    const jitter = Math.floor(Math.random() * 200)
    setInstancesPollMs(backoff + jitter)
  })

  async function invalidateInstances() {
    await queryClient.invalidateQueries({ queryKey: ['instance.list', null] })
  }

  function closeEditModal() {
    setEditingInstanceId(null)
    setEditBase(null)
    setEditFormError(null)
    setEditFieldErrors({})
    setEditTrPasswordVisible(false)
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

    setEditDisplayName(base.display_name ?? '')

    if (base.template_id === 'demo:sleep') {
      setEditSleepSeconds(params.seconds ?? '60')
    }

    if (base.template_id === 'minecraft:vanilla') {
      const v = (params.version ?? 'latest_release').trim() || 'latest_release'
      const known = mcVersionOptions().some((o) => o.value === v)
      setEditMcVersion(v)
      setEditMcVersionAdvanced(!known && v !== 'latest_release' && v !== 'latest_snapshot')
      setEditMcVersionCustom(!known && v !== 'latest_release' && v !== 'latest_snapshot' ? v : '')

      const mem = (params.memory_mb ?? '2048').trim() || '2048'
      const preset = mcMemoryOptions().some((o) => o.value === mem) ? mem : 'custom'
      setEditMcMemoryPreset(preset)
      setEditMcMemory(mem)

      setEditMcPort((params.port ?? '').trim())
    }

    if (base.template_id === 'terraria:vanilla') {
      const v = (params.version ?? '1453').trim() || '1453'
      const known = ['1453', '1452', '1451', '1450', '1449', '1448', '1447', '1436', '1435', '1434', '1423'].includes(v)
      setEditTrVersion(v)
      setEditTrVersionAdvanced(!known)
      setEditTrVersionCustom(!known ? v : '')

      setEditTrPort((params.port ?? '').trim())
      setEditTrMaxPlayers((params.max_players ?? '8').trim() || '8')
      setEditTrWorldName((params.world_name ?? 'world').trim() || 'world')
      setEditTrWorldSize((params.world_size ?? '1').trim() || '1')
      setEditTrPassword(params.password ?? '')
      setEditTrPasswordVisible(false)
    }
  }

  const createInstance = rspc.createMutation(() => 'instance.create')
  const updateInstance = rspc.createMutation(() => 'instance.update')
  const startInstance = rspc.createMutation(() => 'instance.start')
  const restartInstance = rspc.createMutation(() => 'instance.restart')
  const stopInstance = rspc.createMutation(() => 'instance.stop')
  const deleteInstance = rspc.createMutation(() => 'instance.delete')
  const instanceDiagnostics = rspc.createMutation(() => 'instance.diagnostics')
  const controlDiagnostics = rspc.createQuery(
    () => ['control.diagnostics', null],
    () => ({ enabled: isAuthed() && showDiagnosticsModal(), refetchOnWindowFocus: false }),
  )
  const [cacheSelection, setCacheSelection] = createSignal<Record<string, boolean>>({})

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

  const [selectedTemplate, setSelectedTemplate] = createSignal<string>('demo:sleep')
  const [instanceName, setInstanceName] = createSignal<string>('')
  const [sleepSeconds, setSleepSeconds] = createSignal<string>('60')
  const [createFormError, setCreateFormError] = createSignal<{ message: string; requestId?: string } | null>(null)
  const [createFieldErrors, setCreateFieldErrors] = createSignal<Record<string, string>>({})
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
  const [editMcVersionAdvanced, setEditMcVersionAdvanced] = createSignal(false)
  const [editMcVersionCustom, setEditMcVersionCustom] = createSignal('')
  const [editMcMemoryPreset, setEditMcMemoryPreset] = createSignal('2048')
  const [editMcMemory, setEditMcMemory] = createSignal('2048')
  const [editMcPort, setEditMcPort] = createSignal('')

  const [editTrVersion, setEditTrVersion] = createSignal('1453')
  const [editTrVersionAdvanced, setEditTrVersionAdvanced] = createSignal(false)
  const [editTrVersionCustom, setEditTrVersionCustom] = createSignal('')
  const [editTrPort, setEditTrPort] = createSignal('')
  const [editTrMaxPlayers, setEditTrMaxPlayers] = createSignal('8')
  const [editTrWorldName, setEditTrWorldName] = createSignal('world')
  const [editTrWorldSize, setEditTrWorldSize] = createSignal('1')
  const [editTrPassword, setEditTrPassword] = createSignal('')
  const [editTrPasswordVisible, setEditTrPasswordVisible] = createSignal(false)

  const editTemplateId = createMemo(() => editBase()?.template_id ?? null)

  const editMcEffectiveVersion = createMemo(() => {
    if (!editMcVersionAdvanced()) return editMcVersion()
    return editMcVersionCustom().trim() || editMcVersion()
  })

  const editTrEffectiveVersion = createMemo(() => {
    if (!editTrVersionAdvanced()) return editTrVersion()
    return editTrVersionCustom().trim() || editTrVersion()
  })

  const editMcEffectiveMemory = createMemo(() => {
    if (editMcMemoryPreset() === 'custom') return editMcMemory()
    return editMcMemoryPreset()
  })

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
      out.memory_mb = editMcEffectiveMemory().trim() || out.memory_mb || '2048'
      out.port = editMcPort().trim() || out.port || ''
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

  const [mcEula, setMcEula] = createSignal(false)
  const [mcVersion, setMcVersion] = createSignal('latest_release')
  const [mcVersionAdvanced, setMcVersionAdvanced] = createSignal(false)
  const [mcVersionCustom, setMcVersionCustom] = createSignal('')
  const [mcMemoryPreset, setMcMemoryPreset] = createSignal('2048')
  const [mcMemory, setMcMemory] = createSignal('2048')
  const [mcPort, setMcPort] = createSignal('')
  const [mcError, setMcError] = createSignal<string | null>(null)

  const [trVersion, setTrVersion] = createSignal('1453')
  const [trVersionAdvanced, setTrVersionAdvanced] = createSignal(false)
  const [trVersionCustom, setTrVersionCustom] = createSignal('')
  const [trPort, setTrPort] = createSignal('')
  const [trMaxPlayers, setTrMaxPlayers] = createSignal('8')
	  const [trWorldName, setTrWorldName] = createSignal('world')
	  const [trWorldSize, setTrWorldSize] = createSignal('1')
  const [trPassword, setTrPassword] = createSignal('')
	  const [trPasswordVisible, setTrPasswordVisible] = createSignal(false)
	  const [trError, setTrError] = createSignal<string | null>(null)

  createEffect(() => {
    // Clear create-form errors when switching templates.
    selectedTemplate()
    setCreateFormError(null)
    setCreateFieldErrors({})
    setMcError(null)
    setTrError(null)
  })

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

  const mcVersions = rspc.createQuery(
    () => ['minecraft.versions', null],
    () => ({ enabled: isAuthed(), refetchOnWindowFocus: false }),
  )

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

  const mcMemoryOptions = createMemo(() => [
    { value: '16384', label: '16 GB', meta: 'high' },
    { value: '8192', label: '8 GB' },
    { value: '4096', label: '4 GB' },
    { value: '2048', label: '2 GB', meta: 'default' },
    { value: 'custom', label: 'Custom...' },
  ])

  const [tab, setTab] = createSignal<UiTab>('instances')

  // Nodes state/queries will be moved into NodesPage next.

	  const [selectedInstanceId, setSelectedInstanceId] = createSignal<string | null>(null)
	  const selectedInstance = createMemo(() => {
	    const id = selectedInstanceId()
	    if (!id) return null
	    return (instances.data ?? []).find((x: { config: { instance_id: string } }) => x.config.instance_id === id) ?? null
	  })
	  const selectedInstanceStatus = createMemo(() => selectedInstance()?.status ?? null)

	  const logs = rspc.createQuery(
	    () => [
	      'process.logsTail',
      {
        process_id: selectedInstanceId() ?? '',
        cursor: null,
        limit: 200,
      },
    ],
    () => ({
      enabled: isAuthed() && !!selectedInstanceId(),
      refetchInterval: isAuthed() ? 1000 : false,
    }),
  )

  const [showLogsModal, setShowLogsModal] = createSignal(false)

  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null)

  const nodes = rspc.createQuery(
    () => ['node.list', null],
    () => ({ enabled: isAuthed() && tab() === 'nodes', refetchOnWindowFocus: false }),
  )

  const setNodeEnabled = rspc.createMutation(() => 'node.setEnabled')
  const [nodeEnabledOverride, setNodeEnabledOverride] = createSignal<Record<string, boolean>>({})

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
  const fsList = rspc.createQuery(
    () => ['fs.listDir', { path: fsPath() ? fsPath() : null }],
    () => ({ enabled: isAuthed() && tab() === 'files', refetchOnWindowFocus: false, staleTime: 0 }),
  )

  const [selectedFilePath, setSelectedFilePath] = createSignal<string | null>(null)

  const fileText = rspc.createQuery(
    () => [
      'fs.readFile',
      {
        path: selectedFilePath() ?? '',
        offset: 0,
        limit: 65536,
      },
    ],
    () => ({
      enabled:
        isAuthed() &&
        tab() === 'files' &&
        !!selectedFilePath() &&
        !(selectedFilePath() ?? '').toLowerCase().endsWith('.log'),
      refetchOnWindowFocus: false,
      staleTime: 0,
    }),
  )

  const [logCursor, setLogCursor] = createSignal<string | null>(null)
  const [liveTail, setLiveTail] = createSignal(true)
  const MAX_LOG_LINES = 2000
  const [logLines, setLogLines] = createSignal<string[]>([])
  const logTail = rspc.createQuery(
    () => [
      'log.tailFile',
      {
        path: selectedFilePath() ?? '',
        cursor: logCursor(),
        limit_bytes: 65536,
        max_lines: 400,
      },
    ],
    () => ({
      enabled: isAuthed() && tab() === 'files' && !!selectedFilePath() && (selectedFilePath() ?? '').toLowerCase().endsWith('.log'),
      refetchInterval: liveTail() ? 1000 : false,
    }),
  )

  createEffect(() => {
    if (logCursor() !== null) return
    setLogLines([])
  })

  createEffect(() => {
    const lines = logTail.data?.lines
    if (!lines || lines.length === 0) return
    setLogLines((prev) => {
      const next = [...prev, ...lines]
      if (next.length <= MAX_LOG_LINES) return next
      return next.slice(next.length - MAX_LOG_LINES)
    })
  })

  createEffect(() => {
    if (!liveTail()) return
    const next = logTail.data?.next_cursor
    if (next) setLogCursor(next)
  })

  const visibleText = createMemo(() => {
    const path = selectedFilePath()
    if (!path) return ''
    if (path.toLowerCase().endsWith('.log')) {
      const lines = logLines()
      if (lines.length > 0) return lines.join('\n')
      if (logTail.isPending) return 'loading...'
      return '(no log output yet)'
    }
    return fileText.data?.text ?? ''
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
    setTab('files')
    setFsPath(path)
    setSelectedFilePath(null)
    setLogCursor(null)
    setLiveTail(true)
  }

  function openFileInFiles(filePath: string) {
    const cleaned = filePath.replace(/\/+$/, '')
    const idx = cleaned.lastIndexOf('/')
    const dir = idx <= 0 ? '' : cleaned.slice(0, idx)
    setTab('files')
    setFsPath(dir)
    setSelectedFilePath(cleaned)
    setLogCursor(null)
    setLiveTail(true)
  }

  // selectedInstance UI is handled by the terminal modal.

  // Files state/queries will be moved into FilesPage next.

  return (
    <div class="h-screen w-screen overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-200">
      <div class="flex h-full">
  <nav class="hidden sm:flex w-16 flex-none flex-col items-center gap-3 border-r border-slate-200 bg-white px-2 py-4 dark:border-slate-800 dark:bg-slate-950">
  <img src="/logo.svg" class="mt-1 h-9 w-9 rounded-xl" alt="Alloy" />

          <div class="mt-2 flex w-full flex-col items-center gap-2">
            <button
              type="button"
              class={`group relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                tab() === 'instances'
                  ? 'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-300'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200'
              }`}
              onClick={() => setTab('instances')}
              title="Instances"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
                <path d="M10.75 2.5a.75.75 0 00-1.5 0V3.2a6.8 6.8 0 00-2.98 1.235l-.5-.5a.75.75 0 10-1.06 1.06l.5.5A6.8 6.8 0 003.2 9.25H2.5a.75.75 0 000 1.5h.7a6.8 6.8 0 001.235 2.98l-.5.5a.75.75 0 101.06 1.06l.5-.5A6.8 6.8 0 009.25 16.8v.7a.75.75 0 001.5 0v-.7a6.8 6.8 0 002.98-1.235l.5.5a.75.75 0 101.06-1.06l-.5-.5a6.8 6.8 0 001.235-2.98h.7a.75.75 0 000-1.5h-.7a6.8 6.8 0 00-1.235-2.98l.5-.5a.75.75 0 10-1.06-1.06l-.5.5A6.8 6.8 0 0010.75 3.2V2.5z" />
                <path d="M10 6.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z" />
              </svg>
            </button>

            <button
              type="button"
              class={`group relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                tab() === 'files'
                  ? 'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-300'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200'
              }`}
              onClick={() => setTab('files')}
              title="Files"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
                <path d="M2 5.75A2.75 2.75 0 014.75 3h4.19a2.75 2.75 0 011.944.806l.56.56c.215.215.507.334.812.334h2.994A2.75 2.75 0 0118 7.45v6.8A2.75 2.75 0 0115.25 17H4.75A2.75 2.75 0 012 14.25v-8.5z" />
              </svg>
            </button>

            <button
              type="button"
              class={`group relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                tab() === 'nodes'
                  ? 'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-300'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200'
              }`}
              onClick={() => setTab('nodes')}
              title="Nodes"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
                <path d="M4.75 3A2.75 2.75 0 002 5.75v.5A2.75 2.75 0 004.75 9h10.5A2.75 2.75 0 0018 6.25v-.5A2.75 2.75 0 0015.25 3H4.75z" />
                <path d="M4.75 11A2.75 2.75 0 002 13.75v.5A2.75 2.75 0 004.75 17h10.5A2.75 2.75 0 0018 14.25v-.5A2.75 2.75 0 0015.25 11H4.75z" />
              </svg>
            </button>
          </div>

          <div class="mt-auto flex w-full flex-col items-center gap-2 pb-2">
            <button
              class="rounded-xl border border-slate-200 bg-white/70 p-2 text-slate-700 shadow-sm transition-colors hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:bg-slate-900"
              title={themeButtonTitle()}
              onClick={() =>
                setThemePref((prev) => (prev === 'system' ? 'light' : prev === 'light' ? 'dark' : 'system'))
              }
            >
              {themePref() === 'dark' ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                  <path
                    fill-rule="evenodd"
                    d="M17.293 13.293A8 8 0 016.707 2.707a8 8 0 1010.586 10.586z"
                    clip-rule="evenodd"
                  />
                </svg>
              ) : themePref() === 'light' ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                  <path
                    fill-rule="evenodd"
                    d="M10 2a.75.75 0 01.75.75V4a.75.75 0 01-1.5 0V2.75A.75.75 0 0110 2zm0 12a4 4 0 100-8 4 4 0 000 8zm0 3a.75.75 0 01.75.75V18a.75.75 0 01-1.5 0v-1.25A.75.75 0 0110 17zm8-7a.75.75 0 01-.75.75H16a.75.75 0 010-1.5h1.25A.75.75 0 0118 10zm-14.5 0a.75.75 0 01-.75.75H2.75a.75.75 0 010-1.5H3.5A.75.75 0 014.25 10zm10.657-5.657a.75.75 0 010 1.06l-.884.884a.75.75 0 11-1.06-1.06l.884-.884a.75.75 0 011.06 0zM6.287 14.713a.75.75 0 010 1.06l-.884.884a.75.75 0 11-1.06-1.06l.884-.884a.75.75 0 011.06 0zm9.37 0a.75.75 0 01-1.06 0l-.884-.884a.75.75 0 111.06-1.06l.884.884a.75.75 0 010 1.06zm-9.37-9.37a.75.75 0 01-1.06 0l-.884-.884a.75.75 0 011.06-1.06l.884.884a.75.75 0 010 1.06z"
                    clip-rule="evenodd"
                  />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                  <path
                    fill-rule="evenodd"
                    d="M4.75 3A2.75 2.75 0 002 5.75v6.5A2.75 2.75 0 004.75 15H9v1.25H7.75a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5H11V15h4.25A2.75 2.75 0 0018 12.25v-6.5A2.75 2.75 0 0015.25 3H4.75zm-.25 2.75c0-.69.56-1.25 1.25-1.25h8.5c.69 0 1.25.56 1.25 1.25v6.5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-6.5z"
                    clip-rule="evenodd"
                  />
                </svg>
              )}
            </button>
          </div>
        </nav>

        <div class="flex min-w-0 flex-1 flex-col">
  <header class="relative z-50 flex h-14 flex-none items-center justify-between border-b border-slate-200 bg-white/70 px-5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/70">
            <div class="flex items-center gap-4">
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
              <button
                class="sm:hidden rounded-xl border border-slate-200 bg-white/70 p-2 text-slate-700 shadow-sm transition-colors hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:bg-slate-900"
                title={themeButtonTitle()}
                onClick={() =>
                  setThemePref((prev) => (prev === 'system' ? 'light' : prev === 'light' ? 'dark' : 'system'))
                }
              >
                {themePref() === 'dark' ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                    <path
                      fill-rule="evenodd"
                      d="M17.293 13.293A8 8 0 016.707 2.707a8 8 0 1010.586 10.586z"
                      clip-rule="evenodd"
                    />
                  </svg>
                ) : themePref() === 'light' ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                    <path
                      fill-rule="evenodd"
                      d="M10 2a.75.75 0 01.75.75V4a.75.75 0 01-1.5 0V2.75A.75.75 0 0110 2zm0 12a4 4 0 100-8 4 4 0 000 8zm0 3a.75.75 0 01.75.75V18a.75.75 0 01-1.5 0v-1.25A.75.75 0 0110 17zm8-7a.75.75 0 01-.75.75H16a.75.75 0 010-1.5h1.25A.75.75 0 0118 10zm-14.5 0a.75.75 0 01-.75.75H2.75a.75.75 0 010-1.5H3.5A.75.75 0 014.25 10zm10.657-5.657a.75.75 0 010 1.06l-.884.884a.75.75 0 11-1.06-1.06l.884-.884a.75.75 0 011.06 0zM6.287 14.713a.75.75 0 010 1.06l-.884.884a.75.75 0 11-1.06-1.06l.884-.884a.75.75 0 011.06 0zm9.37 0a.75.75 0 01-1.06 0l-.884-.884a.75.75 0 111.06-1.06l.884.884a.75.75 0 010 1.06zm-9.37-9.37a.75.75 0 01-1.06 0l-.884-.884a.75.75 0 011.06-1.06l.884.884a.75.75 0 010 1.06z"
                      clip-rule="evenodd"
                    />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                    <path
                      fill-rule="evenodd"
                      d="M4.75 3A2.75 2.75 0 002 5.75v6.5A2.75 2.75 0 004.75 15H9v1.25H7.75a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5H11V15h4.25A2.75 2.75 0 0018 12.25v-6.5A2.75 2.75 0 0015.25 3H4.75zm-.25 2.75c0-.69.56-1.25 1.25-1.25h8.5c.69 0 1.25.56 1.25 1.25v6.5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-6.5z"
                      clip-rule="evenodd"
                    />
                  </svg>
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
                      class="group flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 py-1 pl-2 pr-2 shadow-sm backdrop-blur-sm transition-all hover:bg-white hover:shadow active:scale-[0.99] dark:border-slate-800 dark:bg-slate-950/60 dark:hover:bg-slate-950/80"
                      onPointerDown={(ev) => ev.stopPropagation()}
                      onClick={() => setShowAccountMenu((v) => !v)}
                      aria-expanded={showAccountMenu()}
                    >
                      <div class="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white shadow-sm dark:bg-slate-100 dark:text-slate-900">
                        {me()!.username.slice(0, 1).toUpperCase()}
                      </div>
                      <div class="flex min-w-0 flex-col leading-none">
                        <span class="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{me()!.username}</span>
                        <span class="mt-0.5 inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                          <span class="h-1.5 w-1.5 rounded-full bg-emerald-400" title="session active" />
                          <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 dark:border-slate-800 dark:bg-slate-950/40">
                            {me()!.is_admin ? 'Admin' : 'User'}
                          </span>
                        </span>
                      </div>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4 text-slate-500 transition-transform group-hover:translate-y-0.5">
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
                            class="absolute right-5 top-14 mt-2 w-36 origin-top-right overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10 backdrop-blur transition-all duration-150 animate-in fade-in zoom-in-95 dark:border-slate-800 dark:bg-slate-950"
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              class="flex w-full items-center justify-between px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 active:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900/50 dark:active:bg-slate-900"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={() => {
                                setShowAccountMenu(false)
                                setShowDiagnosticsModal(true)
                              }}
                            >
                              <span>Diagnostics</span>
                              <span class="text-xs text-slate-400">⌘</span>
                            </button>
                            <button
                              type="button"
                              class="flex w-full items-center justify-between px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 active:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900/50 dark:active:bg-slate-900"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={async () => {
                                setShowAccountMenu(false)
                                await handleLogout()
                              }}
                            >
                              <span>Logout</span>
                              <span class="text-xs text-slate-400">↩</span>
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

            <div class={`flex min-h-0 flex-1 ${!isAuthed() ? 'pointer-events-none blur-sm grayscale opacity-50' : ''}`}>
              <Show when={tab() === 'instances'}>
                <InstancesPage
                  tabLabel={tab()}
                  left={
                    <div class="space-y-3">
                      <label class="block text-sm text-slate-700 dark:text-slate-400">
                        Name (optional)
                        <input
                          class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                          value={instanceName()}
                          onInput={(e) => setInstanceName(e.currentTarget.value)}
                          placeholder="e.g. survival-1"
                        />
                      </label>

                      <Dropdown
                        label="Template"
                        value={selectedTemplate()}
                        options={templateOptions()}
                        disabled={templates.isPending || templateOptions().length === 0}
                        placeholder={templates.isPending ? 'Loading templates...' : 'No templates'}
                        onChange={setSelectedTemplate}
                      />

                      <Show when={selectedTemplate() === 'demo:sleep'}>
                      <label class="block text-sm text-slate-700 dark:text-slate-400">
                        seconds
                        <input
                            class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                            value={sleepSeconds()}
                            onInput={(e) => setSleepSeconds(e.currentTarget.value)}
                          />
                          <Show when={createFieldErrors().seconds}>
                            <div class="mt-1 text-xs text-rose-700 dark:text-rose-300">{createFieldErrors().seconds}</div>
                          </Show>
                        </label>
                      </Show>

                      <Show when={selectedTemplate() === 'minecraft:vanilla'}>
                        <div class="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                          <div class="flex items-start gap-3">
                            <input
                              id="mc-eula"
                              type="checkbox"
                              class="mt-1 h-4 w-4 rounded border-slate-300 bg-white text-amber-600 focus:ring-amber-400 dark:border-slate-700 dark:bg-slate-950/60 dark:text-amber-400"
                              checked={mcEula()}
                              onChange={(e) => setMcEula(e.currentTarget.checked)}
                            />
                              <label for="mc-eula" class="text-sm leading-tight text-slate-800 select-none dark:text-slate-300">
                              I agree to the{' '}
                              <a
                                href="https://account.mojang.com/documents/minecraft_eula"
                                target="_blank"
                                rel="noreferrer noopener"
                                class="text-amber-700 underline hover:text-amber-600 dark:text-amber-300 dark:hover:text-amber-200"
                              >
                                Minecraft EULA
                              </a>
                              <span class="block text-xs text-slate-500 mt-0.5">Required to start server</span>
                            </label>
                          </div>
                          <Show when={createFieldErrors().accept_eula}>
                            <div class="-mt-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                              {createFieldErrors().accept_eula}
                            </div>
                          </Show>

                          <div class="grid grid-cols-2 gap-3">
                            <div>
                              <div class="flex items-center justify-between">
                                <div class="text-sm text-slate-700 dark:text-slate-400">Version</div>
                                <button
                                  type="button"
                                  class={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide transition-all ${
                                    mcVersionAdvanced()
                                      ? 'border-amber-300 bg-amber-500/10 text-amber-800 dark:border-amber-500/30 dark:text-amber-200'
                                      : 'border-slate-300 bg-white/60 text-slate-600 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:bg-slate-900'
                                  }`}
                                  onClick={() =>
                                    setMcVersionAdvanced((v) => {
                                      const next = !v
                                      if (next && !mcVersionCustom().trim()) setMcVersionCustom(mcVersion())
                                      return next
                                    })
                                  }
                                  title="Advanced: type any Mojang version id"
                                >
                                  ADV
                                </button>
                              </div>
                              <div class="mt-1">
                                <Show
                                  when={mcVersionAdvanced()}
                                  fallback={<Dropdown label="" value={mcVersion()} options={mcVersionOptions()} onChange={setMcVersion} />}
                                >
                                  <input
                                    class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                                    value={mcVersionCustom()}
                                    onInput={(e) => setMcVersionCustom(e.currentTarget.value)}
                                    placeholder="e.g. 1.20.4"
                                    list="mc-version-suggest"
                                    spellcheck={false}
                                  />
                                  <datalist id="mc-version-suggest">
                                    <For each={(mcVersionOptions() ?? []).map((o) => o.value)}>{(v) => <option value={v} />}</For>
                                  </datalist>
                                  <div class="mt-1 text-xs text-slate-500">Advanced: enter any Mojang version id.</div>
                                </Show>
                              </div>
                              <Show when={createFieldErrors().version}>
                                <div class="mt-1 text-xs text-rose-700 dark:text-rose-300">{createFieldErrors().version}</div>
                              </Show>
                            </div>
                            <div>
                              <div class="text-sm text-slate-700 dark:text-slate-400">Memory</div>
                              <div class="mt-1">
                                <Dropdown
                                  label=""
                                  value={mcMemoryPreset()}
                                  options={mcMemoryOptions()}
                                  onChange={(v) => {
                                    setMcMemoryPreset(v)
                                    if (v !== 'custom') setMcMemory(v)
                                  }}
                                />
                              </div>
                              <Show when={mcMemoryPreset() === 'custom'}>
                                <input
                                  type="number"
                                  class="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                                  value={mcMemory()}
                                  onInput={(e) => setMcMemory(e.currentTarget.value)}
                                />
                              </Show>
                              <Show when={createFieldErrors().memory_mb}>
                                <div class="mt-1 text-xs text-rose-700 dark:text-rose-300">{createFieldErrors().memory_mb}</div>
                              </Show>
                            </div>
                          </div>

                          <label class="block text-sm text-slate-700 dark:text-slate-400">
                            Port
                            <input
                              type="number"
                              class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                                value={mcPort()}
                                onInput={(e) => setMcPort(e.currentTarget.value)}
                                placeholder="25565"
                            />
                            <Show when={createFieldErrors().port}>
                              <div class="mt-1 text-xs text-rose-700 dark:text-rose-300">{createFieldErrors().port}</div>
                            </Show>
                          </label>

                          <Show when={mcError()}>
                            <div class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                              {mcError()}
                            </div>
                          </Show>
                        </div>
                      </Show>

                      <Show when={selectedTemplate() === 'terraria:vanilla'}>
                        <div class="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                          <div class="grid grid-cols-2 gap-3">
                            <div>
                              <div class="flex items-center justify-between">
                                <div class="text-sm text-slate-700 dark:text-slate-400">Version</div>
                                <button
                                  type="button"
                                  class={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide transition-all ${
                                    trVersionAdvanced()
                                      ? 'border-amber-300 bg-amber-500/10 text-amber-800 dark:border-amber-500/30 dark:text-amber-200'
                                      : 'border-slate-300 bg-white/60 text-slate-600 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:bg-slate-900'
                                  }`}
                                  onClick={() =>
                                    setTrVersionAdvanced((v) => {
                                      const next = !v
                                      if (next && !trVersionCustom().trim()) setTrVersionCustom(trVersion())
                                      return next
                                    })
                                  }
                                  title="Advanced: type any terraria.org package version id"
                                >
                                  ADV
                                </button>
                              </div>
                              <div class="mt-1">
                                <Show
                                  when={trVersionAdvanced()}
                                  fallback={<Dropdown label="" value={trVersion()} options={trVersionOptions()} onChange={setTrVersion} />}
                                >
                                  <input
                                    class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                                    value={trVersionCustom()}
                                    onInput={(e) => setTrVersionCustom(e.currentTarget.value)}
                                    placeholder="e.g. 1453"
                                    list="tr-version-suggest"
                                    spellcheck={false}
                                  />
                                  <datalist id="tr-version-suggest">
                                    <For each={(trVersionOptions() ?? []).map((o) => o.value)}>{(v) => <option value={v} />}</For>
                                  </datalist>
                                  <div class="mt-1 text-xs text-slate-500">Advanced: enter any package id (e.g. 1453).</div>
                                </Show>
                              </div>
                              <Show when={createFieldErrors().version}>
                                <div class="mt-1 text-xs text-rose-700 dark:text-rose-300">{createFieldErrors().version}</div>
                              </Show>
                              <div class="mt-1 text-xs text-slate-500">Uses official terraria.org dedicated-server packages.</div>
                            </div>
                            <label class="block text-sm text-slate-700 dark:text-slate-400">
                              Port
                              <input
                                type="number"
                                class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                                value={trPort()}
                                onInput={(e) => setTrPort(e.currentTarget.value)}
                                placeholder="7777"
                              />
                              <Show when={createFieldErrors().port}>
                                <div class="mt-1 text-xs text-rose-700 dark:text-rose-300">{createFieldErrors().port}</div>
                              </Show>
                            </label>
                          </div>

                          <div class="grid grid-cols-2 gap-3">
                            <label class="block text-sm text-slate-700 dark:text-slate-400">
                              Max players
                              <input
                                type="number"
                                class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                                value={trMaxPlayers()}
                                onInput={(e) => setTrMaxPlayers(e.currentTarget.value)}
                              />
                              <Show when={createFieldErrors().max_players}>
                                <div class="mt-1 text-xs text-rose-700 dark:text-rose-300">{createFieldErrors().max_players}</div>
                              </Show>
                            </label>
                            <label class="block text-sm text-slate-700 dark:text-slate-400">
                              World name
                              <input
                                class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                                value={trWorldName()}
                                onInput={(e) => setTrWorldName(e.currentTarget.value)}
                              />
                              <Show when={createFieldErrors().world_name}>
                                <div class="mt-1 text-xs text-rose-700 dark:text-rose-300">{createFieldErrors().world_name}</div>
                              </Show>
                            </label>
                          </div>

                          <div class="grid grid-cols-2 gap-3">
                            <label class="block text-sm text-slate-700 dark:text-slate-400">
                              World size (1/2/3)
                              <input
                                type="number"
                                class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                                value={trWorldSize()}
                                onInput={(e) => setTrWorldSize(e.currentTarget.value)}
                              />
                              <Show when={createFieldErrors().world_size}>
                                <div class="mt-1 text-xs text-rose-700 dark:text-rose-300">{createFieldErrors().world_size}</div>
                              </Show>
                            </label>
	                            <label class="block text-sm text-slate-700 dark:text-slate-400">
	                              Password (optional)
	                              <div class="mt-1 flex gap-2">
	                                <input
	                                  type={trPasswordVisible() ? 'text' : 'password'}
	                                  class="w-full flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
	                                  value={trPassword()}
	                                  onInput={(e) => setTrPassword(e.currentTarget.value)}
	                                />
	                                <button
	                                  type="button"
	                                  class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900"
	                                  onClick={() => setTrPasswordVisible((v) => !v)}
	                                >
	                                  {trPasswordVisible() ? 'HIDE' : 'SHOW'}
	                                </button>
	                                <button
	                                  type="button"
	                                  class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900"
	                                  disabled={!trPassword()}
	                                  onClick={async () => {
	                                    try {
	                                      await navigator.clipboard.writeText(trPassword())
	                                    } catch {
	                                      // ignore clipboard errors
	                                    }
	                                  }}
	                                >
	                                  COPY
	                                </button>
	                              </div>
                              <Show when={createFieldErrors().password}>
                                <div class="mt-1 text-xs text-rose-700 dark:text-rose-300">{createFieldErrors().password}</div>
                              </Show>
	                            </label>
                          </div>

                          <Show when={trError()}>
                            <div class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                              {trError()}
                            </div>
                          </Show>
                        </div>
                      </Show>

                      <div class="grid grid-cols-2 gap-2">
                        <button
                          class="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-slate-100 ring-1 ring-inset ring-slate-800 hover:bg-slate-800 disabled:opacity-50"
                          disabled={createInstance.isPending}
                          onClick={async () => {
                            const template_id = selectedTemplate()
                            const params: Record<string, string> = {}
                            const display_name = instanceName().trim() ? instanceName().trim() : null

                            if (template_id === 'demo:sleep') {
                              params.seconds = sleepSeconds()
                            } else if (template_id === 'minecraft:vanilla') {
                              if (!mcEula()) {
                                setMcError('You must accept the EULA')
                                return
                              }
                              setMcError(null)
                              params.accept_eula = 'true'
                              const v = mcVersionAdvanced() ? mcVersionCustom().trim() : mcVersion()
                              params.version = v || 'latest_release'
                              params.memory_mb = mcMemory() || '2048'
                              if (mcPort().trim()) params.port = mcPort().trim()
                            } else if (template_id === 'terraria:vanilla') {
                              setTrError(null)
                              const v = trVersionAdvanced() ? trVersionCustom().trim() : trVersion()
                              params.version = v || '1453'
                              if (trPort().trim()) params.port = trPort().trim()
                              params.max_players = trMaxPlayers() || '8'
                              params.world_name = trWorldName() || 'world'
                              params.world_size = trWorldSize() || '1'
                              if (trPassword().trim()) params.password = trPassword().trim()
                            }

                            setCreateFormError(null)
                            setCreateFieldErrors({})
                            try {
                              await createInstance.mutateAsync({ template_id, params, display_name })
                              pushToast('success', 'Instance created', display_name ?? undefined)
                              await invalidateInstances()
                            } catch (e) {
                              if (isAlloyApiError(e)) {
                                setCreateFieldErrors(e.data.field_errors ?? {})
                                setCreateFormError({ message: e.data.message, requestId: e.data.request_id })
                                if (e.data.hint) pushToast('info', 'Hint', e.data.hint, e.data.request_id)
                              } else {
                                setCreateFormError({ message: e instanceof Error ? e.message : 'unknown error' })
                              }
                            }
                          }}
                        >
                          {createInstance.isPending ? 'CREATING…' : 'CREATE'}
                        </button>

                        <button
                          class="w-full rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition-all hover:bg-white hover:shadow active:scale-[0.99] disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-950/60"
                          disabled={
                            warmCache.isPending ||
                            createInstance.isPending ||
                            !['minecraft:vanilla', 'terraria:vanilla'].includes(selectedTemplate())
                          }
                          onClick={async () => {
                            const template_id = selectedTemplate()
                            const params: Record<string, string> = {}
                            if (template_id === 'minecraft:vanilla') {
                              const v = mcVersionAdvanced() ? mcVersionCustom().trim() : mcVersion()
                              params.version = v || 'latest_release'
                            }
                            if (template_id === 'terraria:vanilla') {
                              const v = trVersionAdvanced() ? trVersionCustom().trim() : trVersion()
                              params.version = v || '1453'
                            }
                            try {
                              const out = await warmCache.mutateAsync({ template_id, params })
                              pushToast('success', 'Cache warmed', out.message)
                            } catch (e) {
                              toastError('Warm cache failed', e)
                            }
                          }}
                          title="Only download required files (no start)"
                        >
                          {warmCache.isPending ? 'WARMING…' : 'WARM'}
                        </button>
                      </div>
                      <Show when={createFormError()}>
                        <div class="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                          <div class="font-semibold">Create failed</div>
                          <div class="mt-1 text-xs text-rose-800/90 dark:text-rose-200/90">{createFormError()!.message}</div>
                          <Show when={createFormError()!.requestId}>
                            <div class="mt-2 flex items-center justify-between gap-2">
                              <div class="text-[11px] text-rose-700/80 dark:text-rose-200/70 font-mono">req {createFormError()!.requestId}</div>
                              <button
                                type="button"
                                class="rounded-lg border border-rose-200 bg-white/70 px-2 py-1 text-[11px] font-medium text-rose-800 hover:bg-white dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200 dark:hover:bg-rose-950/40"
                                onClick={() => safeCopy(createFormError()!.requestId ?? '')}
                              >
                                COPY
                              </button>
                            </div>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  }
                  right={
                    <>
                      <div class="flex items-center justify-between">
                        <div class="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Instances</div>
                      </div>

                      <div class="mt-3 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                        <For each={instances.data ?? []}>
                          {(i) => (
                              <div
                                class={`group rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:bg-white hover:shadow-md active:scale-[0.99] dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none dark:hover:bg-slate-950/60 ${
                                  selectedInstanceId() === i.config.instance_id
                                    ? 'ring-1 ring-amber-500/25'
                                    : 'ring-0 ring-transparent'
                                }`}
                              >
                              <button
                                class="w-full text-left hover:cursor-pointer"
                                onClick={() => {
                                  setSelectedInstanceId(i.config.instance_id)
                                  setShowLogsModal(true)
                                }}
                              >
                                <div class="flex items-start justify-between gap-3">
                                  <div class="min-w-0">
	                                    <div class="truncate font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
	                                      {i.config.display_name ?? (i.config.params?.name as unknown as string | undefined) ?? i.config.instance_id}
	                                    </div>
                                    <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                      <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono dark:border-slate-800 dark:bg-slate-950/40">
                                        {i.config.instance_id}
                                      </span>
                                      <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono dark:border-slate-800 dark:bg-slate-950/40">
                                        {i.config.template_id}
                                      </span>
                                      <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 dark:border-slate-800 dark:bg-slate-950/40">
                                        {instanceStateLabel(i.status)}
                                      </span>
                                      <Show when={i.status?.pid != null}>
                                        <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono dark:border-slate-800 dark:bg-slate-950/40">
                                          pid {i.status?.pid}
                                        </span>
                                      </Show>
                                      <Show when={instancePort(i)}>
                                        {(p) => {
                                          const addr = `${connectHost()}:${p()}`
                                          return (
                                            <span
                                              class="group inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono text-slate-700 transition-colors hover:bg-white dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 dark:hover:bg-slate-900"
                                              title="Click to copy connection address"
                                              role="button"
                                              tabIndex={0}
                                              onClick={(e) => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                void safeCopy(addr)
                                                pushToast('success', 'Copied address', addr)
                                              }}
                                              onKeyDown={(e) => {
                                                if (e.key !== 'Enter' && e.key !== ' ') return
                                                e.preventDefault()
                                                e.stopPropagation()
                                                void safeCopy(addr)
                                                pushToast('success', 'Copied address', addr)
                                              }}
                                            >
                                              <span class="truncate">{addr}</span>
                                              <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                viewBox="0 0 20 20"
                                                fill="currentColor"
                                                class="h-3 w-3 flex-none opacity-60 group-hover:opacity-100"
                                                aria-hidden="true"
                                              >
                                                <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
                                                <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
                                              </svg>
                                            </span>
                                          )
                                        }}
                                      </Show>
                                    </div>
                                  </div>
	                                  <span
	                                    class={`mt-1 inline-flex h-2.5 w-2.5 flex-none rounded-full ${
	                                      i.status?.state === 'PROCESS_STATE_RUNNING'
	                                        ? 'bg-emerald-400'
	                                        : i.status?.state === 'PROCESS_STATE_STARTING'
	                                          ? 'bg-amber-400 animate-pulse'
	                                          : i.status?.state === 'PROCESS_STATE_STOPPING'
	                                            ? 'bg-amber-400 animate-pulse'
	                                            : i.status?.state === 'PROCESS_STATE_FAILED'
	                                              ? 'bg-rose-500'
	                                              : 'bg-slate-400'
	                                    }`}
	                                    title={i.status?.state ?? 'unknown'}
	                                  />
	                                </div>
	                              </button>

	                              <Show
	                                when={
	                                  i.status?.state === 'PROCESS_STATE_FAILED' &&
	                                  (i.status?.message != null || i.status?.exit_code != null)
	                                }
	                              >
	                                <div class="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
	                                  <span class="font-semibold">Failed:</span>
	                                  <span class="ml-1">
	                                    <Show when={i.status?.exit_code != null}>
	                                      exit {i.status?.exit_code}
	                                    </Show>
	                                    <Show when={i.status?.message != null}>
	                                      <span class="ml-2">{statusMessageParts(i.status).text}</span>
	                                    </Show>
	                                  </span>
	                                  <Show when={statusMessageParts(i.status).hint}>
	                                    {(hint) => (
	                                      <div class="mt-1 text-[11px] text-rose-700/80 dark:text-rose-200/70">
	                                        {hint()}
	                                      </div>
	                                    )}
	                                  </Show>
	                                </div>
	                              </Show>

                              <Show when={i.status?.resources}>
                                {(r) => (
                                  <div class="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                    <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono dark:border-slate-800 dark:bg-slate-950/40">
                                      cpu {formatCpuPercent(r().cpu_percent_x100)}
                                    </span>
                                    <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono dark:border-slate-800 dark:bg-slate-950/40">
                                      rss {formatBytes(parseU64(r().rss_bytes))}
                                    </span>
                                    <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono dark:border-slate-800 dark:bg-slate-950/40">
                                      io {formatBytes(parseU64(r().read_bytes))}↓ {formatBytes(parseU64(r().write_bytes))}↑
                                    </span>
                                  </div>
                                )}
                              </Show>

	                              <div class="mt-3 flex flex-wrap items-center gap-2">
                                <Show
                                  when={canStartInstance(i.status)}
                                  fallback={
                                    <button
                                      class="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs font-medium text-slate-800 shadow-sm transition-all duration-150 hover:bg-white hover:shadow active:scale-[0.98] disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
                                      disabled={stopInstance.isPending || isStopping(i.status)}
                                      onClick={async () => {
                                        await stopInstance.mutateAsync({ instance_id: i.config.instance_id, timeout_ms: 30_000 })
                                        await invalidateInstances()
                                      }}
                                    >
                                      STOP
                                    </button>
                                  }
	                                >
	                                  <button
	                                    class="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs font-medium text-slate-800 shadow-sm transition-all duration-150 hover:bg-white hover:shadow active:scale-[0.98] disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
	                                    disabled={startInstance.isPending}
	                                    onClick={async () => {
	                                      await startInstance.mutateAsync({ instance_id: i.config.instance_id })
	                                      await invalidateInstances()
	                                    }}
	                                  >
	                                    START
	                                  </button>
	                                </Show>

	                                <Show when={i.status != null}>
	                                  <button
	                                    class="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs font-medium text-slate-800 shadow-sm transition-all duration-150 hover:bg-white hover:shadow active:scale-[0.98] disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
	                                    disabled={
	                                      restartInstance.isPending ||
	                                      startInstance.isPending ||
	                                      stopInstance.isPending ||
	                                      isStopping(i.status)
	                                    }
	                                    onClick={async () => {
	                                      await restartInstance.mutateAsync({ instance_id: i.config.instance_id, timeout_ms: 30_000 })
	                                      await invalidateInstances()
	                                    }}
	                                  >
	                                    RESTART
	                                  </button>
	                                </Show>

	                                <button
	                                  class="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800 shadow-sm transition-all hover:bg-rose-100 hover:shadow active:scale-[0.98] disabled:opacity-50 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200 dark:shadow-none dark:hover:bg-rose-950/30"
	                                  disabled={deleteInstance.isPending || !canStartInstance(i.status)}
                                  onClick={() => setConfirmDeleteInstanceId(i.config.instance_id)}
                                >
                                  DEL
                                </button>

                                <button
                                  class="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs font-medium text-slate-800 shadow-sm transition-all hover:bg-white hover:shadow active:scale-[0.98] disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
                                  disabled={!canStartInstance(i.status)}
                                  title={!canStartInstance(i.status) ? 'Stop the instance before editing' : 'Edit instance parameters'}
                                  onClick={() => openEditModal(i)}
                                >
                                  EDIT
                                </button>

                                <button
                                  class="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs font-medium text-slate-800 shadow-sm transition-all hover:bg-white hover:shadow active:scale-[0.98] dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
                                  onClick={() => openInFiles(`instances/${i.config.instance_id}`)}
                                  title="Open instance directory"
                                >
                                  FILES
                                </button>

                                <Show when={i.config.template_id === 'minecraft:vanilla'}>
                                  <button
                                    class="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs font-medium text-slate-800 shadow-sm transition-all hover:bg-white hover:shadow active:scale-[0.98] dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
                                    onClick={() => openFileInFiles(`instances/${i.config.instance_id}/logs/latest.log`)}
                                    title="Open latest.log"
                                  >
                                    LOG
                                  </button>
                                </Show>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>

                      {/* Logs are shown in the terminal modal; keep the main view clean. */}
                    </>
                  }
                />
              </Show>

                <Show when={tab() === 'files'}>
                <FilesPage
                  tabLabel={tab()}
                  left={
                    <div class="space-y-3">
                      <label class="block text-sm text-slate-700 dark:text-slate-400">
                        Path
                        <input
                          class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                          value={fsPath()}
                          onInput={(e) => setFsPath(e.currentTarget.value)}
                          placeholder="(empty = /data)"
                        />
                      </label>

                      <div class="grid grid-cols-2 gap-2">
                        <button
                          class="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-800 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900"
                          onClick={() => {
                            setSelectedFilePath(null)
                            setLogCursor(null)
                            setLiveTail(true)
                          }}
                        >
                          RESET
                        </button>
                        <button
                          class="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-800 hover:bg-white disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900"
                          disabled={!fsPath()}
                          onClick={() => {
                            const cur = fsPath().replace(/\/+$/, '')
                            const idx = cur.lastIndexOf('/')
                            const next = idx <= 0 ? '' : cur.slice(0, idx)
                            setFsPath(next)
                            setSelectedFilePath(null)
                            setLogCursor(null)
                            setLiveTail(true)
                          }}
                        >
                          UP
                        </button>
                      </div>

                      <div class="max-h-96 overflow-auto rounded-xl border border-slate-200 bg-white/60 p-1 dark:border-slate-800 dark:bg-slate-950/40">
                        <Show when={!fsList.isPending} fallback={<div class="p-2 text-xs text-slate-500 font-mono">loading...</div>}>
                          <For each={fsList.data?.entries ?? []}>
                            {(e) => (
                              <button
                                class={`w-full rounded-lg px-2 py-2 text-left text-sm font-mono text-slate-900 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900 ${
                                  selectedFilePath()?.endsWith(`/${e.name}`) && !e.is_dir ? 'bg-slate-100 dark:bg-slate-900' : ''
                                }`}
                                onClick={() => {
                                  if (e.is_dir) {
                                    const next = fsPath() ? `${fsPath().replace(/\/+$/, '')}/${e.name}` : e.name
                                    setFsPath(next)
                                    setSelectedFilePath(null)
                                    setLogCursor(null)
                                    setLiveTail(true)
                                  } else {
                                    const file = fsPath() ? `${fsPath().replace(/\/+$/, '')}/${e.name}` : e.name
                                    setSelectedFilePath(file)
                                    setLogCursor(null)
                                    setLiveTail(true)
                                  }
                                }}
                              >
                                <span class="inline-flex items-center gap-2">
                                  <span class="text-slate-500">
                                    <Show when={e.is_dir} fallback={<span class="text-[11px]">F</span>}>
                                      <span class="text-[11px]">D</span>
                                    </Show>
                                  </span>
                                  <span class="truncate">{e.name}</span>
                                  <span class="ml-auto rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                                    {e.is_dir ? 'dir' : 'file'}
                                  </span>
                                </span>
                              </button>
                            )}
                          </For>
                          <Show when={(fsList.data?.entries ?? []).length === 0}>
                            <div class="p-2 text-xs text-slate-500 font-mono">empty</div>
                          </Show>
                        </Show>
                      </div>
                    </div>
                  }
                  right={
                    <>
                      <div class="flex items-center justify-between">
                        <div class="text-xs font-semibold uppercase tracking-wider text-slate-400">Preview</div>
                        <div class="truncate font-mono text-[11px] text-slate-500">{selectedFilePath() ?? '-'}</div>
                      </div>

                      <div class="mt-3 grid gap-2">
                        <Show when={selectedFilePath() && (selectedFilePath() ?? '').toLowerCase().endsWith('.log')}>
                          <div class="flex items-center justify-between rounded-xl border border-slate-200 bg-white/60 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/40">
                            <div class="text-slate-600 dark:text-slate-400">Tail</div>
                            <div class="flex items-center gap-3">
                              <label class="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                                <input type="checkbox" checked={liveTail()} onChange={(e) => setLiveTail(e.currentTarget.checked)} />
                                Live
                              </label>
                              <button
                                class="rounded-lg border border-slate-200 bg-white/70 px-2 py-1 text-xs text-slate-700 shadow-sm hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
                                onClick={() => setLogCursor(null)}
                              >
                                End
                              </button>
                            </div>
                          </div>
                        </Show>

                        <pre class="mt-0 max-h-[70vh] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                          {selectedFilePath() ? visibleText() : 'Select a file from the list'}
                        </pre>
                      </div>
                    </>
                  }
                />
                </Show>

              <Show when={tab() === 'nodes'}>
                <NodesPage
                  tabLabel={tab()}
                  left={
                    <div class="space-y-3">
                      <div class="max-h-96 overflow-auto rounded-xl border border-slate-200 bg-white/60 p-1 dark:border-slate-800 dark:bg-slate-950/40">
                        <Show when={!nodes.isPending} fallback={<div class="p-2 text-xs font-mono text-slate-500">loading...</div>}>
                          <For each={nodes.data ?? []}>
                            {(n) => (
                              <button
                                type="button"
                                class={`w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-900 ${
                                  selectedNodeId() === n.id ? 'bg-slate-100 dark:bg-slate-900' : ''
                                }`}
                                onClick={() => setSelectedNodeId(n.id)}
                              >
                                <div class="flex items-center justify-between gap-2">
                                  <div class="min-w-0">
                                    <div class="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{n.name}</div>
                                    <div class="mt-0.5 truncate font-mono text-[11px] text-slate-500">{n.endpoint}</div>
                                  </div>
                                  <span
                                    class={`h-2 w-2 rounded-full ${
                                      n.last_error ? 'bg-rose-500' : n.last_seen_at ? 'bg-emerald-400' : 'bg-slate-500'
                                    }`}
                                  />
                                </div>
                              </button>
                            )}
                          </For>
                        </Show>
                      </div>
                    </div>
                  }
                  right={
                    <div class="mt-3 rounded-xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                      <Show when={selectedNode()} fallback={<div class="text-xs text-slate-500">select a node</div>}>
                        {(n) => (
                          <div>
                            <div class="flex items-center justify-between gap-3">
                              <div class="min-w-0">
                                <div class="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{n().name}</div>
                                <div class="mt-0.5 truncate font-mono text-[11px] text-slate-500">{n().endpoint}</div>
                              </div>
                              <Show when={me()?.is_admin}>
                                <button
                                  type="button"
                                  disabled={setNodeEnabled.isPending}
                                  class="group inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/60 px-2 py-1.5 text-[11px] text-slate-700 shadow-sm hover:bg-white disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300 dark:shadow-none dark:hover:bg-slate-900"
                                  onClick={async () => {
                                    const id = n().id
                                    const current =
                                      Object.prototype.hasOwnProperty.call(nodeEnabledOverride(), id)
                                        ? nodeEnabledOverride()[id]
                                        : n().enabled
                                    const next = !current
                                    setNodeEnabledOverride({ ...nodeEnabledOverride(), [id]: next })
                                    try {
                                      await setNodeEnabled.mutateAsync({ node_id: id, enabled: next })
                                      void invalidateNodes()
                                    } catch {
                                      setNodeEnabledOverride({ ...nodeEnabledOverride(), [id]: current })
                                    }
                                  }}
                                >
                                  <span class="text-slate-500 dark:text-slate-500">Enabled</span>
                                  <span
                                    class={`relative inline-flex h-5 w-9 items-center rounded-full border transition-colors ${
                                      (Object.prototype.hasOwnProperty.call(nodeEnabledOverride(), n().id)
                                        ? nodeEnabledOverride()[n().id]
                                        : n().enabled)
                                        ? 'border-emerald-200 bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/20'
                                        : 'border-slate-300 bg-slate-200 dark:border-slate-700 dark:bg-slate-900/40'
                                    }`}
                                  >
                                    <span
                                      class={`inline-block h-4 w-4 transform rounded-full bg-slate-100 shadow transition-transform ${
                                        (Object.prototype.hasOwnProperty.call(nodeEnabledOverride(), n().id)
                                          ? nodeEnabledOverride()[n().id]
                                          : n().enabled)
                                          ? 'translate-x-4'
                                          : 'translate-x-1'
                                      }`}
                                    />
                                  </span>
                                </button>
                              </Show>
                            </div>

                            <div class="mt-4 grid grid-cols-2 gap-3 text-xs">
                              <div>
                                <div class="text-[11px] text-slate-500">Status</div>
                                <div class="mt-1 text-slate-700 dark:text-slate-200">{n().last_error ? 'Error' : n().last_seen_at ? 'Healthy' : 'Unknown'}</div>
                              </div>
                              <div>
                                <div class="text-[11px] text-slate-500">Agent</div>
                                <div class="mt-1 text-slate-700 dark:text-slate-200">{n().agent_version ?? '-'}</div>
                              </div>
                              <div class="col-span-2">
                                <div class="text-[11px] text-slate-500">Last seen</div>
                                <div class="mt-1 font-mono text-[11px] text-slate-700 dark:text-slate-200">{n().last_seen_at ?? '-'}</div>
                              </div>
                              <div class="col-span-2">
                                <div class="text-[11px] text-slate-500">Last error</div>
                                <div class="mt-1 font-mono text-[11px] text-rose-700 dark:text-rose-300">{n().last_error ?? '-'}</div>
                              </div>
                            </div>
                          </div>
                        )}
                      </Show>
                    </div>
                  }
                />
              </Show>
            </div>
          </main>

          <nav class="sm:hidden flex h-12 flex-none items-center justify-around border-t border-slate-200 bg-white/70 px-2 dark:border-slate-800 dark:bg-slate-950/80">
            <button
              class={`flex flex-1 items-center justify-center rounded-xl py-2 text-xs ${
                tab() === 'instances'
                  ? 'bg-amber-500/10 text-amber-800 dark:text-amber-200'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
              onClick={() => setTab('instances')}
            >
              Instances
            </button>
            <button
              class={`flex flex-1 items-center justify-center rounded-xl py-2 text-xs ${
                tab() === 'files' ? 'bg-amber-500/10 text-amber-800 dark:text-amber-200' : 'text-slate-600 dark:text-slate-400'
              }`}
              onClick={() => setTab('files')}
            >
              Files
            </button>
            <button
              class={`flex flex-1 items-center justify-center rounded-xl py-2 text-xs ${
                tab() === 'nodes' ? 'bg-amber-500/10 text-amber-800 dark:text-amber-200' : 'text-slate-600 dark:text-slate-400'
              }`}
              onClick={() => setTab('nodes')}
            >
              Nodes
            </button>
          </nav>
        </div>
      </div>


        {/* Legacy UI below the new console layout was accidentally left in place.
            Keep return() to the new layout + modals only. */}

        <Show when={showLoginModal() && !me()}>
          <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              class="absolute inset-0 bg-slate-900/20 backdrop-blur-sm dark:bg-slate-950/60"
              onClick={() => setShowLoginModal(false)}
            />

            <div
              class="relative w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
              role="dialog"
              aria-modal="true"
            >
              <div class="px-6 py-8">
                <h2 class="text-xl font-semibold text-slate-900 dark:text-slate-100">Welcome back</h2>
                <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Enter your credentials to access the control plane.
                </p>

                <form
                  class="mt-6 grid gap-4"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    try {
                      setAuthError(null)
                      setAuthLoading(true)
                      await login({ username: loginUser(), password: loginPass() })
                      await refreshSession()
                      setShowLoginModal(false)
                    } catch (err) {
                      setAuthError(err instanceof Error ? err.message : 'login failed')
                    } finally {
                      setAuthLoading(false)
                    }
                  }}
                >
                  <label class="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Username
                    <input
                      ref={(el) => {
                        loginUsernameEl = el
                      }}
                      class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200"
                      value={loginUser()}
                      onInput={(ev) => setLoginUser(ev.currentTarget.value)}
                      autocomplete="username"
                    />
                  </label>
                  <label class="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Password
                    <input
                      type="password"
                      class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200"
                      value={loginPass()}
                      onInput={(ev) => setLoginPass(ev.currentTarget.value)}
                      autocomplete="current-password"
                    />
                  </label>

                  <Show when={authError()}>
                    <div class="rounded-md bg-rose-50 p-3 text-xs text-rose-600 dark:bg-rose-950/30 dark:text-rose-400">
                      {authError()}
                    </div>
                  </Show>

                  <div class="mt-4 flex gap-3">
                    <button
                      type="button"
                      class="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      onClick={() => setShowLoginModal(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={authLoading()}
                      class="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                    >
                      Sign in
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </Show>

        <Show when={confirmDeleteInstanceId() != null}>
          <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              class="absolute inset-0 bg-slate-900/20 backdrop-blur-sm dark:bg-slate-950/60"
              onClick={() => setConfirmDeleteInstanceId(null)}
            />

            <div
              class="relative w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
              role="dialog"
              aria-modal="true"
            >
              <div class="px-6 py-6">
                <div class="flex items-start gap-3">
                  <div class="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
                      <path
                        fill-rule="evenodd"
                        d="M8.257 3.099c.765-1.36 2.72-1.36 3.486 0l5.58 9.92c.75 1.334-.214 2.98-1.743 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM10 7.25a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0V8a.75.75 0 01.75-.75zM10 13.75a1 1 0 100 2 1 1 0 000-2z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </div>
                  <div class="min-w-0">
                    <h3 class="text-base font-semibold text-slate-900 dark:text-slate-100">Delete instance</h3>
                    <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      This will permanently delete
                      <span class="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        {confirmDeleteInstanceId()}
                      </span>
                      .
                    </p>
                  </div>
                </div>

                <div class="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-[12px] text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
                  <div class="flex items-center justify-between gap-3">
                    <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Delete preview</div>
                    <Show
                      when={!instanceDeletePreview.isPending}
                      fallback={<div class="text-[11px] text-slate-400">loading…</div>}
                    >
                      <Show
                        when={!instanceDeletePreview.isError}
                        fallback={<div class="text-[11px] text-rose-600 dark:text-rose-300">failed to load</div>}
                      >
                        <div class="text-[11px] text-slate-500 dark:text-slate-400">ok</div>
                      </Show>
                    </Show>
                  </div>

                  <Show when={instanceDeletePreview.data}>
                    {(d) => (
                      <div class="mt-2 space-y-1">
                        <div class="flex items-center justify-between gap-3">
                          <div class="text-slate-500 dark:text-slate-400">Path</div>
                          <div class="min-w-0 truncate font-mono text-[11px]" title={d().path}>
                            {d().path}
                          </div>
                        </div>
                        <div class="flex items-center justify-between gap-3">
                          <div class="text-slate-500 dark:text-slate-400">Estimated size</div>
                          <div class="font-mono text-[11px]">{formatBytes(Number(d().size_bytes))}</div>
                        </div>
                      </div>
                    )}
                  </Show>

                  <Show when={instanceDeletePreview.isError && (instanceDeletePreview.error as unknown)}>
                    <div class="mt-2 text-[11px] text-rose-700/80 dark:text-rose-200/70">
                      Preview unavailable. You can still delete after confirmation.
                    </div>
                  </Show>
                </div>

                <div class="mt-4">
                  <div class="text-xs font-medium text-slate-700 dark:text-slate-300">Type the instance id to confirm</div>
                  <input
                    class="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-rose-500/50 focus:outline-none focus:ring-2 focus:ring-rose-500/20 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200"
                    value={confirmDeleteText()}
                    onInput={(e) => setConfirmDeleteText(e.currentTarget.value)}
                    placeholder={confirmDeleteInstanceId() ?? ''}
                  />
                  <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    Tip: copy/paste the id above to avoid typos.
                  </div>
                </div>

                <div class="mt-6 flex gap-3">
                  <button
                    type="button"
                    class="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    onClick={() => setConfirmDeleteInstanceId(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="flex-1 rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-rose-700 disabled:opacity-50 dark:bg-rose-500 dark:hover:bg-rose-400"
                    disabled={
                      deleteInstance.isPending ||
                      confirmDeleteText().trim() !== (confirmDeleteInstanceId() ?? '') ||
                      !confirmDeleteInstanceId()
                    }
                    onClick={async () => {
                      const id = confirmDeleteInstanceId()
                      if (!id) return
                      try {
                        await deleteInstance.mutateAsync({ instance_id: id })
                        if (selectedInstanceId() === id) setSelectedInstanceId(null)
                        setConfirmDeleteInstanceId(null)
                        await invalidateInstances()
                      } catch {
                        // Error state already reflected on existing mutation handling.
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Show>

        <Show when={editingInstanceId() != null && editBase() != null}>
          <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              class="absolute inset-0 bg-slate-900/30 backdrop-blur-sm dark:bg-slate-950/70"
              onClick={() => closeEditModal()}
            />

            <div
              class="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
              role="dialog"
              aria-modal="true"
            >
              <div class="px-6 py-6">
                <div class="flex items-start gap-3">
                  <div class="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5">
                      <path d="M5.433 13.69A4.5 4.5 0 0110 6.5h.25a.75.75 0 000-1.5H10a6 6 0 00-5.9 4.91.75.75 0 00.58.88.75.75 0 00.88-.58 4.5 4.5 0 01-.127 3.5z" />
                      <path d="M14.567 6.31A4.5 4.5 0 0110 13.5h-.25a.75.75 0 000 1.5H10a6 6 0 005.9-4.91.75.75 0 00-.58-.88.75.75 0 00-.88.58 4.5 4.5 0 01.127-3.5z" />
                    </svg>
                  </div>
                  <div class="min-w-0">
                    <h3 class="text-base font-semibold text-slate-900 dark:text-slate-100">Edit instance</h3>
                    <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      <span class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        {editBase()!.instance_id}
                      </span>
                      <span class="mx-2 text-slate-300 dark:text-slate-700">/</span>
                      <span class="font-mono text-[12px] text-slate-600 dark:text-slate-300">{editBase()!.template_id}</span>
                    </p>
                  </div>
                  <div class="ml-auto flex items-center gap-2">
                    <span
                      class={`rounded-full border px-2 py-1 text-[11px] font-semibold tracking-wide ${
                        editHasChanges()
                          ? 'border-amber-300 bg-amber-500/10 text-amber-800 dark:border-amber-500/30 dark:text-amber-200'
                          : 'border-slate-200 bg-white/60 text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400'
                      }`}
                    >
                      {editHasChanges() ? `${editChangedKeys().length} change(s)` : 'No changes'}
                    </span>
                  </div>
                </div>

                <div class="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-[12px] text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
                  <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Notes</div>
                  <ul class="mt-2 space-y-1 text-[12px] text-slate-600 dark:text-slate-300">
                    <li>Changes apply on next start.</li>
                    <li>Stop the instance before editing (required).</li>
                  </ul>
                  <Show when={editRisk().length > 0}>
                    <div class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
                      <div class="text-xs font-semibold uppercase tracking-wider text-amber-700/80 dark:text-amber-200/80">Risk</div>
                      <ul class="mt-1 space-y-1">
                        <For each={editRisk()}>{(r) => <li>{r}</li>}</For>
                      </ul>
                    </div>
                  </Show>
                </div>

                <div class="mt-5 space-y-3">
                  <label class="block text-sm text-slate-700 dark:text-slate-300">
                    Display name (optional)
                    <input
                      class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                      value={editDisplayName()}
                      onInput={(e) => setEditDisplayName(e.currentTarget.value)}
                      placeholder="e.g. friends-survival"
                    />
                    <Show when={editFieldErrors().display_name}>
                      <div class="mt-1 text-xs text-rose-700 dark:text-rose-300">{editFieldErrors().display_name}</div>
                    </Show>
                  </label>

                  <Show when={editTemplateId() === 'demo:sleep'}>
                    <label class="block text-sm text-slate-700 dark:text-slate-300">
                      seconds
                      <input
                        class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                        value={editSleepSeconds()}
                        onInput={(e) => setEditSleepSeconds(e.currentTarget.value)}
                      />
                      <Show when={editFieldErrors().seconds}>
                        <div class="mt-1 text-xs text-rose-700 dark:text-rose-300">{editFieldErrors().seconds}</div>
                      </Show>
                    </label>
                  </Show>

                  <Show when={editTemplateId() === 'minecraft:vanilla'}>
                    <div class="space-y-3 rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                      <div class="flex items-center justify-between">
                        <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Minecraft</div>
                        <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 text-[11px] font-mono text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                          EULA accepted
                        </span>
                      </div>

                      <div class="grid grid-cols-2 gap-3">
                        <div>
                          <div class="flex items-center justify-between">
                            <div class="text-sm text-slate-700 dark:text-slate-300">Version</div>
                            <button
                              type="button"
                              class={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide transition-all ${
                                editMcVersionAdvanced()
                                  ? 'border-amber-300 bg-amber-500/10 text-amber-800 dark:border-amber-500/30 dark:text-amber-200'
                                  : 'border-slate-300 bg-white/60 text-slate-600 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:bg-slate-900'
                              }`}
                              onClick={() =>
                                setEditMcVersionAdvanced((v) => {
                                  const next = !v
                                  if (next && !editMcVersionCustom().trim()) setEditMcVersionCustom(editMcVersion())
                                  return next
                                })
                              }
                              title="Advanced: type any Mojang version id"
                            >
                              ADV
                            </button>
                          </div>
                          <div class="mt-1">
                            <Show
                              when={!editMcVersionAdvanced()}
                              fallback={
                                <input
                                  class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                                  value={editMcVersionCustom()}
                                  onInput={(e) => setEditMcVersionCustom(e.currentTarget.value)}
                                  placeholder="e.g. 1.20.4"
                                />
                              }
                            >
                              <Dropdown label="" value={editMcVersion()} options={mcVersionOptions()} onChange={setEditMcVersion} />
                            </Show>
                            <Show when={editFieldErrors().version}>
                              <div class="mt-1 text-xs text-rose-700 dark:text-rose-300">{editFieldErrors().version}</div>
                            </Show>
                          </div>
                        </div>

                        <div>
                          <div class="text-sm text-slate-700 dark:text-slate-300">Memory</div>
                          <div class="mt-1">
                            <Dropdown label="" value={editMcMemoryPreset()} options={mcMemoryOptions()} onChange={setEditMcMemoryPreset} />
                          </div>
                          <Show when={editMcMemoryPreset() === 'custom'}>
                            <input
                              class="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                              value={editMcMemory()}
                              onInput={(e) => setEditMcMemory(e.currentTarget.value)}
                              placeholder="2048"
                            />
                          </Show>
                          <Show when={editFieldErrors().memory_mb}>
                            <div class="mt-1 text-xs text-rose-700 dark:text-rose-300">{editFieldErrors().memory_mb}</div>
                          </Show>
                        </div>
                      </div>

                      <div class="grid grid-cols-2 gap-3">
                        <label class="block text-sm text-slate-700 dark:text-slate-300">
                          Port
                          <input
                            class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                            value={editMcPort()}
                            onInput={(e) => setEditMcPort(e.currentTarget.value)}
                            placeholder="0 for auto"
                          />
                          <Show when={editFieldErrors().port}>
                            <div class="mt-1 text-xs text-rose-700 dark:text-rose-300">{editFieldErrors().port}</div>
                          </Show>
                        </label>
                        <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                          <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Tip</div>
                          <div class="mt-1">Use port 0 to auto-assign a free port on next start.</div>
                        </div>
                      </div>
                    </div>
                  </Show>

                  <Show when={editTemplateId() === 'terraria:vanilla'}>
                    <div class="space-y-3 rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                      <div class="flex items-center justify-between">
                        <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Terraria</div>
                        <button
                          type="button"
                          class={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide transition-all ${
                            editTrVersionAdvanced()
                              ? 'border-amber-300 bg-amber-500/10 text-amber-800 dark:border-amber-500/30 dark:text-amber-200'
                              : 'border-slate-300 bg-white/60 text-slate-600 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:bg-slate-900'
                          }`}
                          onClick={() =>
                            setEditTrVersionAdvanced((v) => {
                              const next = !v
                              if (next && !editTrVersionCustom().trim()) setEditTrVersionCustom(editTrVersion())
                              return next
                            })
                          }
                          title="Advanced: type any package id (e.g. 1453)"
                        >
                          ADV
                        </button>
                      </div>

                      <div class="grid grid-cols-2 gap-3">
                        <label class="block text-sm text-slate-700 dark:text-slate-300">
                          Version
                          <Show
                            when={!editTrVersionAdvanced()}
                            fallback={
                              <input
                                class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                                value={editTrVersionCustom()}
                                onInput={(e) => setEditTrVersionCustom(e.currentTarget.value)}
                                placeholder="1453"
                              />
                            }
                          >
                            <input
                              class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                              value={editTrVersion()}
                              onInput={(e) => setEditTrVersion(e.currentTarget.value)}
                              placeholder="1453"
                            />
                          </Show>
                          <Show when={editFieldErrors().version}>
                            <div class="mt-1 text-xs text-rose-700 dark:text-rose-300">{editFieldErrors().version}</div>
                          </Show>
                        </label>
                        <label class="block text-sm text-slate-700 dark:text-slate-300">
                          Port
                          <input
                            class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                            value={editTrPort()}
                            onInput={(e) => setEditTrPort(e.currentTarget.value)}
                            placeholder="0 for auto"
                          />
                          <Show when={editFieldErrors().port}>
                            <div class="mt-1 text-xs text-rose-700 dark:text-rose-300">{editFieldErrors().port}</div>
                          </Show>
                        </label>
                      </div>

                      <div class="grid grid-cols-2 gap-3">
                        <label class="block text-sm text-slate-700 dark:text-slate-300">
                          Max players
                          <input
                            class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                            value={editTrMaxPlayers()}
                            onInput={(e) => setEditTrMaxPlayers(e.currentTarget.value)}
                            placeholder="8"
                          />
                          <Show when={editFieldErrors().max_players}>
                            <div class="mt-1 text-xs text-rose-700 dark:text-rose-300">{editFieldErrors().max_players}</div>
                          </Show>
                        </label>
                        <label class="block text-sm text-slate-700 dark:text-slate-300">
                          World size (1/2/3)
                          <input
                            class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                            value={editTrWorldSize()}
                            onInput={(e) => setEditTrWorldSize(e.currentTarget.value)}
                            placeholder="1"
                          />
                          <Show when={editFieldErrors().world_size}>
                            <div class="mt-1 text-xs text-rose-700 dark:text-rose-300">{editFieldErrors().world_size}</div>
                          </Show>
                        </label>
                      </div>

                      <div class="grid grid-cols-2 gap-3">
                        <label class="block text-sm text-slate-700 dark:text-slate-300">
                          World name
                          <input
                            class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                            value={editTrWorldName()}
                            onInput={(e) => setEditTrWorldName(e.currentTarget.value)}
                            placeholder="world"
                          />
                          <Show when={editFieldErrors().world_name}>
                            <div class="mt-1 text-xs text-rose-700 dark:text-rose-300">{editFieldErrors().world_name}</div>
                          </Show>
                        </label>

                        <label class="block text-sm text-slate-700 dark:text-slate-300">
                          Password (optional)
                          <div class="mt-1 flex gap-2">
                            <input
                              type={editTrPasswordVisible() ? 'text' : 'password'}
                              class="w-full flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                              value={editTrPassword()}
                              onInput={(e) => setEditTrPassword(e.currentTarget.value)}
                              placeholder="(empty)"
                            />
                            <button
                              type="button"
                              class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900"
                              onClick={() => setEditTrPasswordVisible((v) => !v)}
                            >
                              {editTrPasswordVisible() ? 'HIDE' : 'SHOW'}
                            </button>
                            <button
                              type="button"
                              class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900"
                              disabled={!editTrPassword()}
                              onClick={async () => safeCopy(editTrPassword())}
                            >
                              COPY
                            </button>
                          </div>
                          <Show when={editFieldErrors().password}>
                            <div class="mt-1 text-xs text-rose-700 dark:text-rose-300">{editFieldErrors().password}</div>
                          </Show>
                        </label>
                      </div>
                    </div>
                  </Show>

                  <Show when={editFormError()}>
                    <div class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                      <div class="font-semibold">Update failed</div>
                      <div class="mt-1">{editFormError()!.message}</div>
                      <Show when={editFormError()!.requestId}>
                        <div class="mt-2 flex items-center justify-between gap-2">
                          <div class="text-[11px] text-rose-700/80 dark:text-rose-200/70 font-mono">req {editFormError()!.requestId}</div>
                          <button
                            type="button"
                            class="rounded-lg border border-rose-200 bg-white/70 px-2 py-1 text-[11px] font-medium text-rose-800 hover:bg-white dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200 dark:hover:bg-rose-950/40"
                            onClick={() => safeCopy(editFormError()!.requestId ?? '')}
                          >
                            COPY
                          </button>
                        </div>
                      </Show>
                    </div>
                  </Show>
                </div>

                <div class="mt-6 flex gap-3">
                  <button
                    type="button"
                    class="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    onClick={() => closeEditModal()}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                    disabled={updateInstance.isPending || !editHasChanges() || editOutgoingParams() == null}
                    onClick={async () => {
                      const base = editBase()
                      const params = editOutgoingParams()
                      if (!base || !params) return

                      setEditFormError(null)
                      setEditFieldErrors({})
                      try {
                        await updateInstance.mutateAsync({
                          instance_id: base.instance_id,
                          params,
                          display_name: editDisplayName().trim() ? editDisplayName().trim() : null,
                        })
                        pushToast('success', 'Updated', 'Instance parameters saved.')
                        closeEditModal()
                        await invalidateInstances()
                      } catch (err) {
                        if (isAlloyApiError(err)) {
                          setEditFormError({ message: err.data.message, requestId: err.data.request_id })
                          setEditFieldErrors(err.data.field_errors ?? {})
                        } else {
                          setEditFormError({ message: err instanceof Error ? err.message : 'unknown error' })
                        }
                      }
                    }}
                  >
                    Save changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Show>

        <Show when={showDiagnosticsModal()}>
          <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              class="absolute inset-0 bg-slate-900/30 backdrop-blur-sm dark:bg-slate-950/70"
              onClick={() => setShowDiagnosticsModal(false)}
            />

            <div
              class="relative w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950"
              role="dialog"
              aria-modal="true"
            >
              <div class="flex items-center justify-between gap-3 border-b border-slate-200 bg-white/70 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/70">
                <div class="min-w-0">
                  <div class="text-xs font-semibold uppercase tracking-wider text-slate-500">Diagnostics</div>
                  <div class="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                    <Show when={controlDiagnostics.data?.request_id} fallback="loading…">
                      req {controlDiagnostics.data?.request_id}
                    </Show>
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  <button
                    class="rounded-lg border border-slate-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm transition-all hover:bg-white hover:shadow active:scale-[0.98] disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
                    disabled={controlDiagnostics.isPending}
                    onClick={async () => {
                      await queryClient.invalidateQueries({ queryKey: ['control.diagnostics', null] })
                    }}
                  >
                    Refresh
                  </button>
                  <button
                    class="rounded-lg border border-slate-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm transition-all hover:bg-white hover:shadow active:scale-[0.98] disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
                    disabled={!controlDiagnostics.data}
                    onClick={async () => {
                      if (!controlDiagnostics.data) return
                      await safeCopy(JSON.stringify(controlDiagnostics.data, null, 2))
                      pushToast('success', 'Copied', 'Diagnostics copied to clipboard.')
                    }}
                  >
                    Copy
                  </button>
                  <button
                    class="rounded-lg border border-slate-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm transition-all hover:bg-white hover:shadow active:scale-[0.98] disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
                    disabled={!controlDiagnostics.data}
                    onClick={() => {
                      if (!controlDiagnostics.data) return
                      downloadJson(`alloy-control-diagnostics.json`, { type: 'alloy-control-diagnostics', ...controlDiagnostics.data })
                    }}
                  >
                    Download
                  </button>
                  <button
                    class="rounded-lg border border-slate-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm transition-all hover:bg-white hover:shadow active:scale-[0.98] dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
                    onClick={() => setShowDiagnosticsModal(false)}
                  >
                    Close
                  </button>
                </div>
              </div>

              <div class="max-h-[80vh] overflow-auto bg-slate-50 p-4 dark:bg-slate-950">
                <Show when={controlDiagnostics.isPending}>
                  <div class="grid gap-3 sm:grid-cols-2">
                    <div class="h-28 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
                    <div class="h-28 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
                  </div>
                </Show>

                <Show when={controlDiagnostics.isError}>
                  <div class="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                    Failed to load diagnostics.
                  </div>
                </Show>

                <Show when={controlDiagnostics.data}>
                  {(d) => (
                    <div class="grid gap-4 lg:grid-cols-3">
                      <div class="space-y-4 lg:col-span-2">
                        <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                          <div class="flex flex-wrap items-center justify-between gap-2">
                            <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Control</div>
                            <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                              <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono dark:border-slate-800 dark:bg-slate-950/40">
                                v{d().control_version}
                              </span>
                              <span
                                class={`rounded-full border px-2 py-0.5 font-mono ${
                                  d().read_only
                                    ? 'border-amber-300 bg-amber-500/10 text-amber-800 dark:border-amber-500/30 dark:text-amber-200'
                                    : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200'
                                }`}
                              >
                                {d().read_only ? 'read-only' : 'writable'}
                              </span>
                              <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono dark:border-slate-800 dark:bg-slate-950/40">
                                fs-write {d().fs.write_enabled ? 'on' : 'off'}
                              </span>
                            </div>
                          </div>
                          <div class="mt-3 text-[12px] text-slate-600 dark:text-slate-300">
                            fetched {new Date(Number(d().fetched_at_unix_ms)).toLocaleString()}
                          </div>
                        </div>

                        <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                          <div class="flex items-center justify-between">
                            <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Agent</div>
                            <span
                              class={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                                d().agent.ok
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200'
                                  : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200'
                              }`}
                            >
                              {d().agent.ok ? 'connected' : 'offline'}
                            </span>
                          </div>

                          <div class="mt-3 space-y-2 text-[12px] text-slate-600 dark:text-slate-300">
                            <div class="flex items-center justify-between gap-3">
                              <div class="text-slate-500 dark:text-slate-400">Endpoint</div>
                              <div class="min-w-0 truncate font-mono text-[11px]" title={d().agent.endpoint}>
                                {d().agent.endpoint}
                              </div>
                            </div>
                            <Show when={d().agent.agent_version}>
                              <div class="flex items-center justify-between gap-3">
                                <div class="text-slate-500 dark:text-slate-400">Version</div>
                                <div class="font-mono text-[11px]">{d().agent.agent_version}</div>
                              </div>
                            </Show>
                            <Show when={d().agent.data_root}>
                              <div class="flex items-center justify-between gap-3">
                                <div class="text-slate-500 dark:text-slate-400">Data root</div>
                                <div class="min-w-0 truncate font-mono text-[11px]" title={d().agent.data_root ?? ''}>
                                  {d().agent.data_root}
                                </div>
                              </div>
                            </Show>
                            <Show when={d().agent.data_root_free_bytes}>
                              <div class="flex items-center justify-between gap-3">
                                <div class="text-slate-500 dark:text-slate-400">Free space</div>
                                <div class="font-mono text-[11px]">{formatBytes(Number(d().agent.data_root_free_bytes))}</div>
                              </div>
                            </Show>
                            <Show when={d().agent.error}>
                              <div class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                                {d().agent.error}
                              </div>
                            </Show>
                          </div>
                        </div>

                        <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                          <div class="flex items-center justify-between gap-3">
                            <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Cache</div>
                            <button
                              class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-800 shadow-sm transition-all hover:bg-rose-100 hover:shadow active:scale-[0.98] disabled:opacity-50 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200 dark:shadow-none dark:hover:bg-rose-950/30"
                              disabled={clearCache.isPending}
                              onClick={async () => {
                                const keys = Object.entries(cacheSelection())
                                  .filter(([, v]) => v)
                                  .map(([k]) => k)
                                if (!keys.length) {
                                  pushToast('info', 'No selection', 'Select caches to clear first.')
                                  return
                                }
                                try {
                                  const out = await clearCache.mutateAsync({ keys })
                                  pushToast('success', 'Cache cleared', `Freed ${formatBytes(Number(out.freed_bytes))}`)
                                  await queryClient.invalidateQueries({ queryKey: ['control.diagnostics', null] })
                                  await queryClient.invalidateQueries({ queryKey: ['process.cacheStats', null] })
                                } catch (e) {
                                  toastError('Clear cache failed', e)
                                }
                              }}
                            >
                              Clear selected
                            </button>
                          </div>

                          <div class="mt-3 space-y-2">
                            <For each={d().cache.entries}>
                              {(e) => (
                                <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/40">
                                  <label class="flex items-center gap-2 text-[12px] text-slate-700 dark:text-slate-200">
                                    <input
                                      type="checkbox"
                                      class="h-4 w-4 rounded border-slate-300 bg-white text-rose-600 focus:ring-rose-400 dark:border-slate-700 dark:bg-slate-950/60 dark:text-rose-400"
                                      checked={cacheSelection()[e.key] ?? false}
                                      onChange={(ev) =>
                                        setCacheSelection((prev) => ({ ...prev, [e.key]: ev.currentTarget.checked }))
                                      }
                                    />
                                    <span class="font-mono text-[11px]">{e.key}</span>
                                  </label>
                                  <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                    <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono dark:border-slate-800 dark:bg-slate-950/40">
                                      {formatBytes(Number(e.size_bytes))}
                                    </span>
                                    <span
                                      class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono dark:border-slate-800 dark:bg-slate-950/40"
                                      title={new Date(Number(e.last_used_unix_ms)).toLocaleString()}
                                    >
                                      {formatRelativeTime(Number(e.last_used_unix_ms))}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </For>
                            <div class="text-[11px] text-slate-500 dark:text-slate-400">
                              Clearing cache removes downloaded jars/zips. Next start will re-download.
                            </div>
                          </div>
                        </div>
                      </div>

                      <div class="space-y-4">
                        <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                          <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Agent log (tail)</div>
                          <Show
                            when={(d().agent_log_lines ?? []).length > 0}
                            fallback={<div class="mt-3 text-[12px] text-slate-500">(no log data)</div>}
                          >
                            <pre class="mt-3 max-h-64 overflow-auto rounded-xl bg-slate-950 px-3 py-2 text-[11px] leading-relaxed text-slate-100">
                              <For each={d().agent_log_lines}>{(l) => <div class="whitespace-pre-wrap">{l}</div>}</For>
                            </pre>
                          </Show>
                          <Show when={d().agent_log_path}>
                            <div class="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                              <span class="truncate font-mono">{d().agent_log_path}</span>
                              <button
                                type="button"
                                class="rounded-lg border border-slate-200 bg-white/70 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900"
                                onClick={() => safeCopy(d().agent_log_path ?? '')}
                              >
                                COPY
                              </button>
                            </div>
                          </Show>
                        </div>
                      </div>
                    </div>
                  )}
                </Show>
              </div>
            </div>
          </div>
        </Show>

        <Show when={showLogsModal() && selectedInstanceId() != null}>
          <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              class="absolute inset-0 bg-slate-900/40 backdrop-blur-sm dark:bg-slate-950/70"
              onClick={() => setShowLogsModal(false)}
            />

            <div
              class="relative w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950"
              role="dialog"
              aria-modal="true"
            >
	              <div class="flex items-center justify-between gap-3 border-b border-slate-200 bg-white/70 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/70">
	                <div class="min-w-0">
	                  <div class="text-xs font-semibold uppercase tracking-wider text-slate-500">Terminal</div>
	                  <div class="mt-0.5 truncate font-mono text-[11px] text-slate-500">
	                    {selectedInstanceId() ?? ''}
	                  </div>
	                  <Show when={selectedInstanceStatus()}>
	                    <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
	                      <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 dark:border-slate-800 dark:bg-slate-950/40">
	                        {instanceStateLabel(selectedInstanceStatus())}
	                      </span>
	                      <Show when={selectedInstanceStatus()?.exit_code != null}>
	                        <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono dark:border-slate-800 dark:bg-slate-950/40">
	                          exit {selectedInstanceStatus()?.exit_code}
	                        </span>
	                      </Show>
	                      <Show when={selectedInstanceStatus()?.message != null}>
	                        <span class="truncate">{selectedInstanceMessage()}</span>
	                      </Show>
	                    </div>
	                  </Show>
	                </div>
	                <div class="flex items-center gap-2">
	                  <div class="flex items-center gap-2 text-[11px] text-slate-500">
	                    <span
                      class={`h-1.5 w-1.5 rounded-full ${statusDotClass({ loading: logs.isPending, error: logs.isError })}`}
                      title={logs.isPending ? 'loading' : logs.isError ? 'error' : 'live'}
	                    />
	                    <span>{logs.isPending ? 'loading' : logs.isError ? 'error' : 'live'}</span>
	                  </div>
	                  <button
	                    class="rounded-lg border border-slate-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm transition-all hover:bg-white hover:shadow active:scale-[0.98] disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
	                    disabled={instanceDiagnostics.isPending || selectedInstance() == null}
	                    onClick={async () => {
	                      const inst = selectedInstance()
	                      if (!inst) return
	                      const cfg = {
	                        ...inst.config,
	                        params: { ...(inst.config.params as Record<string, string>) },
	                      }
	                      if ('password' in cfg.params) cfg.params.password = '<redacted>'
	                      const diag = await instanceDiagnostics.mutateAsync({
	                        instance_id: inst.config.instance_id,
	                        max_lines: 600,
	                        limit_bytes: 512 * 1024,
	                      })

	                      const payload = {
	                        type: 'alloy-instance-diagnostics',
	                        ...diag,
	                        config: cfg,
	                        status: inst.status ?? null,
	                        process_logs_tail: logs.data?.lines ?? [],
	                      }

	                      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
	                      const url = URL.createObjectURL(blob)
	                      const a = document.createElement('a')
	                      a.href = url
	                      a.download = `alloy-${inst.config.instance_id}-diagnostics.json`
	                      a.click()
	                      URL.revokeObjectURL(url)
	                    }}
	                  >
	                    DIAG
	                  </button>
	                  <button
	                    class="rounded-lg border border-slate-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm transition-all hover:bg-white hover:shadow active:scale-[0.98] disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
	                    disabled={selectedInstance() == null}
	                    onClick={async () => {
	                      const inst = selectedInstance()
	                      if (!inst) return
	                      const cfg = {
	                        ...inst.config,
	                        params: { ...(inst.config.params as Record<string, string>) },
	                      }
	                      if ('password' in cfg.params) cfg.params.password = '<redacted>'
	                      const payload = {
	                        instance_id: inst.config.instance_id,
	                        template_id: inst.config.template_id,
	                        config: cfg,
	                        status: inst.status ?? null,
	                        logs_tail: logs.data?.lines ?? [],
	                      }
	                      await safeCopy(JSON.stringify(payload, null, 2))
	                    }}
	                  >
	                    COPY
	                  </button>
	                  <button
	                    class="rounded-lg border border-slate-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm transition-all hover:bg-white hover:shadow active:scale-[0.98] dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
	                    onClick={() => setShowLogsModal(false)}
	                  >
                    Close
                  </button>
                </div>
              </div>

              <div class="bg-slate-950">
                <pre class="h-[70vh] overflow-auto px-4 py-3 text-[11px] leading-relaxed text-slate-100">
                  <Show when={(logs.data?.lines ?? []).length > 0} fallback={<div class="text-slate-400">(no output yet)</div>}>
                    <For each={logs.data?.lines ?? []}>{(l) => <div class="whitespace-pre-wrap">{l}</div>}</For>
                  </Show>
                </pre>
              </div>
            </div>
          </div>
        </Show>

        <Portal>
          <div class="pointer-events-none fixed bottom-4 right-4 z-[9999] flex w-[360px] flex-col gap-2">
            <For each={toasts()}>
              {(t) => (
                <div
                  class={`pointer-events-auto overflow-hidden rounded-2xl border bg-white/80 shadow-2xl shadow-slate-900/10 backdrop-blur transition-all duration-150 animate-in fade-in zoom-in-95 dark:bg-slate-950/80 ${
                    t.variant === 'success'
                      ? 'border-emerald-200 dark:border-emerald-900/40'
                      : t.variant === 'error'
                        ? 'border-rose-200 dark:border-rose-900/40'
                        : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div class="p-3">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div
                          class={`text-sm font-semibold ${
                            t.variant === 'success'
                              ? 'text-emerald-900 dark:text-emerald-200'
                              : t.variant === 'error'
                                ? 'text-rose-900 dark:text-rose-200'
                                : 'text-slate-900 dark:text-slate-100'
                          }`}
                        >
                          {t.title}
                        </div>
                        <Show when={t.message}>
                          <div class="mt-1 text-[12px] text-slate-600 dark:text-slate-300">{t.message}</div>
                        </Show>
                      </div>
                      <button
                        type="button"
                        class="rounded-lg border border-slate-200 bg-white/70 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900"
                        onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                      >
                        Close
                      </button>
                    </div>

                    <Show when={t.requestId}>
                      <div class="mt-2 flex items-center justify-between gap-2">
                        <div class="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">req {t.requestId}</div>
                        <button
                          type="button"
                          class="rounded-lg border border-slate-200 bg-white/70 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900"
                          onClick={() => safeCopy(t.requestId ?? '')}
                        >
                          COPY
                        </button>
                      </div>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Portal>

    </div>
  )
}

export default App
