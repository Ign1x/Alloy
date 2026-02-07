import { Show } from 'solid-js'
import { formatRelativeTime } from '../../app/helpers/format'
import { instanceStateLabel } from '../../app/helpers/instances'
import { connectHost, instancePort } from '../../app/helpers/network'
import { safeCopy, shortId } from '../../app/helpers/misc'
import { StartProgress } from '../../app/primitives/StartProgress'
import { Badge } from '../../components/ui/Badge'
import { IconButton } from '../../components/ui/IconButton'

export type InstanceCardHeaderProps = {
  [key: string]: unknown
}

export default function InstanceCardHeader(props: InstanceCardHeaderProps) {
  const {
    i,
    instanceDisplayName,
    instanceStatusKeys,
    pinnedInstanceIds,
    pushToast,
    togglePinnedInstance,
  } = props as any

  return (
                                <div class="flex items-start justify-between gap-3">
                                  <div class="min-w-0">
                                    <div class="truncate font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                                      {instanceDisplayName(i)}
                                    </div>
	                                    <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
	                                      <button
	                                        type="button"
	                                        class="group inline-flex max-w-full cursor-pointer items-center gap-1 rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono text-[11px] text-slate-700 transition-all duration-150 hover:bg-white active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 dark:hover:bg-slate-900 dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950"
	                                        onClick={(e) => {
	                                          e.preventDefault()
	                                          e.stopPropagation()
	                                          void safeCopy(i.config.instance_id)
	                                          pushToast('success', 'Copied ID', shortId(i.config.instance_id))
	                                        }}
	                                        title="Copy instance id"
	                                      >
	                                        <span class="truncate">{shortId(i.config.instance_id)}</span>
	                                        <svg
	                                          xmlns="http://www.w3.org/2000/svg"
	                                          viewBox="0 0 20 20"
	                                          fill="currentColor"
	                                          class="h-3 w-3 flex-none opacity-60 group-hover:opacity-100"
	                                          aria-hidden="true"
	                                        >
	                                          <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
	                                          <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
	                                        </svg>
	                                      </button>
	                                      <Badge
	                                        variant={
	                                          i.status?.state === 'PROCESS_STATE_RUNNING'
	                                            ? 'success'
                                            : i.status?.state === 'PROCESS_STATE_FAILED'
                                              ? 'danger'
                                              : i.status?.state === 'PROCESS_STATE_STARTING' || i.status?.state === 'PROCESS_STATE_STOPPING'
                                                ? 'warning'
                                                : 'neutral'
                                        }
                                        title={i.status?.state ?? 'PROCESS_STATE_EXITED'}
                                      >
                                        {instanceStateLabel(i.status)}
                                      </Badge>
                                      <Show when={instanceStatusKeys()[i.config.instance_id]?.updated_at_unix_ms}>
                                        {(t) => (
                                          <Badge variant="neutral" title={new Date(t()).toLocaleString()}>
                                            {formatRelativeTime(t())}
                                          </Badge>
                                        )}
                                      </Show>
                                      <Show when={instancePort(i)}>
                                        {(p) => {
	                                          const addr = `${connectHost()}:${p()}`
	                                          return (
	                                            <button
	                                              type="button"
	                                              class="group inline-flex max-w-full cursor-pointer items-center gap-1 rounded-full border border-slate-200 bg-white/60 px-2 py-0.5 font-mono text-slate-700 transition-all duration-150 hover:bg-white active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 dark:hover:bg-slate-900 dark:focus-visible:ring-amber-400/35 dark:focus-visible:ring-offset-slate-950"
	                                              title="Click to copy connection address"
	                                              onClick={(e) => {
	                                                e.preventDefault()
                                                e.stopPropagation()
                                                void safeCopy(addr)
                                                pushToast('success', 'Copied address', addr)
                                              }}
                                            >
                                              <span class="truncate">{addr}</span>
                                              <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                viewBox="0 0 20 20"
                                                fill="currentColor"
                                                class="h-3 w-3 flex-none opacity-60 group-hover:opacity-100"
                                                aria-hidden="true"
                                              >
                                                <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
                                                <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
                                              </svg>
                                            </button>
	                                          )
                                        }}
                                      </Show>
                                    </div>
                                    <Show when={i.status?.state === 'PROCESS_STATE_STARTING' ? i.status?.message?.trim() : null}>
                                      {(msg) => <StartProgress templateId={i.config.template_id} message={msg()} />}
                                    </Show>
                                  </div>
                                  <div class="mt-0.5 flex flex-none items-center gap-2">
                                    <IconButton
                                      type="button"
                                      label={pinnedInstanceIds()[i.config.instance_id] ? 'Unpin instance' : 'Pin instance'}
                                      variant="ghost"
                                      onClick={(e) => {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        togglePinnedInstance(i.config.instance_id)
                                      }}
                                    >
                                      <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        viewBox="0 0 20 20"
                                        fill="currentColor"
                                        class={`h-4 w-4 ${
                                          pinnedInstanceIds()[i.config.instance_id]
                                            ? 'text-amber-500'
                                            : 'text-slate-400 dark:text-slate-500'
                                        }`}
                                        aria-hidden="true"
                                      >
                                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.539 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                      </svg>
                                    </IconButton>

                                    <span
                                      class={`mt-1 inline-flex h-2.5 w-2.5 flex-none rounded-full ${
                                        i.status?.state === 'PROCESS_STATE_RUNNING'
                                          ? 'bg-emerald-400'
                                          : i.status?.state === 'PROCESS_STATE_STARTING'
                                            ? 'bg-amber-400 animate-pulse'
                                            : i.status?.state === 'PROCESS_STATE_STOPPING'
                                              ? 'bg-amber-400 animate-pulse'
                                              : i.status?.state === 'PROCESS_STATE_FAILED'
                                                ? 'bg-rose-500'
                                                : 'bg-slate-400'
                                      }`}
                                      title={i.status?.state ?? 'unknown'}
                                    />
                                  </div>
                                </div>
  )
}
