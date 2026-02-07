import { For, Show } from 'solid-js'
import { startProgressIndex, startProgressSteps } from '../helpers/instances'

export function StartProgress(props: { templateId: string; message: string }) {
  const steps = () => startProgressSteps(props.templateId)
  const active = () => startProgressIndex(props.templateId, props.message)
  return (
    <div class="mt-2 rounded-xl border border-slate-200 bg-white/60 px-3 py-2 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
      <div class="flex flex-wrap items-center gap-2">
        <For each={steps()}>
          {(s, idx) => {
            const i = idx()
            const state = () => (i < active() ? 'done' : i === active() ? 'active' : 'todo')
            const dot = () =>
              state() === 'done'
                ? 'bg-emerald-400'
                : state() === 'active'
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-slate-400'
            const text = () =>
              state() === 'active' ? 'text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'

            return (
              <div class="flex items-center gap-2">
                <span class={`h-1.5 w-1.5 rounded-full ${dot()}`} aria-hidden="true" />
                <span class={text()}>{s}</span>
                <Show when={i < steps().length - 1}>
                  <span class="text-slate-300 dark:text-slate-700" aria-hidden="true">
                    ›
                  </span>
                </Show>
              </div>
            )
          }}
        </For>

        <span class="ml-auto truncate font-mono text-[11px] text-slate-500 dark:text-slate-400" title={props.message}>
          {props.message}
        </span>
      </div>
    </div>
  )
}

