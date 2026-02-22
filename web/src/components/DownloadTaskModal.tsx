import { Show } from 'solid-js'
import { downloadJobPercent, downloadJobStatusLabel, downloadJobStatusVariant, downloadTargetLabel } from '../app/helpers/downloads'
import { formatBytes, formatDateTime } from '../app/helpers/format'
import type { I18nTranslate } from '../app/i18n'
import type { DownloadJob, DownloadTarget } from '../app/types'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Modal } from './ui/Modal'

export type DownloadTaskModalProps = {
  t: I18nTranslate
  selectedDownloadJobId: () => string | null
  setSelectedDownloadJobId: (next: string | null) => void
  selectedDownloadJob: () => DownloadJob | null
  latestDownloadFailureByTarget: () => Record<string, string>
  copyDownloadJobDetails: (job: DownloadJob) => void | Promise<void>
  copyDownloadFailureReason: (target: DownloadTarget) => void | Promise<void>
}

export default function DownloadTaskModal(props: DownloadTaskModalProps) {
  const {
    t,
    selectedDownloadJobId,
    setSelectedDownloadJobId,
    selectedDownloadJob,
    latestDownloadFailureByTarget,
    copyDownloadJobDetails,
    copyDownloadFailureReason,
  } = props

  return (
        <Modal
          open={Boolean(selectedDownloadJobId())}
          onClose={() => setSelectedDownloadJobId(null)}
          title={t('downloadTask.title')}
          size="md"
          footer={
            <div class="flex gap-3">
              <Button variant="secondary" class="flex-1" onClick={() => setSelectedDownloadJobId(null)}>
                {t('downloadTask.close')}
              </Button>
              <Show when={selectedDownloadJob()}>
                {(job) => (
                  <Button variant="primary" class="flex-1" onClick={() => void copyDownloadJobDetails(job())}>
                    {t('downloadTask.copyJson')}
                  </Button>
                )}
              </Show>
            </div>
          }
        >
          <Show
            when={selectedDownloadJob()}
            fallback={
              <div class="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                {t('downloadTask.removedFromHistory')}
              </div>
            }
          >
            {(job) => {
              const latestFailureText = () => (latestDownloadFailureByTarget()[job().target] ?? '').trim()
              const progressPercent = () => downloadJobPercent(job())
              const progressLabel = () => {
                const pct = progressPercent()
                if (pct == null) return t('downloadTask.running')
                return `${pct.toFixed(1)}%`
              }
              const progressBarWidth = () => {
                const pct = progressPercent()
                if (pct == null) return '30%'
                const clamped = Math.max(0, Math.min(100, pct))
                if (clamped > 0 && clamped < 2) return '2%'
                return `${clamped}%`
              }
              const progressBarClass = () => {
                const pct = progressPercent()
                if (pct == null) return 'animate-pulse bg-amber-400'
                if (pct < 30) return 'bg-amber-500'
                if (pct >= 90) return 'bg-emerald-400'
                return 'bg-emerald-500'
              }
              return (
                <div class="space-y-3">
                  <div class="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/40">
                    <div class="flex flex-wrap items-center gap-2">
                      <div class="font-semibold text-slate-800 dark:text-slate-100">{downloadTargetLabel(job().target)}</div>
                      <Badge variant={downloadJobStatusVariant(job().state)}>{downloadJobStatusLabel(job().state)}</Badge>
                      <span class="rounded-full border border-slate-200 bg-white/70 px-2 py-0.5 font-mono text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                        {job().version}
                      </span>
                    </div>
                    <div class="mt-2 space-y-1 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                      <div>id {job().id}</div>
                      <Show when={job().requestId}>
                        <div>
                          {t('common.requestId')} {job().requestId}
                        </div>
                      </Show>
                    </div>
                    <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                      {t('downloadTask.startedUpdated', {
                        started: formatDateTime(job().startedAtUnixMs),
                        updated: formatDateTime(job().updatedAtUnixMs),
                      })}
                    </div>
                  </div>

                  <Show when={job().state === 'running'}>
                    <div class="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/40">
                      <div class="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {t('downloadTask.progressHeading')}
                      </div>
                      <div class="mt-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        <span>{job().progressStage || t('downloadTask.progressDefaultStage')}</span>
                        <span class="font-mono text-slate-700 dark:text-slate-200">{progressLabel()}</span>
                      </div>
                      <div class="mt-1 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                        <div
                          class={`h-full rounded-full transition-all duration-300 ${progressBarClass()}`}
                          style={{ width: progressBarWidth() }}
                          aria-hidden="true"
                        />
                      </div>
                      <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-slate-700 dark:text-slate-200">
                        <span>
                          {t('downloadTask.speedLabel', {
                            value: job().progressSpeedBytesPerSec ? `${formatBytes(job().progressSpeedBytesPerSec)}/s` : '—',
                          })}
                        </span>
                        <span>
                          {t('downloadTask.progressLabel', {
                            value: progressPercent() == null ? '—' : `${progressPercent()!.toFixed(1)}%`,
                          })}
                        </span>
                        <span>
                          {t('downloadTask.sizeLabel', {
                            downloaded: formatBytes(job().progressDownloadedBytes),
                            total: formatBytes(job().progressTotalBytes),
                          })}
                        </span>
                      </div>
                    </div>
                  </Show>

                  <div class="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/40">
                    <div class="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {t('downloadTask.messageHeading')}
                    </div>
                    <div class="mt-1 whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">{job().message || '—'}</div>
                  </div>

                  <div class="rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2 text-xs text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                    <div class="flex items-center justify-between gap-2">
                      <div class="text-[11px] font-semibold uppercase tracking-wide">{t('downloadTask.latestFailureHeading')}</div>
                      <Button size="xs" variant="secondary" onClick={() => void copyDownloadFailureReason(job().target)}>
                        {t('instances.details.copy')}
                      </Button>
                    </div>
                    <div class="mt-1 whitespace-pre-wrap break-words font-mono text-[11px]">
                      {latestFailureText() || t('downloadTask.noFailureRecorded')}
                    </div>
                  </div>
                </div>
              )
            }}
          </Show>
        </Modal>
  )
}
