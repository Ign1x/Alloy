import { Show, createMemo, createSignal } from 'solid-js'
import { Gamepad2 } from 'lucide-solid'
import { cn } from './cn'

export type GameAvatarProps = {
  name: string
  src?: string
  class?: string
  title?: string
}

function toneFor(name: string): string {
  const key = name.trim().toLowerCase()
  if (key.includes('minecraft')) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200'
  }
  if (key.includes('terraria')) {
    return 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200'
  }
  if (key.includes('starve') || key.includes('dst')) {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200'
  }
  return 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
}

export function GameAvatar(props: GameAvatarProps) {
  const [imgFailed, setImgFailed] = createSignal(false)
  const showImage = createMemo(() => Boolean(props.src) && !imgFailed())

  const initial = createMemo(() => {
    const name = props.name.trim()
    if (!name) return '?'
    const first = name.match(/[A-Za-z0-9]/)?.[0] ?? name.slice(0, 1)
    return first.toUpperCase()
  })

  const label = () => props.title ?? props.name

  return (
    <span
      role="img"
      aria-label={label()}
      title={label()}
      class={cn(
        'relative inline-flex h-6 w-6 flex-none items-center justify-center overflow-hidden rounded-md border shadow-sm dark:shadow-none',
        toneFor(props.name),
        props.class,
      )}
    >
      <Show
        when={showImage()}
        fallback={
          <span class="flex h-full w-full items-center justify-center">
            <Show when={initial() !== '?'} fallback={<Gamepad2 class="h-3.5 w-3.5" aria-hidden="true" />}>
              <span class="text-[11px] font-semibold leading-none">{initial()}</span>
            </Show>
          </span>
        }
      >
        <img
          src={props.src!}
          alt={`${props.name} logo`}
          loading="lazy"
          decoding="async"
          class="h-full w-full object-contain p-0.5"
          onError={() => setImgFailed(true)}
        />
      </Show>
    </span>
  )
}
