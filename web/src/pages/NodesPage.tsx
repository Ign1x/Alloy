import type { JSX } from 'solid-js'

export type NodesPageProps = {
  left: JSX.Element
  right: JSX.Element
  tabLabel?: string
}

export default function NodesPage(props: NodesPageProps) {
  return (
    <div class="flex min-h-0 flex-1">
      <aside class="hidden md:flex w-[360px] flex-none flex-col border-r border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-950/60">
        <div class="flex items-center justify-between border-b border-slate-200 bg-white/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/60">
          <div class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{props.tabLabel ?? 'nodes'}</div>
          <div class="text-[11px] text-slate-400">auto</div>
        </div>
        <div class="min-h-0 flex-1 overflow-auto p-4">{props.left}</div>
      </aside>

      <section class="min-w-0 flex-1 overflow-auto bg-slate-50 p-4 dark:bg-slate-950">{props.right}</section>
    </div>
  )
}
