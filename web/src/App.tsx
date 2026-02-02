import { onAuthEvent, queryClient, rspc } from './rspc'
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import type { InstanceConfigDto, ProcessStatusDto } from './bindings'
import { ensureCsrfCookie, login, logout, whoami } from './auth'
import { Dropdown } from './components/Dropdown'

function statusDotClass(state: { loading: boolean; error: boolean }) {
  if (state.loading) return 'bg-slate-600 animate-pulse'
  if (state.error) return 'bg-rose-500'
  return 'bg-emerald-400'
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

type UiTab = 'instances' | 'files' | 'nodes'

function isTextFilePath(p: string) {
  const lower = p.toLowerCase()
  return (
    lower.endsWith('.log') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.yml') ||
    lower.endsWith('.yaml') ||
    lower.endsWith('.json') ||
    lower.endsWith('.properties')
  )
}

function isLogFilePath(p: string) {
  return p.toLowerCase().endsWith('.log')
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
  const [showAccountMenu, setShowAccountMenu] = createSignal(false)

  const [focusLoginUsername, setFocusLoginUsername] = createSignal(false)
  let loginUsernameEl: HTMLInputElement | undefined

  const THEME_STORAGE_KEY = 'alloy.theme'
  const [theme, setTheme] = createSignal<'light' | 'dark'>((() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY)
      if (saved === 'light' || saved === 'dark') return saved
    } catch {
      // ignore
    }
    const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    return systemDark ? 'dark' : 'light'
  })())

  createEffect(() => {
    const next = theme()
    document.documentElement.classList.toggle('dark', next === 'dark')
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // ignore
    }
  })

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
    const onDoc = (ev: MouseEvent) => {
      const t = ev.target as Node | null
      if (!t) return
      // Close on any outside click; menu is simple.
      setShowAccountMenu(false)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setShowAccountMenu(false)
    }
    // Use capture so clicks on menu still close after action.
    // Use a plain listener (no options) for compatibility and easy cleanup.
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
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
  const instances = rspc.createQuery(
    () => ['instance.list', null],
    () => ({ enabled: isAuthed() }),
  )

  const createInstance = rspc.createMutation(() => 'instance.create')
  const startInstance = rspc.createMutation(() => 'instance.start')
  const stopInstance = rspc.createMutation(() => 'instance.stop')
  const deleteInstance = rspc.createMutation(() => 'instance.delete')

  const [selectedTemplate, setSelectedTemplate] = createSignal<string>('demo:sleep')
  const [sleepSeconds, setSleepSeconds] = createSignal<string>('60')

  const [mcEula, setMcEula] = createSignal(false)
  const [mcVersion, setMcVersion] = createSignal('latest_release')
  const [mcVersionPreset, setMcVersionPreset] = createSignal('latest_release')
  const [mcMemory, setMcMemory] = createSignal('2048')
  const [mcPort, setMcPort] = createSignal('25565')
  const [mcError, setMcError] = createSignal<string | null>(null)

  const [trVersion, setTrVersion] = createSignal('1453')
  const [trPort, setTrPort] = createSignal('7777')
  const [trMaxPlayers, setTrMaxPlayers] = createSignal('8')
  const [trWorldName, setTrWorldName] = createSignal('world')
  const [trWorldSize, setTrWorldSize] = createSignal('1')
  const [trPassword, setTrPassword] = createSignal('')
  const [trError, setTrError] = createSignal<string | null>(null)

  const mcVersionOptions = createMemo(() => [
    { value: 'latest_release', label: 'Latest release', meta: 'recommended' },
    { value: 'latest_snapshot', label: 'Latest snapshot', meta: 'unstable' },
    { value: '1.21.4', label: '1.21.4' },
    { value: '1.21.3', label: '1.21.3' },
    { value: '1.21.2', label: '1.21.2' },
    { value: '1.21.1', label: '1.21.1' },
    { value: '1.21', label: '1.21' },
    { value: 'custom', label: 'Custom...' },
  ])

  const [tab, setTab] = createSignal<UiTab>('instances')

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

  const selectedNode = createMemo(() => {
    const id = selectedNodeId()
    if (!id) return null
    return (nodes.data ?? []).find((n: { id: string }) => n.id === id) ?? null
  })

  const [selectedInstanceId, setSelectedInstanceId] = createSignal<string | null>(null)

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

  const selectedInstance = createMemo(() => {
    const id = selectedInstanceId()
    if (!id) return null
    return (
      (instances.data ?? []).find(
        (i: { config: InstanceConfigDto; status: ProcessStatusDto | null }) => i.config.instance_id === id,
      ) ?? null
    )
  })

  const [fsPath, setFsPath] = createSignal<string>('')
  const [fsSelectedName, setFsSelectedName] = createSignal<string | null>(null)
  const fsList = rspc.createQuery(
    () => ['fs.listDir', { path: fsPath() ? fsPath() : null }],
    () => ({ enabled: isAuthed(), refetchOnWindowFocus: false }),
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
      enabled: isAuthed() && !!selectedFilePath() && isTextFilePath(selectedFilePath() ?? ''),
      refetchOnWindowFocus: false,
    }),
  )

  const [logCursor, setLogCursor] = createSignal<string | null>(null)
  const [liveTail, setLiveTail] = createSignal(true)
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
      enabled: isAuthed() && !!selectedFilePath() && isLogFilePath(selectedFilePath() ?? ''),
      refetchInterval: liveTail() ? 1000 : false,
    }),
  )

  createEffect(() => {
    // Advance cursor when we are following a file.
    if (!liveTail()) return
    const next = logTail.data?.next_cursor
    if (next) setLogCursor(next)
  })

  function openInFiles(path: string, nameHint?: string) {
    setTab('files')
    setSelectedFilePath(null)
    setFsSelectedName(nameHint ?? null)
    setLogCursor(null)
    setLiveTail(true)
    setFsPath(path)
    void fsList.refetch()
  }

  function openFileInFiles(filePath: string, nameHint?: string) {
    const cleaned = filePath.replace(/\/+$/, '')
    const idx = cleaned.lastIndexOf('/')
    const dir = idx <= 0 ? '' : cleaned.slice(0, idx)
    const name = idx <= 0 ? cleaned : cleaned.slice(idx + 1)
    setTab('files')
    setFsPath(dir)
    setSelectedFilePath(cleaned)
    setFsSelectedName(nameHint ?? name)
    setLogCursor(null)
    setLiveTail(true)
    void fsList.refetch()
  }

  const visibleText = createMemo(() => {
    if (!selectedFilePath()) return ''
    if (!isTextFilePath(selectedFilePath() ?? '')) return 'Binary file preview not supported'

    // Prefer tailing (for logs) when available.
    if (logTail.data?.lines) {
      return logTail.data.lines.join('\n')
    }
    return fileText.data?.text ?? ''
  })

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
              title={theme() === 'dark' ? 'Switch to light' : 'Switch to dark'}
              onClick={() => setTheme(theme() === 'dark' ? 'light' : 'dark')}
            >
              <Show
                when={theme() === 'dark'}
                fallback={
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                    <path
                      fill-rule="evenodd"
                      d="M10 6.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM5 10a5 5 0 1110 0 5 5 0 01-10 0z"
                      clip-rule="evenodd"
                    />
                  </svg>
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
            </button>
          </div>
        </nav>

        <div class="flex min-w-0 flex-1 flex-col">
  <header class="flex h-14 flex-none items-center justify-between border-b border-slate-200 bg-white/70 px-5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/70">
            <div class="flex items-center gap-4">
              <div class="flex items-center gap-2">
  <img src="/logo.svg" class="h-7 w-7 rounded-lg" alt="Alloy" />
                <div class="leading-none">
  <div class="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">ALLOY</div>
                  <div class="text-[10px] uppercase tracking-[0.2em] text-slate-500">control plane</div>
                </div>
              </div>

              <div class="hidden md:flex items-center gap-2 font-mono text-[10px] text-slate-400">
                <div class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white/60 px-2 py-1 dark:border-slate-800 dark:bg-slate-950/60">
                  <span
                    class={`h-1.5 w-1.5 rounded-full ${statusDotClass({ loading: ping.isPending, error: ping.isError })}`}
                  />
                  <span>BACKEND</span>
                  <span class="text-slate-500">{ping.isError ? 'offline' : ping.isPending ? '...' : 'ok'}</span>
                </div>
                <div class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white/60 px-2 py-1 dark:border-slate-800 dark:bg-slate-950/60">
                  <span
                    class={`h-1.5 w-1.5 rounded-full ${statusDotClass({ loading: agentHealth.isPending, error: agentHealth.isError })}`}
                  />
                  <span>AGENT</span>
                  <span class="text-slate-500">{agentHealth.isError ? 'offline' : agentHealth.isPending ? '...' : 'ok'}</span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-3">
              <button
                class="sm:hidden rounded-xl border border-slate-200 bg-white/70 p-2 text-slate-700 shadow-sm transition-colors hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:bg-slate-900"
                title={theme() === 'dark' ? 'Switch to light' : 'Switch to dark'}
                onClick={() => setTheme(theme() === 'dark' ? 'light' : 'dark')}
              >
                <Show
                  when={theme() === 'dark'}
                  fallback={
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                      <path
                        fill-rule="evenodd"
                        d="M10 6.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM5 10a5 5 0 1110 0 5 5 0 01-10 0z"
                        clip-rule="evenodd"
                      />
                    </svg>
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
                      class="flex items-center gap-3 rounded-xl border border-slate-200 bg-white/60 py-1.5 pl-3 pr-2 shadow-sm hover:bg-white dark:border-slate-800 dark:bg-slate-950/50 dark:hover:bg-slate-950/70"
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowAccountMenu((v) => !v)
                      }}
                      aria-expanded={showAccountMenu()}
                    >
                      <div class="flex flex-col text-right leading-none">
                        <span class="text-sm font-medium text-slate-900 dark:text-slate-100">{me()!.username}</span>
                        <span class="text-[11px] text-slate-500">{me()!.is_admin ? 'Admin' : 'User'}</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <span class="h-2 w-2 rounded-full bg-emerald-400" title="session active" />
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4 text-slate-500">
                          <path
                            fill-rule="evenodd"
                            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                            clip-rule="evenodd"
                          />
                        </svg>
                      </div>
                    </button>

                    <Show when={showAccountMenu()}>
                      <div class="absolute right-0 mt-2 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-950">
                        <button
                          type="button"
                          class="flex w-full items-center justify-between px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900/50"
                          onClick={async () => {
                            setShowAccountMenu(false)
                            await handleLogout()
                          }}
                        >
                          <span>Sign out</span>
                          <span class="text-xs text-slate-400">logout</span>
                        </button>
                      </div>
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
                    <button
                      class="flex-1 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-700 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:bg-slate-900"
                      onClick={() => {
                        void ping.refetch()
                        void agentHealth.refetch()
                      }}
                    >
                      RECHECK_STATUS
                    </button>
                  </div>
                </div>
              </div>
            </Show>

            <div class={`flex min-h-0 flex-1 ${!isAuthed() ? 'pointer-events-none blur-sm grayscale opacity-50' : ''}`}>
              <aside class="hidden md:flex w-[360px] flex-none flex-col border-r border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-950/60">
                <div class="flex items-center justify-between border-b border-slate-200 bg-white/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/60">
                  <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{tab()}</div>
                  <button
                    class="rounded-lg border border-slate-200 bg-white/60 px-2 py-1 text-[11px] text-slate-700 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:bg-slate-900"
                    onClick={() => {
                      if (tab() === 'instances') void templates.refetch()
                      if (tab() === 'instances') void instances.refetch()
                      if (tab() === 'files') void fsList.refetch()
                      if (tab() === 'nodes') void nodes.refetch()
                    }}
                  >
                    REFRESH
                  </button>
                </div>

                <div class="min-h-0 flex-1 overflow-auto p-4">
                  <Show when={tab() === 'instances'}>
                    <div class="space-y-3">
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

                          <div class="grid grid-cols-2 gap-3">
                            <div>
                              <div class="text-sm text-slate-700 dark:text-slate-400">Version</div>
                              <div class="mt-1">
                                <Dropdown
                                  label=""
                                  value={mcVersionPreset()}
                                  options={mcVersionOptions()}
                                  onChange={(v) => {
                                    setMcVersionPreset(v)
                                    if (v !== 'custom') setMcVersion(v)
                                  }}
                                />
                              </div>
                              <Show when={mcVersionPreset() === 'custom'}>
                                <input
                                  class="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                                  value={mcVersion()}
                                  onInput={(e) => setMcVersion(e.currentTarget.value)}
                                  placeholder="e.g. 1.20.4"
                                />
                              </Show>
                            </div>
                            <label class="block text-sm text-slate-700 dark:text-slate-400">
                              Memory (MB)
                              <input
                                type="number"
                                class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                                value={mcMemory()}
                                onInput={(e) => setMcMemory(e.currentTarget.value)}
                              />
                            </label>
                          </div>

                          <label class="block text-sm text-slate-700 dark:text-slate-400">
                            Port
                            <input
                              type="number"
                              class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                              value={mcPort()}
                              onInput={(e) => setMcPort(e.currentTarget.value)}
                            />
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
                            <label class="block text-sm text-slate-700 dark:text-slate-400">
                              Version (server package)
                              <input
                                class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                                value={trVersion()}
                                onInput={(e) => setTrVersion(e.currentTarget.value)}
                                placeholder="e.g. 1453"
                              />
                            </label>
                            <label class="block text-sm text-slate-700 dark:text-slate-400">
                              Port
                              <input
                                type="number"
                                class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                                value={trPort()}
                                onInput={(e) => setTrPort(e.currentTarget.value)}
                              />
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
                            </label>
                            <label class="block text-sm text-slate-700 dark:text-slate-400">
                              World name
                              <input
                                class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                                value={trWorldName()}
                                onInput={(e) => setTrWorldName(e.currentTarget.value)}
                              />
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
                            </label>
                            <label class="block text-sm text-slate-700 dark:text-slate-400">
                              Password (optional)
                              <input
                                class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                                value={trPassword()}
                                onInput={(e) => setTrPassword(e.currentTarget.value)}
                              />
                            </label>
                          </div>

                          <Show when={trError()}>
                            <div class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                              {trError()}
                            </div>
                          </Show>
                        </div>
                      </Show>

                      <button
                        class="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-slate-100 ring-1 ring-inset ring-slate-800 hover:bg-slate-800 disabled:opacity-50"
                        disabled={createInstance.isPending}
                        onClick={async () => {
                          const template_id = selectedTemplate()
                          const params: Record<string, string> = {}

                          if (template_id === 'demo:sleep') {
                            params.seconds = sleepSeconds()
                          } else if (template_id === 'minecraft:vanilla') {
                            if (!mcEula()) {
                              setMcError('You must accept the EULA')
                              return
                            }
                            setMcError(null)
                            params.accept_eula = 'true'
                            params.version = mcVersion() || 'latest_release'
                            params.memory_mb = mcMemory() || '2048'
                            params.port = mcPort() || '25565'
                          } else if (template_id === 'terraria:vanilla') {
                            setTrError(null)
                            params.version = trVersion() || '1453'
                            params.port = trPort() || '7777'
                            params.max_players = trMaxPlayers() || '8'
                            params.world_name = trWorldName() || 'world'
                            params.world_size = trWorldSize() || '1'
                            if (trPassword().trim()) params.password = trPassword().trim()
                          }

                          await createInstance.mutateAsync({ template_id, params })
                          await instances.refetch()
                        }}
                      >
                        {createInstance.isPending ? 'CREATING...' : 'CREATE_INSTANCE'}
                      </button>
                    </div>
                  </Show>

                  <Show when={tab() === 'files'}>
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
                            setFsSelectedName(null)
                            setLogCursor(null)
                            setLiveTail(true)
                            void fsList.refetch()
                          }}
                        >
                          REFRESH
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
                            setFsSelectedName(null)
                            setLogCursor(null)
                            setLiveTail(true)
                          }}
                        >
                          UP
                        </button>
                      </div>

                      <div class="max-h-96 overflow-auto rounded-xl border border-slate-200 bg-white/60 p-1 dark:border-slate-800 dark:bg-slate-950/40">
                        <Show
                          when={!fsList.isPending}
                          fallback={<div class="p-2 text-xs text-slate-500 font-mono">loading...</div>}
                        >
                          <For each={fsList.data?.entries ?? []}>
                            {(e) => (
                              <button
                                class={`w-full rounded-lg px-2 py-2 text-left text-sm font-mono text-slate-900 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900 ${
                                  fsSelectedName() === e.name && !e.is_dir ? 'bg-slate-100 dark:bg-slate-900' : ''
                                }`}
                                onClick={() => {
                                  if (e.is_dir) {
                                    const next = fsPath() ? `${fsPath().replace(/\/+$/, '')}/${e.name}` : e.name
                                    setFsPath(next)
                                    setSelectedFilePath(null)
                                    setFsSelectedName(null)
                                    setLogCursor(null)
                                    setLiveTail(true)
                                  } else {
                                    const file = fsPath() ? `${fsPath().replace(/\/+$/, '')}/${e.name}` : e.name
                                    setSelectedFilePath(file)
                                    setFsSelectedName(e.name)
                                    setLogCursor(null)
                                    setLiveTail(true)
                                  }
                                }}
                              >
                                <span class="inline-flex items-center gap-2">
                                  <span class="text-slate-500">
                                    <Show
                                      when={e.is_dir}
                                      fallback={
                                        <svg
                                          xmlns="http://www.w3.org/2000/svg"
                                          viewBox="0 0 20 20"
                                          fill="currentColor"
                                          class="h-4 w-4"
                                        >
                                          <path d="M4.75 3A2.75 2.75 0 002 5.75v8.5A2.75 2.75 0 004.75 17h10.5A2.75 2.75 0 0018 14.25V7.45A2.75 2.75 0 0015.25 4.7h-2.994a1.25 1.25 0 01-.884-.366l-.56-.56A2.75 2.75 0 009.69 3H4.75z" />
                                        </svg>
                                      }
                                    >
                                      <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        viewBox="0 0 20 20"
                                        fill="currentColor"
                                        class="h-4 w-4"
                                      >
                                        <path d="M2 5.75A2.75 2.75 0 014.75 3h4.19a2.75 2.75 0 011.944.806l.56.56c.215.215.507.334.812.334h2.994A2.75 2.75 0 0118 7.45v6.8A2.75 2.75 0 0115.25 17H4.75A2.75 2.75 0 012 14.25v-8.5z" />
                                      </svg>
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
                  </Show>

                  <Show when={tab() === 'nodes'}>
                    <div class="space-y-3">
                      <button
                        class="w-full rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-700 shadow-sm hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
                        onClick={() => void nodes.refetch()}
                      >
                        REFRESH
                      </button>

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
                  </Show>
                </div>
              </aside>

              <section class="min-w-0 flex-1 overflow-auto bg-slate-50 p-4 dark:bg-slate-950">
                <Show when={tab() === 'instances'}>
                  <div class="flex items-center justify-between">
                    <div class="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Instances</div>
                    <button
                      class="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-800 shadow-sm hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900"
                      onClick={() => instances.refetch()}
                    >
                      REFRESH
                    </button>
                  </div>

                  <div class="mt-3 grid gap-2">
                    <For each={instances.data ?? []}>
                      {(i) => (
                        <div
                          class={`flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none ${
                            selectedInstanceId() === i.config.instance_id ? 'ring-1 ring-amber-500/20' : ''
                          }`}
                        >
                          <button class="min-w-0 flex-1 text-left" onClick={() => setSelectedInstanceId(i.config.instance_id)}>
                            <div class="truncate font-mono text-sm text-slate-900 dark:text-slate-100">{i.config.instance_id}</div>
                            <div class="mt-0.5 truncate text-xs text-slate-500">
                              {i.config.template_id} • {instanceStateLabel(i.status)}
                              <Show when={i.status?.pid != null}> • pid {i.status?.pid}</Show>
                            </div>
                          </button>

                          <div class="flex items-center gap-2">
                            <Show
                              when={canStartInstance(i.status)}
                              fallback={
                                <button
                                  class="rounded-lg border border-slate-200 bg-white/70 px-3 py-1.5 text-xs text-slate-800 shadow-sm hover:bg-white disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
                                  disabled={stopInstance.isPending || isStopping(i.status)}
                                  onClick={async () => {
                                    await stopInstance.mutateAsync({ instance_id: i.config.instance_id, timeout_ms: 30_000 })
                                    await instances.refetch()
                                  }}
                                >
                                  STOP
                                </button>
                              }
                            >
                              <button
                                class="rounded-lg border border-slate-200 bg-white/70 px-3 py-1.5 text-xs text-slate-800 shadow-sm hover:bg-white disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
                                disabled={startInstance.isPending}
                                onClick={async () => {
                                  await startInstance.mutateAsync({ instance_id: i.config.instance_id })
                                  await instances.refetch()
                                }}
                              >
                                START
                              </button>
                            </Show>

                            <button
                              class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-800 shadow-sm hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200 dark:shadow-none dark:hover:bg-rose-950/30"
                              disabled={deleteInstance.isPending || !canStartInstance(i.status)}
                              onClick={() => setConfirmDeleteInstanceId(i.config.instance_id)}
                            >
                              DEL
                            </button>

                            <button
                              class="rounded-lg border border-slate-200 bg-white/70 px-3 py-1.5 text-xs text-slate-800 shadow-sm hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
                              onClick={() => openInFiles(`instances/${i.config.instance_id}`, i.config.instance_id)}
                              title="Open instance directory"
                            >
                              FILES
                            </button>

                            <Show when={i.config.template_id === 'minecraft:vanilla'}>
                              <button
                                class="rounded-lg border border-slate-200 bg-white/70 px-3 py-1.5 text-xs text-slate-800 shadow-sm hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
                                onClick={() => openFileInFiles(`instances/${i.config.instance_id}/logs/latest.log`, 'latest.log')}
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

                  <Show when={selectedInstance()}>
                    {(i) => (
                      <div class="mt-4 rounded-xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                        <div class="flex items-center justify-between">
                          <div class="text-xs text-slate-600 dark:text-slate-400">
                            logs: <span class="font-mono text-slate-900 dark:text-slate-200">{i().config.instance_id}</span>
                          </div>
                          <div class="text-xs text-slate-500">{logs.isPending ? 'loading...' : logs.isError ? 'error' : 'live'}</div>
                        </div>
                        <pre class="mt-2 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                          <For each={logs.data?.lines ?? []}>{(l) => <div class="whitespace-pre-wrap">{l}</div>}</For>
                        </pre>
                      </div>
                    )}
                  </Show>
                </Show>

                <Show when={tab() === 'files'}>
                  <div class="flex items-center justify-between">
                    <div class="text-xs font-semibold uppercase tracking-wider text-slate-400">Preview</div>
                    <div class="truncate font-mono text-[11px] text-slate-500">{selectedFilePath() ?? '-'}</div>
                  </div>

                  <div class="mt-3 grid gap-2">
                    <Show when={selectedFilePath() && isLogFilePath(selectedFilePath() ?? '')}>
                      <div class="flex items-center justify-between rounded-xl border border-slate-200 bg-white/60 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/40">
                        <div class="text-slate-600 dark:text-slate-400">Tail</div>
                        <div class="flex items-center gap-3">
                          <label class="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                            <input type="checkbox" checked={liveTail()} onChange={(e) => setLiveTail(e.currentTarget.checked)} />
                            Live
                          </label>
                          <button
                            class="rounded-lg border border-slate-200 bg-white/70 px-2 py-1 text-xs text-slate-700 shadow-sm hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
                            onClick={() => {
                              setLogCursor(null)
                              void logTail.refetch()
                            }}
                          >
                            End
                          </button>
                        </div>
                      </div>
                    </Show>

                    <Show when={selectedFilePath() && isTextFilePath(selectedFilePath() ?? '') && !isLogFilePath(selectedFilePath() ?? '')}>
                      <div class="flex items-center justify-between rounded-xl border border-slate-200 bg-white/60 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/40">
                        <div class="text-slate-600 dark:text-slate-400">Read</div>
                        <button
                          class="rounded-lg border border-slate-200 bg-white/70 px-2 py-1 text-xs text-slate-700 shadow-sm hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
                          onClick={() => void fileText.refetch()}
                        >
                          Refresh
                        </button>
                      </div>
                    </Show>

                    <pre class="mt-0 max-h-[70vh] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                      {selectedFilePath() ? visibleText() : 'Select a file from the list'}
                    </pre>
                  </div>
                </Show>

                <Show when={tab() === 'nodes'}>
                  <div class="flex items-center justify-between">
                    <div class="text-xs font-semibold uppercase tracking-wider text-slate-400">Node</div>
                    <button
                      class="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-700 shadow-sm hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none dark:hover:bg-slate-900"
                      onClick={() => void nodes.refetch()}
                    >
                      REFRESH
                    </button>
                  </div>

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
                                    void nodes.refetch()
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
                </Show>
              </section>
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
                    disabled={deleteInstance.isPending}
                    onClick={async () => {
                      const id = confirmDeleteInstanceId()
                      if (!id) return
                      try {
                        await deleteInstance.mutateAsync({ instance_id: id })
                        if (selectedInstanceId() === id) setSelectedInstanceId(null)
                        setConfirmDeleteInstanceId(null)
                        await instances.refetch()
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

    </div>
  )
}

export default App
