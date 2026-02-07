import { Show } from 'solid-js'

import { formatRelativeTime } from '../app/helpers/format'
import type { UiTab } from '../app/types'
import { Banner } from './ui/Banner'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'

interface AppStatusBannersProps {
  pingError: boolean
  agentError: boolean
  isReadOnly: boolean
  fsWriteEnabled: boolean
  tab: UiTab
  lastBackendOkAtUnixMs: number | null
  lastAgentOkAtUnixMs: number | null
  retryBackend: () => void
  retryAgent: () => void
  openDiagnostics: () => void
  copyFsWriteEnv: () => void
}

export default function AppStatusBanners(props: AppStatusBannersProps) {
  return (
    <div class="space-y-3">
      <Show when={props.pingError}>
        <Banner
          variant="danger"
          title="Backend offline"
          message={`Last ok: ${formatRelativeTime(props.lastBackendOkAtUnixMs)}.`}
          actions={
            <Button size="xs" variant="secondary" onClick={props.retryBackend}>
              Retry
            </Button>
          }
        />
      </Show>
      <Show when={props.agentError}>
        <Banner
          variant="danger"
          title="Agent unreachable"
          message={`Last ok: ${formatRelativeTime(props.lastAgentOkAtUnixMs)}.`}
          actions={
            <Button size="xs" variant="secondary" onClick={props.retryAgent}>
              Retry
            </Button>
          }
        />
      </Show>
      <Show when={props.isReadOnly}>
        <Banner
          variant="warning"
          title="Read-only mode"
          message="Instance actions and filesystem writes are disabled."
          actions={
            <Button size="xs" variant="secondary" onClick={props.openDiagnostics}>
              Details
            </Button>
          }
        />
      </Show>
      <Show when={!props.fsWriteEnabled && props.tab === 'files'}>
        <Banner
          variant="info"
          title="Read-only filesystem"
          message="Enable with ALLOY_FS_WRITE_ENABLED=true."
          actions={
            <div class="flex flex-wrap items-center gap-2">
              <Button size="xs" variant="secondary" onClick={props.openDiagnostics}>
                Details
              </Button>
              <IconButton size="sm" variant="secondary" label="Copy env var" onClick={props.copyFsWriteEnv}>
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
