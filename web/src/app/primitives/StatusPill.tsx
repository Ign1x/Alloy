function statusDotClass(state: { loading: boolean; error: boolean }) {
  if (state.error) return 'bg-rose-500'
  if (state.loading) return 'bg-amber-500 animate-pulse'
  return 'bg-emerald-500'
}

export function StatusPill(props: {
  label: string
  status: string
  state: { loading: boolean; error: boolean }
}) {
  return (
    <div class="motion-surface flex items-center gap-2 rounded-full border border-slate-200/90 bg-white/76 px-2.5 py-1 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/58 dark:shadow-none">
      <span class={`h-1.5 w-1.5 rounded-full ${statusDotClass(props.state)}`} />
      <span class="font-display text-[11px] font-semibold tracking-wide text-slate-700 dark:text-slate-200">{props.label}</span>
      <span class="font-mono text-[11px] text-slate-600 dark:text-slate-300">{props.status}</span>
    </div>
  )
}
