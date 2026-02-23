import type { JSX } from 'solid-js'

export type FilesPageProps = {
  left: JSX.Element
  right: JSX.Element
  tabLabel?: string
}

export default function FilesPage(props: FilesPageProps) {
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
      <aside class="surface-glass flex w-full flex-none flex-col border-b max-h-[42dvh] min-h-[16rem] md:w-[372px] md:border-b-0 md:border-r md:max-h-none md:min-h-0">
        {props.tabLabel ? (
          <div class="flex items-center justify-between border-b border-slate-200/90 bg-white/78 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/58 md:hidden">
            <div class="text-section-title">{props.tabLabel}</div>
          </div>
        ) : null}
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 md:p-4">{props.left}</div>
      </aside>

      <section class="surface-glass min-w-0 min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 md:p-4">{props.right}</section>
    </div>
  )
}
