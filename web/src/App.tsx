import { isAlloyApiError, onAuthEvent, queryClient, rspc } from './rspc'
import { createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { ProcessStatusDto } from './bindings'
import { ensureCsrfCookie, login, logout, whoami } from './auth'
import { Dropdown } from './components/Dropdown'
import { Banner } from './components/ui/Banner'
import { Badge } from './components/ui/Badge'
import { Button } from './components/ui/Button'
import { Drawer } from './components/ui/Drawer'
import { EmptyState } from './components/ui/EmptyState'
import { ErrorState } from './components/ui/ErrorState'
import { Field } from './components/ui/Field'
import { IconButton } from './components/ui/IconButton'
import { TemplateMark } from './components/ui/TemplateMark'
import { Input } from './components/ui/Input'
import { Link } from './components/ui/Link'
import { Modal } from './components/ui/Modal'
import { Skeleton } from './components/ui/Skeleton'
import { Tabs } from './components/ui/Tabs'
import { Textarea } from './components/ui/Textarea'
import { Tooltip } from './components/ui/Tooltip'
import { FileBrowser } from './components/FileBrowser'
import { LogViewer } from './components/LogViewer'
import InstancesPage from './pages/InstancesPage'
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

function startProgressSteps(templateId: string): string[] {
  if (templateId === 'minecraft:vanilla') return ['Resolve', 'Download', 'Spawn', 'Wait']
  if (templateId === 'terraria:vanilla') return ['Resolve', 'Download', 'Extract', 'Spawn', 'Wait']
  return ['Spawn', 'Wait']
}

function startProgressIndex(templateId: string, message: string): number {
  const m = message.toLowerCase()
  const steps = startProgressSteps(templateId)

  const find = (label: string) => steps.findIndex((s) => s.toLowerCase() === label)
  const clamp = (idx: number) => Math.max(0, Math.min(steps.length - 1, idx))

  if (m.includes('resolve')) return clamp(find('resolve'))
  if (m.includes('download')) return clamp(find('download'))
  if (m.includes('extract')) return clamp(find('extract'))
  if (m.includes('spawn')) return clamp(find('spawn'))
  if (m.includes('wait')) return clamp(find('wait'))
  return 0
}

function StartProgress(props: { templateId: string; message: string }) {
  const steps = () => startProgressSteps(props.templateId)
  const active = () => startProgressIndex(props.templateId, props.message)
  return (
    <div class="mt-2 rounded-xl border border-slate-200 bg-white/60 px-3 py-2 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
      <div class="flex flex-wrap items-center gap-2">
        <For each={steps()}>
          {(s, idx) => {
            const i = idx()
            const state = () => (i < active() ? 'done' : i === active() ? 'active' : 'todo')
            const dot = () =>
              state() === 'done'
                ? 'bg-emerald-400'
                : state() === 'active'
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-slate-400'
            const text = () =>
              state() === 'active' ? 'text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'

            return (
              <div class="flex items-center gap-2">
                <span class={`h-1.5 w-1.5 rounded-full ${dot()}`} aria-hidden="true" />
                <span class={text()}>{s}</span>
                <Show when={i < steps().length - 1}>
                  <span class="text-slate-300 dark:text-slate-700" aria-hidden="true">
                    ›
                  </span>
                </Show>
              </div>
            )
          }}
        </For>

        <span class="ml-auto truncate font-mono text-[11px] text-slate-500 dark:text-slate-400" title={props.message}>
          {props.message}
        </span>
      </div>
    </div>
  )
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

function isSecretParamKey(key: string) {
  const k = key.toLowerCase()
  if (k.includes('password') || k.includes('token') || k.includes('secret')) return true
  if (k.includes('frp') && k.includes('config')) return true
  return false
}

function parseFrpcIniEndpoint(config: string | null | undefined): string | null {
  const raw = (config ?? '').trim()
  if (!raw) return null

  let serverAddr: string | null = null
  let remotePort: string | null = null
  let section: string | null = null

  for (const lineRaw of raw.split('\n')) {
    const line = lineRaw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue

    const sec = /^\[(.+)\]$/.exec(line)
    if (sec) {
      section = sec[1].trim().toLowerCase()
      continue
    }

    const kv = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)\s*$/.exec(line)
    if (!kv) continue
    const key = kv[1].trim().toLowerCase()
    let val = kv[2].trim()
    // Strip simple inline comments.
    val = val.replace(/\s*[#;].*$/, '').trim()
    val = val.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')

    if (section === 'common') {
      if (key === 'server_addr') serverAddr = val
      continue
    }

    if (key === 'remote_port' && remotePort == null) remotePort = val
  }

  if (!serverAddr || !remotePort) return null
  return `${serverAddr}:${remotePort}`
}

function LabelTip(props: { label: string; content: JSX.Element }) {
  return (
    <Tooltip content={props.content}>
      <span class="cursor-help underline decoration-dotted underline-offset-4">{props.label}</span>
    </Tooltip>
  )
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

function parsePort(value: unknown): number | null {
  if (value == null) return null
  const n = Number.parseInt(String(value), 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function instancePort(info: { config: { template_id: string; params: unknown } }): number | null {
  const params = info.config.params as Record<string, unknown> | null | undefined
  return parsePort(params?.port)
}

function connectHost() {
  try {
    return window.location.hostname || 'localhost'
  } catch {
    return 'localhost'
  }
}

function defaultControlWsUrl() {
  try {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const host = window.location.host || 'localhost'
    return `${proto}://${host}/agent/ws`
  } catch {
    return 'ws://<panel-host>/agent/ws'
  }
}

function shortId(id: string, head = 8, tail = 4): string {
  const s = id.trim()
  if (s.length <= head + tail + 1) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}

function optionsWithCurrentValue(
  options: { value: string; label: string; meta?: string }[],
  currentValue: string,
): { value: string; label: string; meta?: string }[] {
  const v = currentValue.trim()
  if (!v) return options
  if (options.some((o) => o.value === v)) return options
  return [{ value: v, label: v }, ...options]
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
  let createInstanceNameEl: HTMLInputElement | undefined
  let createSleepSecondsEl: HTMLInputElement | undefined
  let createMcEulaEl: HTMLInputElement | undefined
  let createMcPortEl: HTMLInputElement | undefined
  let createMcMemoryCustomEl: HTMLInputElement | undefined
  let createMcFrpConfigEl: HTMLTextAreaElement | undefined
  let createTrPortEl: HTMLInputElement | undefined
  let createTrMaxPlayersEl: HTMLInputElement | undefined
  let createTrWorldNameEl: HTMLInputElement | undefined
  let createTrWorldSizeEl: HTMLInputElement | undefined
  let createTrPasswordEl: HTMLInputElement | undefined
  let createTrFrpConfigEl: HTMLTextAreaElement | undefined
  let editDisplayNameEl: HTMLInputElement | undefined
  let editSleepSecondsEl: HTMLInputElement | undefined
  let editMcMemoryCustomEl: HTMLInputElement | undefined
  let editMcPortEl: HTMLInputElement | undefined
  let editMcFrpConfigEl: HTMLTextAreaElement | undefined
  let editTrPortEl: HTMLInputElement | undefined
  let editTrMaxPlayersEl: HTMLInputElement | undefined
  let editTrWorldNameEl: HTMLInputElement | undefined
  let editTrWorldSizeEl: HTMLInputElement | undefined
  let editTrPasswordEl: HTMLInputElement | undefined
  let editTrFrpConfigEl: HTMLTextAreaElement | undefined

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

  type TemplateOption = { value: string; label: string; meta: string }
  const templateOptions = createMemo<TemplateOption[]>(() =>
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
  const [instanceCompact, setInstanceCompact] = createSignal(false)
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
      if (typeof parsed?.compact === 'boolean') setInstanceCompact(parsed.compact)
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
          compact: instanceCompact(),
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
    const opts = [{ value: 'all', label: 'All templates' }]
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
    { value: 'all', label: 'All statuses' },
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
    setEditTrFrpEnabled(false)
    setEditTrFrpConfig('')
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
    setEditTrFrpEnabled(false)
    setEditTrFrpConfig('')

    setEditDisplayName(base.display_name ?? '')

    if (base.template_id === 'demo:sleep') {
      setEditSleepSeconds(params.seconds ?? '60')
    }

    if (base.template_id === 'minecraft:vanilla') {
      const v = (params.version ?? 'latest_release').trim() || 'latest_release'
      setEditMcVersion(v)

      const mem = (params.memory_mb ?? '2048').trim() || '2048'
      const preset = mcMemoryOptions().some((o) => o.value === mem) ? mem : 'custom'
      setEditMcMemoryPreset(preset)
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
  const [editMcMemoryPreset, setEditMcMemoryPreset] = createSignal('2048')
  const [editMcMemory, setEditMcMemory] = createSignal('2048')
  const [editMcPort, setEditMcPort] = createSignal('')
  const [editMcFrpEnabled, setEditMcFrpEnabled] = createSignal(false)
  const [editMcFrpConfig, setEditMcFrpConfig] = createSignal('')

  const [editTrVersion, setEditTrVersion] = createSignal('1453')
  const [editTrPort, setEditTrPort] = createSignal('')
  const [editTrMaxPlayers, setEditTrMaxPlayers] = createSignal('8')
  const [editTrWorldName, setEditTrWorldName] = createSignal('world')
  const [editTrWorldSize, setEditTrWorldSize] = createSignal('1')
  const [editTrPassword, setEditTrPassword] = createSignal('')
  const [editTrPasswordVisible, setEditTrPasswordVisible] = createSignal(false)
  const [editTrFrpEnabled, setEditTrFrpEnabled] = createSignal(false)
  const [editTrFrpConfig, setEditTrFrpConfig] = createSignal('')

  const [editAdvanced, setEditAdvanced] = createSignal(false)

  const editTemplateId = createMemo(() => editBase()?.template_id ?? null)

  const editMcEffectiveVersion = createMemo(() => editMcVersion())

  const editTrEffectiveVersion = createMemo(() => editTrVersion())

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
      if (!editMcFrpEnabled()) delete out.frp_config
      else if (editMcFrpConfig().trim()) out.frp_config = editMcFrpConfig()
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
      else if (editTrFrpConfig().trim()) out.frp_config = editTrFrpConfig()
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

  const [mcEula, setMcEula] = createSignal(false)
  const [mcVersion, setMcVersion] = createSignal('latest_release')
  const [mcMemoryPreset, setMcMemoryPreset] = createSignal('2048')
  const [mcMemory, setMcMemory] = createSignal('2048')
  const [mcPort, setMcPort] = createSignal('')
  const [mcFrpEnabled, setMcFrpEnabled] = createSignal(false)
  const [mcFrpConfig, setMcFrpConfig] = createSignal('')

  const [trVersion, setTrVersion] = createSignal('1453')
  const [trPort, setTrPort] = createSignal('')
  const [trMaxPlayers, setTrMaxPlayers] = createSignal('8')
  const [trWorldName, setTrWorldName] = createSignal('world')
  const [trWorldSize, setTrWorldSize] = createSignal('1')
  const [trPassword, setTrPassword] = createSignal('')
  const [trPasswordVisible, setTrPasswordVisible] = createSignal(false)
  const [trFrpEnabled, setTrFrpEnabled] = createSignal(false)
  const [trFrpConfig, setTrFrpConfig] = createSignal('')

  const [createAdvanced, setCreateAdvanced] = createSignal(false)
  const createAdvancedDirty = createMemo(() => {
    const template = selectedTemplate()
    if (template === 'minecraft:vanilla') return mcPort().trim().length > 0 || mcFrpEnabled() || mcFrpConfig().trim().length > 0
    if (template === 'terraria:vanilla') {
      if (trPort().trim()) return true
      const ws = trWorldSize().trim()
      if (ws && ws !== '1') return true
      if (trPassword().trim()) return true
      if (trFrpEnabled() || trFrpConfig().trim()) return true
      return false
    }
    return false
  })

  const createPreview = createMemo(() => {
    const template_id = selectedTemplate()
    const templateLabel = templateOptions().find((o) => o.value === template_id)?.label ?? template_id

    const rows: { label: string; value: string; isSecret?: boolean }[] = []

    const name = instanceName().trim()
    if (name) rows.push({ label: 'Name', value: name })

    const warnings: string[] = []

    if (template_id === 'demo:sleep') {
      rows.push({ label: 'Seconds', value: sleepSeconds().trim() || '60' })
    }

    if (template_id === 'minecraft:vanilla') {
      const v = mcVersion().trim() || 'latest_release'
      rows.push({ label: 'Version', value: v })
      rows.push({ label: 'Memory (MB)', value: (mcMemory().trim() || mcMemoryPreset().trim() || '2048') })

      const portRaw = mcPort().trim()
      const portLabel = !portRaw || portRaw === '0' ? 'auto' : portRaw
      rows.push({ label: 'Port', value: portLabel })
      rows.push({
        label: 'Connect',
        value: portLabel === 'auto' ? 'TBD (auto port)' : `${connectHost()}:${portLabel}`,
      })

      if (mcFrpEnabled()) {
        const ep = parseFrpcIniEndpoint(mcFrpConfig())
        rows.push({ label: 'FRP', value: ep ?? '(enabled)' })
        if (!mcFrpConfig().trim()) warnings.push('Paste FRP config or disable FRP.')
      }

      if (!mcEula()) warnings.push('Accept the Minecraft EULA to start.')
    }

    if (template_id === 'terraria:vanilla') {
      const v = trVersion().trim() || '1453'
      rows.push({ label: 'Version', value: v })

      const portRaw = trPort().trim()
      const portLabel = !portRaw || portRaw === '0' ? 'auto' : portRaw
      rows.push({ label: 'Port', value: portLabel })
      rows.push({
        label: 'Connect',
        value: portLabel === 'auto' ? 'TBD (auto port)' : `${connectHost()}:${portLabel}`,
      })

      if (trFrpEnabled()) {
        const ep = parseFrpcIniEndpoint(trFrpConfig())
        rows.push({ label: 'FRP', value: ep ?? '(enabled)' })
        if (!trFrpConfig().trim()) warnings.push('Paste FRP config or disable FRP.')
      }

      rows.push({ label: 'Max players', value: trMaxPlayers().trim() || '8' })
      rows.push({ label: 'World name', value: trWorldName().trim() || 'world' })
      rows.push({ label: 'World size', value: trWorldSize().trim() || '1' })
      rows.push({ label: 'Password', value: trPassword().trim() ? '(set)' : '(none)', isSecret: true })

    }

    return { template_id, templateLabel, rows, warnings }
  })

  createEffect(() => {
    // Clear create-form errors when switching templates.
    selectedTemplate()
    setCreateFormError(null)
    setCreateFieldErrors({})
    setCreateAdvanced(false)
    setMcFrpEnabled(false)
    setMcFrpConfig('')
    setTrFrpEnabled(false)
    setTrFrpConfig('')
  })

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

  function focusFirstCreateError(errors: Record<string, string>) {
    const template_id = selectedTemplate()
    const order: string[] =
      template_id === 'demo:sleep'
        ? ['seconds', 'display_name']
        : template_id === 'minecraft:vanilla'
          ? ['accept_eula', 'version', 'memory_mb', 'port', 'frp_config', 'display_name']
          : template_id === 'terraria:vanilla'
            ? ['version', 'max_players', 'world_name', 'port', 'world_size', 'password', 'frp_config', 'display_name']
            : ['display_name']

    const needsAdvanced =
      !createAdvanced() &&
      (Boolean(errors.port) || Boolean(errors.world_size) || Boolean(errors.password) || Boolean(errors.frp_config))
    if (needsAdvanced) setCreateAdvanced(true)

    const run = () => {
      for (const key of order) {
        if (!errors[key]) continue

        if (key === 'display_name' && focusEl(createInstanceNameEl)) return
        if (key === 'seconds' && focusEl(createSleepSecondsEl)) return

        if (template_id === 'minecraft:vanilla') {
          if (key === 'accept_eula' && focusEl(createMcEulaEl)) return
          if (key === 'port' && focusEl(createMcPortEl)) return
          if (key === 'frp_config' && focusEl(createMcFrpConfigEl)) return
          if (key === 'memory_mb' && mcMemoryPreset() === 'custom' && focusEl(createMcMemoryCustomEl)) return
        }

        if (template_id === 'terraria:vanilla') {
          if (key === 'port' && focusEl(createTrPortEl)) return
          if (key === 'world_size' && focusEl(createTrWorldSizeEl)) return
          if (key === 'password' && focusEl(createTrPasswordEl)) return
          if (key === 'frp_config' && focusEl(createTrFrpConfigEl)) return
          if (key === 'world_name' && focusEl(createTrWorldNameEl)) return
          if (key === 'max_players' && focusEl(createTrMaxPlayersEl)) return
        }
      }
    }

    if (needsAdvanced) requestAnimationFrame(run)
    else queueMicrotask(run)
  }

  function focusFirstEditError(errors: Record<string, string>) {
    const template_id = editTemplateId()
    if (!template_id) return

    const order: string[] =
      template_id === 'demo:sleep'
        ? ['display_name', 'seconds']
        : template_id === 'minecraft:vanilla'
          ? ['display_name', 'version', 'memory_mb', 'port', 'frp_config']
          : template_id === 'terraria:vanilla'
            ? ['display_name', 'version', 'max_players', 'world_name', 'port', 'world_size', 'password', 'frp_config']
            : ['display_name']

    const needsAdvanced =
      !editAdvanced() &&
      (Boolean(errors.port) || Boolean(errors.world_size) || Boolean(errors.password) || Boolean(errors.frp_config))
    if (needsAdvanced) setEditAdvanced(true)

    const run = () => {
      for (const key of order) {
        if (!errors[key]) continue

        if (key === 'display_name' && focusEl(editDisplayNameEl)) return
        if (key === 'seconds' && focusEl(editSleepSecondsEl)) return

        if (template_id === 'minecraft:vanilla') {
          if (key === 'port' && focusEl(editMcPortEl)) return
          if (key === 'frp_config' && focusEl(editMcFrpConfigEl)) return
          if (key === 'memory_mb' && editMcMemoryPreset() === 'custom' && focusEl(editMcMemoryCustomEl)) return
        }

        if (template_id === 'terraria:vanilla') {
          if (key === 'port' && focusEl(editTrPortEl)) return
          if (key === 'max_players' && focusEl(editTrMaxPlayersEl)) return
          if (key === 'world_name' && focusEl(editTrWorldNameEl)) return
          if (key === 'world_size' && focusEl(editTrWorldSizeEl)) return
          if (key === 'password' && focusEl(editTrPasswordEl)) return
          if (key === 'frp_config' && focusEl(editTrFrpConfigEl)) return
        }
      }
    }

    if (needsAdvanced) requestAnimationFrame(run)
    else queueMicrotask(run)
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
  const selectedInstanceDisplayName = createMemo(() => {
    const inst = selectedInstance() as any
    if (!inst) return null
    const params = inst.config?.params as Record<string, unknown> | null | undefined
    const paramName = params?.name
    if (typeof inst.config?.display_name === 'string' && inst.config.display_name.trim()) return inst.config.display_name.trim()
    if (typeof paramName === 'string' && paramName.trim()) return paramName.trim()
    const templateId = inst.config?.template_id
    if (typeof templateId === 'string' && templateId.trim()) {
      return templateOptions().find((o) => o.value === templateId)?.label ?? templateId
    }
    return inst.config?.instance_id ?? null
  })

  const [showInstanceModal, setShowInstanceModal] = createSignal(false)
  type InstanceDetailTab = 'overview' | 'logs' | 'files' | 'config'
  const [instanceDetailTab, setInstanceDetailTab] = createSignal<InstanceDetailTab>('logs')

  type TailLine = { text: string; received_at_unix_ms: number }
  const MAX_PROCESS_LOG_LINES = 600
  const [processLogCursor, setProcessLogCursor] = createSignal<string | null>(null)
  const [processLogLive, setProcessLogLive] = createSignal(true)
  const [processLogLines, setProcessLogLines] = createSignal<TailLine[]>([])

  createEffect(() => {
    // Reset log tail state when switching instance.
    selectedInstanceId()
    setProcessLogCursor(null)
    setProcessLogLines([])
    setProcessLogLive(true)
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

  const createNode = rspc.createMutation(() => 'node.create')
  const [showCreateNodeModal, setShowCreateNodeModal] = createSignal(false)
  const [createNodeName, setCreateNodeName] = createSignal('')
  const [createNodeControlWsUrl, setCreateNodeControlWsUrl] = createSignal(defaultControlWsUrl())
  const [createNodeFieldErrors, setCreateNodeFieldErrors] = createSignal<Record<string, string>>({})
  const [createNodeFormError, setCreateNodeFormError] = createSignal<string | null>(null)
  const [createNodeResult, setCreateNodeResult] = createSignal<NodeCreateResult | null>(null)
  let createNodeNameEl: HTMLInputElement | undefined

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
    requestAnimationFrame(() => createNodeNameEl?.focus())
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
                <path d="M10.75 2.5a.75.75 0 00-1.5 0V3.2a6.8 6.8 0 00-2.98 1.235l-.5-.5a.75.75 0 10-1.06 1.06l.5.5A6.8 6.8 0 003.2 9.25H2.5a.75.75 0 000 1.5h.7a6.8 6.8 0 001.235 2.98l-.5.5a.75.75 0 101.06 1.06l.5-.5A6.8 6.8 0 009.25 16.8v.7a.75.75 0 001.5 0v-.7a6.8 6.8 0 002.98-1.235l.5.5a.75.75 0 101.06-1.06l-.5-.5a6.8 6.8 0 001.235-2.98h.7a.75.75 0 000-1.5h-.7a6.8 6.8 0 00-1.235-2.98l.5-.5a.75.75 0 10-1.06-1.06l-.5.5A6.8 6.8 0 0010.75 3.2V2.5z" />
                <path d="M10 6.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z" />
              </svg>
              <Show when={sidebarExpanded()}>
                <span class="text-sm font-medium">Instances</span>
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
          </div>

          <div class={`mt-auto flex w-full flex-col items-center gap-2 pb-2 ${sidebarExpanded() ? 'px-1' : ''}`}>
            <IconButton
              label={sidebarExpanded() ? 'Collapse sidebar' : 'Expand sidebar'}
              variant="ghost"
              onClick={() => setSidebarExpanded((v) => !v)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                <path
                  fill-rule="evenodd"
                  d="M6.22 5.22a.75.75 0 011.06 0L11 8.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L6.22 6.28a.75.75 0 010-1.06z"
                  clip-rule="evenodd"
                />
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
                  <Show
                    when={themePref() === 'light'}
                    fallback={
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                        <path
                          fill-rule="evenodd"
                          d="M4.75 3A2.75 2.75 0 002 5.75v6.5A2.75 2.75 0 004.75 15H9v1.25H7.75a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5H11V15h4.25A2.75 2.75 0 0018 12.25v-6.5A2.75 2.75 0 0015.25 3H4.75zm-.25 2.75c0-.69.56-1.25 1.25-1.25h8.5c.69 0 1.25.56 1.25 1.25v6.5c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25v-6.5z"
                          clip-rule="evenodd"
                        />
                      </svg>
                    }
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                      <path
                        fill-rule="evenodd"
                        d="M10 2a.75.75 0 01.75.75V4a.75.75 0 01-1.5 0V2.75A.75.75 0 0110 2zm0 12a4 4 0 100-8 4 4 0 000 8zm0 3a.75.75 0 01.75.75V18a.75.75 0 01-1.5 0v-1.25A.75.75 0 0110 17zm8-7a.75.75 0 01-.75.75H16a.75.75 0 010-1.5h1.25A.75.75 0 0118 10zm-14.5 0a.75.75 0 01-.75.75H2.75a.75.75 0 010-1.5H3.5A.75.75 0 014.25 10zm10.657-5.657a.75.75 0 010 1.06l-.884.884a.75.75 0 11-1.06-1.06l.884-.884a.75.75 0 011.06 0zM6.287 14.713a.75.75 0 010 1.06l-.884.884a.75.75 0 11-1.06-1.06l.884-.884a.75.75 0 011.06 0zm9.37 0a.75.75 0 01-1.06 0l-.884-.884a.75.75 0 111.06-1.06l.884.884a.75.75 0 010 1.06zm-9.37-9.37a.75.75 0 01-1.06 0l-.884-.884a.75.75 0 011.06-1.06l.884.884a.75.75 0 010 1.06z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </Show>
                }
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                  <path
                    fill-rule="evenodd"
                    d="M17.293 13.293A8 8 0 016.707 2.707a8 8 0 1010.586 10.586z"
                    clip-rule="evenodd"
                  />
                </svg>
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
              <Show when={tab() === 'instances'}>
                <InstancesPage
                  tabLabel={tab()}
                  left={
                    <div class="space-y-3">
	                      <Field
	                        label="Name (optional)"
	                      >
                        <Input
                          ref={(el) => {
                            createInstanceNameEl = el
                          }}
                          value={instanceName()}
                          onInput={(e) => setInstanceName(e.currentTarget.value)}
                          placeholder="e.g. survival-1"
                          spellcheck={false}
                        />
                      </Field>

                      <Field label="Template" required>
                        <Dropdown
                          label=""
                          value={selectedTemplate()}
                          options={templateOptions()}
                          disabled={templates.isPending || templateOptions().length === 0}
                          placeholder={templates.isPending ? 'Loading templates...' : 'No templates'}
                          onChange={setSelectedTemplate}
                        />
                      </Field>

	                      <Show when={selectedTemplate() === 'demo:sleep'}>
	                        <Field
	                          label="Seconds"
	                          required
	                          error={createFieldErrors().seconds}
	                        >
                          <Input
                            ref={(el) => {
                              createSleepSecondsEl = el
                            }}
                            type="number"
                            value={sleepSeconds()}
                            onInput={(e) => setSleepSeconds(e.currentTarget.value)}
                            invalid={Boolean(createFieldErrors().seconds)}
                          />
                        </Field>
                      </Show>

                      <Show when={selectedTemplate() === 'minecraft:vanilla'}>
                        <div class="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                          <div class="flex items-center justify-between gap-3">
                            <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                              Minecraft settings
                            </div>
                            <Button
                              size="xs"
                              variant={createAdvanced() ? 'secondary' : 'ghost'}
                              onClick={() => setCreateAdvanced((v) => !v)}
                              title="Show or hide advanced fields"
                            >
                              <span class="inline-flex items-center gap-2">
                                {createAdvanced() ? 'Hide advanced' : 'Advanced'}
                                <Show when={!createAdvanced() && createAdvancedDirty()}>
                                  <span class="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                                </Show>
                              </span>
                            </Button>
                          </div>

                          <div class="rounded-2xl border border-slate-200 bg-white/70 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                            <label for="mc-eula" class="flex items-start gap-3 text-sm text-slate-800 dark:text-slate-300">
                              <input
                                ref={(el) => {
                                  createMcEulaEl = el
                                }}
                                id="mc-eula"
                                type="checkbox"
                                class="mt-0.5 h-4 w-4 rounded border-slate-300 bg-white text-amber-600 focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:border-slate-700 dark:bg-slate-950/60 dark:text-amber-400 dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950"
                                checked={mcEula()}
                                onChange={(e) => setMcEula(e.currentTarget.checked)}
                              />
                              <span class="leading-tight">
                                I agree to the{' '}
                                <Link
                                  href="https://account.mojang.com/documents/minecraft_eula"
                                  target="_blank"
                                  rel="noreferrer noopener"
                                >
                                  Minecraft EULA
                                </Link>
                                <span class="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                                  Required to start server.
                                </span>
                              </span>
                            </label>
                            <Show when={createFieldErrors().accept_eula}>
                              <div class="mt-2 text-[12px] text-rose-700 dark:text-rose-300">{createFieldErrors().accept_eula}</div>
                            </Show>
                          </div>

	                          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		                            <Field
		                              label={<LabelTip label="Version" content="Use Latest release unless you know you need a specific version." />}
		                              error={createFieldErrors().version}
		                            >
                              <div class="space-y-2">
                                <Dropdown
                                  label=""
                                  value={mcVersion()}
                                  options={optionsWithCurrentValue(mcVersionOptions(), mcVersion())}
                                  onChange={setMcVersion}
                                />
                              </div>
	                            </Field>

	                            <Field
	                              label={
	                                <LabelTip
	                                  label="Memory (MB)"
	                                  content="Sets JVM heap size. Too low can crash; too high can starve the host."
	                                />
	                              }
	                              error={createFieldErrors().memory_mb}
	                            >
                              <div class="space-y-2">
                                <Dropdown
                                  label=""
                                  value={mcMemoryPreset()}
                                  options={mcMemoryOptions()}
                                  onChange={(v) => {
                                    setMcMemoryPreset(v)
                                    if (v !== 'custom') setMcMemory(v)
                                  }}
                                />
                                <Show when={mcMemoryPreset() === 'custom'}>
                                  <Input
                                    ref={(el) => {
                                      createMcMemoryCustomEl = el
                                    }}
                                    type="number"
                                    value={mcMemory()}
                                    onInput={(e) => setMcMemory(e.currentTarget.value)}
                                    invalid={Boolean(createFieldErrors().memory_mb)}
                                  />
                                </Show>
                              </div>
                            </Field>
                          </div>

	                          <Show when={createAdvanced()}>
	                            <div class="space-y-3">
	                              <Field
	                                label={<LabelTip label="Port (optional)" content="Leave blank for auto-assign." />}
	                                error={createFieldErrors().port}
	                              >
                                <Input
                                  ref={(el) => {
                                    createMcPortEl = el
                                  }}
                                  type="number"
                                  value={mcPort()}
                                  onInput={(e) => setMcPort(e.currentTarget.value)}
                                  placeholder="25565"
                                  invalid={Boolean(createFieldErrors().port)}
                                />
                              </Field>

	                              <Field
	                                label={<LabelTip label="Public (FRP)" content="Optional. Paste an frpc config to expose this instance via FRP." />}
	                                error={createFieldErrors().frp_config}
	                              >
	                                <div class="space-y-2">
	                                  <label class="inline-flex items-center gap-2 text-[12px] text-slate-700 dark:text-slate-200">
	                                    <input
	                                      type="checkbox"
	                                      class="h-4 w-4 rounded border-slate-300 bg-white text-amber-600 focus:ring-amber-400 dark:border-slate-700 dark:bg-slate-950/60 dark:text-amber-400"
	                                      checked={mcFrpEnabled()}
	                                      onChange={(e) => setMcFrpEnabled(e.currentTarget.checked)}
	                                    />
	                                    <span>Enable</span>
	                                  </label>
	                                  <Show when={mcFrpEnabled()}>
	                                    <Textarea
	                                      ref={(el) => {
	                                        createMcFrpConfigEl = el
	                                      }}
	                                      value={mcFrpConfig()}
	                                      onInput={(e) => setMcFrpConfig(e.currentTarget.value)}
	                                      placeholder="Paste frpc config (INI)"
	                                      spellcheck={false}
	                                      class="font-mono text-[11px]"
	                                      invalid={Boolean(createFieldErrors().frp_config)}
	                                    />
	                                  </Show>
	                                </div>
	                              </Field>
	                            </div>
                          </Show>
                        </div>
                      </Show>

                      <Show when={selectedTemplate() === 'terraria:vanilla'}>
                        <div class="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                          <div class="flex items-center justify-between gap-3">
                            <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                              Terraria settings
                            </div>
                            <Button
                              size="xs"
                              variant={createAdvanced() ? 'secondary' : 'ghost'}
                              onClick={() => setCreateAdvanced((v) => !v)}
                              title="Show or hide advanced fields"
                            >
                              <span class="inline-flex items-center gap-2">
                                {createAdvanced() ? 'Hide advanced' : 'Advanced'}
                                <Show when={!createAdvanced() && createAdvancedDirty()}>
                                  <span class="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                                </Show>
                              </span>
                            </Button>
                          </div>

	                          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		                            <Field
		                              label={
		                                <LabelTip
		                                  label="Version"
		                                  content="Package id (e.g. 1453). Stick to latest unless you need compatibility."
		                                />
		                              }
		                              error={createFieldErrors().version}
		                            >
                              <div class="space-y-2">
                                <Dropdown
                                  label=""
                                  value={trVersion()}
                                  options={optionsWithCurrentValue(trVersionOptions(), trVersion())}
                                  onChange={setTrVersion}
                                />
                              </div>
		                            </Field>

		                            <Field
		                              label={<LabelTip label="Max players" content="Maximum concurrent players allowed to join." />}
		                              error={createFieldErrors().max_players}
		                            >
                              <Input
                                ref={(el) => {
                                  createTrMaxPlayersEl = el
                                }}
                                type="number"
                                value={trMaxPlayers()}
                                onInput={(e) => setTrMaxPlayers(e.currentTarget.value)}
                                invalid={Boolean(createFieldErrors().max_players)}
                              />
                            </Field>
                          </div>

	                          <Field
	                            label={
	                              <LabelTip
	                                label="World name"
	                                content="Changing it uses a different world file (existing worlds are not deleted)."
	                              />
	                            }
	                            error={createFieldErrors().world_name}
	                          >
                            <Input
                              ref={(el) => {
                                createTrWorldNameEl = el
                              }}
                              value={trWorldName()}
                              onInput={(e) => setTrWorldName(e.currentTarget.value)}
                              invalid={Boolean(createFieldErrors().world_name)}
                            />
                          </Field>

                          <Show when={createAdvanced()}>
                            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
	                              <Field
	                                label={<LabelTip label="Port (optional)" content="Leave blank for auto-assign." />}
	                                error={createFieldErrors().port}
	                              >
                                <Input
                                  ref={(el) => {
                                    createTrPortEl = el
                                  }}
                                  type="number"
                                  value={trPort()}
                                  onInput={(e) => setTrPort(e.currentTarget.value)}
                                  placeholder="7777"
                                  invalid={Boolean(createFieldErrors().port)}
                                />
                              </Field>

		                              <Field
		                                label={<LabelTip label="World size (1/2/3)" content="1=small, 2=medium, 3=large." />}
		                                error={createFieldErrors().world_size}
		                              >
                                <Input
                                  ref={(el) => {
                                    createTrWorldSizeEl = el
                                  }}
                                  type="number"
                                  value={trWorldSize()}
                                  onInput={(e) => setTrWorldSize(e.currentTarget.value)}
                                  invalid={Boolean(createFieldErrors().world_size)}
                                />
                              </Field>
                            </div>

		                            <Field
		                              label={<LabelTip label="Password (optional)" content="Optional join password." />}
		                              error={createFieldErrors().password}
		                            >
	                              <div class="flex flex-wrap items-center gap-2">
	                                <Input
	                                  ref={(el) => {
	                                    createTrPasswordEl = el
	                                  }}
	                                  type={trPasswordVisible() ? 'text' : 'password'}
	                                  value={trPassword()}
	                                  onInput={(e) => setTrPassword(e.currentTarget.value)}
	                                  invalid={Boolean(createFieldErrors().password)}
	                                  class="min-w-[220px] flex-1"
	                                />
	                                <IconButton
	                                  type="button"
	                                  size="sm"
	                                  variant="secondary"
	                                  label={trPasswordVisible() ? 'Hide password' : 'Show password'}
	                                  onClick={() => setTrPasswordVisible((v) => !v)}
	                                >
	                                  <Show
	                                    when={trPasswordVisible()}
	                                    fallback={
	                                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                                        <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
	                                        <path
	                                          fill-rule="evenodd"
	                                          d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.382.147.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
	                                          clip-rule="evenodd"
	                                        />
	                                      </svg>
	                                    }
	                                  >
	                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                                      <path d="M13.359 11.238l1.36 1.36a4 4 0 01-5.317-5.317l1.36 1.36a2.5 2.5 0 002.597 2.597z" />
	                                      <path
	                                        fill-rule="evenodd"
	                                        d="M2 4.25a.75.75 0 011.28-.53l14.5 14.5a.75.75 0 11-1.06 1.06l-2.294-2.294A9.961 9.961 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41a1.651 1.651 0 010-1.186 10.03 10.03 0 012.924-4.167L2.22 3.78A.75.75 0 012 4.25zm6.12 6.12a2.5 2.5 0 003.51 3.51l-3.51-3.51z"
	                                        clip-rule="evenodd"
	                                      />
	                                      <path d="M12.454 8.214L9.31 5.07A4 4 0 0114.93 10.69l-2.476-2.476z" />
	                                      <path d="M15.765 12.585l1.507 1.507a10.03 10.03 0 002.064-3.502 1.651 1.651 0 000-1.186A10.004 10.004 0 0010 3a9.961 9.961 0 00-3.426.608l1.65 1.65A8.473 8.473 0 0110 4.5c3.49 0 6.574 2.138 7.773 5.5a8.5 8.5 0 01-2.008 2.585z" />
	                                    </svg>
	                                  </Show>
	                                </IconButton>
	                                <IconButton
	                                  type="button"
	                                  size="sm"
	                                  variant="secondary"
	                                  label="Copy password"
	                                  disabled={!trPassword().trim()}
	                                  onClick={() => void safeCopy(trPassword())}
	                                >
	                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                                    <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
	                                    <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
	                                  </svg>
	                                </IconButton>
	                              </div>
	                            </Field>

	                            <Field
	                              label={<LabelTip label="Public (FRP)" content="Optional. Paste an frpc config to expose this instance via FRP." />}
	                              error={createFieldErrors().frp_config}
	                            >
	                              <div class="space-y-2">
	                                <label class="inline-flex items-center gap-2 text-[12px] text-slate-700 dark:text-slate-200">
	                                  <input
	                                    type="checkbox"
	                                    class="h-4 w-4 rounded border-slate-300 bg-white text-amber-600 focus:ring-amber-400 dark:border-slate-700 dark:bg-slate-950/60 dark:text-amber-400"
	                                    checked={trFrpEnabled()}
	                                    onChange={(e) => setTrFrpEnabled(e.currentTarget.checked)}
	                                  />
	                                  <span>Enable</span>
	                                </label>
	                                <Show when={trFrpEnabled()}>
	                                  <Textarea
	                                    ref={(el) => {
	                                      createTrFrpConfigEl = el
	                                    }}
	                                    value={trFrpConfig()}
	                                    onInput={(e) => setTrFrpConfig(e.currentTarget.value)}
	                                    placeholder="Paste frpc config (INI)"
	                                    spellcheck={false}
	                                    class="font-mono text-[11px]"
	                                    invalid={Boolean(createFieldErrors().frp_config)}
	                                  />
	                                </Show>
	                              </div>
	                            </Field>
                          </Show>
                        </div>
                      </Show>

                      <div class="rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                        <div class="flex items-center justify-between gap-3">
                          <div class="text-section-title">Preview</div>
                          <div class="flex min-w-0 items-center justify-end gap-2">
                            <Show when={createPreview().warnings.length > 0}>
                              <Tooltip
                                content={
                                  <div class="space-y-1">
                                    <For each={createPreview().warnings}>{(w) => <div class="whitespace-pre-wrap">{w}</div>}</For>
                                  </div>
                                }
                              >
                                <Badge variant="warning" class="cursor-help">
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-3 w-3">
                                    <path
                                      fill-rule="evenodd"
                                      d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.515 2.625H3.72c-1.345 0-2.188-1.458-1.515-2.625l6.28-10.875zM10 6.75a.75.75 0 00-.75.75v3.5a.75.75 0 001.5 0v-3.5A.75.75 0 0010 6.75zm0 7a.75.75 0 100-1.5.75.75 0 000 1.5z"
                                      clip-rule="evenodd"
                                    />
                                  </svg>
                                  {createPreview().warnings.length}
                                </Badge>
                              </Tooltip>
                            </Show>
                            <TemplateMark templateId={createPreview().template_id} class="h-8 w-8" />
                          </div>
                        </div>
                        <div class="mt-2 space-y-1.5">
                          <For each={createPreview().rows}>
                            {(row) => (
                              <div class="flex items-start justify-between gap-4 text-[12px]">
                                <div class="text-slate-500 dark:text-slate-400">{row.label}</div>
                                <div
                                  class={`min-w-0 truncate font-mono text-[11px] ${
                                    row.isSecret ? 'text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-200'
                                  }`}
                                  title={row.value}
                                >
                                  {row.value}
                                </div>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>

                      <div class="grid grid-cols-2 gap-2">
	                        <Button
	                          class="w-full"
	                          size="md"
	                          variant="primary"
	                          leftIcon={
	                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                              <path
	                                fill-rule="evenodd"
	                                d="M10 4.25a.75.75 0 01.75.75v4.25H15a.75.75 0 010 1.5h-4.25V15a.75.75 0 01-1.5 0v-4.25H5a.75.75 0 010-1.5h4.25V5a.75.75 0 01.75-.75z"
	                                clip-rule="evenodd"
	                              />
	                            </svg>
	                          }
	                          loading={createInstance.isPending}
	                          disabled={isReadOnly()}
	                          title={isReadOnly() ? 'Read-only mode' : 'Create instance'}
                          onClick={async () => {
                            const template_id = selectedTemplate()
                            const params: Record<string, string> = {}
                            const display_name = instanceName().trim() ? instanceName().trim() : null

                            setCreateFormError(null)
                            setCreateFieldErrors({})

                            const localErrors: Record<string, string> = {}

                            if (template_id === 'demo:sleep') {
                              params.seconds = sleepSeconds()
                            } else if (template_id === 'minecraft:vanilla') {
                              if (!mcEula()) localErrors.accept_eula = 'You must accept the EULA to start a Minecraft server.'
                              if (mcFrpEnabled() && !mcFrpConfig().trim()) localErrors.frp_config = 'Paste frpc config.'
                              params.accept_eula = 'true'
                              const v = mcVersion().trim()
                              params.version = v || 'latest_release'
                              params.memory_mb = mcMemory() || '2048'
                              if (mcPort().trim()) params.port = mcPort().trim()
                              if (mcFrpEnabled() && mcFrpConfig().trim()) params.frp_config = mcFrpConfig().trim()
                            } else if (template_id === 'terraria:vanilla') {
                              const v = trVersion().trim()
                              params.version = v || '1453'
                              if (trPort().trim()) params.port = trPort().trim()
                              params.max_players = trMaxPlayers().trim() || '8'
                              params.world_name = trWorldName().trim() || 'world'
                              params.world_size = trWorldSize().trim() || '1'
                              if (trPassword().trim()) params.password = trPassword().trim()
                              if (trFrpEnabled() && !trFrpConfig().trim()) localErrors.frp_config = 'Paste frpc config.'
                              if (trFrpEnabled() && trFrpConfig().trim()) params.frp_config = trFrpConfig().trim()
                            }

                            if (Object.keys(localErrors).length > 0) {
                              setCreateFieldErrors(localErrors)
                              queueMicrotask(() => focusFirstCreateError(localErrors))
                              return
                            }

                            try {
                              const out = await createInstance.mutateAsync({ template_id, params, display_name })
                              pushToast('success', 'Instance created', display_name ?? undefined)
                              await invalidateInstances()
                              revealInstance(out.instance_id)
                              setSelectedInstanceId(out.instance_id)
                            } catch (e) {
                              if (isAlloyApiError(e)) {
                                setCreateFieldErrors(e.data.field_errors ?? {})
                                setCreateFormError({ message: e.data.message, requestId: e.data.request_id })
                                if (e.data.hint) pushToast('info', 'Hint', e.data.hint, e.data.request_id)
                                queueMicrotask(() => focusFirstCreateError(e.data.field_errors ?? {}))
                              } else {
                                setCreateFormError({ message: e instanceof Error ? e.message : 'unknown error' })
                              }
                            }
                          }}
                        >
                          Create
                        </Button>

	                        <Button
	                          class="w-full"
	                          size="md"
	                          variant="secondary"
	                          leftIcon={
	                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                              <path
	                                fill-rule="evenodd"
	                                d="M10 2.75a.75.75 0 01.75.75v6.69l2.22-2.22a.75.75 0 111.06 1.06l-3.5 3.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 111.06-1.06l2.22 2.22V3.5a.75.75 0 01.75-.75zM3.5 13.25a.75.75 0 01.75.75v1.25c0 .69.56 1.25 1.25 1.25h9c.69 0 1.25-.56 1.25-1.25V14a.75.75 0 011.5 0v1.25A2.75 2.75 0 0114.5 18h-9a2.75 2.75 0 01-2.75-2.75V14a.75.75 0 01.75-.75z"
	                                clip-rule="evenodd"
	                              />
	                            </svg>
	                          }
	                          loading={warmCache.isPending}
	                          disabled={
	                            isReadOnly() ||
                            createInstance.isPending ||
                            !['minecraft:vanilla', 'terraria:vanilla'].includes(selectedTemplate())
                          }
                          title={isReadOnly() ? 'Read-only mode' : 'Only download required files (no start)'}
                          onClick={async () => {
                            const template_id = selectedTemplate()
                            const params: Record<string, string> = {}
                            if (template_id === 'minecraft:vanilla') {
                              const v = mcVersion().trim()
                              params.version = v || 'latest_release'
                            }
                            if (template_id === 'terraria:vanilla') {
                              const v = trVersion().trim()
                              params.version = v || '1453'
                            }
                            try {
                              const out = await warmCache.mutateAsync({ template_id, params })
                              pushToast('success', 'Cache warmed', out.message)
                            } catch (e) {
                              toastError('Warm cache failed', e)
                            }
                          }}
                        >
                          Warm
                        </Button>
                      </div>
                      <Show when={warmCache.isPending}>
                        <div class="mt-2 rounded-xl border border-slate-200 bg-white/60 px-3 py-2 text-[12px] text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
                          Downloading and preparing server files… This can take a while.
                        </div>
                      </Show>
                      <Show when={createFormError()}>
                        <div class="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                          <div class="font-semibold">Create failed</div>
                          <div class="mt-1 text-xs text-rose-800/90 dark:text-rose-200/90">{createFormError()!.message}</div>
		                          <Show when={createFormError()!.requestId}>
		                            <div class="mt-2 flex items-center justify-between gap-2">
		                              <div class="text-[11px] text-rose-700/80 dark:text-rose-200/70 font-mono">req {createFormError()!.requestId}</div>
		                              <IconButton
		                                size="sm"
		                                variant="danger"
		                                label="Copy request id"
		                                onClick={() => void safeCopy(createFormError()!.requestId ?? '')}
		                              >
		                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
		                                  <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
		                                  <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
		                                </svg>
		                              </IconButton>
		                            </div>
		                          </Show>
	                        </div>
	                      </Show>
                    </div>
                  }
                  right={
                    <>
                      <div class="flex flex-wrap items-center justify-between gap-3">
                        <div class="min-w-0">
                          <div class="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Instances</div>
                          <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                            <span>Updated {formatRelativeTime(instancesLastUpdatedAtUnixMs())}</span>
                            <span class="text-slate-300 dark:text-slate-700">•</span>
                            <span>
                              Showing {filteredInstances().length}/{(instances.data ?? []).length}
                            </span>
                          </div>
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
                          <IconButton
                            type="button"
                            label="Refresh"
                            title="Refresh instances"
                            variant="secondary"
                            disabled={instances.isPending}
                            onClick={() => void invalidateInstances()}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                              <path
                                fill-rule="evenodd"
                                d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466.75.75 0 011.06-1.06 4 4 0 006.764-2.289H13a.75.75 0 010-1.5h2.75a.75.75 0 01.75.75V12.5a.75.75 0 01-1.5 0v-1.076zM4.688 8.576a5.5 5.5 0 019.201-2.466.75.75 0 11-1.06 1.06A4 4 0 006.065 9.46H7a.75.75 0 010 1.5H4.25a.75.75 0 01-.75-.75V7.5a.75.75 0 011.5 0v1.076z"
                                clip-rule="evenodd"
                              />
                            </svg>
                          </IconButton>
	                            <Button
	                              size="xs"
	                              variant="primary"
	                              leftIcon={
	                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                                  <path
	                                    fill-rule="evenodd"
	                                    d="M10 4.25a.75.75 0 01.75.75v4.25H15a.75.75 0 010 1.5h-4.25V15a.75.75 0 01-1.5 0v-4.25H5a.75.75 0 010-1.5h4.25V5a.75.75 0 01.75-.75z"
	                                    clip-rule="evenodd"
	                                  />
	                                </svg>
	                              }
	                              disabled={isReadOnly()}
	                              title={isReadOnly() ? 'Read-only mode' : 'Create a new instance'}
	                              onClick={() => {
                                try {
                                  createInstanceNameEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                } catch {
                                  // ignore
                                }
                                queueMicrotask(() => createInstanceNameEl?.focus())
                              }}
                            >
                              Create
                            </Button>
                        </div>
                      </div>

                      <div class="mt-3 flex flex-wrap items-center gap-2">
                        <div class="w-full sm:w-56 lg:w-64">
                          <Input
                            value={instanceSearchInput()}
                            onInput={(e) => setInstanceSearchInput(e.currentTarget.value)}
                            placeholder="Search…"
                            aria-label="Search instances"
                            spellcheck={false}
                            leftIcon={
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                                <path
                                  fill-rule="evenodd"
                                  d="M9 3.5a5.5 5.5 0 104.473 8.714l2.656 2.657a.75.75 0 101.061-1.06l-2.657-2.657A5.5 5.5 0 009 3.5zM5 9a4 4 0 117.999.001A4 4 0 015 9z"
                                  clip-rule="evenodd"
                                />
                              </svg>
                            }
                            rightIcon={
                              instanceSearchInput().length > 0 ? (
                                <button
                                  type="button"
                                  class="rounded-md p-1 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 dark:hover:bg-slate-900/60"
                                  aria-label="Clear search"
                                  title="Clear search"
                                  onClick={() => {
                                    setInstanceSearchInput('')
                                    setInstanceSearch('')
                                  }}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                                    <path
                                      fill-rule="evenodd"
                                      d="M4.47 4.47a.75.75 0 011.06 0L10 8.94l4.47-4.47a.75.75 0 111.06 1.06L11.06 10l4.47 4.47a.75.75 0 11-1.06 1.06L10 11.06l-4.47 4.47a.75.75 0 11-1.06-1.06L8.94 10 4.47 5.53a.75.75 0 010-1.06z"
                                      clip-rule="evenodd"
                                    />
                                  </svg>
                                </button>
                              ) : undefined
                            }
                          />
                        </div>
                        <div class="w-full sm:w-36">
                          <Dropdown
                            label=""
                            ariaLabel="Filter by status"
                            title={instanceStatusFilter() === 'all' ? 'All statuses' : instanceStatusFilter()}
                            leftIcon={
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                                <path
                                  fill-rule="evenodd"
                                  d="M10 2.25a.75.75 0 01.75.75v6a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75z"
                                  clip-rule="evenodd"
                                />
                                <path
                                  fill-rule="evenodd"
                                  d="M6.22 4.97a.75.75 0 011.06.08.75.75 0 01-.08 1.06 4.75 4.75 0 105.6 0 .75.75 0 01-.08-1.06.75.75 0 011.06-.08 6.25 6.25 0 11-7.48 0z"
                                  clip-rule="evenodd"
                                />
                              </svg>
                            }
                            value={instanceStatusFilter()}
                            options={instanceStatusFilterOptions()}
                            onChange={(v) => setInstanceStatusFilter(v as InstanceStatusFilter)}
                          />
                        </div>
                        <div class="w-full sm:w-44 lg:w-52">
                          <Dropdown
                            label=""
                            ariaLabel="Filter by template"
                            title={instanceTemplateFilter() === 'all' ? 'All templates' : instanceTemplateFilter()}
                            leftIcon={
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                                <path d="M10 2.25l6.5 3.75v7.5L10 17.25 3.5 13.5V6L10 2.25z" />
                                <path d="M10 9.75L3.5 6 10 2.25 16.5 6 10 9.75z" opacity="0.35" />
                                <path d="M10 9.75v7.5l6.5-3.75V6L10 9.75z" opacity="0.35" />
                              </svg>
                            }
                            value={instanceTemplateFilter()}
                            options={instanceTemplateFilterOptions()}
                            onChange={setInstanceTemplateFilter}
                          />
                        </div>
                      </div>

                      <div class="mt-2 flex flex-wrap items-center gap-2">
                        <div class="w-full sm:w-36">
                          <Dropdown
                            label=""
                            ariaLabel="Sort instances"
                            title="Sort"
                            leftIcon={
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                                <path
                                  fill-rule="evenodd"
                                  d="M6 4.25a.75.75 0 01.75.75v9.69l1.72-1.72a.75.75 0 111.06 1.06l-3 3a.75.75 0 01-1.06 0l-3-3a.75.75 0 111.06-1.06l1.72 1.72V5A.75.75 0 016 4.25zm8 0a.75.75 0 01.75.75v9.69l1.72-1.72a.75.75 0 111.06 1.06l-3 3a.75.75 0 01-1.06 0l-3-3a.75.75 0 111.06-1.06l1.72 1.72V5a.75.75 0 01.75-.75z"
                                  clip-rule="evenodd"
                                />
                              </svg>
                            }
                            value={instanceSortKey()}
                            options={instanceSortOptions()}
                            onChange={(v) => setInstanceSortKey(v as InstanceSortKey)}
                          />
                        </div>
                        <label class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/60 px-3 py-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
                          <input
                            type="checkbox"
                            class="h-4 w-4 rounded border-slate-300 bg-white text-amber-600 focus:ring-amber-400 dark:border-slate-700 dark:bg-slate-950/60 dark:text-amber-400"
                            checked={instanceCompact()}
                            onChange={(e) => setInstanceCompact(e.currentTarget.checked)}
                          />
                          Compact
                        </label>
                      </div>

                      <Show when={instances.isError && (instances.error as unknown)}>
                        <ErrorState
                          class="mt-4"
                          title="Failed to load instances"
                          error={instances.error}
                          onRetry={() => void invalidateInstances()}
                        />
                      </Show>

                      <Show when={!instances.isError}>
                        <Show
                          when={instances.isPending}
                          fallback={
                            <Show
                              when={filteredInstances().length > 0}
                              fallback={
                                <EmptyState
                                  class="mt-4"
                                  title={(instances.data ?? []).length === 0 ? 'No instances yet' : 'No matches'}
                                  description={
                                    (instances.data ?? []).length === 0
                                      ? 'Create your first instance to get started.'
                                      : 'Try adjusting search or filters.'
                                  }
                                  actions={
                                    (instances.data ?? []).length === 0 ? (
	                                      <Button
	                                        variant="primary"
	                                        size="md"
	                                        leftIcon={
	                                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                                            <path
	                                              fill-rule="evenodd"
	                                              d="M10 4.25a.75.75 0 01.75.75v4.25H15a.75.75 0 010 1.5h-4.25V15a.75.75 0 01-1.5 0v-4.25H5a.75.75 0 010-1.5h4.25V5a.75.75 0 01.75-.75z"
	                                              clip-rule="evenodd"
	                                            />
	                                          </svg>
	                                        }
	                                        disabled={isReadOnly()}
	                                        title={isReadOnly() ? 'Read-only mode' : 'Create a new instance'}
	                                        onClick={() => {
	                                          try {
                                            createInstanceNameEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                          } catch {
                                            // ignore
                                          }
                                          queueMicrotask(() => createInstanceNameEl?.focus())
                                        }}
                                      >
                                        Create instance
                                      </Button>
                                    ) : undefined
                                  }
                                />
                              }
                            >
                              <div class={`mt-4 grid gap-3 ${instanceCompact() ? 'sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4' : 'sm:grid-cols-2 2xl:grid-cols-3'}`}>
                                <For each={filteredInstances()}>
                          {(i) => (
                              <div
                                ref={(el) => instanceCardEls.set(i.config.instance_id, el)}
                                class={`group rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:bg-white hover:shadow-md active:scale-[0.99] dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none dark:hover:bg-slate-950/60 ${
                                  selectedInstanceId() === i.config.instance_id
                                    ? 'ring-1 ring-amber-500/25'
                                    : highlightInstanceId() === i.config.instance_id
                                      ? 'ring-2 ring-emerald-400/25'
                                      : 'ring-0 ring-transparent'
                                }`}
                              >
                              <div
                                class="w-full cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950"
                                data-instance-card-focus="true"
                                role="button"
                                tabIndex={0}
                                onClick={() => {
                                  setSelectedInstanceId(i.config.instance_id)
                                  setInstanceDetailTab('logs')
                                  setShowInstanceModal(true)
                                }}
                                onKeyDown={(e) => {
                                  if (e.key !== 'Enter' && e.key !== ' ') return
                                  e.preventDefault()
                                  setSelectedInstanceId(i.config.instance_id)
                                  setInstanceDetailTab('logs')
                                  setShowInstanceModal(true)
                                }}
                              >
                                <div class="flex items-start justify-between gap-3">
                                  <div class="min-w-0">
                                    <div class="truncate font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                                      {instanceDisplayName(i)}
                                    </div>
	                                    <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
	                                      <button
	                                        type="button"
	                                        class="group inline-flex max-w-full cursor-pointer items-center gap-1 rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono text-[11px] text-slate-700 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 dark:hover:bg-slate-900 dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950"
	                                        onClick={(e) => {
	                                          e.preventDefault()
	                                          e.stopPropagation()
	                                          void safeCopy(i.config.instance_id)
	                                          pushToast('success', 'Copied ID', shortId(i.config.instance_id))
	                                        }}
	                                        title="Copy instance id"
	                                      >
	                                        <span class="truncate">{shortId(i.config.instance_id)}</span>
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
	                                      </button>
	                                      <Badge
	                                        variant={
	                                          i.status?.state === 'PROCESS_STATE_RUNNING'
	                                            ? 'success'
                                            : i.status?.state === 'PROCESS_STATE_FAILED'
                                              ? 'danger'
                                              : i.status?.state === 'PROCESS_STATE_STARTING' || i.status?.state === 'PROCESS_STATE_STOPPING'
                                                ? 'warning'
                                                : 'neutral'
                                        }
                                        title={i.status?.state ?? 'PROCESS_STATE_EXITED'}
                                      >
                                        {instanceStateLabel(i.status)}
                                      </Badge>
                                      <Show when={instanceStatusKeys()[i.config.instance_id]?.updated_at_unix_ms}>
                                        {(t) => (
                                          <Badge variant="neutral" title={new Date(t()).toLocaleString()}>
                                            {formatRelativeTime(t())}
                                          </Badge>
                                        )}
                                      </Show>
                                      <Show when={instancePort(i)}>
                                        {(p) => {
	                                          const addr = `${connectHost()}:${p()}`
	                                          return (
	                                            <span
	                                              class="group inline-flex max-w-full cursor-pointer items-center gap-1 rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono text-slate-700 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 dark:hover:bg-slate-900 dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950"
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
                                    <Show when={i.status?.state === 'PROCESS_STATE_STARTING' ? i.status?.message?.trim() : null}>
                                      {(msg) => <StartProgress templateId={i.config.template_id} message={msg()} />}
                                    </Show>
                                  </div>
                                  <div class="mt-0.5 flex flex-none items-center gap-2">
                                    <IconButton
                                      type="button"
                                      label={pinnedInstanceIds()[i.config.instance_id] ? 'Unpin instance' : 'Pin instance'}
                                      variant="ghost"
                                      onClick={(e) => {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        togglePinnedInstance(i.config.instance_id)
                                      }}
                                    >
                                      <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        viewBox="0 0 20 20"
                                        fill="currentColor"
                                        class={`h-4 w-4 ${
                                          pinnedInstanceIds()[i.config.instance_id]
                                            ? 'text-amber-500'
                                            : 'text-slate-400 dark:text-slate-500'
                                        }`}
                                        aria-hidden="true"
                                      >
                                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.539 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                      </svg>
                                    </IconButton>

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
                                </div>
                              </div>

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

                              <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
                                <div class="flex flex-wrap items-center gap-2">
                                  <Show
                                    when={canStartInstance(i.status)}
                                    fallback={
	                                      <Button
	                                        size="xs"
	                                        variant="secondary"
	                                        leftIcon={
	                                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                                            <path d="M5.75 5.75A.75.75 0 016.5 5h7a.75.75 0 01.75.75v8.5a.75.75 0 01-.75.75h-7a.75.75 0 01-.75-.75v-8.5z" />
	                                          </svg>
	                                        }
	                                        loading={instanceOpById()[i.config.instance_id] === 'stopping'}
	                                        disabled={
	                                          isReadOnly() ||
	                                          instanceOpById()[i.config.instance_id] != null ||
                                          isStopping(i.status)
                                        }
                                        title={isReadOnly() ? 'Read-only mode' : 'Stop instance'}
                                        onClick={async () => {
                                          try {
                                            await runInstanceOp(i.config.instance_id, 'stopping', () =>
                                              stopInstance.mutateAsync({ instance_id: i.config.instance_id, timeout_ms: 30_000 }),
                                            )
                                            await invalidateInstances()
                                            pushToast('success', 'Stopped', instanceDisplayName(i as unknown as InstanceListItem))
                                          } catch (e) {
                                            toastError('Stop failed', e)
                                          }
                                        }}
                                      >
                                        Stop
                                      </Button>
                                    }
                                  >
	                                    <Button
	                                      size="xs"
	                                      variant="primary"
	                                      leftIcon={
	                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                                          <path d="M4.5 3.25a.75.75 0 011.18-.62l10.5 7.25a.75.75 0 010 1.24l-10.5 7.25A.75.75 0 014.5 17.75V3.25z" />
	                                        </svg>
	                                      }
	                                      loading={instanceOpById()[i.config.instance_id] === 'starting'}
	                                      disabled={isReadOnly() || instanceOpById()[i.config.instance_id] != null}
	                                      title={isReadOnly() ? 'Read-only mode' : 'Start instance'}
                                      onClick={async () => {
                                        try {
                                          await runInstanceOp(i.config.instance_id, 'starting', () =>
                                            startInstance.mutateAsync({ instance_id: i.config.instance_id }),
                                          )
                                          await invalidateInstances()
                                          pushToast('success', 'Started', instanceDisplayName(i as unknown as InstanceListItem))
                                        } catch (e) {
                                          toastError('Start failed', e)
                                        }
                                      }}
                                    >
                                      Start
                                    </Button>
                                  </Show>

                                  <Show when={i.status != null}>
	                                    <Button
	                                      size="xs"
	                                      variant="secondary"
	                                      leftIcon={
	                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                                          <path
	                                            fill-rule="evenodd"
	                                            d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466.75.75 0 011.06-1.06 4 4 0 006.764-2.289H13a.75.75 0 010-1.5h2.75a.75.75 0 01.75.75V12.5a.75.75 0 01-1.5 0v-1.076zM4.688 8.576a5.5 5.5 0 019.201-2.466.75.75 0 11-1.06 1.06A4 4 0 006.065 9.46H7a.75.75 0 010 1.5H4.25a.75.75 0 01-.75-.75V7.5a.75.75 0 011.5 0v1.076z"
	                                            clip-rule="evenodd"
	                                          />
	                                        </svg>
	                                      }
	                                      loading={instanceOpById()[i.config.instance_id] === 'restarting'}
	                                      disabled={
	                                        isReadOnly() ||
	                                        instanceOpById()[i.config.instance_id] != null ||
                                        isStopping(i.status)
                                      }
                                      title={isReadOnly() ? 'Read-only mode' : 'Restart instance'}
                                      onClick={async () => {
                                        try {
                                          await runInstanceOp(i.config.instance_id, 'restarting', () =>
                                            restartInstance.mutateAsync({ instance_id: i.config.instance_id, timeout_ms: 30_000 }),
                                          )
                                          await invalidateInstances()
                                          pushToast('success', 'Restarted', instanceDisplayName(i as unknown as InstanceListItem))
                                        } catch (e) {
                                          toastError('Restart failed', e)
                                        }
                                      }}
                                    >
                                      Restart
                                    </Button>
                                  </Show>
                                </div>

	                                <div class="flex items-center gap-2">
	                                  <div class="flex items-center gap-1.5 max-w-0 overflow-hidden opacity-0 transition-[max-width,opacity] duration-150 invisible group-hover:visible group-hover:max-w-[480px] group-hover:opacity-100 group-hover:overflow-visible group-focus-within:visible group-focus-within:max-w-[480px] group-focus-within:opacity-100 group-focus-within:overflow-visible">
	                                  <IconButton
	                                    type="button"
	                                    label="Edit"
	                                    title={
	                                      isReadOnly()
                                        ? 'Read-only mode'
                                        : !canStartInstance(i.status)
                                          ? 'Stop the instance before editing'
                                          : 'Edit instance parameters'
                                    }
                                    variant="ghost"
                                    disabled={isReadOnly() || !canStartInstance(i.status)}
                                    onClick={() => openEditModal(i)}
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-9.5 9.5a1 1 0 01-.39.242l-3.5 1.166a.5.5 0 01-.632-.632l1.166-3.5a1 1 0 01.242-.39l9.5-9.5z" />
	                                    </svg>
	                                  </IconButton>

                                  <IconButton
                                    type="button"
                                    label="Files"
                                    title="Open instance directory"
                                    variant="ghost"
                                    onClick={() => openInFiles(`instances/${i.config.instance_id}`)}
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                                      <path d="M2 5.75A2.75 2.75 0 014.75 3h4.19a2.75 2.75 0 011.944.806l.56.56c.215.215.507.334.812.334h2.994A2.75 2.75 0 0118 7.45v6.8A2.75 2.75 0 0115.25 17H4.75A2.75 2.75 0 012 14.25v-8.5z" />
                                    </svg>
                                  </IconButton>

                                  <Show when={i.config.template_id === 'minecraft:vanilla'}>
                                    <IconButton
                                      type="button"
                                      label="Log"
                                      title="Open latest.log"
                                      variant="ghost"
                                      onClick={() => openFileInFiles(`instances/${i.config.instance_id}/logs/latest.log`)}
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                                        <path
                                          fill-rule="evenodd"
                                          d="M3.25 4A2.75 2.75 0 016 1.25h5.586c.73 0 1.429.29 1.945.806l2.578 2.578c.516.516.805 1.214.805 1.944V16A2.75 2.75 0 0114.25 18.75H6A2.75 2.75 0 013.25 16V4zm8.5 1.25a.75.75 0 00-.75-.75H6A1.25 1.25 0 004.75 4v12c0 .69.56 1.25 1.25 1.25h8.25c.69 0 1.25-.56 1.25-1.25V7.5h-2.75a1 1 0 01-1-1V5.25z"
                                          clip-rule="evenodd"
                                        />
                                      </svg>
                                    </IconButton>
                                  </Show>

                                  <IconButton
                                    type="button"
                                    label="Delete"
                                    title={
                                      isReadOnly()
                                        ? 'Read-only mode'
                                        : !canStartInstance(i.status)
                                          ? 'Stop the instance before deleting'
                                          : 'Delete instance'
                                    }
                                    variant="danger"
                                    disabled={isReadOnly() || !canStartInstance(i.status)}
                                    onClick={() => setConfirmDeleteInstanceId(i.config.instance_id)}
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                                      <path
                                        fill-rule="evenodd"
                                        d="M8.75 2.75A.75.75 0 019.5 2h1a.75.75 0 01.75.75V3h3.5a.75.75 0 010 1.5h-.918l-.764 10.694A2.75 2.75 0 0111.327 18H8.673a2.75 2.75 0 01-2.741-2.806L5.168 4.5H4.25a.75.75 0 010-1.5h3.5v-.25zm1.5.25v.25h-1.5V3h1.5z"
                                        clip-rule="evenodd"
                                      />
                                    </svg>
	                                  </IconButton>
	                                  </div>
	                                  <TemplateMark templateId={i.config.template_id} />
	                                </div>
	                              </div>
	                            </div>
	                          )}
	                                </For>
	                              </div>
                            </Show>
                          }
                        >
                          <div class={`mt-4 grid gap-3 ${instanceCompact() ? 'sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4' : 'sm:grid-cols-2 2xl:grid-cols-3'}`}>
                            <For each={Array.from({ length: 6 })}>
                              {() => <Skeleton class={instanceCompact() ? 'h-28' : 'h-40'} />}
                            </For>
                          </div>
                        </Show>
                      </Show>

                      {/* Logs are shown in the terminal modal; keep the main view clean. */}
                    </>
                  }
                />
              </Show>

              <Show when={tab() === 'files'}>
                <FileBrowser
                  enabled={isAuthed() && tab() === 'files'}
                  title="Files"
                  initialPath={fsPath()}
                  initialSelectedFile={selectedFilePath()}
                  rootLabel="/data"
                />
              </Show>

              <Show when={tab() === 'nodes'}>
                <NodesPage
                  tabLabel="Nodes"
                  left={
                    <div class="space-y-3">
                      <div class="flex items-center justify-end gap-2">
                        <Show when={me()?.is_admin}>
                          <IconButton type="button" label="Add node" variant="secondary" onClick={() => openCreateNode()}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                              <path
                                fill-rule="evenodd"
                                d="M10 3.25a.75.75 0 01.75.75v5.25H16a.75.75 0 010 1.5h-5.25V16a.75.75 0 01-1.5 0v-5.25H4a.75.75 0 010-1.5h5.25V4a.75.75 0 01.75-.75z"
                                clip-rule="evenodd"
                              />
                            </svg>
                          </IconButton>
                        </Show>
                        <IconButton type="button" label="Refresh" variant="secondary" disabled={nodes.isPending} onClick={() => void invalidateNodes()}>
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                            <path
                              fill-rule="evenodd"
                              d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466.75.75 0 00-1.06 1.06 7 7 0 0011.698-3.132.75.75 0 00-1.437-.394z"
                              clip-rule="evenodd"
                            />
                            <path
                              fill-rule="evenodd"
                              d="M4.688 8.576a5.5 5.5 0 019.201-2.466.75.75 0 001.06-1.06A7 7 0 003.25 8.182a.75.75 0 001.438.394z"
                              clip-rule="evenodd"
                            />
                          </svg>
                        </IconButton>
                      </div>
                      <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span>Updated {formatRelativeTime(nodesLastUpdatedAtUnixMs())}</span>
                        <Show when={nodes.isPending}>
                          <span class="inline-flex items-center gap-1">
                            <span class="h-1.5 w-1.5 rounded-full bg-slate-500 animate-pulse" />
                            loading
                          </span>
                        </Show>
                        <Show when={nodes.isError}>
                          <span class="inline-flex items-center gap-1">
                            <span class="h-1.5 w-1.5 rounded-full bg-rose-500" />
                            error
                          </span>
                        </Show>
                      </div>

                      <Show when={nodes.isError} fallback={<></>}>
                        <ErrorState title="Failed to load nodes" error={nodes.error} onRetry={() => void invalidateNodes()} />
                      </Show>

                      <Show when={!nodes.isError}>
                        <Show when={nodes.isPending} fallback={<></>}>
                          <div class="rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                            <Skeleton lines={6} />
                          </div>
                        </Show>

                        <Show
                          when={!nodes.isPending && (nodes.data ?? []).length > 0}
                          fallback={
                            <Show when={!nodes.isPending}>
                              <EmptyState title="No nodes" description="No nodes registered yet." />
                            </Show>
                          }
                        >
                          <div class="max-h-96 overflow-auto rounded-xl border border-slate-200 bg-white/60 p-1 dark:border-slate-800 dark:bg-slate-950/40">
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
                          </div>
                        </Show>
                      </Show>
                    </div>
                  }
                  right={
                    <>
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Details</div>
                        <IconButton
                          type="button"
                          label="Refresh"
                          title="Refresh nodes"
                          variant="secondary"
                          disabled={nodes.isPending}
                          onClick={() => void invalidateNodes()}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                            <path
                              fill-rule="evenodd"
                              d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466.75.75 0 00-1.06 1.06 7 7 0 0011.698-3.132.75.75 0 00-1.437-.394z"
                              clip-rule="evenodd"
                            />
                            <path
                              fill-rule="evenodd"
                              d="M4.688 8.576a5.5 5.5 0 019.201-2.466.75.75 0 001.06-1.06A7 7 0 003.25 8.182a.75.75 0 001.438.394z"
                              clip-rule="evenodd"
                            />
                          </svg>
                        </IconButton>
                      </div>

                      <div class="mt-3 rounded-xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                        <Show
                          when={nodes.isError}
                          fallback={
                            <Show
                              when={(nodes.data ?? []).length > 0}
                              fallback={<EmptyState title="No nodes" description="There are no nodes to show." />}
                            >
                              <Show
                                when={selectedNode()}
                                fallback={<EmptyState title="Select a node" description="Pick a node from the left to view details." />}
                              >
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
                            </Show>
                          }
                        >
                          <ErrorState title="Failed to load nodes" error={nodes.error} onRetry={() => void invalidateNodes()} />
                        </Show>
                      </div>
                    </>
                  }
                />
              </Show>
              </div>
            </div>
          </main>

        </div>
      </div>


        {/* Legacy UI below the new console layout was accidentally left in place.
            Keep return() to the new layout + modals only. */}

        <Modal
          open={showLoginModal() && !me()}
          onClose={() => setShowLoginModal(false)}
          title="Sign in"
          description="Enter your credentials to access the control plane."
          size="sm"
          initialFocus={() => loginUsernameEl}
          footer={
            <div class="flex gap-3">
              <Button variant="secondary" class="flex-1" onClick={() => setShowLoginModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" class="flex-1" type="submit" form="alloy-login" loading={authLoading()}>
                Sign in
              </Button>
            </div>
          }
        >
          <form
            id="alloy-login"
            class="grid gap-4"
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
            <Field label="Username" required>
              <Input
                ref={(el) => {
                  loginUsernameEl = el
                }}
                value={loginUser()}
                onInput={(ev) => setLoginUser(ev.currentTarget.value)}
                autocomplete="username"
              />
            </Field>
            <Field label="Password" required>
              <Input
                type="password"
                value={loginPass()}
                onInput={(ev) => setLoginPass(ev.currentTarget.value)}
                autocomplete="current-password"
              />
            </Field>

            <Show when={authError()}>
              {(msg) => (
                <div class="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-[12px] text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                  {msg()}
                </div>
              )}
            </Show>
          </form>
        </Modal>

        <Modal
          open={showCreateNodeModal()}
          onClose={() => closeCreateNode()}
          title="Add node"
          description="Creates a one-time token and a docker-compose snippet for an agent to connect back."
          size="lg"
          footer={
            <Show
              when={createNodeResult()}
              fallback={
                <div class="flex gap-3">
                  <Button variant="secondary" class="flex-1" onClick={() => closeCreateNode()}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    class="flex-1"
                    type="submit"
                    form="alloy-create-node"
                    loading={createNode.isPending}
                    disabled={!createNodeName().trim()}
                  >
                    Create
                  </Button>
                </div>
              }
            >
              <div class="flex gap-3">
                <Button variant="secondary" class="flex-1" onClick={() => closeCreateNode()}>
                  Close
                </Button>
              </div>
            </Show>
          }
        >
          <Show
            when={createNodeResult()}
            fallback={
              <form
                id="alloy-create-node"
                class="grid gap-4"
                onSubmit={async (e) => {
                  e.preventDefault()
                  setCreateNodeFieldErrors({})
                  setCreateNodeFormError(null)
                  try {
                    const out = await createNode.mutateAsync({ name: createNodeName().trim() })
                    setCreateNodeResult(out as any)
                    pushToast('success', 'Node created', (out as any).node?.name ?? '')
                    await invalidateNodes()
                    if ((out as any).node?.id) setSelectedNodeId((out as any).node.id)
                  } catch (err) {
                    if (isAlloyApiError(err)) {
                      setCreateNodeFieldErrors(err.data.field_errors ?? {})
                      setCreateNodeFormError(err.data.message)
                      return
                    }
                    setCreateNodeFormError(err instanceof Error ? err.message : 'create failed')
                  }
                }}
              >
                <Field label="Name" required error={createNodeFieldErrors().name}>
                  <Input
                    ref={(el) => {
                      createNodeNameEl = el
                    }}
                    value={createNodeName()}
                    onInput={(e) => setCreateNodeName(e.currentTarget.value)}
                    placeholder="e.g. node-1"
                    spellcheck={false}
                    invalid={Boolean(createNodeFieldErrors().name)}
                  />
                </Field>

                <Field label={<LabelTip label="Control WS URL" content="The agent connects to this websocket endpoint (usually your panel URL)." />}>
                  <Input
                    value={createNodeControlWsUrl()}
                    onInput={(e) => setCreateNodeControlWsUrl(e.currentTarget.value)}
                    placeholder={defaultControlWsUrl()}
                    spellcheck={false}
                  />
                </Field>

                <Show when={createNodeFormError()}>
                  {(msg) => (
                    <div class="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-[12px] text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                      {msg()}
                    </div>
                  )}
                </Show>
              </form>
            }
          >
            {(r) => (
              <div class="space-y-4">
                <div class="rounded-2xl border border-slate-200 bg-white/60 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                  <div class="flex items-center justify-between gap-3">
                    <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Token</div>
                    <IconButton
                      type="button"
                      label="Copy token"
                      variant="secondary"
                      onClick={() => {
                        void safeCopy(r().connect_token)
                        pushToast('success', 'Copied', 'Token copied.')
                      }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                        <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
                        <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
                      </svg>
                    </IconButton>
                  </div>
                  <Input value={r().connect_token} readOnly class="mt-2 font-mono text-[11px]" />
                  <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Save it now — it’s only shown once.</div>
                </div>

                <div class="rounded-2xl border border-slate-200 bg-white/60 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                  <div class="flex items-center justify-between gap-3">
                    <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">docker-compose.yml</div>
                    <IconButton
                      type="button"
                      label="Copy compose"
                      variant="secondary"
                      onClick={() => {
                        void safeCopy(createNodeComposeYaml())
                        pushToast('success', 'Copied', 'Compose copied.')
                      }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                        <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
                        <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
                      </svg>
                    </IconButton>
                  </div>

                  <div class="mt-3">
                    <Field label={<LabelTip label="Control WS URL" content="If your agent can’t reach the panel, update this URL and copy again." />}>
                      <Input
                        value={createNodeControlWsUrl()}
                        onInput={(e) => setCreateNodeControlWsUrl(e.currentTarget.value)}
                        placeholder={defaultControlWsUrl()}
                        spellcheck={false}
                      />
                    </Field>
                  </div>

                  <Textarea value={createNodeComposeYaml()} readOnly class="mt-3 font-mono text-[11px]" />
                </div>
              </div>
            )}
          </Show>
        </Modal>

        <Modal
          open={confirmDeleteInstanceId() != null}
          onClose={() => setConfirmDeleteInstanceId(null)}
          title="Delete instance"
          description="This permanently deletes the instance directory under /data."
          size="sm"
          footer={
            <div class="flex gap-3">
              <Button variant="secondary" class="flex-1" onClick={() => setConfirmDeleteInstanceId(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                class="flex-1"
                disabled={
                  deleteInstance.isPending ||
                  confirmDeleteText().trim() !== (confirmDeleteInstanceId() ?? '') ||
                  !confirmDeleteInstanceId()
                }
                loading={deleteInstance.isPending}
                onClick={async () => {
                  const id = confirmDeleteInstanceId()
                  if (!id) return
                  try {
                    await deleteInstance.mutateAsync({ instance_id: id })
                    if (selectedInstanceId() === id) setSelectedInstanceId(null)
                    pushToast('success', 'Deleted', id)
                    setConfirmDeleteInstanceId(null)
                    await invalidateInstances()
                  } catch (e) {
                    toastError('Delete failed', e)
                  }
                }}
              >
                Delete
              </Button>
            </div>
          }
        >
          <div class="space-y-4">
            <div class="rounded-2xl border border-slate-200 bg-white/60 p-4 text-[12px] text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
              <div class="flex items-center justify-between gap-3">
                <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Delete preview</div>
                <Show when={instanceDeletePreview.isPending}>
                  <span class="text-[11px] text-slate-400">loading…</span>
                </Show>
                <Show when={instanceDeletePreview.isError}>
                  <span class="text-[11px] text-rose-600 dark:text-rose-300">failed</span>
                </Show>
                <Show when={!instanceDeletePreview.isPending && !instanceDeletePreview.isError}>
                  <span class="text-[11px] text-slate-500 dark:text-slate-400">ok</span>
                </Show>
              </div>

              <Show when={instanceDeletePreview.data}>
                {(d) => (
                  <div class="mt-3 space-y-2">
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

              <Show when={instanceDeletePreview.isError}>
                <div class="mt-3 text-[11px] text-rose-700/80 dark:text-rose-200/70">
                  Preview unavailable. You can still delete after confirmation.
                </div>
              </Show>
            </div>

            <Field
              label="Type the instance id to confirm"
              required
              description="Tip: copy/paste the id to avoid typos."
              error={
                confirmDeleteText().trim().length > 0 && confirmDeleteText().trim() !== (confirmDeleteInstanceId() ?? '')
                  ? 'Does not match.'
                  : undefined
              }
            >
              <Input
                value={confirmDeleteText()}
                onInput={(e) => setConfirmDeleteText(e.currentTarget.value)}
                placeholder={confirmDeleteInstanceId() ?? ''}
                invalid={confirmDeleteText().trim().length > 0 && confirmDeleteText().trim() !== (confirmDeleteInstanceId() ?? '')}
              />
            </Field>
          </div>
        </Modal>

        <Modal
          open={editingInstanceId() != null && editBase() != null}
          onClose={() => closeEditModal()}
          title="Edit instance"
          size="lg"
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
                  <Field label="Display name (optional)" error={editFieldErrors().display_name}>
                    <Input
                      ref={(el) => {
                        editDisplayNameEl = el
                      }}
                      value={editDisplayName()}
                      onInput={(e) => setEditDisplayName(e.currentTarget.value)}
                      placeholder="e.g. friends-survival"
                      invalid={Boolean(editFieldErrors().display_name)}
                      spellcheck={false}
                    />
                  </Field>

                  <Show when={editTemplateId() === 'demo:sleep'}>
                    <Field label="Seconds" required error={editFieldErrors().seconds}>
                      <Input
                        ref={(el) => {
                          editSleepSecondsEl = el
                        }}
                        type="number"
                        value={editSleepSeconds()}
                        onInput={(e) => setEditSleepSeconds(e.currentTarget.value)}
                        invalid={Boolean(editFieldErrors().seconds)}
                      />
                    </Field>
                  </Show>

                  <Show when={editTemplateId() === 'minecraft:vanilla'}>
                    <div class="space-y-3 rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                      <div class="flex items-center justify-between gap-3">
                        <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Minecraft</div>
                        <div class="flex items-center gap-2">
                          <span class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 text-[11px] font-mono text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                            EULA accepted
                          </span>
                          <Button
                            size="xs"
                            variant={editAdvanced() ? 'secondary' : 'ghost'}
                            onClick={() => setEditAdvanced((v) => !v)}
                            title="Show or hide advanced fields"
                          >
                            <span class="inline-flex items-center gap-2">
                              {editAdvanced() ? 'Hide advanced' : 'Advanced'}
                              <Show when={!editAdvanced() && editAdvancedDirty()}>
                                <span class="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                              </Show>
                            </span>
                          </Button>
                        </div>
                      </div>

		                      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		                        <Field
		                          label={
		                            <LabelTip
		                              label="Version"
		                              content="Changing version may trigger downloads and compatibility issues."
		                            />
		                          }
		                          error={editFieldErrors().version}
		                        >
                              <div class="space-y-2">
                                <Dropdown
                                  label=""
                                  value={editMcVersion()}
                                  options={optionsWithCurrentValue(mcVersionOptions(), editMcVersion())}
                                  onChange={setEditMcVersion}
                                />
                              </div>
	                        </Field>

	                        <Field
	                          label={
	                            <LabelTip
	                              label="Memory (MB)"
	                              content="Sets JVM heap size. Too low can crash; too high can starve the host."
	                            />
	                          }
	                          error={editFieldErrors().memory_mb}
	                        >
                          <div class="space-y-2">
                            <Dropdown
                              label=""
                              value={editMcMemoryPreset()}
                              options={mcMemoryOptions()}
                              onChange={(v) => setEditMcMemoryPreset(v)}
                            />
                            <Show when={editMcMemoryPreset() === 'custom'}>
                              <Input
                                ref={(el) => {
                                  editMcMemoryCustomEl = el
                                }}
                                type="number"
                                value={editMcMemory()}
                                onInput={(e) => setEditMcMemory(e.currentTarget.value)}
                                placeholder="2048"
                                invalid={Boolean(editFieldErrors().memory_mb)}
                              />
                            </Show>
                          </div>
                        </Field>
                      </div>

	                      <Show when={editAdvanced()}>
	                        <div class="space-y-3">
	                          <Field
	                            label={
	                              <LabelTip
	                                label="Port (0 = auto)"
	                                content="Applied on next start. Use 0 to auto-assign a free port."
	                              />
	                            }
	                            error={editFieldErrors().port}
	                          >
                              <Input
                                ref={(el) => {
                                  editMcPortEl = el
                                }}
                                type="number"
                                value={editMcPort()}
                                onInput={(e) => setEditMcPort(e.currentTarget.value)}
                                placeholder="0 for auto"
                                invalid={Boolean(editFieldErrors().port)}
                              />
                            </Field>

	                          <Field
	                            label={<LabelTip label="Public (FRP)" content="Optional. Paste an frpc config to expose this instance via FRP." />}
	                            error={editFieldErrors().frp_config}
	                          >
	                            <div class="space-y-2">
	                              <label class="inline-flex items-center gap-2 text-[12px] text-slate-700 dark:text-slate-200">
	                                <input
	                                  type="checkbox"
	                                  class="h-4 w-4 rounded border-slate-300 bg-white text-amber-600 focus:ring-amber-400 dark:border-slate-700 dark:bg-slate-950/60 dark:text-amber-400"
	                                  checked={editMcFrpEnabled()}
	                                  onChange={(e) => {
	                                    setEditMcFrpEnabled(e.currentTarget.checked)
	                                    if (!e.currentTarget.checked) setEditMcFrpConfig('')
	                                  }}
	                                />
	                                <span>Enable</span>
	                              </label>
	                              <Show when={editMcFrpEnabled()}>
	                                <Textarea
	                                  ref={(el) => {
	                                    editMcFrpConfigEl = el
	                                  }}
	                                  value={editMcFrpConfig()}
	                                  onInput={(e) => setEditMcFrpConfig(e.currentTarget.value)}
	                                  placeholder="Paste frpc config to set/replace (INI)"
	                                  spellcheck={false}
	                                  class="font-mono text-[11px]"
	                                  invalid={Boolean(editFieldErrors().frp_config)}
	                                />
	                              </Show>
	                            </div>
	                          </Field>
	                        </div>
                      </Show>
                    </div>
                  </Show>

                  <Show when={editTemplateId() === 'terraria:vanilla'}>
                    <div class="space-y-3 rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                      <div class="flex items-center justify-between gap-3">
                        <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Terraria</div>
                        <Button
                          size="xs"
                          variant={editAdvanced() ? 'secondary' : 'ghost'}
                          onClick={() => setEditAdvanced((v) => !v)}
                          title="Show or hide advanced fields"
                        >
                          <span class="inline-flex items-center gap-2">
                            {editAdvanced() ? 'Hide advanced' : 'Advanced'}
                            <Show when={!editAdvanced() && editAdvancedDirty()}>
                              <span class="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                            </Show>
                          </span>
                        </Button>
                      </div>

	                      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		                        <Field
		                          label={
		                            <LabelTip
		                              label="Version"
		                              content="Package id (e.g. 1453). Changing version may require re-download and can affect world compatibility."
		                            />
		                          }
		                          error={editFieldErrors().version}
		                        >
                            <div class="space-y-2">
                              <Dropdown
                                label=""
                                value={editTrVersion()}
                                options={optionsWithCurrentValue(trVersionOptions(), editTrVersion())}
                                onChange={setEditTrVersion}
                              />
                            </div>
	                        </Field>

	                        <Field
	                          label={<LabelTip label="Max players" content="Maximum concurrent players allowed to join." />}
	                          error={editFieldErrors().max_players}
	                        >
                          <Input
                            ref={(el) => {
                              editTrMaxPlayersEl = el
                            }}
                            type="number"
                            value={editTrMaxPlayers()}
                            onInput={(e) => setEditTrMaxPlayers(e.currentTarget.value)}
                            placeholder="8"
                            invalid={Boolean(editFieldErrors().max_players)}
                          />
                        </Field>
                      </div>

	                      <Field
	                        label={
	                          <LabelTip
	                            label="World name"
	                            content="Changing world name will use a different world file (existing worlds are not deleted)."
	                          />
	                        }
	                        error={editFieldErrors().world_name}
	                      >
                        <Input
                          ref={(el) => {
                            editTrWorldNameEl = el
                          }}
                          value={editTrWorldName()}
                          onInput={(e) => setEditTrWorldName(e.currentTarget.value)}
                          placeholder="world"
                          invalid={Boolean(editFieldErrors().world_name)}
                        />
                      </Field>

	                      <Show when={editAdvanced()}>
	                        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
	                          <Field
	                            label={
	                              <LabelTip
	                                label="Port (0 = auto)"
	                                content="Applied on next start. Use 0 to auto-assign a free port."
	                              />
	                            }
	                            error={editFieldErrors().port}
	                          >
                            <Input
                              ref={(el) => {
                                editTrPortEl = el
                              }}
                              type="number"
                              value={editTrPort()}
                              onInput={(e) => setEditTrPort(e.currentTarget.value)}
                              placeholder="0 for auto"
                              invalid={Boolean(editFieldErrors().port)}
                            />
                          </Field>

	                          <Field
	                            label={<LabelTip label="World size (1/2/3)" content="1=small, 2=medium, 3=large." />}
	                            error={editFieldErrors().world_size}
	                          >
                            <Input
                              ref={(el) => {
                                editTrWorldSizeEl = el
                              }}
                              type="number"
                              value={editTrWorldSize()}
                              onInput={(e) => setEditTrWorldSize(e.currentTarget.value)}
                              placeholder="1"
                              invalid={Boolean(editFieldErrors().world_size)}
                            />
                          </Field>
                        </div>

	                        <Field
	                          label={<LabelTip label="Password (optional)" content="Leave blank to keep existing; set a value to change." />}
	                          error={editFieldErrors().password}
	                        >
	                          <div class="flex flex-wrap items-center gap-2">
	                            <Input
	                              ref={(el) => {
	                                editTrPasswordEl = el
	                              }}
	                              type={editTrPasswordVisible() ? 'text' : 'password'}
	                              value={editTrPassword()}
	                              onInput={(e) => setEditTrPassword(e.currentTarget.value)}
	                              placeholder="(leave blank to keep)"
	                              invalid={Boolean(editFieldErrors().password)}
	                              class="min-w-[220px] flex-1"
	                            />
	                            <IconButton
	                              type="button"
	                              size="sm"
	                              variant="secondary"
	                              label={editTrPasswordVisible() ? 'Hide password' : 'Show password'}
	                              onClick={() => setEditTrPasswordVisible((v) => !v)}
	                            >
	                              <Show
	                                when={editTrPasswordVisible()}
	                                fallback={
	                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                                    <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
	                                    <path
	                                      fill-rule="evenodd"
	                                      d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.382.147.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
	                                      clip-rule="evenodd"
	                                    />
	                                  </svg>
	                                }
	                              >
	                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                                  <path d="M13.359 11.238l1.36 1.36a4 4 0 01-5.317-5.317l1.36 1.36a2.5 2.5 0 002.597 2.597z" />
	                                  <path
	                                    fill-rule="evenodd"
	                                    d="M2 4.25a.75.75 0 011.28-.53l14.5 14.5a.75.75 0 11-1.06 1.06l-2.294-2.294A9.961 9.961 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41a1.651 1.651 0 010-1.186 10.03 10.03 0 012.924-4.167L2.22 3.78A.75.75 0 012 4.25zm6.12 6.12a2.5 2.5 0 003.51 3.51l-3.51-3.51z"
	                                    clip-rule="evenodd"
	                                  />
	                                  <path d="M12.454 8.214L9.31 5.07A4 4 0 0114.93 10.69l-2.476-2.476z" />
	                                  <path d="M15.765 12.585l1.507 1.507a10.03 10.03 0 002.064-3.502 1.651 1.651 0 000-1.186A10.004 10.004 0 0010 3a9.961 9.961 0 00-3.426.608l1.65 1.65A8.473 8.473 0 0110 4.5c3.49 0 6.574 2.138 7.773 5.5a8.5 8.5 0 01-2.008 2.585z" />
	                                </svg>
	                              </Show>
	                            </IconButton>
	                            <IconButton
	                              type="button"
	                              size="sm"
	                              variant="secondary"
	                              label="Copy password"
	                              disabled={!editTrPassword().trim()}
	                              onClick={() => void safeCopy(editTrPassword())}
	                            >
	                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                                <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
	                                <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
	                              </svg>
	                            </IconButton>
	                          </div>
	                        </Field>

	                        <Field
	                          label={<LabelTip label="Public (FRP)" content="Optional. Paste an frpc config to expose this instance via FRP." />}
	                          error={editFieldErrors().frp_config}
	                        >
	                          <div class="space-y-2">
	                            <label class="inline-flex items-center gap-2 text-[12px] text-slate-700 dark:text-slate-200">
	                              <input
	                                type="checkbox"
	                                class="h-4 w-4 rounded border-slate-300 bg-white text-amber-600 focus:ring-amber-400 dark:border-slate-700 dark:bg-slate-950/60 dark:text-amber-400"
	                                checked={editTrFrpEnabled()}
	                                onChange={(e) => {
	                                  setEditTrFrpEnabled(e.currentTarget.checked)
	                                  if (!e.currentTarget.checked) setEditTrFrpConfig('')
	                                }}
	                              />
	                              <span>Enable</span>
	                            </label>
	                            <Show when={editTrFrpEnabled()}>
	                              <Textarea
	                                ref={(el) => {
	                                  editTrFrpConfigEl = el
	                                }}
	                                value={editTrFrpConfig()}
	                                onInput={(e) => setEditTrFrpConfig(e.currentTarget.value)}
	                                placeholder="Paste frpc config to set/replace (INI)"
	                                spellcheck={false}
	                                class="font-mono text-[11px]"
	                                invalid={Boolean(editFieldErrors().frp_config)}
	                              />
	                            </Show>
	                          </div>
	                        </Field>
                      </Show>
                    </div>
                  </Show>

                  <Show when={editFormError()}>
                    <div class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                      <div class="font-semibold">Update failed</div>
                      <div class="mt-1">{editFormError()!.message}</div>
	                      <Show when={editFormError()!.requestId}>
	                        <div class="mt-2 flex items-center justify-between gap-2">
	                          <div class="text-[11px] text-rose-700/80 dark:text-rose-200/70 font-mono">req {editFormError()!.requestId}</div>
	                          <IconButton
	                            size="sm"
	                            variant="danger"
	                            label="Copy request id"
	                            onClick={() => safeCopy(editFormError()!.requestId ?? '')}
	                          >
	                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                              <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
	                              <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
	                            </svg>
	                          </IconButton>
	                        </div>
	                      </Show>
                    </div>
                  </Show>
                </div>

                <div class="mt-6 flex gap-3">
                  <Button type="button" variant="secondary" size="md" class="flex-1" onClick={() => closeEditModal()}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    class="flex-1"
                    loading={updateInstance.isPending}
                    disabled={!editHasChanges() || editOutgoingParams() == null}
                    onClick={async () => {
                      const base = editBase()
                      const params = editOutgoingParams()
                      if (!base || !params) return

                      setEditFormError(null)
                      setEditFieldErrors({})
                      const localErrors: Record<string, string> = {}

                      if (base.template_id === 'minecraft:vanilla') {
                        const existing = (base.params.frp_config ?? '').trim()
                        if (editMcFrpEnabled() && !existing && !editMcFrpConfig().trim()) localErrors.frp_config = 'Paste frpc config.'
                      }

                      if (base.template_id === 'terraria:vanilla') {
                        const existing = (base.params.frp_config ?? '').trim()
                        if (editTrFrpEnabled() && !existing && !editTrFrpConfig().trim()) localErrors.frp_config = 'Paste frpc config.'
                      }

                      if (Object.keys(localErrors).length > 0) {
                        setEditFieldErrors(localErrors)
                        queueMicrotask(() => focusFirstEditError(localErrors))
                        return
                      }

                      try {
                        await updateInstance.mutateAsync({
                          instance_id: base.instance_id,
                          params,
                          display_name: editDisplayName().trim() ? editDisplayName().trim() : null,
                        })
                        pushToast('success', 'Updated', 'Instance parameters saved.')
                        closeEditModal()
                        await invalidateInstances()
                        revealInstance(base.instance_id)
                      } catch (err) {
                        if (isAlloyApiError(err)) {
                          setEditFormError({ message: err.data.message, requestId: err.data.request_id })
                          setEditFieldErrors(err.data.field_errors ?? {})
                          queueMicrotask(() => focusFirstEditError(err.data.field_errors ?? {}))
                        } else {
                          setEditFormError({ message: err instanceof Error ? err.message : 'unknown error' })
                        }
                      }
                    }}
                  >
                    Save changes
                  </Button>
                </div>
          </div>
        </Modal>

        <Modal
          open={showDiagnosticsModal()}
          onClose={() => setShowDiagnosticsModal(false)}
          title="Diagnostics"
          description={
            controlDiagnostics.data?.request_id
              ? `req ${controlDiagnostics.data.request_id}`
              : controlDiagnostics.isPending
                ? 'loading…'
                : undefined
          }
          size="xl"
          footer={
            <div class="flex flex-wrap justify-end gap-2">
              <IconButton
                type="button"
                label="Refresh"
                title="Refresh diagnostics"
                variant="secondary"
                disabled={controlDiagnostics.isPending}
                onClick={() => void queryClient.invalidateQueries({ queryKey: ['control.diagnostics', null] })}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                  <path
                    fill-rule="evenodd"
                    d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466.75.75 0 00-1.06 1.06 7 7 0 0011.698-3.132.75.75 0 00-1.437-.394z"
                    clip-rule="evenodd"
                  />
                  <path
                    fill-rule="evenodd"
                    d="M4.688 8.576a5.5 5.5 0 019.201-2.466.75.75 0 001.06-1.06A7 7 0 003.25 8.182a.75.75 0 001.438.394z"
                    clip-rule="evenodd"
                  />
                </svg>
              </IconButton>
              <Button
                size="sm"
                variant="secondary"
                disabled={!controlDiagnostics.data}
                onClick={async () => {
                  if (!controlDiagnostics.data) return
                  await safeCopy(JSON.stringify(controlDiagnostics.data, null, 2))
                  pushToast('success', 'Copied', 'Diagnostics copied to clipboard.')
                }}
              >
                Copy
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!controlDiagnostics.data}
                onClick={() => {
                  if (!controlDiagnostics.data) return
                  downloadJson(`alloy-control-diagnostics.json`, { type: 'alloy-control-diagnostics', ...controlDiagnostics.data })
                }}
              >
                Download
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowDiagnosticsModal(false)}>
                Close
              </Button>
            </div>
          }
        >
          <div class="space-y-4">
                <Show when={controlDiagnostics.isPending}>
                  <div class="grid gap-3 sm:grid-cols-2">
                    <div class="h-28 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
                    <div class="h-28 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
                  </div>
                </Show>

                <Show when={controlDiagnostics.isError}>
                  <ErrorState
                    title="Failed to load diagnostics"
                    error={controlDiagnostics.error}
                    onRetry={() => void queryClient.invalidateQueries({ queryKey: ['control.diagnostics', null] })}
                  />
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
                            <Button
                              size="xs"
                              variant="danger"
                              loading={clearCache.isPending}
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
                            </Button>
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
                              <Button size="xs" variant="secondary" onClick={() => safeCopy(d().agent_log_path ?? '')}>
                                Copy
                              </Button>
                            </div>
                          </Show>
                        </div>
                      </div>
                    </div>
                  )}
                </Show>
              </div>
        </Modal>

	        <Modal
	          open={showInstanceModal() && selectedInstanceId() != null}
	          onClose={() => setShowInstanceModal(false)}
	          title={selectedInstanceDisplayName() ?? 'Instance details'}
	          size="xl"
	        >
          <Show when={selectedInstance()} fallback={<div class="text-sm text-slate-500">No instance selected.</div>}>
	            {(inst) => {
	              const id = () => inst().config.instance_id
	              const status = () => inst().status ?? null
	              const displayName = () => instanceDisplayName(inst() as unknown as InstanceListItem)
	              const uiName = () => selectedInstanceDisplayName() ?? displayName()
	              const params = () => (inst().config.params as Record<string, unknown> | null | undefined) ?? null
	              const version = () => {
	                const v = params()?.version
	                return typeof v === 'string' && v.trim() ? v : null
	              }
              const port = () => instancePort(inst() as unknown as { config: { template_id: string; params: unknown } })
              const connectInfo = () => {
                const p = port()
                return p ? `${connectHost()}:${p}` : null
              }
              const frpEndpoint = () => {
                const raw = params()?.frp_config
                if (typeof raw !== 'string') return null
                return parseFrpcIniEndpoint(raw)
              }

              const [revealedSecrets, setRevealedSecrets] = createSignal<Record<string, boolean>>({})

              const statusVariant = () => {
                const s = status()?.state
                if (s === 'PROCESS_STATE_RUNNING') return 'success' as const
                if (s === 'PROCESS_STATE_FAILED') return 'danger' as const
                if (s === 'PROCESS_STATE_STARTING' || s === 'PROCESS_STATE_STOPPING') return 'warning' as const
                return 'neutral' as const
              }

              async function copyConnect() {
                const c = connectInfo()
                if (!c) return
                await safeCopy(c)
                pushToast('success', 'Copied', c)
              }

              async function copyFrp() {
                const c = frpEndpoint()
                if (!c) return
                await safeCopy(c)
                pushToast('success', 'Copied', c)
              }

              async function downloadDiagnostics() {
                const instValue = inst()
                try {
                  const cfg = {
                    ...instValue.config,
                    params: { ...(instValue.config.params as Record<string, string>) },
                  }
                  for (const [k, v] of Object.entries(cfg.params)) {
                    if (isSecretParamKey(k)) {
                      if (typeof v === 'string' && v) cfg.params[k] = '<redacted>'
                    }
                  }

                  const diag = await instanceDiagnostics.mutateAsync({
                    instance_id: instValue.config.instance_id,
                    max_lines: 600,
                    limit_bytes: 512 * 1024,
                  })

                  const payload = {
                    type: 'alloy-instance-diagnostics',
                    ...diag,
                    config: cfg,
                    status: instValue.status ?? null,
                    process_logs_tail: processLogLines().map((l) => l.text),
                  }

                  downloadJson(`alloy-${instValue.config.instance_id}-diagnostics.json`, payload)
                  pushToast('success', 'Downloaded', 'Diagnostics report saved.')
                } catch (e) {
                  toastError('Diagnostics failed', e)
                }
              }

              async function copyDiagnostics() {
                const instValue = inst()
                try {
                  const cfg = {
                    ...instValue.config,
                    params: { ...(instValue.config.params as Record<string, string>) },
                  }
                  for (const [k, v] of Object.entries(cfg.params)) {
                    if (isSecretParamKey(k)) {
                      if (typeof v === 'string' && v) cfg.params[k] = '<redacted>'
                    }
                  }
                  const payload = {
                    instance_id: instValue.config.instance_id,
                    template_id: instValue.config.template_id,
                    config: cfg,
                    status: instValue.status ?? null,
                    process_logs_tail: processLogLines().map((l) => l.text),
                  }
                  await safeCopy(JSON.stringify(payload, null, 2))
                  pushToast('success', 'Copied', 'Diagnostics JSON copied.')
                } catch (e) {
                  toastError('Copy failed', e)
                }
              }

              return (
                <div class="space-y-4">
                  <div
                    class={`-mx-5 -mt-4 border-b border-slate-200 bg-white/80 px-5 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80 ${
                      instanceDetailTab() === 'logs' ? '' : 'sticky top-0 z-10'
                    }`}
                  >
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div class="min-w-0">
	                        <div class="mt-1 flex flex-wrap items-center gap-2">
	                          <div class="truncate font-display text-base font-semibold text-slate-900 dark:text-slate-100">{uiName()}</div>
	                          <Badge variant={statusVariant()} title={status()?.state ?? 'PROCESS_STATE_EXITED'}>
	                            {instanceStateLabel(status())}
	                          </Badge>
	                          <Show when={version()}>{(v) => <Badge variant="neutral">v{v()}</Badge>}</Show>
                          <Show when={connectInfo()}>
                            {(c) => (
                              <button
                                type="button"
                                class="group inline-flex max-w-full cursor-pointer items-center gap-1 rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono text-[11px] text-slate-700 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 dark:hover:bg-slate-900 dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950"
                                onClick={() => void copyConnect()}
                                title="Copy connection info"
                              >
                                <span class="truncate">{c()}</span>
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
                              </button>
                            )}
                          </Show>
                          <Show when={frpEndpoint()}>
                            {(c) => (
                              <button
                                type="button"
                                class="group inline-flex max-w-full cursor-pointer items-center gap-1 rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono text-[11px] text-slate-700 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 dark:hover:bg-slate-900 dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950"
                                onClick={() => void copyFrp()}
                                title="Copy public endpoint (FRP)"
                              >
                                <span class="truncate">FRP {c()}</span>
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
                              </button>
                            )}
                          </Show>
                        </div>

                        <Show when={status()?.state === 'PROCESS_STATE_STARTING' ? status()?.message?.trim() : null}>
                          {(msg) => <StartProgress templateId={inst().config.template_id} message={msg()} />}
                        </Show>

	                        <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
	                          <button
	                            type="button"
	                            class="group inline-flex cursor-pointer items-center gap-1 rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono text-slate-700 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 dark:hover:bg-slate-900 dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950"
	                            onClick={() => {
	                              void safeCopy(id())
	                              pushToast('success', 'Copied ID', shortId(id()))
	                            }}
	                            title="Copy instance id"
	                          >
	                            <span class="truncate">{shortId(id())}</span>
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
	                          </button>
	                          <Show when={instanceStatusKeys()[id()]?.updated_at_unix_ms}>
	                            {(t) => (
                              <span
	                                class="rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono dark:border-slate-800 dark:bg-slate-950/40"
	                                title={new Date(t()).toLocaleString()}
	                              >
	                                {formatRelativeTime(t())}
	                              </span>
	                            )}
	                          </Show>
	                        </div>
                      </div>

                      <div class="flex flex-wrap items-center justify-end gap-2">
                        <Show
                          when={canStartInstance(status())}
                          fallback={
	                            <Button
	                              size="xs"
	                              variant="secondary"
	                              leftIcon={
	                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                                  <path d="M5.75 5.75A.75.75 0 016.5 5h7a.75.75 0 01.75.75v8.5a.75.75 0 01-.75.75h-7a.75.75 0 01-.75-.75v-8.5z" />
	                                </svg>
	                              }
	                              loading={instanceOpById()[id()] === 'stopping'}
	                              disabled={isReadOnly() || instanceOpById()[id()] != null || isStopping(status())}
	                              title={isReadOnly() ? 'Read-only mode' : 'Stop instance'}
	                            onClick={async () => {
	                              try {
	                                await runInstanceOp(id(), 'stopping', () =>
	                                  stopInstance.mutateAsync({ instance_id: id(), timeout_ms: 30_000 }),
	                                )
	                                await invalidateInstances()
	                                pushToast('success', 'Stopped', uiName())
	                              } catch (e) {
	                                toastError('Stop failed', e)
	                              }
	                            }}
	                          >
                              Stop
                            </Button>
                          }
                        >
	                          <Button
	                            size="xs"
	                            variant="primary"
	                            leftIcon={
	                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                                <path d="M4.5 3.25a.75.75 0 011.18-.62l10.5 7.25a.75.75 0 010 1.24l-10.5 7.25A.75.75 0 014.5 17.75V3.25z" />
	                              </svg>
	                            }
	                            loading={instanceOpById()[id()] === 'starting'}
	                            disabled={isReadOnly() || instanceOpById()[id()] != null}
	                            title={isReadOnly() ? 'Read-only mode' : 'Start instance'}
	                            onClick={async () => {
	                              try {
	                                await runInstanceOp(id(), 'starting', () => startInstance.mutateAsync({ instance_id: id() }))
	                                await invalidateInstances()
	                                pushToast('success', 'Started', uiName())
	                              } catch (e) {
	                                toastError('Start failed', e)
	                              }
	                            }}
	                          >
                            Start
                          </Button>
                        </Show>

                        <Show when={status() != null}>
	                          <IconButton
	                            type="button"
	                            label="Restart"
	                            title={isReadOnly() ? 'Read-only mode' : 'Restart instance'}
	                            variant="secondary"
	                            disabled={isReadOnly() || instanceOpById()[id()] != null}
	                            onClick={async () => {
	                              try {
	                                await runInstanceOp(id(), 'restarting', () =>
	                                  restartInstance.mutateAsync({ instance_id: id(), timeout_ms: 30_000 }),
	                                )
	                                await invalidateInstances()
	                                pushToast('success', 'Restarted', uiName())
	                              } catch (e) {
	                                toastError('Restart failed', e)
	                              }
	                            }}
	                          >
	                            <Show
	                              when={instanceOpById()[id()] === 'restarting'}
	                              fallback={
	                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                                  <path
	                                    fill-rule="evenodd"
	                                    d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466.75.75 0 011.06-1.06 4 4 0 006.764-2.289H13a.75.75 0 010-1.5h2.75a.75.75 0 01.75.75V12.5a.75.75 0 01-1.5 0v-1.076zM4.688 8.576a5.5 5.5 0 019.201-2.466.75.75 0 11-1.06 1.06A4 4 0 006.065 9.46H7a.75.75 0 010 1.5H4.25a.75.75 0 01-.75-.75V7.5a.75.75 0 011.5 0v1.076z"
	                                    clip-rule="evenodd"
	                                  />
	                                </svg>
	                              }
	                            >
	                              <svg
	                                class="h-4 w-4 animate-spin"
	                                viewBox="0 0 24 24"
	                                fill="none"
	                                xmlns="http://www.w3.org/2000/svg"
	                                role="status"
	                                aria-label="Restarting"
	                              >
	                                <path d="M12 3a9 9 0 1 0 9 9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="opacity-25" />
	                                <path
	                                  d="M21 12a9 9 0 0 0-9-9"
	                                  stroke="currentColor"
	                                  stroke-width="2.5"
	                                  stroke-linecap="round"
	                                  class="origin-center"
	                                />
	                              </svg>
	                            </Show>
	                          </IconButton>
                        </Show>

	                        <IconButton
	                          type="button"
	                          label="Report"
	                          title="Download diagnostics report"
	                          variant="secondary"
	                          disabled={instanceDiagnostics.isPending || selectedInstance() == null}
	                          onClick={() => void downloadDiagnostics()}
	                        >
	                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                            <path
	                              fill-rule="evenodd"
	                              d="M3.75 3A1.75 1.75 0 002 4.75v10.5C2 16.216 2.784 17 3.75 17h8.5A1.75 1.75 0 0014 15.25V7.5a.75.75 0 00-.22-.53l-3.75-3.75A.75.75 0 009.5 3H3.75zm6.5 1.56L12.44 6.75h-1.69a.5.5 0 01-.5-.5V4.56z"
	                              clip-rule="evenodd"
	                            />
	                          </svg>
	                        </IconButton>
	                        <IconButton
	                          type="button"
	                          label="Copy"
	                          title="Copy diagnostics JSON"
	                          variant="secondary"
	                          disabled={selectedInstance() == null}
	                          onClick={() => void copyDiagnostics()}
	                        >
	                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                            <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
	                            <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
	                          </svg>
	                        </IconButton>

	                        <IconButton
	                          type="button"
	                          label="Edit"
	                          title={
	                            isReadOnly()
	                              ? 'Read-only mode'
	                              : !canStartInstance(status())
	                                ? 'Stop the instance before editing'
	                                : 'Edit instance'
	                          }
	                          variant="secondary"
	                          disabled={isReadOnly() || !canStartInstance(status())}
	                          onClick={() => {
	                            setShowInstanceModal(false)
	                            openEditModal(inst())
	                          }}
	                        >
	                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-9.5 9.5a1 1 0 01-.39.242l-3.5 1.166a.5.5 0 01-.632-.632l1.166-3.5a1 1 0 01.242-.39l9.5-9.5z" />
	                          </svg>
	                        </IconButton>
	                        <IconButton
	                          type="button"
	                          label="Delete"
	                          title={
	                            isReadOnly()
	                              ? 'Read-only mode'
	                              : !canStartInstance(status())
	                                ? 'Stop the instance before deleting'
	                                : 'Delete instance'
	                          }
	                          variant="danger"
	                          disabled={isReadOnly() || !canStartInstance(status())}
	                          onClick={() => {
	                            setShowInstanceModal(false)
	                            setConfirmDeleteInstanceId(id())
	                          }}
	                        >
	                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
	                            <path
	                              fill-rule="evenodd"
	                              d="M8.75 2.75A.75.75 0 019.5 2h1a.75.75 0 01.75.75V3h3.5a.75.75 0 010 1.5h-.918l-.764 10.694A2.75 2.75 0 0111.327 18H8.673a2.75 2.75 0 01-2.741-2.806L5.168 4.5H4.25a.75.75 0 010-1.5h3.5v-.25zm1.5.25v.25h-1.5V3h1.5z"
	                              clip-rule="evenodd"
	                            />
	                          </svg>
	                        </IconButton>

                        <IconButton type="button" label="Close" variant="ghost" onClick={() => setShowInstanceModal(false)}>
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                            <path
                              fill-rule="evenodd"
                              d="M4.47 4.47a.75.75 0 011.06 0L10 8.94l4.47-4.47a.75.75 0 111.06 1.06L11.06 10l4.47 4.47a.75.75 0 11-1.06 1.06L10 11.06l-4.47 4.47a.75.75 0 11-1.06-1.06L8.94 10 4.47 5.53a.75.75 0 010-1.06z"
                              clip-rule="evenodd"
                            />
                          </svg>
                        </IconButton>
                      </div>
                    </div>

                    <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <Tabs
                        value={instanceDetailTab()}
                        options={[
                          { value: 'overview', label: 'Overview' },
                          { value: 'logs', label: 'Logs' },
                          { value: 'files', label: 'Files' },
                          { value: 'config', label: 'Config' },
                        ]}
                        onChange={setInstanceDetailTab}
                      />

                      <Show when={instanceDetailTab() === 'logs'}>
                        <div class="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                          <span
                            class={`h-1.5 w-1.5 rounded-full ${statusDotClass({ loading: processLogsTail.isPending, error: processLogsTail.isError })}`}
                          />
                          <span>{processLogLive() ? 'live' : 'paused'}</span>
                        </div>
                      </Show>
                    </div>
                  </div>

                  <Show when={instanceDetailTab() === 'overview'}>
                    <div class="grid gap-4 lg:grid-cols-2">
                      <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                        <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</div>
                        <div class="mt-3 space-y-2 text-[12px] text-slate-600 dark:text-slate-300">
                          <div class="flex items-center justify-between gap-3">
                            <div class="text-slate-500 dark:text-slate-400">State</div>
                            <div class="font-mono text-[11px]">{status()?.state ?? 'PROCESS_STATE_EXITED'}</div>
                          </div>
                          <Show when={status()?.pid != null}>
                            <div class="flex items-center justify-between gap-3">
                              <div class="text-slate-500 dark:text-slate-400">PID</div>
                              <div class="font-mono text-[11px]">{status()?.pid}</div>
                            </div>
                          </Show>
                          <Show when={status()?.exit_code != null}>
                            <div class="flex items-center justify-between gap-3">
                              <div class="text-slate-500 dark:text-slate-400">Exit</div>
                              <div class="font-mono text-[11px]">{status()?.exit_code}</div>
                            </div>
                          </Show>
                        </div>

                        <Show when={status()?.message != null}>
                          <div class="mt-3 rounded-xl border border-slate-200 bg-white/60 p-3 text-[12px] text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
                            <div class="font-semibold">Message</div>
                            <div class="mt-1 font-mono text-[11px] whitespace-pre-wrap">{selectedInstanceMessage() ?? ''}</div>
                            <Show when={statusMessageParts(status()).hint}>
                              {(hint) => (
                                <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{hint()}</div>
                              )}
                            </Show>
                          </div>
                        </Show>
                      </div>

                      <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                        <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Resources</div>
                        <Show
                          when={status()?.resources}
                          fallback={<div class="mt-3 text-[12px] text-slate-500">(no resource data)</div>}
                        >
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

                        <div class="mt-4 flex flex-wrap items-center gap-2">
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => {
                              setInstanceDetailTab('logs')
                            }}
                          >
                            View logs
                          </Button>
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => {
                              setInstanceDetailTab('files')
                            }}
                          >
                            Browse files
                          </Button>
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => openInFiles(`instances/${id()}`)}
                            title="Open in the global Files tab"
                          >
                            Open in Files tab
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Show>

                  <Show when={instanceDetailTab() === 'logs'}>
                    <Show when={processLogsTail.isError}>
                      <ErrorState error={processLogsTail.error} title="Failed to load logs" onRetry={() => processLogsTail.refetch()} />
                    </Show>
                    <LogViewer
                      title="Process logs"
                      lines={processLogLines()}
                      loading={processLogsTail.isPending}
                      error={processLogsTail.isError ? processLogsTail.error : undefined}
                      live={processLogLive()}
                      onLiveChange={setProcessLogLive}
                      onClear={() => setProcessLogLines([])}
                      storageKey={`alloy.processlog.${id()}`}
                      class="mt-3"
                    />
                  </Show>

                  <Show when={instanceDetailTab() === 'files'}>
                    <div class="rounded-2xl border border-slate-200 bg-white/70 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
	                      <FileBrowser
	                        enabled={isAuthed() && showInstanceModal() && instanceDetailTab() === 'files'}
	                        title="Files"
	                        rootPath={`instances/${id()}`}
	                        rootLabel={uiName()}
	                      />
                    </div>
                  </Show>

                  <Show when={instanceDetailTab() === 'config'}>
                    <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Parameters</div>
                        <div class="text-[11px] text-slate-500 dark:text-slate-400">
                          Edits require the instance to be stopped.
                        </div>
                      </div>

                      <div class="mt-3 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                        <div class="grid grid-cols-[160px_1fr_auto] gap-0 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                          <div>Key</div>
                          <div>Value</div>
                          <div class="text-right">Actions</div>
                        </div>
                        <div class="divide-y divide-slate-200 dark:divide-slate-800">
                          <For
                            each={Object.entries(params() ?? {}).sort(([a], [b]) => a.localeCompare(b))}
                          >
                            {([k, v]) => (
                              <div class="grid grid-cols-[160px_1fr_auto] gap-3 px-3 py-2 text-[12px] text-slate-700 dark:text-slate-200">
                                <div class="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400" title={k}>
                                  {k}
                                </div>
                                <div class="min-w-0 font-mono text-[11px]">
                                  <Show
                                    when={
                                      isSecretParamKey(k)
                                    }
                                    fallback={<span class="whitespace-pre-wrap break-words">{String(v ?? '')}</span>}
                                  >
                                    <Show
                                      when={revealedSecrets()[k]}
                                      fallback={<span class="text-slate-500 dark:text-slate-400">••••••</span>}
                                    >
                                      <span class="whitespace-pre-wrap break-words">{String(v ?? '')}</span>
                                    </Show>
                                  </Show>
                                </div>
                                <div class="flex items-center justify-end gap-2">
                                  <Show
                                    when={
                                      isSecretParamKey(k)
                                    }
                                  >
                                    <Button
                                      size="xs"
                                      variant="secondary"
                                      onClick={() => setRevealedSecrets((prev) => ({ ...prev, [k]: !(prev[k] ?? false) }))}
                                    >
                                      {revealedSecrets()[k] ? 'Hide' : 'Show'}
                                    </Button>
                                  </Show>
                                  <Button
                                    size="xs"
                                    variant="secondary"
                                    onClick={() => safeCopy(String(v ?? ''))}
                                    disabled={String(v ?? '').length === 0}
                                    title="Copy value"
                                  >
                                    Copy
                                  </Button>
                                </div>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    </div>
                  </Show>
                </div>
              )
            }}
          </Show>
        </Modal>

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
