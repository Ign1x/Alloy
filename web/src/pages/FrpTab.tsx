import { For, Show } from 'solid-js'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { IconButton } from '../components/ui/IconButton'
import { compactAllocatablePortsSpec, detectFrpConfigFormat, formatLatencyMs, parseFrpEndpoint } from '../app/helpers/network'
import { safeCopy } from '../app/helpers/misc'

export type FrpTabProps = {
  tab: () => string
  [key: string]: unknown
}

export default function FrpTab(props: FrpTabProps) {
  const {
    tab,
    frpNodes,
    isAuthed,
    isReadOnly,
    openCreateFrpNodeModal,
    openEditFrpNodeModal,
    frpDeleteNode,
    invalidateFrpNodes,
    pushToast,
    toastError,
  } = props as any

  return (
              <Show when={tab() === 'frp'}>
                <div class="min-h-0 flex-1 overflow-auto p-4">
                  <div class="mx-auto w-full max-w-3xl space-y-4">
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">FRP nodes</div>
                        <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Manage FRP servers (IP/port/allocatable ports/token) and reusable configs (INI/TOML/YAML/JSON).
                        </div>
                      </div>
                      <div class="flex items-center gap-2">
                        <Show when={frpNodes.isPending}>
                          <Badge variant="neutral">Loading</Badge>
                        </Show>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={!isAuthed() || isReadOnly()}
                          title={!isAuthed() ? 'Sign in required' : isReadOnly() ? 'Read-only mode' : 'Add FRP node'}
                          onClick={() => openCreateFrpNodeModal()}
                        >
                          New
                        </Button>
                      </div>
                    </div>

                    <Show when={isAuthed()} fallback={<EmptyState title="Sign in required" description="Sign in to manage FRP nodes." />}>
                      <Show
                        when={frpNodes.isError}
                        fallback={
                          <Show
                            when={(frpNodes.data ?? []).length > 0}
                            fallback={
                              <EmptyState
                                title="No FRP nodes"
                                description="Add one FRP server profile and reuse it when creating Minecraft/Terraria instances."
                                actions={
                                  <Button variant="secondary" size="sm" onClick={() => openCreateFrpNodeModal()} disabled={isReadOnly()}>
                                    Add node
                                  </Button>
                                }
                              />
                            }
                          >
                            <div class="space-y-3">
                              <For each={(frpNodes.data ?? []) as unknown as any[]}>
                                {(n) => {
                                  const endpoint = () =>
                                    n.server_addr && n.server_port ? `${n.server_addr}:${n.server_port}` : parseFrpEndpoint(n.config)
                                  const configFormat = () => detectFrpConfigFormat(n.config)
                                  const latencyLabel = () => formatLatencyMs(n.latency_ms)
                                  const latencyClass = () =>
                                    n.latency_ms == null
                                      ? 'text-rose-600 dark:text-rose-300'
                                      : n.latency_ms > 300
                                        ? 'text-amber-600 dark:text-amber-300'
                                        : 'text-emerald-600 dark:text-emerald-300'
                                  const allocPorts = () => compactAllocatablePortsSpec(n.allocatable_ports)

                                  return (
                                    <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                                      <div class="flex flex-wrap items-start justify-between gap-3">
                                        <div class="min-w-0">
                                          <div class="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{n.name}</div>
                                          <div class="mt-1 space-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                            <div>
                                              Server: <span class="font-mono">{endpoint() ?? '—'}</span>
                                            </div>
                                            <div>
                                              Latency: <span class={`font-mono ${latencyClass()}`}>{latencyLabel()}</span>
                                            </div>
                                            <Show when={allocPorts()}>
                                              <div>
                                                Alloc ports:{' '}
                                                <span class="font-mono break-all whitespace-pre-wrap">{allocPorts()}</span>
                                              </div>
                                            </Show>
                                            <div>
                                              Token: <span class="font-mono">{(n.token ?? '').trim() ? '(set)' : '(none)'}</span>
                                            </div>
                                            <div>
                                              Config: <span class="font-mono uppercase">{configFormat()}</span>
                                            </div>
                                          </div>
                                        </div>
                                        <div class="flex flex-wrap items-center gap-2">
                                          <IconButton
                                            size="sm"
                                            variant="secondary"
                                            label="Copy endpoint"
                                            disabled={!endpoint()}
                                            onClick={async () => {
                                              const ep = endpoint()
                                              if (!ep) return
                                              await safeCopy(ep)
                                              pushToast('success', 'Copied', ep)
                                            }}
                                          >
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                                              <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
                                              <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
                                            </svg>
                                          </IconButton>
                                          <Button size="sm" variant="secondary" onClick={() => openEditFrpNodeModal(n)}>
                                            Edit
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="danger"
                                            disabled={isReadOnly() || frpDeleteNode.isPending}
                                            onClick={async () => {
                                              if (!window.confirm(`Delete FRP node “${n.name}”?`)) return
                                              try {
                                                await frpDeleteNode.mutateAsync({ id: n.id })
                                                pushToast('success', 'Deleted', n.name)
                                                void invalidateFrpNodes()
                                              } catch (e) {
                                                toastError('Delete failed', e)
                                              }
                                            }}
                                          >
                                            Delete
                                          </Button>
                                        </div>
                                      </div>
                                      <div class="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
                                        Updated <span class="font-mono">{n.updated_at}</span>
                                      </div>
                                    </div>
                                  )
                                }}
                              </For>
                            </div>
                          </Show>
                        }
                      >
                        <ErrorState title="Failed to load FRP nodes" error={frpNodes.error} onRetry={() => void invalidateFrpNodes()} />
                      </Show>
                    </Show>
                  </div>
                </div>
              </Show>

  )
}
