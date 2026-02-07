import { Show } from 'solid-js'

import type { UiTab } from '../app/types'
import { FileBrowser } from './FileBrowser'
import DownloadsTab, { type DownloadsTabProps } from '../pages/DownloadsTab'
import FrpTab, { type FrpTabProps } from '../pages/FrpTab'
import InstancesTab, { type InstancesTabProps } from '../pages/InstancesTab'
import NodesTab, { type NodesTabProps } from '../pages/NodesTab'
import SettingsTab, { type SettingsTabProps } from '../pages/SettingsTab'

interface AppMainPanelsProps {
  tab: () => UiTab
  isAuthed: () => boolean
  fsPath: () => string
  selectedFilePath: () => string | null
  instancesTabProps: InstancesTabProps
  downloadsTabProps: DownloadsTabProps
  frpTabProps: FrpTabProps
  settingsTabProps: SettingsTabProps
  nodesTabProps: NodesTabProps
}

export default function AppMainPanels(props: AppMainPanelsProps) {
  return (
    <div class="flex min-h-0 flex-1">
      <InstancesTab {...props.instancesTabProps} />
      <DownloadsTab {...props.downloadsTabProps} />

      <Show when={props.tab() === 'files'}>
        <FileBrowser
          enabled={props.isAuthed() && props.tab() === 'files'}
          title="Files"
          initialPath={props.fsPath()}
          initialSelectedFile={props.selectedFilePath()}
          rootLabel="/data"
        />
      </Show>

      <FrpTab {...props.frpTabProps} />
      <SettingsTab {...props.settingsTabProps} />
      <NodesTab {...props.nodesTabProps} />
    </div>
  )
}
