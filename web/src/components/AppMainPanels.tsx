import { For, Show } from 'solid-js'

import type { I18nTranslate } from '../app/i18n'
import type { FilesTarget } from '../app/types'
import type { ToastVariant, UiTab } from '../app/types'
import { FileBrowser } from './FileBrowser'
import DownloadsTab, { type DownloadsTabProps } from '../pages/DownloadsTab'
import FrpTab, { type FrpTabProps } from '../pages/FrpTab'
import InstancesTab, { type InstancesTabProps } from '../pages/InstancesTab'
import NodesTab, { type NodesTabProps } from '../pages/NodesTab'
import SettingsTab, { type SettingsTabProps } from '../pages/SettingsTab'

interface AppMainPanelsProps {
  tab: () => UiTab
  setTab: (next: UiTab) => void
  isAuthed: () => boolean
  fsPath: () => string
  selectedFilePath: () => string | null
  filesTarget: () => FilesTarget
  filesNodeId: () => string | null
  filesNodeOptions: () => { value: string; label: string; meta?: string }[]
  setFilesTarget: (next: FilesTarget) => void
  setFilesNodeId: (next: string | null) => void
  instancesTabProps: InstancesTabProps
  downloadsTabProps: DownloadsTabProps
  frpTabProps: FrpTabProps
  settingsTabProps: SettingsTabProps
  nodesTabProps: NodesTabProps
  t: I18nTranslate
}

export default function AppMainPanels(props: AppMainPanelsProps) {
  return (
    <div class="flex min-h-0 flex-1">
      <InstancesTab {...props.instancesTabProps} />
      <DownloadsTab {...props.downloadsTabProps} />

      <Show when={props.tab() === 'files'}>
        <div class="flex min-h-0 flex-1 flex-col gap-2">
          <div class="surface-card px-3 py-2">
            <div class="flex flex-wrap items-center gap-2">
              <div class="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{props.t('fileBrowser.targetLabel')}</div>
              <div class="inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white/70 p-1 dark:border-slate-800 dark:bg-slate-950/40">
                <button
                  type="button"
                  class={`rounded-md px-2 py-1 text-[12px] ${props.filesTarget() === 'control' ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900/60'}`}
                  onClick={() => props.setFilesTarget('control')}
                >
                  {props.t('fileBrowser.targetControl')}
                </button>
                <For each={props.filesNodeOptions()}>
                  {(node) => (
                    <button
                      type="button"
                      class={`rounded-md px-2 py-1 text-[12px] ${props.filesTarget() === 'node' && props.filesNodeId() === node.value ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900/60'}`}
                      onClick={() => {
                        props.setFilesTarget('node')
                        props.setFilesNodeId(node.value)
                      }}
                      title={node.meta || undefined}
                    >
                      {node.label}
                    </button>
                  )}
                </For>
              </div>
              <Show when={props.filesTarget() === 'node' && props.filesNodeOptions().length === 0}>
                <div class="text-[11px] text-amber-700 dark:text-amber-300">{props.t('nodes.noNodes')}</div>
              </Show>
            </div>
          </div>

          <FileBrowser
            t={props.t}
            enabled={props.isAuthed() && props.tab() === 'files'}
            title={props.t('tab.files')}
            titleLevel="page"
            initialPath={props.fsPath()}
            initialSelectedFile={props.selectedFilePath()}
            fsNodeId={props.filesNodeId()}
            onOpenSettings={() => props.setTab('settings')}
            onToast={(variant: ToastVariant, title: string, message?: string) => props.downloadsTabProps.pushToast(variant, title, message)}
            rootLabel="/data"
            class="min-h-0 flex-1"
          />
        </div>
      </Show>

      <FrpTab {...props.frpTabProps} />
      <SettingsTab {...props.settingsTabProps} />
      <NodesTab {...props.nodesTabProps} />
    </div>
  )
}
