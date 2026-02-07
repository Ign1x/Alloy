import { For, Show } from 'solid-js'
import { EmptyState } from '../components/ui/EmptyState'
import { ErrorState } from '../components/ui/ErrorState'
import { IconButton } from '../components/ui/IconButton'
import { Skeleton } from '../components/ui/Skeleton'
import { formatRelativeTime } from '../app/helpers/format'
import NodesPage from './NodesPage'

export type NodesTabProps = {
  tab: () => string
  [key: string]: unknown
}

export default function NodesTab(props: NodesTabProps) {
  const {
    tab,
    me,
    openCreateNode,
    nodesLastUpdatedAtUnixMs,
    nodes,
    invalidateNodes,
    selectedNodeId,
    setSelectedNodeId,
    selectedNode,
    setNodeEnabled,
    nodeEnabledOverride,
    setNodeEnabledOverride,
  } = props as any

  return (
              <Show when={tab() === 'nodes'}>
                <NodesPage
                  tabLabel="Nodes"
                  left={
                    <div class="space-y-3">
                      <div class="flex items-center justify-end gap-2">
                        <Show when={me()?.is_admin}>
                          <IconButton type="button" label="Add node" variant="secondary" onClick={() => openCreateNode()}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                              <path
                                fill-rule="evenodd"
                                d="M10 3.25a.75.75 0 01.75.75v5.25H16a.75.75 0 010 1.5h-5.25V16a.75.75 0 01-1.5 0v-5.25H4a.75.75 0 010-1.5h5.25V4a.75.75 0 01.75-.75z"
                                clip-rule="evenodd"
                              />
                            </svg>
                          </IconButton>
                        </Show>
                      </div>
                      <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span>Updated {formatRelativeTime(nodesLastUpdatedAtUnixMs())}</span>
                        <Show when={nodes.isPending}>
                          <span class="inline-flex items-center gap-1">
                            <span class="h-1.5 w-1.5 rounded-full bg-slate-500 animate-pulse" />
                            loading
                          </span>
                        </Show>
                        <Show when={nodes.isError}>
                          <span class="inline-flex items-center gap-1">
                            <span class="h-1.5 w-1.5 rounded-full bg-rose-500" />
                            error
                          </span>
                        </Show>
                      </div>

                      <Show when={nodes.isError} fallback={<></>}>
                        <ErrorState title="Failed to load nodes" error={nodes.error} onRetry={() => void invalidateNodes()} />
                      </Show>

                      <Show when={!nodes.isError}>
                        <Show when={nodes.isPending} fallback={<></>}>
                          <div class="rounded-xl border border-slate-200 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                            <Skeleton lines={6} />
                          </div>
                        </Show>

                        <Show
                          when={!nodes.isPending && (nodes.data ?? []).length > 0}
                          fallback={
                            <Show when={!nodes.isPending}>
                              <EmptyState title="No nodes" description="No nodes registered yet." />
                            </Show>
                          }
                        >
                          <div class="max-h-96 overflow-auto rounded-xl border border-slate-200 bg-white/60 p-1 dark:border-slate-800 dark:bg-slate-950/40">
                            <For each={nodes.data ?? []}>
                              {(n) => (
                                <button
                                  type="button"
                                  class={`w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-900 ${
                                    selectedNodeId() === n.id ? 'bg-slate-100 dark:bg-slate-900' : ''
                                  }`}
                                  onClick={() => setSelectedNodeId(n.id)}
                                >
                                  <div class="flex items-center justify-between gap-2">
                                    <div class="min-w-0">
                                      <div class="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{n.name}</div>
                                      <div class="mt-0.5 truncate font-mono text-[11px] text-slate-500">{n.endpoint}</div>
                                    </div>
                                    <span
                                      class={`h-2 w-2 rounded-full ${
                                        n.last_error ? 'bg-rose-500' : n.last_seen_at ? 'bg-emerald-400' : 'bg-slate-500'
                                      }`}
                                    />
                                  </div>
                                </button>
                              )}
                            </For>
                          </div>
                        </Show>
                      </Show>
                    </div>
                  }
                  right={
                    <>
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Details</div>
                      </div>

                      <div class="mt-3 rounded-xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40 dark:shadow-none">
                        <Show
                          when={nodes.isError}
                          fallback={
                            <Show
                              when={(nodes.data ?? []).length > 0}
                              fallback={<EmptyState title="No nodes" description="There are no nodes to show." />}
                            >
                              <Show
                                when={selectedNode()}
                                fallback={<EmptyState title="Select a node" description="Pick a node from the left to view details." />}
                              >
                                {(n) => (
                                  <div>
                                    <div class="flex items-center justify-between gap-3">
                                      <div class="min-w-0">
                                        <div class="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{n().name}</div>
                                        <div class="mt-0.5 truncate font-mono text-[11px] text-slate-500">{n().endpoint}</div>
                                      </div>
                                      <Show when={me()?.is_admin}>
                                        <button
                                          type="button"
                                          disabled={setNodeEnabled.isPending}
                                          class="group inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/60 px-2 py-1.5 text-[11px] text-slate-700 shadow-sm hover:bg-white disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300 dark:shadow-none dark:hover:bg-slate-900"
                                          onClick={async () => {
                                            const id = n().id
                                            const current =
                                              Object.prototype.hasOwnProperty.call(nodeEnabledOverride(), id)
                                                ? nodeEnabledOverride()[id]
                                                : n().enabled
                                            const next = !current
                                            setNodeEnabledOverride({ ...nodeEnabledOverride(), [id]: next })
                                            try {
                                              await setNodeEnabled.mutateAsync({ node_id: id, enabled: next })
                                              void invalidateNodes()
                                            } catch {
                                              setNodeEnabledOverride({ ...nodeEnabledOverride(), [id]: current })
                                            }
                                          }}
                                        >
                                          <span class="text-slate-500 dark:text-slate-500">Enabled</span>
                                          <span
                                            class={`relative inline-flex h-5 w-9 items-center rounded-full border transition-colors ${
                                              (Object.prototype.hasOwnProperty.call(nodeEnabledOverride(), n().id)
                                                ? nodeEnabledOverride()[n().id]
                                                : n().enabled)
                                                ? 'border-emerald-200 bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/20'
                                                : 'border-slate-300 bg-slate-200 dark:border-slate-700 dark:bg-slate-900/40'
                                            }`}
                                          >
                                            <span
                                              class={`inline-block h-4 w-4 transform rounded-full bg-slate-100 shadow transition-transform ${
                                                (Object.prototype.hasOwnProperty.call(nodeEnabledOverride(), n().id)
                                                  ? nodeEnabledOverride()[n().id]
                                                  : n().enabled)
                                                  ? 'translate-x-4'
                                                  : 'translate-x-1'
                                              }`}
                                            />
                                          </span>
                                        </button>
                                      </Show>
                                    </div>

                                    <div class="mt-4 grid grid-cols-2 gap-3 text-xs">
                                      <div>
                                        <div class="text-[11px] text-slate-500">Status</div>
                                        <div class="mt-1 text-slate-700 dark:text-slate-200">{n().last_error ? 'Error' : n().last_seen_at ? 'Healthy' : 'Unknown'}</div>
                                      </div>
                                      <div>
                                        <div class="text-[11px] text-slate-500">Agent</div>
                                        <div class="mt-1 text-slate-700 dark:text-slate-200">{n().agent_version ?? '-'}</div>
                                      </div>
                                      <div class="col-span-2">
                                        <div class="text-[11px] text-slate-500">Last seen</div>
                                        <div class="mt-1 font-mono text-[11px] text-slate-700 dark:text-slate-200">{n().last_seen_at ?? '-'}</div>
                                      </div>
                                      <div class="col-span-2">
                                        <div class="text-[11px] text-slate-500">Last error</div>
                                        <div class="mt-1 font-mono text-[11px] text-rose-700 dark:text-rose-300">{n().last_error ?? '-'}</div>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </Show>
                            </Show>
                          }
                        >
                          <ErrorState title="Failed to load nodes" error={nodes.error} onRetry={() => void invalidateNodes()} />
                        </Show>
                      </div>
                    </>
                  }
                />
              </Show>
  )
}
