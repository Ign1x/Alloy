import { Show } from 'solid-js'
import { downloadJobStatusLabel, downloadJobStatusVariant, downloadTargetLabel } from '../app/helpers/downloads'
import { formatDateTime } from '../app/helpers/format'
import type { DownloadJob, DownloadTarget } from '../app/types'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Modal } from './ui/Modal'

export type DownloadTaskModalProps = {
  selectedDownloadJobId: () => string | null
  setSelectedDownloadJobId: (next: string | null) => void
  selectedDownloadJob: () => DownloadJob | null
  latestDownloadFailureByTarget: () => Map<DownloadTarget, DownloadJob>
  copyDownloadJobDetails: (job: DownloadJob) => void | Promise<void>
  copyDownloadFailureReason: (job: DownloadJob) => void | Promise<void>
}

export default function DownloadTaskModal(props: DownloadTaskModalProps) {
  const {
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
          title="Download Task"
          description="Task details, latest failure reason, and quick copy actions."
          size="md"
          footer={
            <div class="flex gap-3">
              <Button variant="secondary" class="flex-1" onClick={() => setSelectedDownloadJobId(null)}>
                Close
              </Button>
              <Show when={selectedDownloadJob()}>
                {(job) => (
                  <Button variant="primary" class="flex-1" onClick={() => void copyDownloadJobDetails(job())}>
                    Copy JSON
                  </Button>
                )}
              </Show>
            </div>
          }
        >
          <Show
            when={selectedDownloadJob()}
            fallback={<div class="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">This task is no longer in queue history.</div>}
          >
            {(job) => {
              const latestFailure = () => latestDownloadFailureByTarget().get(job().target)
              const latestFailureText = () => (latestFailure()?.message ?? '').trim()
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
                        <div>req {job().requestId}</div>
                      </Show>
                    </div>
                    <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                      started {formatDateTime(job().startedAtUnixMs)} · updated {formatDateTime(job().updatedAtUnixMs)}
                    </div>
                  </div>

                  <div class="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/40">
                    <div class="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Message</div>
                    <div class="mt-1 whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">{job().message || '—'}</div>
                  </div>

                  <div class="rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2 text-xs text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200">
                    <div class="flex items-center justify-between gap-2">
                      <div class="text-[11px] font-semibold uppercase tracking-wide">Latest failure reason</div>
                      <Button size="xs" variant="secondary" onClick={() => void copyDownloadFailureReason(job())}>
                        Copy
                      </Button>
                    </div>
                    <div class="mt-1 whitespace-pre-wrap break-words font-mono text-[11px]">
                      {latestFailureText() || 'No failure recorded yet for this target.'}
                    </div>
                  </div>
                </div>
              )
            }}
          </Show>
        </Modal>
  )
}
