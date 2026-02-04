import { cn } from './cn'

export type SkeletonProps = {
  class?: string
  lines?: number
}

export function Skeleton(props: SkeletonProps) {
  const lines = Math.floor(props.lines ?? 0)
  if (lines > 0) {
    const count = Math.max(1, Math.min(lines, 24))
    return (
      <div class={cn('space-y-2', props.class)}>
        {Array.from({ length: count }, (_, idx) => (
          <div
            class={cn(
              'h-3 animate-pulse rounded-lg bg-slate-200/70 dark:bg-slate-800/60',
              idx === count - 1 ? 'w-2/3' : 'w-full',
            )}
          />
        ))}
      </div>
    )
  }
  return <div class={cn('animate-pulse rounded-xl bg-slate-200/70 dark:bg-slate-800/60', props.class)} />
}
