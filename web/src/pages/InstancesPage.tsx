import type { JSX } from 'solid-js'

export type InstancesPageProps = {
  left: JSX.Element
  right: JSX.Element
  tabLabel?: string
}

export default function InstancesPage(props: InstancesPageProps) {
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3 md:flex-row md:items-stretch">
      <aside class="surface-glass flex w-full flex-none flex-col border-b max-h-[42dvh] min-h-[16rem] md:w-[372px] md:border-b-0 md:border-r md:max-h-none md:min-h-0">
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 md:p-4">{props.left}</div>
      </aside>

      <section class="surface-glass min-w-0 min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 md:p-4">{props.right}</section>
    </div>
  )
}
