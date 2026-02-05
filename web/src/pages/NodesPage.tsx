import type { JSX } from 'solid-js'

export type NodesPageProps = {
  left: JSX.Element
  right: JSX.Element
  tabLabel?: string
}

export default function NodesPage(props: NodesPageProps) {
  return (
    <div class="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside class="flex w-full flex-none flex-col border-b border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-950/60 md:w-[360px] md:border-b-0 md:border-r max-h-[45vh] md:max-h-none">
        <div class="flex items-center justify-between border-b border-slate-200 bg-white/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/60 md:hidden">
          <div class="text-section-title">{props.tabLabel ?? 'nodes'}</div>
        </div>
        <div class="min-h-0 flex-1 overflow-auto p-4">{props.left}</div>
      </aside>

      <section class="min-w-0 flex-1 overflow-auto bg-transparent p-4">{props.right}</section>
    </div>
  )
}
