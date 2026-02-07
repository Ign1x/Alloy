function statusDotClass(state: { loading: boolean; error: boolean }) {
  if (state.loading) return 'bg-slate-600 animate-pulse'
  if (state.error) return 'bg-rose-500'
  return 'bg-emerald-400'
}

export function StatusPill(props: {
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

