import { For, Show, createSignal } from 'solid-js'
import type { I18nTranslate } from '../app/i18n'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { DataBoundary } from '../components/ui/DataBoundary'
import { EmptyState } from '../components/ui/EmptyState'
import { IconButton } from '../components/ui/IconButton'
import { Modal } from '../components/ui/Modal'
import { compactAllocatablePortsSpec, detectFrpConfigFormat, formatLatencyMs, parseFrpEndpoint } from '../app/helpers/network'
import { safeCopy } from '../app/helpers/misc'

export type FrpTabProps = {
  tab: () => string
  t: I18nTranslate
  [key: string]: unknown
}

export default function FrpTab(props: FrpTabProps) {
  const {
    tab,
    t,
    frpNodes,
    isAuthed,
    isReadOnly,
    openCreateFrpNodeModal,
    openEditFrpNodeModal,
    frpDeleteNode,
    invalidateFrpNodes,
    openSettingsTab,
    pushToast,
    toastError,
  } = props as any

  const [confirmDeleteNode, setConfirmDeleteNode] = createSignal<{ id: string; name: string } | null>(null)

  async function handleDeleteNode() {
    const target = confirmDeleteNode()
    if (!target) return
    try {
      await frpDeleteNode.mutateAsync({ id: target.id })
      pushToast('success', t('frp.deleted'), target.name, undefined, {
        context: { scope: 'node', id: target.id, label: target.name },
      })
      void invalidateFrpNodes()
    } catch (e) {
      toastError(t('frp.deleteFailed'), e, {
        context: { scope: 'node', id: target.id, label: target.name },
        retry: { key: `frp.delete:${target.id}` },
        onRetry: () => frpDeleteNode.mutateAsync({ id: target.id }).then(() => void invalidateFrpNodes()),
      })
    } finally {
      setConfirmDeleteNode(null)
    }
  }

  return (
    <>
      <Show when={tab() === 'frp'}>
                <div class="min-h-0 flex-1 overflow-auto p-4">
                  <div class="mx-auto w-full max-w-3xl space-y-4">
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('frp.tunnelNodes')}</div>
                      </div>
                      <div class="flex items-center gap-2">
                        <Show when={frpNodes.isPending}>
                          <Badge variant="neutral">{t('frp.loading')}</Badge>
                        </Show>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={!isAuthed() || isReadOnly()}
                          title={!isAuthed() ? t('frp.signInRequired') : isReadOnly() ? t('common.readOnlyMode') : t('frp.addTunnelNode')}
                          onClick={() => openCreateFrpNodeModal()}
                        >
                          {t('frp.new')}
                        </Button>
                      </div>
                    </div>

                    <Show when={isAuthed()} fallback={<EmptyState title={t('frp.signInRequired')} />}>
                      <DataBoundary
                        t={t}
                        loading={frpNodes.isPending}
                        loadingLines={5}
                        error={frpNodes.error}
                        errorTitle={t('frp.errorLoadTunnelNodes')}
                        hasData={(frpNodes.data ?? []).length > 0}
                        empty={(frpNodes.data ?? []).length === 0}
                        emptyTitle={t('frp.noTunnelNodes')}
                        emptyActions={
                          <Button variant="secondary" size="sm" onClick={() => openCreateFrpNodeModal()} disabled={isReadOnly()}>
                            {t('frp.addTunnelNode')}
                          </Button>
                        }
                        onRetry={() => void invalidateFrpNodes()}
                        onOpenSettings={openSettingsTab}
                        settingsCtaLabel={t('downloads.openSettings')}
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
                                          {t('frp.server')}: <span class="font-mono">{endpoint() ?? '—'}</span>
                                        </div>
                                        <div>
                                          {t('frp.latency')}: <span class={`font-mono ${latencyClass()}`}>{latencyLabel()}</span>
                                        </div>
                                        <Show when={allocPorts()}>
                                          <div>
                                            {t('frp.allocPorts')}:{' '}
                                            <span class="font-mono break-all whitespace-pre-wrap">{allocPorts()}</span>
                                          </div>
                                        </Show>
                                        <div>
                                          {t('frp.token')}: <span class="font-mono">{(n.token ?? '').trim() ? t('frp.set') : t('frp.none')}</span>
                                        </div>
                                        <div>
                                          {t('frp.config')}: <span class="font-mono uppercase">{configFormat()}</span>
                                        </div>
                                      </div>
                                    </div>
                                    <div class="flex flex-wrap items-center gap-2">
                                      <IconButton
                                        size="sm"
                                        variant="secondary"
                                        label={t('frp.copyEndpoint')}
                                        disabled={!endpoint()}
                                        onClick={async () => {
                                          const ep = endpoint()
                                          if (!ep) return
                                          await safeCopy(ep)
                                          pushToast('success', t('toast.copied'), ep, undefined, {
                                            context: { scope: 'node', id: n.id, label: n.name },
                                          })
                                        }}
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                                          <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
                                          <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
                                        </svg>
                                      </IconButton>
                                      <Button size="sm" variant="secondary" onClick={() => openEditFrpNodeModal(n)}>
                                        {t('frp.edit')}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="danger"
                                        disabled={isReadOnly() || frpDeleteNode.isPending}
                                        onClick={() => setConfirmDeleteNode({ id: n.id, name: n.name })}
                                      >
                                        {t('frp.delete')}
                                      </Button>
                                    </div>
                                  </div>
                                  <div class="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
                                    {t('frp.updated')} <span class="font-mono">{n.updated_at}</span>
                                  </div>
                                </div>
                              )
                            }}
                          </For>
                        </div>
                      </DataBoundary>
                    </Show>
                  </div>
                </div>
      </Show>

      <Modal
        open={confirmDeleteNode() != null}
        onClose={() => setConfirmDeleteNode(null)}
        title={t('frp.deleteTunnelNode')}
        size="sm"
        footer={
          <div class="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirmDeleteNode(null)} disabled={frpDeleteNode.isPending}>
              {t('frp.cancel')}
            </Button>
            <Button variant="danger" size="sm" onClick={() => void handleDeleteNode()} disabled={frpDeleteNode.isPending}>
              {t('frp.delete')}
            </Button>
          </div>
        }
      >
        <p class="text-sm text-slate-700 dark:text-slate-300">
          {t('frp.deleteTunnelNodePrompt', { name: confirmDeleteNode()?.name ?? '' })}
        </p>
      </Modal>

    </>
  )
}
