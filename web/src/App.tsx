import { onAuthEvent, queryClient, rspc } from './rspc'
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import type { InstanceConfigDto, ProcessStatusDto } from './bindings'
import { ensureCsrfCookie, login, logout, whoami } from './auth'

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

type UiTab = 'instances' | 'files'

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

  const [focusLoginUsername, setFocusLoginUsername] = createSignal(false)
  let loginUsernameEl: HTMLInputElement | undefined

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
  const [mcMemory, setMcMemory] = createSignal('2048')
  const [mcPort, setMcPort] = createSignal('25565')
  const [mcError, setMcError] = createSignal<string | null>(null)

  const [tab, setTab] = createSignal<UiTab>('instances')

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

  const pingErrorMessage = () => {
    if (!ping.isError) return ''
    const err = ping.error as unknown
    if (err && typeof err === 'object' && 'message' in err) {
      return String((err as { message?: unknown }).message)
    }
    return 'unknown error'
  }

  return (
    <main class="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 text-slate-900 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 dark:text-slate-100">
      <div class="mx-auto max-w-5xl px-6 py-10">
        <header class="flex items-center justify-between gap-6">
          <div class="flex items-center gap-4">
            <img
              src="/logo.svg"
              width="40"
              height="40"
              class="h-10 w-10 rounded-xl shadow-lg shadow-amber-500/10"
              alt="Alloy"
            />
            <div class="leading-none">
              <h1 class="text-4xl font-semibold tracking-tight">Alloy</h1>
              <div class="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                control plane
              </div>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <Show
              when={!authLoading()}
              fallback={<div class="h-9 w-24 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />}
            >
              <Show
                when={me()}
                fallback={
                  <button
                    class="rounded-full bg-slate-900 px-5 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                    onClick={() => {
                      setAuthError(null)
                      setShowLoginModal(true)
                      setFocusLoginUsername(true)
                    }}
                  >
                    Sign in
                  </button>
                }
              >
                <div class="flex items-center gap-3 rounded-full border border-slate-200 bg-white/50 py-1.5 pl-4 pr-1.5 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/50">
                  <div class="flex flex-col text-right leading-none">
                    <span class="text-xs font-medium text-slate-700 dark:text-slate-200">{me()!.username}</span>
                    <span class="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {me()!.is_admin ? 'Admin' : 'User'}
                    </span>
                  </div>
                  <button
                    class="group rounded-full bg-slate-100 p-2 text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-rose-950/30 dark:hover:text-rose-400"
                    title="Sign out"
                    onClick={handleLogout}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      class="h-4 w-4"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M3 4.25A2.25 2.25 0 015.25 2h5.5A2.25 2.25 0 0113 4.25v2a.75.75 0 01-1.5 0v-2a.75.75 0 00-.75-.75h-5.5a.75.75 0 00-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 00.75-.75v-2a.75.75 0 011.5 0v2A2.25 2.25 0 0110.75 18h-5.5A2.25 2.25 0 013 15.75V4.25z"
                        clip-rule="evenodd"
                      />
                      <path
                        fill-rule="evenodd"
                        d="M19 10a.75.75 0 00-.75-.75H8.704l1.048-1.047a.75.75 0 00-1.06-1.06l-2.358 2.358a.75.75 0 000 1.06l2.358 2.358a.75.75 0 101.06-1.06L8.704 10.75h9.546A.75.75 0 0019 10z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              </Show>
            </Show>
          </div>
        </header>

        <p class="mt-4 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          Game server control plane.
        </p>


        <section class="mt-8 grid gap-4 sm:grid-cols-2">
          <div class="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/40 dark:shadow-none">
            <div class="text-sm font-medium">Backend</div>
            <div class="mt-2 flex items-center gap-2">
              <span
                class={`h-2.5 w-2.5 rounded-full ${statusDotClass({ loading: ping.isPending, error: ping.isError })}`}
              />
              <span class="text-sm text-slate-800 dark:text-slate-200">
                {ping.isPending ? 'checking...' : ping.isError ? 'offline' : 'online'}
              </span>
            </div>
            <div class="mt-4 text-xs text-slate-500 dark:text-slate-400">
              rspc: <span class="font-mono">control.ping</span>
            </div>
            <div class="mt-2 text-xs text-slate-600 dark:text-slate-500">
              {ping.isError ? pingErrorMessage() : ping.data ? `version: ${ping.data.version}` : ''}
            </div>
          </div>

          <div class="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/40 dark:shadow-none">
            <div class="text-sm font-medium">Agent</div>
            <div class="mt-2 flex items-center gap-2">
              <span
                class={`h-2.5 w-2.5 rounded-full ${statusDotClass({ loading: agentHealth.isPending, error: agentHealth.isError })}`}
              />
              <span class="text-sm text-slate-800 dark:text-slate-200">
                {agentHealth.isPending ? 'checking...' : agentHealth.isError ? 'offline' : 'online'}
              </span>
            </div>
            <div class="mt-4 text-xs text-slate-500 dark:text-slate-400">
              rspc: <span class="font-mono">agent.health</span>
            </div>
            <div class="mt-2 text-xs text-slate-600 dark:text-slate-500">
              {agentHealth.isError
                ? 'failed to reach agent'
                : agentHealth.data
                  ? `status: ${agentHealth.data.status} (${agentHealth.data.agent_version})`
                  : ''}
            </div>
          </div>
        </section>

        <Show
          when={isAuthed()}
          fallback={
            <section class="mt-8 rounded-3xl border border-dashed border-slate-300 bg-slate-50/50 py-16 text-center dark:border-slate-800 dark:bg-slate-900/20">
              <div class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800/50 dark:text-slate-500">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="1.5"
                  stroke="currentColor"
                  class="h-8 w-8"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                  />
                </svg>
              </div>
              <h3 class="text-lg font-medium text-slate-900 dark:text-slate-100">Workspace Locked</h3>
              <p class="mt-2 mx-auto max-w-sm text-sm text-slate-500 dark:text-slate-400">
                Sign in to manage instances and browse logs.
              </p>
              <Show when={authError()}>
                <div class="mt-4 text-xs text-rose-700 dark:text-rose-300">{authError()}</div>
              </Show>
              <button
                class="mt-8 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                onClick={() => {
                  setAuthError(null)
                  setShowLoginModal(true)
                  setFocusLoginUsername(true)
                }}
              >
                Sign in to Alloy
              </button>
            </section>
          }
        >
        <section class="mt-8 grid gap-4 lg:grid-cols-3">
          <div class="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/40 dark:shadow-none lg:col-span-1">
            <div class="flex items-center justify-between gap-3">
              <div class="text-sm font-medium">Workspace</div>
              <div class="flex items-center gap-2">
                <button
                  class={`rounded-lg border px-3 py-1.5 text-xs shadow-sm ${
                    tab() === 'instances'
                      ? 'border-slate-300 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200'
                      : 'border-transparent bg-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                  onClick={() => setTab('instances')}
                >
                  Instances
                </button>
                <button
                  class={`rounded-lg border px-3 py-1.5 text-xs shadow-sm ${
                    tab() === 'files'
                      ? 'border-slate-300 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200'
                      : 'border-transparent bg-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                  onClick={() => setTab('files')}
                >
                  Files
                </button>
              </div>
            </div>

            <Show when={tab() === 'instances'}>
              <div class="mt-4 text-xs text-slate-500 dark:text-slate-400">rspc: instance.create</div>

              <div class="mt-4 space-y-3">
              <label class="block text-xs text-slate-700 dark:text-slate-300">
                Template
                <div class="relative mt-1">
                  <select
                    class="w-full appearance-none rounded-lg border border-slate-300 bg-white px-3 py-2 pr-10 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:focus:border-slate-600 dark:focus:ring-slate-600"
                    value={selectedTemplate()}
                    onInput={(e) => setSelectedTemplate(e.currentTarget.value)}
                  >
                    <For each={templates.data ?? []}>
                      {(t) => (
                        <option value={t.template_id}>
                          {t.display_name} ({t.template_id})
                        </option>
                      )}
                    </For>
                  </select>
                  <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      class="h-4 w-4 text-slate-500 dark:text-slate-400"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </div>
                </div>
              </label>

              <Show when={selectedTemplate() === 'demo:sleep'}>
                <label class="block text-xs text-slate-700 dark:text-slate-300">
                  seconds
                  <input
                    class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:focus:border-slate-600 dark:focus:ring-slate-600"
                    value={sleepSeconds()}
                    onInput={(e) => setSleepSeconds(e.currentTarget.value)}
                  />
                </label>
              </Show>

              <Show when={selectedTemplate() === 'minecraft:vanilla'}>
                <div class="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800/50">
                  <div class="flex items-start gap-3">
                    <input
                      id="mc-eula"
                      type="checkbox"
                      class="mt-1 h-4 w-4 rounded border-slate-300 bg-white text-slate-700 focus:ring-slate-400 focus:ring-offset-white dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-500 dark:focus:ring-slate-500 dark:focus:ring-offset-slate-900"
                      checked={mcEula()}
                      onChange={(e) => setMcEula(e.currentTarget.checked)}
                    />
                    <label
                      for="mc-eula"
                      class="text-xs leading-tight text-slate-700 select-none dark:text-slate-300"
                    >
                      I agree to the{' '}
                      <a
                        href="https://account.mojang.com/documents/minecraft_eula"
                        target="_blank"
                        rel="noreferrer noopener"
                        class="text-indigo-600 hover:text-indigo-500 underline dark:text-indigo-400 dark:hover:text-indigo-300"
                      >
                        Minecraft EULA
                      </a>
                      <span class="block text-[10px] text-slate-500 mt-0.5">Required to start server</span>
                    </label>
                  </div>

                  <div class="grid grid-cols-2 gap-3">
                    <label class="block text-xs text-slate-700 dark:text-slate-300">
                      Version
                      <input
                        class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:placeholder-slate-600 dark:focus:border-slate-600 dark:focus:ring-slate-600"
                        value={mcVersion()}
                        onInput={(e) => setMcVersion(e.currentTarget.value)}
                        placeholder="latest_release"
                      />
                    </label>

                    <label class="block text-xs text-slate-700 dark:text-slate-300">
                      Memory (MB)
                      <input
                        type="number"
                        class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:focus:border-slate-600 dark:focus:ring-slate-600"
                        value={mcMemory()}
                        onInput={(e) => setMcMemory(e.currentTarget.value)}
                      />
                    </label>
                  </div>

                  <label class="block text-xs text-slate-700 dark:text-slate-300">
                    Port
                    <input
                      type="number"
                      class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:focus:border-slate-600 dark:focus:ring-slate-600"
                      value={mcPort()}
                      onInput={(e) => setMcPort(e.currentTarget.value)}
                    />
                  </label>

                  <Show when={mcError()}>
                    <div class="text-xs text-rose-700 bg-rose-50 border border-rose-200 p-2 rounded animate-pulse dark:text-rose-300 dark:bg-rose-950/20 dark:border-rose-900/50">
                      {mcError()}
                    </div>
                  </Show>
                </div>
              </Show>

              <button
                class="w-full rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
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
                  }

                  await createInstance.mutateAsync({ template_id, params })
                  await instances.refetch()
                }}
              >
                {createInstance.isPending ? 'Creating...' : 'Create Instance'}
              </button>
              <Show when={createInstance.isError}>
                <div class="text-xs text-rose-300">create failed</div>
              </Show>
              </div>
            </Show>

            <Show when={tab() === 'files'}>
              <div class="mt-4 text-xs text-slate-500 dark:text-slate-400">rspc: fs.* + log.tailFile</div>

              <div class="mt-4 space-y-3">
                <label class="block text-xs text-slate-700 dark:text-slate-300">
                  Path
                  <input
                    class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:focus:border-slate-600 dark:focus:ring-slate-600"
                    value={fsPath()}
                    onInput={(e) => setFsPath(e.currentTarget.value)}
                    placeholder="(empty = /data)"
                  />
                </label>

                <div class="grid grid-cols-2 gap-2">
                  <button
                    class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none"
                    onClick={() => {
                      setSelectedFilePath(null)
                      setFsSelectedName(null)
                      setLogCursor(null)
                      setLiveTail(true)
                      void fsList.refetch()
                    }}
                  >
                    Refresh
                  </button>
                  <button
                    class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none"
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
                    Up
                  </button>
                </div>

                <div class="max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white/60 p-2 dark:border-slate-800/70 dark:bg-slate-950/30">
                  <Show when={!fsList.isPending} fallback={<div class="p-2 text-xs text-slate-500">loading...</div>}>
                    <For each={fsList.data?.entries ?? []}>
                      {(e) => (
                        <button
                          class={`w-full rounded-lg px-2 py-1 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-900/40 ${
                            fsSelectedName() === e.name && !e.is_dir
                              ? 'bg-slate-100 dark:bg-slate-900/40'
                              : ''
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
                          <span class="font-mono">
                            {e.is_dir ? 'dir' : 'file'} {e.name}
                          </span>
                        </button>
                      )}
                    </For>
                    <Show when={(fsList.data?.entries ?? []).length === 0}>
                      <div class="p-2 text-xs text-slate-500">empty</div>
                    </Show>
                  </Show>
                </div>
              </div>
            </Show>
          </div>

          <div class="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/40 dark:shadow-none lg:col-span-2">
            <Show
              when={tab() === 'instances'}
              fallback={
                <div>
                  <div class="flex items-center justify-between gap-4">
                    <div class="text-sm font-medium">Preview</div>
                    <div class="text-xs text-slate-500 dark:text-slate-400">
                      {selectedFilePath() ? selectedFilePath() : 'no file selected'}
                    </div>
                  </div>

                  <div class="mt-3 grid gap-2">
                    <Show when={selectedFilePath() && isLogFilePath(selectedFilePath() ?? '')}>
                      <div class="flex items-center justify-between rounded-lg border border-slate-200 bg-white/60 px-3 py-2 text-xs dark:border-slate-800/70 dark:bg-slate-950/30">
                        <div class="text-slate-600 dark:text-slate-300">Tail</div>
                        <div class="flex items-center gap-3">
                          <label class="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                            <input
                              type="checkbox"
                              checked={liveTail()}
                              onChange={(e) => setLiveTail(e.currentTarget.checked)}
                            />
                            Live
                          </label>

                          <button
                            class="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                            onClick={() => {
                              setLogCursor(null)
                              void logTail.refetch()
                            }}
                            title="Jump to end"
                          >
                            End
                          </button>
                        </div>
                      </div>
                    </Show>

                    <Show
                      when={selectedFilePath() && isTextFilePath(selectedFilePath() ?? '') && !isLogFilePath(selectedFilePath() ?? '')}
                    >
                      <div class="flex items-center justify-between rounded-lg border border-slate-200 bg-white/60 px-3 py-2 text-xs dark:border-slate-800/70 dark:bg-slate-950/30">
                        <div class="text-slate-600 dark:text-slate-300">Read</div>
                        <button
                          class="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                          onClick={() => void fileText.refetch()}
                        >
                          Refresh
                        </button>
                      </div>
                    </Show>

                    <pre class="mt-0 max-h-80 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-200">
                      {selectedFilePath() ? visibleText() : 'Select a file from the list'}
                    </pre>
                  </div>
                </div>
              }
            >
              <div class="flex items-center justify-between gap-4">
                <div class="text-sm font-medium">Instances</div>
                <button
                  class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none"
                  onClick={() => instances.refetch()}
                >
                  Refresh
                </button>
              </div>

            <div class="mt-3 grid gap-2">
              <For each={instances.data ?? []}>
                {(i) => (
                  <div
                    class={`flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 dark:border-slate-800/70 dark:bg-slate-950/40 ${
                      selectedInstanceId() === i.config.instance_id ? 'ring-1 ring-slate-300 dark:ring-slate-600' : ''
                    }`}
                  >
                    <button
                      class="min-w-0 flex-1 text-left"
                      onClick={() => setSelectedInstanceId(i.config.instance_id)}
                    >
                      <div class="truncate text-sm text-slate-900 dark:text-slate-100">{i.config.instance_id}</div>
                      <div class="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                        {i.config.template_id} • {instanceStateLabel(i.status)}
                        <Show when={i.status?.pid != null}> • pid {i.status?.pid}</Show>
                      </div>
                    </button>

                    <div class="flex items-center gap-2">
                      <Show
                        when={canStartInstance(i.status)}
                        fallback={
                          <button
                            class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none"
                            disabled={stopInstance.isPending || isStopping(i.status)}
                            onClick={async () => {
                              await stopInstance.mutateAsync({ instance_id: i.config.instance_id, timeout_ms: 30_000 })
                              await instances.refetch()
                            }}
                          >
                            Stop
                          </button>
                        }
                      >
                        <button
                          class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none"
                          disabled={startInstance.isPending}
                          onClick={async () => {
                            await startInstance.mutateAsync({ instance_id: i.config.instance_id })
                            await instances.refetch()
                          }}
                        >
                          Start
                        </button>
                      </Show>

                      <button
                        class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700 shadow-sm hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300 dark:shadow-none"
                        disabled={deleteInstance.isPending || !canStartInstance(i.status)}
                        onClick={async () => {
                          setConfirmDeleteInstanceId(i.config.instance_id)
                        }}
                      >
                        Del
                      </button>

                      <button
                        class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none"
                        onClick={() => openInFiles(`instances/${i.config.instance_id}`, i.config.instance_id)}
                        title="Open instance directory"
                      >
                        Files
                      </button>

                      <Show when={i.config.template_id === 'minecraft:vanilla'}>
                        <button
                          class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:shadow-none"
                          onClick={() =>
                            openFileInFiles(
                              `instances/${i.config.instance_id}/logs/latest.log`,
                              'latest.log',
                            )
                          }
                          title="Open latest.log"
                        >
                          Log
                        </button>
                      </Show>
                    </div>
                  </div>
                )}
              </For>

              <Show when={(instances.data ?? []).length === 0}>
                <div class="rounded-xl border border-dashed border-slate-200 bg-white/50 p-6 text-sm text-slate-500 dark:border-slate-800/70 dark:bg-slate-950/20 dark:text-slate-400">
                  no instances created yet
                </div>
              </Show>
            </div>

              <Show when={selectedInstance()}>
                {(i) => (
                <div class="mt-4 rounded-xl border border-slate-200 bg-white/70 p-4 dark:border-slate-800/70 dark:bg-slate-950/40">
                  <div class="flex items-center justify-between gap-4">
                    <div class="text-xs text-slate-600 dark:text-slate-300">
                      logs: <span class="font-mono">{i().config.instance_id}</span>
                    </div>
                    <div class="text-xs text-slate-500">
                      {logs.isPending ? 'loading...' : logs.isError ? 'error' : 'live'}
                    </div>
                  </div>
                  <pre class="mt-2 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-200">
                    <For each={logs.data?.lines ?? []}>{(l) => <div class="whitespace-pre-wrap">{l}</div>}</For>
                  </pre>
                </div>
                )}
              </Show>
            </Show>
          </div>
        </section>
        </Show>

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

        <footer class="mt-10 text-xs text-slate-500">CopyRight@ign1x</footer>
      </div>
    </main>
  )
}

export default App
