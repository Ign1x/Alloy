import { Show } from 'solid-js'

import { formatRelativeTime } from '../app/helpers/format'
import type { I18nTranslate } from '../app/i18n'
import type { UiTab } from '../app/types'
import { Banner } from './ui/Banner'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'

interface AppStatusBannersProps {
  pingError: boolean
  isReadOnly: boolean
  fsWriteEnabled: boolean
  tab: UiTab
  lastBackendOkAtUnixMs: number | null
  retryBackend: () => void
  openDiagnostics: () => void
  copyFsWriteEnv: () => void
  t: I18nTranslate
}

export default function AppStatusBanners(props: AppStatusBannersProps) {
  const backendMessage = () => {
    const lastOk = formatRelativeTime(props.lastBackendOkAtUnixMs)
    return props.t('banner.lastOkOfflineHint', { value: lastOk })
  }

  return (
    <div class="feedback-stack">
      <Show when={props.pingError}>
        <Banner
          variant="danger"
          title={props.t('banner.backendOffline')}
          message={backendMessage()}
          actions={
            <Button size="xs" variant="secondary" aria-keyshortcuts="R" onClick={props.retryBackend}>
              {props.t('banner.retry')}
            </Button>
          }
        />
      </Show>
      <Show when={props.isReadOnly}>
        <Banner
          variant="warning"
          title={props.t('banner.readOnlyMode')}
          message={props.t('banner.readOnlyMessage')}
          actions={
            <Button size="xs" variant="secondary" onClick={props.openDiagnostics}>
              {props.t('banner.details')}
            </Button>
          }
        />
      </Show>
      <Show when={!props.fsWriteEnabled && props.tab === 'files'}>
        <Banner
          variant="info"
          title={props.t('banner.readOnlyFilesystem')}
          message={props.t('banner.enableFsWrite')}
          actions={
            <div class="flex flex-wrap items-center gap-2">
              <Button size="xs" variant="secondary" onClick={props.openDiagnostics}>
                {props.t('banner.details')}
              </Button>
              <IconButton size="sm" variant="secondary" label={props.t('banner.copyEnvVar')} onClick={props.copyFsWriteEnv}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
                  <path d="M5.75 2A2.75 2.75 0 003 4.75v9.5A2.75 2.75 0 005.75 17h1.5a.75.75 0 000-1.5h-1.5c-.69 0-1.25-.56-1.25-1.25v-9.5c0-.69.56-1.25 1.25-1.25h5.5c.69 0 1.25.56 1.25 1.25v1a.75.75 0 001.5 0v-1A2.75 2.75 0 0011.25 2h-5.5z" />
                  <path d="M8.75 6A2.75 2.75 0 006 8.75v6.5A2.75 2.75 0 008.75 18h5.5A2.75 2.75 0 0017 15.25v-6.5A2.75 2.75 0 0014.25 6h-5.5z" />
                </svg>
              </IconButton>
            </div>
          }
        />
      </Show>
    </div>
  )
}
