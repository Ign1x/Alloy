import type { JSX } from 'solid-js'

export type NodesPageProps = {
  left: JSX.Element
  right: JSX.Element
  tabLabel?: string
}

export default function NodesPage(props: NodesPageProps) {
  return (
    <div class="relative flex min-h-0 flex-1 flex-col gap-4 md:gap-5 xl:flex-row">
      <div class="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
        <div class="absolute -left-28 -top-24 h-56 w-56 rounded-full bg-cyan-300/20 blur-3xl dark:bg-cyan-500/15" />
        <div class="absolute -right-20 top-1/3 h-52 w-52 rounded-full bg-amber-300/25 blur-3xl dark:bg-amber-500/15" />
      </div>

      <aside class="surface-glass relative flex w-full flex-none flex-col overflow-hidden border-white/55 bg-gradient-to-br from-white/90 via-white/75 to-slate-100/65 shadow-xl shadow-slate-900/5 max-h-[45dvh] min-h-[17rem] xl:w-[390px] xl:max-h-none xl:min-h-0">
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 md:p-4">{props.left}</div>
      </aside>

      <section class="surface-glass relative min-w-0 min-h-0 flex-1 overflow-hidden border-white/55 bg-gradient-to-br from-white/92 via-white/78 to-slate-100/66 p-0 shadow-xl shadow-slate-900/5 dark:border-slate-700/70 dark:from-slate-950/86 dark:via-slate-950/72 dark:to-slate-900/66">
        <div class="h-full overflow-y-auto overscroll-contain p-3 md:p-4">{props.right}</div>
      </section>
    </div>
  )
}
