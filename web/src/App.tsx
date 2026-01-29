function App() {
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
              <span class="h-2.5 w-2.5 rounded-full bg-amber-400" />
              <span class="text-sm text-slate-200">waiting for rspc routes</span>
            </div>
            <div class="mt-4 text-xs text-slate-400">HTTP: /healthz (Axum) - coming next</div>
          </div>

          <div class="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5">
            <div class="text-sm font-medium">Agent</div>
            <div class="mt-2 flex items-center gap-2">
              <span class="h-2.5 w-2.5 rounded-full bg-amber-400" />
              <span class="text-sm text-slate-200">gRPC: AgentHealthService</span>
            </div>
            <div class="mt-4 text-xs text-slate-400">Default port: :50051</div>
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
