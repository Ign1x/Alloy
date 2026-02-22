import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js'

import { isAlloyApiError, queryClient, rspc } from '../../rspc'
import { downloadTargetLabel, mapDownloadJobFromServer } from '../helpers/downloads'
import { safeCopy } from '../helpers/misc'
import type { I18nTranslate } from '../i18n'
import type {
  DownloadCenterView,
  DownloadJob,
  DownloadTarget,
  ToastVariant,
  UiTab,
} from '../types'
import { DOWNLOAD_VIEW_STORAGE_KEY } from '../types'

type UseDownloadsDomainParams = {
  isAuthed: () => boolean
  tab: () => UiTab
  isReadOnly: () => boolean
  t: I18nTranslate
  pushToast: (variant: ToastVariant, title: string, message?: string, requestId?: string) => void
  toastError: (title: string, error: unknown) => void
  friendlyErrorMessage: (error: unknown) => string
}

type DownloadQueueJobDto = {
  id?: string
  target?: string
  template_id?: string
  version?: string
  state?: string
  message?: string | null
  request_id?: string | null
  started_at_unix_ms?: string | null
  updated_at_unix_ms?: string | null
  params?: Record<string, string> | null
}

export function useDownloadsDomain(params: UseDownloadsDomainParams) {
  const downloadQueue = rspc.createQuery(
    () => ['process.downloadQueue', null],
    () => ({
      enabled: params.isAuthed(),
      refetchOnWindowFocus: false,
      refetchInterval: params.isAuthed() && params.tab() === 'downloads' ? 1500 : false,
    }),
  )

  const downloadQueueEnqueue = rspc.createMutation(() => 'process.downloadQueueEnqueue')
  const downloadQueueSetPaused = rspc.createMutation(() => 'process.downloadQueueSetPaused')
  const downloadQueueMove = rspc.createMutation(() => 'process.downloadQueueMove')
  const downloadQueuePauseJob = rspc.createMutation(() => 'process.downloadQueuePauseJob')
  const downloadQueueResumeJob = rspc.createMutation(() => 'process.downloadQueueResumeJob')
  const downloadQueueCancelJob = rspc.createMutation(() => 'process.downloadQueueCancelJob')
  const downloadQueueRetryJob = rspc.createMutation(() => 'process.downloadQueueRetryJob')
  const downloadQueueClearHistory = rspc.createMutation(() => 'process.downloadQueueClearHistory')

  const [downloadCenterView, setDownloadCenterView] = createSignal<DownloadCenterView>((() => {
    try {
      const v = localStorage.getItem(DOWNLOAD_VIEW_STORAGE_KEY)
      if (
        v === 'tasks' ||
        v === 'minecraft' ||
        v === 'terraria' ||
        v === 'dst' ||
        v === 'palworld' ||
        v === 'factorio' ||
        v === 'core_keeper' ||
        v === 'seven_days' ||
        v === 'the_forest' ||
        v === 'sons_of_the_forest' ||
        v === 'cache'
      ) {
        return v
      }
    } catch {}
    return 'tasks'
  })())

  createEffect(() => {
    try {
      localStorage.setItem(DOWNLOAD_VIEW_STORAGE_KEY, downloadCenterView())
    } catch {}
  })

  const downloadJobs = createMemo<DownloadJob[]>(() => {
    const rows = (downloadQueue.data?.jobs ?? []) as unknown[]
    const out: DownloadJob[] = []
    for (const row of rows) {
      const mapped = mapDownloadJobFromServer(row)
      if (mapped) out.push(mapped)
    }
    return out
  })

  const downloadQueuePaused = createMemo(() => Boolean(downloadQueue.data?.queue_paused))

  const downloadStatus = createMemo(() => {
    const rows = (downloadQueue.data?.jobs ?? []) as unknown as DownloadQueueJobDto[]
    const byTarget: Record<string, { state?: string; message?: string | null; request_id?: string | null }> = {}
    for (const row of rows) {
      const target = String(row.target ?? '').trim()
      if (!target) continue
      byTarget[target] = {
        state: row.state,
        message: row.message ?? null,
        request_id: row.request_id ?? null,
      }
    }
    return byTarget
  })

  const [selectedDownloadJobId, setSelectedDownloadJobId] = createSignal<string | null>(null)
  const selectedDownloadJob = createMemo(() => {
    const id = selectedDownloadJobId()
    if (!id) return null
    return downloadJobs().find((j) => j.id === id) ?? null
  })

  createEffect(() => {
    const id = selectedDownloadJobId()
    if (!id) return
    if (selectedDownloadJob()) return
    setSelectedDownloadJobId(null)
  })

  const latestDownloadFailureByTarget = createMemo(() => {
    const rows = downloadJobs()
    const out: Record<string, string> = {}
    for (const j of rows) {
      if (!j.target) continue
      if (j.state !== 'error') continue
      const msg = (j.message ?? '').trim()
      if (msg) out[j.target] = msg
    }
    return out
  })

  function copyDownloadFailureReason(target: DownloadTarget) {
    const msg = latestDownloadFailureByTarget()[target]
    if (!msg) {
      params.pushToast('info', params.t('downloads.nothingToCopy'), params.t('downloads.noFailureReasonYet'))
      return
    }
    void safeCopy(msg)
    params.pushToast('success', params.t('toast.copied'), params.t('downloads.failureReasonCopied'))
  }

  function copyDownloadJobDetails(job: DownloadJob) {
    void safeCopy(
      JSON.stringify(
        {
          id: job.id,
          target: job.target,
          template_id: job.templateId,
          version: job.version,
          state: job.state,
          message: job.message,
          request_id: job.requestId ?? null,
          started_at_unix_ms: job.startedAtUnixMs,
          updated_at_unix_ms: job.updatedAtUnixMs,
          params: job.params,
        },
        null,
        2,
      ),
    )
    params.pushToast('success', params.t('toast.copied'), params.t('downloads.taskDetailsCopied'))
  }

  async function invalidateDownloadQueue() {
    await queryClient.invalidateQueries({ queryKey: ['process.downloadQueue', null] })
  }

  async function toggleDownloadQueuePaused() {
    try {
      await downloadQueueSetPaused.mutateAsync({ paused: !downloadQueuePaused() })
      await invalidateDownloadQueue()
    } catch (e) {
      params.toastError(params.t('downloads.queueUpdateFailed'), e)
    }
  }

  async function clearDownloadHistory() {
    try {
      await downloadQueueClearHistory.mutateAsync(null)
      await invalidateDownloadQueue()
    } catch (e) {
      params.toastError(params.t('downloads.clearHistoryFailed'), e)
    }
  }

  async function moveDownloadJob(jobId: string, direction: 'up' | 'down') {
    try {
      await downloadQueueMove.mutateAsync({ job_id: jobId, direction })
      await invalidateDownloadQueue()
    } catch (e) {
      params.toastError(params.t('downloads.reorderFailed'), e)
    }
  }

  async function pauseDownloadJob(jobId: string) {
    try {
      await downloadQueuePauseJob.mutateAsync({ job_id: jobId })
      await invalidateDownloadQueue()
    } catch (e) {
      params.toastError(params.t('downloads.pauseFailed'), e)
    }
  }

  async function resumeDownloadJob(jobId: string) {
    try {
      await downloadQueueResumeJob.mutateAsync({ job_id: jobId })
      await invalidateDownloadQueue()
    } catch (e) {
      params.toastError(params.t('downloads.resumeFailed'), e)
    }
  }

  async function cancelDownloadJob(jobId: string) {
    try {
      await downloadQueueCancelJob.mutateAsync({ job_id: jobId })
      await invalidateDownloadQueue()
    } catch (e) {
      params.toastError(params.t('downloads.cancelFailed'), e)
    }
  }

  async function retryDownloadJob(jobId: string) {
    try {
      await downloadQueueRetryJob.mutateAsync({ job_id: jobId })
      await invalidateDownloadQueue()
    } catch (e) {
      params.toastError(params.t('downloads.retryFailed'), e)
    }
  }

  const [downloadEnqueueTarget, setDownloadEnqueueTarget] = createSignal<DownloadTarget | null>(null)

  const [downloadMcVersion, setDownloadMcVersion] = createSignal('latest_release')
  const [downloadTrVersion, setDownloadTrVersion] = createSignal('1453')
  const [downloadDstVersion, setDownloadDstVersion] = createSignal('latest')
  const [downloadPwVersion, setDownloadPwVersion] = createSignal('latest')
  const [downloadFxVersion, setDownloadFxVersion] = createSignal('stable')
  const [downloadCoreKeeperVersion, setDownloadCoreKeeperVersion] = createSignal('latest')
  const [downloadSevenDaysVersion, setDownloadSevenDaysVersion] = createSignal('latest')
  const [downloadTheForestVersion, setDownloadTheForestVersion] = createSignal('latest')
  const [downloadSonsOfTheForestVersion, setDownloadSonsOfTheForestVersion] = createSignal('latest')

  function buildDownloadRequest(target: DownloadTarget): { templateId: string; version: string; params: Record<string, string> } | null {
    if (target === 'minecraft_vanilla') {
      const templateId = 'minecraft:vanilla'
      const params: Record<string, string> = {}
      const v = downloadMcVersion().trim()
      params.version = v || 'latest_release'
      const version = params.version
      return { templateId, version, params }
    }

    if (target === 'terraria_vanilla') {
      const templateId = 'terraria:vanilla'
      const params: Record<string, string> = {}
      const v = downloadTrVersion().trim()
      params.version = v || '1453'
      const version = params.version
      return { templateId, version, params }
    }

    if (target === 'dst_vanilla') {
      const templateId = 'dst:vanilla'
      const version = downloadDstVersion().trim() || 'latest'
      return { templateId, version, params: {} }
    }

    if (target === 'palworld_vanilla') {
      const templateId = 'palworld:vanilla'
      const version = downloadPwVersion().trim() || 'latest'
      return { templateId, version, params: {} }
    }

    if (target === 'factorio_vanilla') {
      const templateId = 'factorio:vanilla'
      const params: Record<string, string> = {}
      const v = downloadFxVersion().trim()
      params.version = v || 'stable'
      const version = params.version
      return { templateId, version, params }
    }

    if (target === 'core_keeper_vanilla') {
      const templateId = 'core_keeper:vanilla'
      const version = downloadCoreKeeperVersion().trim() || 'latest'
      return { templateId, version, params: {} }
    }

    if (target === 'seven_days_vanilla') {
      const templateId = 'seven_days:vanilla'
      const version = downloadSevenDaysVersion().trim() || 'latest'
      return { templateId, version, params: {} }
    }

    if (target === 'the_forest_vanilla') {
      const templateId = 'the_forest:vanilla'
      const version = downloadTheForestVersion().trim() || 'latest'
      return { templateId, version, params: {} }
    }

    if (target === 'sons_of_the_forest_vanilla') {
      const templateId = 'sons_of_the_forest:vanilla'
      const version = downloadSonsOfTheForestVersion().trim() || 'latest'
      return { templateId, version, params: {} }
    }

    return null
  }

  async function enqueueDownloadWarm(target: DownloadTarget) {
    if (params.isReadOnly()) {
      params.pushToast('error', params.t('common.readOnlyMode'), params.t('downloads.enableWriteBeforeDownload'))
      return
    }

    const req = buildDownloadRequest(target)
    if (!req) return

    try {
      setDownloadEnqueueTarget(target)
      await downloadQueueEnqueue.mutateAsync({
        target,
        template_id: req.templateId,
        version: req.version,
        params: req.params,
      })
      params.pushToast('info', params.t('downloads.addedToQueue'), `${downloadTargetLabel(target)} · ${req.version}`)
      await invalidateDownloadQueue()
    } catch (e) {
      if (isAlloyApiError(e)) {
        const fieldErrors = e.data.field_errors ?? {}
        params.pushToast('error', params.t('downloads.addToQueueFailed'), e.data.message, e.data.request_id)
        if (fieldErrors.steam_guard_code) {
          params.pushToast('info', params.t('downloads.steamGuardRequired'), params.t('downloads.enterSteamGuardOrAuto2fa'), e.data.request_id)
        }
        if (e.data.hint) params.pushToast('info', params.t('common.hint'), e.data.hint, e.data.request_id)
        return
      }
      params.pushToast('error', params.t('downloads.addToQueueFailed'), params.friendlyErrorMessage(e))
    } finally {
      setDownloadEnqueueTarget(null)
    }
  }

  const [downloadNowUnixMs, setDownloadNowUnixMs] = createSignal(Date.now())
  const tick = window.setInterval(() => setDownloadNowUnixMs(Date.now()), 1000)
  onCleanup(() => window.clearInterval(tick))

  const hasRunningDownloadJobs = createMemo(() => downloadJobs().some((j) => j.state === 'running'))

  return {
    cancelDownloadJob,
    clearDownloadHistory,
    copyDownloadFailureReason,
    copyDownloadJobDetails,
    downloadCenterView,
    downloadEnqueueTarget,
    downloadFxVersion,
    downloadJobs,
    downloadMcVersion,
    downloadNowUnixMs,
    downloadQueue,
    downloadQueueEnqueue,
    downloadQueuePaused,
    downloadSevenDaysVersion,
    downloadSonsOfTheForestVersion,
    downloadStatus,
    downloadTheForestVersion,
    downloadTrVersion,
    downloadDstVersion,
    downloadPwVersion,
    downloadCoreKeeperVersion,
    enqueueDownloadWarm,
    hasRunningDownloadJobs,
    latestDownloadFailureByTarget,
    moveDownloadJob,
    pauseDownloadJob,
    resumeDownloadJob,
    retryDownloadJob,
    selectedDownloadJob,
    selectedDownloadJobId,
    setDownloadCenterView,
    setDownloadFxVersion,
    setDownloadMcVersion,
    setDownloadSevenDaysVersion,
    setDownloadSonsOfTheForestVersion,
    setDownloadTheForestVersion,
    setDownloadTrVersion,
    setDownloadDstVersion,
    setDownloadPwVersion,
    setDownloadCoreKeeperVersion,
    setSelectedDownloadJobId,
    toggleDownloadQueuePaused,
  }
}
