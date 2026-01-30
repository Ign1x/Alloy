import { rspc } from './rspc'
import { createMemo, createSignal, For, Show } from 'solid-js'

function statusDotClass(state: { loading: boolean; error: boolean }) {
  if (state.loading) return 'bg-slate-600 animate-pulse'
  if (state.error) return 'bg-rose-500'
  return 'bg-emerald-400'
}

function App() {
  const ping = rspc.createQuery(() => ['control.ping', null])
  const agentHealth = rspc.createQuery(() => ['agent.health', null])

  const templates = rspc.createQuery(() => ['process.templates', null])
  const processes = rspc.createQuery(() => ['process.list', null])

  const startProcess = rspc.createMutation(() => 'process.start')
  const stopProcess = rspc.createMutation(() => 'process.stop')

  const [selectedTemplate, setSelectedTemplate] = createSignal<string>('demo:sleep')
  const [sleepSeconds, setSleepSeconds] = createSignal<string>('60')

  const [mcEula, setMcEula] = createSignal(false)
  const [mcVersion, setMcVersion] = createSignal('latest_release')
  const [mcMemory, setMcMemory] = createSignal('2048')
  const [mcPort, setMcPort] = createSignal('25565')
  const [mcError, setMcError] = createSignal<string | null>(null)

  const [selectedProcessId, setSelectedProcessId] = createSignal<string | null>(null)
  const logs = rspc.createQuery(
    () => [
      'process.logsTail',
      {
        process_id: selectedProcessId() ?? '',
        cursor: null,
        limit: 200,
      },
    ],
    () => ({
      enabled: !!selectedProcessId(),
      refetchInterval: 1000,
    }),
  )

  const selectedProcess = createMemo(() => {
    const id = selectedProcessId()
    if (!id) return null
    return (
      (processes.data ?? []).find((p: { process_id: string }) => p.process_id === id) ?? null
    )
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
    <main class="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 text-slate-900">
      <div class="mx-auto max-w-5xl px-6 py-10">
        <header class="flex items-baseline justify-between gap-6">
          <h1 class="text-4xl font-semibold tracking-tight">Alloy</h1>
          <div class="text-xs uppercase tracking-[0.2em] text-slate-500">control plane</div>
        </header>

        <p class="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
          Rust (Axum + SeaORM) as the control plane, gRPC (Tonic) to agents, and SolidJS + Tailwind v4 for the web UI.
        </p>


        <section class="mt-8 grid gap-4 sm:grid-cols-2">
          <div class="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm">
            <div class="text-sm font-medium">Backend</div>
            <div class="mt-2 flex items-center gap-2">
              <span
                class={`h-2.5 w-2.5 rounded-full ${statusDotClass({ loading: ping.isPending, error: ping.isError })}`}
              />
              <span class="text-sm text-slate-800">
                {ping.isPending ? 'checking...' : ping.isError ? 'offline' : 'online'}
              </span>
            </div>
            <div class="mt-4 text-xs text-slate-500">
              rspc: <span class="font-mono">control.ping</span>
            </div>
            <div class="mt-2 text-xs text-slate-600">
              {ping.isError ? pingErrorMessage() : ping.data ? `version: ${ping.data.version}` : ''}
            </div>
          </div>

          <div class="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm">
            <div class="text-sm font-medium">Agent</div>
            <div class="mt-2 flex items-center gap-2">
              <span
                class={`h-2.5 w-2.5 rounded-full ${statusDotClass({ loading: agentHealth.isPending, error: agentHealth.isError })}`}
              />
              <span class="text-sm text-slate-800">
                {agentHealth.isPending ? 'checking...' : agentHealth.isError ? 'offline' : 'online'}
              </span>
            </div>
            <div class="mt-4 text-xs text-slate-500">
              rspc: <span class="font-mono">agent.health</span>
            </div>
            <div class="mt-2 text-xs text-slate-600">
              {agentHealth.isError
                ? 'failed to reach agent'
                : agentHealth.data
                  ? `status: ${agentHealth.data.status} (${agentHealth.data.agent_version})`
                  : ''}
            </div>
          </div>
        </section>

        <section class="mt-8 grid gap-4 lg:grid-cols-3">
          <div class="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm lg:col-span-1">
            <div class="text-sm font-medium">Processes</div>
            <div class="mt-2 text-xs text-slate-500">rspc: process.* (template-based)</div>

            <div class="mt-4 space-y-3">
              <label class="block text-xs text-slate-700">
                Template
                <select
                  class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
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
                <label class="block text-xs text-slate-700">
                  seconds
                  <input
                    class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
                    value={sleepSeconds()}
                    onInput={(e) => setSleepSeconds(e.currentTarget.value)}
                  />
                </label>
              </Show>

              <Show when={selectedTemplate() === 'minecraft:vanilla'}>
                <div class="space-y-3 border-t border-slate-200 pt-3">
                  <div class="flex items-start gap-3">
                    <input
                      id="mc-eula"
                      type="checkbox"
                      class="mt-1 h-4 w-4 rounded border-slate-300 bg-white text-slate-700 focus:ring-slate-400 focus:ring-offset-white"
                      checked={mcEula()}
                      onChange={(e) => setMcEula(e.currentTarget.checked)}
                    />
                    <label for="mc-eula" class="text-xs leading-tight text-slate-700 select-none">
                      I agree to the{' '}
                      <a
                        href="https://account.mojang.com/documents/minecraft_eula"
                        target="_blank"
                        rel="noreferrer noopener"
                        class="text-indigo-600 hover:text-indigo-500 underline"
                      >
                        Minecraft EULA
                      </a>
                      <span class="block text-[10px] text-slate-500 mt-0.5">Required to start server</span>
                    </label>
                  </div>

                  <div class="grid grid-cols-2 gap-3">
                    <label class="block text-xs text-slate-700">
                      Version
                      <input
                        class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
                        value={mcVersion()}
                        onInput={(e) => setMcVersion(e.currentTarget.value)}
                        placeholder="latest_release"
                      />
                    </label>

                    <label class="block text-xs text-slate-700">
                      Memory (MB)
                      <input
                        type="number"
                        class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
                        value={mcMemory()}
                        onInput={(e) => setMcMemory(e.currentTarget.value)}
                      />
                    </label>
                  </div>

                  <label class="block text-xs text-slate-700">
                    Port
                    <input
                      type="number"
                      class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
                      value={mcPort()}
                      onInput={(e) => setMcPort(e.currentTarget.value)}
                    />
                  </label>

                  <Show when={mcError()}>
                    <div class="text-xs text-rose-700 bg-rose-50 border border-rose-200 p-2 rounded animate-pulse">
                      {mcError()}
                    </div>
                  </Show>
                </div>
              </Show>

              <button
                class="w-full rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
                disabled={startProcess.isPending}
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

                  await startProcess.mutateAsync({ template_id, params })
                  await processes.refetch()
                }}
              >
                {startProcess.isPending ? 'Starting...' : 'Start'}
              </button>
              <Show when={startProcess.isError}>
                <div class="text-xs text-rose-300">start failed</div>
              </Show>
            </div>
          </div>

          <div class="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm lg:col-span-2">
            <div class="flex items-center justify-between gap-4">
              <div class="text-sm font-medium">Running (agent memory)</div>
              <button
                class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm hover:bg-slate-50"
                onClick={() => processes.refetch()}
              >
                Refresh
              </button>
            </div>

            <div class="mt-3 grid gap-2">
              <For each={processes.data ?? []}>
                {(p) => (
                  <div
                    class={`flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 ${
                      selectedProcessId() === p.process_id ? 'ring-1 ring-slate-300' : ''
                    }`}
                  >
                    <button
                      class="min-w-0 flex-1 text-left"
                      onClick={() => setSelectedProcessId(p.process_id)}
                    >
                      <div class="truncate text-sm text-slate-900">{p.process_id}</div>
                      <div class="mt-0.5 truncate text-xs text-slate-500">
                        {p.template_id} • {p.state}
                        <Show when={p.pid !== null}> • pid {p.pid}</Show>
                      </div>
                    </button>

                    <button
                      class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                      disabled={stopProcess.isPending}
                      onClick={async () => {
                        await stopProcess.mutateAsync({ process_id: p.process_id, timeout_ms: 30_000 })
                        await processes.refetch()
                      }}
                    >
                      Stop
                    </button>
                  </div>
                )}
              </For>

              <Show when={(processes.data ?? []).length === 0}>
                <div class="rounded-xl border border-dashed border-slate-200 bg-white/50 p-6 text-sm text-slate-500">
                  no processes yet
                </div>
              </Show>
            </div>

            <Show when={selectedProcess()}>
              {(p) => (
                <div class="mt-4 rounded-xl border border-slate-200 bg-white/70 p-4">
                  <div class="flex items-center justify-between gap-4">
                    <div class="text-xs text-slate-600">
                      logs: <span class="font-mono">{p().process_id}</span>
                    </div>
                    <div class="text-xs text-slate-500">
                      {logs.isPending ? 'loading...' : logs.isError ? 'error' : 'live'}
                    </div>
                  </div>
                  <pre class="mt-2 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
                    <For each={logs.data?.lines ?? []}>{(l) => <div class="whitespace-pre-wrap">{l}</div>}</For>
                  </pre>
                </div>
              )}
            </Show>
          </div>
        </section>

        <footer class="mt-10 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            UI stack: <span class="text-slate-700">SolidJS</span> + <span class="text-slate-700">Tailwind v4</span>
          </div>
          <div>
            Next: <span class="text-slate-700">process supervision</span> + <span class="text-slate-700">templates</span>
          </div>
        </footer>
      </div>
    </main>
  )
}

export default App
