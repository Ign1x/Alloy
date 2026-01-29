import { rspc } from './rspc'

function statusDotClass(state: { loading: boolean; error: boolean }) {
  if (state.loading) return 'bg-slate-600 animate-pulse'
  if (state.error) return 'bg-rose-500'
  return 'bg-emerald-400'
}

function App() {
  const ping = rspc.createQuery(() => ['control.ping', null])
  const agentHealth = rspc.createQuery(() => ['agent.health', null])

  const pingErrorMessage = () => {
    if (!ping.isError) return ''
    const err = ping.error as unknown
    if (err && typeof err === 'object' && 'message' in err) {
      return String((err as { message?: unknown }).message)
    }
    return 'unknown error'
  }

  return (
    <main class="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-slate-100">
      <div class="mx-auto max-w-5xl px-6 py-10">
        <header class="flex items-baseline justify-between gap-6">
          <h1 class="text-4xl font-semibold tracking-tight">Alloy</h1>
          <div class="text-xs uppercase tracking-[0.2em] text-slate-400">control plane</div>
        </header>

        <p class="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
          Rust (Axum + SeaORM) as the control plane, gRPC (Tonic) to agents, and SolidJS + Tailwind v4 for the web UI.
        </p>

	        <section class="mt-8 grid gap-4 sm:grid-cols-2">
	          <div class="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5">
	            <div class="text-sm font-medium">Backend</div>
	            <div class="mt-2 flex items-center gap-2">
	              <span class={`h-2.5 w-2.5 rounded-full ${statusDotClass({ loading: ping.isPending, error: ping.isError })}`} />
	              <span class="text-sm text-slate-200">
	                {ping.isPending
	                  ? 'checking...'
	                  : ping.isError
	                    ? 'offline'
	                    : 'online'}
	              </span>
	            </div>
	            <div class="mt-4 text-xs text-slate-400">
	              rspc: <span class="font-mono">control.ping</span>
	            </div>
	            <div class="mt-2 text-xs text-slate-500">
	              {ping.isError ? pingErrorMessage() : ping.data ? `version: ${ping.data.version}` : ''}
	            </div>
	          </div>

	          <div class="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5">
	            <div class="text-sm font-medium">Agent</div>
	            <div class="mt-2 flex items-center gap-2">
	              <span class={`h-2.5 w-2.5 rounded-full ${statusDotClass({ loading: agentHealth.isPending, error: agentHealth.isError })}`} />
	              <span class="text-sm text-slate-200">
	                {agentHealth.isPending
	                  ? 'checking...'
	                  : agentHealth.isError
	                    ? 'offline'
	                    : 'online'}
	              </span>
	            </div>
	            <div class="mt-4 text-xs text-slate-400">
	              rspc: <span class="font-mono">agent.health</span>
	            </div>
	            <div class="mt-2 text-xs text-slate-500">
	              {agentHealth.isError
	                ? 'failed to reach agent'
	                : agentHealth.data
	                  ? `status: ${agentHealth.data.status} (${agentHealth.data.agent_version})`
	                  : ''}
	            </div>
	          </div>
	        </section>

        <footer class="mt-10 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            UI stack: <span class="text-slate-300">SolidJS</span> + <span class="text-slate-300">Tailwind v4</span>
          </div>
          <div>
            Next: <span class="text-slate-300">rspc</span> end-to-end TS bindings
          </div>
        </footer>
      </div>
    </main>
  )
}

export default App
