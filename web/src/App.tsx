import { rspc } from './rspc'
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import type { InstanceConfigDto, ProcessStatusDto } from './bindings'
import { ensureCsrfCookie } from './auth'

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

  const ping = rspc.createQuery(() => ['control.ping', null])
  const agentHealth = rspc.createQuery(() => ['agent.health', null])

  const templates = rspc.createQuery(() => ['process.templates', null])
  const instances = rspc.createQuery(() => ['instance.list', null])

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
      enabled: !!selectedInstanceId(),
      refetchInterval: 1000,
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
    () => ({ refetchOnWindowFocus: false }),
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
    () => ({ enabled: !!selectedFilePath() && isTextFilePath(selectedFilePath() ?? ''), refetchOnWindowFocus: false }),
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
      enabled: !!selectedFilePath() && isLogFilePath(selectedFilePath() ?? ''),
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
                <select
                  class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200 dark:focus:border-slate-600 dark:focus:ring-slate-600"
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
                          if (confirm('Delete instance?')) {
                            await deleteInstance.mutateAsync({ instance_id: i.config.instance_id })
                            if (selectedInstanceId() === i.config.instance_id) {
                              setSelectedInstanceId(null)
                            }
                            await instances.refetch()
                          }
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

        <footer class="mt-10 text-xs text-slate-500">CopyRight@ign1x</footer>
      </div>
    </main>
  )
}

export default App
