import type { JSX } from 'solid-js'
import { Show } from 'solid-js'
import { cn } from './cn'

export type FieldProps = {
  label?: JSX.Element
  description?: JSX.Element
  error?: string | null | undefined
  required?: boolean
  right?: JSX.Element
  class?: string
  children: JSX.Element
}

export function Field(props: FieldProps) {
  return (
    <div class={cn('space-y-1.5', props.class)}>
      <Show when={props.label != null}>
        <div class="flex items-center justify-between gap-3">
          <div class="text-sm font-medium text-slate-700 dark:text-slate-300">
            {props.label}
            <Show when={props.required}>
              <span class="ml-1 text-rose-600 dark:text-rose-400">*</span>
            </Show>
          </div>
          <Show when={props.right}>
            <div class="flex items-center gap-2">{props.right}</div>
          </Show>
        </div>
      </Show>

      {props.children}

      <Show when={props.description}>
        <div class="text-[12px] text-slate-500 dark:text-slate-400">{props.description}</div>
      </Show>
      <Show when={props.error}>
        <div class="text-[12px] text-rose-700 dark:text-rose-300">{props.error}</div>
      </Show>
    </div>
  )
}

