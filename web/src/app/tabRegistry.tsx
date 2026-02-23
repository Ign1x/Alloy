import type { Component } from 'solid-js'

import type { I18nKey } from './i18n'
import type { UiTab } from './types'

export type UiTabRouteState = {
  tab?: UiTab
  instanceId?: string | null
  fsPath?: string | null
  selectedFilePath?: string | null
  filesTarget?: string | null
  filesNodeId?: string | null
}

export type UiRouteSelection = {
  tab: UiTab
  instanceId: string | null
  fsPath: string | null
  selectedFilePath: string | null
  filesTarget: string | null
  filesNodeId: string | null
}

export type UiTabRegistryItem = {
  id: UiTab
  labelKey: I18nKey
  adminOnly?: boolean
  icon: Component<{ class?: string }>
}

const InstancesIcon: Component<{ class?: string }> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class={props.class}>
    <path d="M3 4.75A1.75 1.75 0 014.75 3h2.5A1.75 1.75 0 019 4.75v2.5A1.75 1.75 0 017.25 9h-2.5A1.75 1.75 0 013 7.25v-2.5zM11 4.75A1.75 1.75 0 0112.75 3h2.5A1.75 1.75 0 0117 4.75v2.5A1.75 1.75 0 0115.25 9h-2.5A1.75 1.75 0 0111 7.25v-2.5zM3 12.75A1.75 1.75 0 014.75 11h2.5A1.75 1.75 0 019 12.75v2.5A1.75 1.75 0 017.25 17h-2.5A1.75 1.75 0 013 15.25v-2.5zM11 12.75A1.75 1.75 0 0112.75 11h2.5A1.75 1.75 0 0117 12.75v2.5A1.75 1.75 0 0115.25 17h-2.5A1.75 1.75 0 0111 15.25v-2.5z" />
  </svg>
)

const DownloadsIcon: Component<{ class?: string }> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class={props.class}>
    <path
      fill-rule="evenodd"
      d="M10 2.75a.75.75 0 01.75.75v8.19l2.22-2.22a.75.75 0 111.06 1.06l-3.5 3.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 111.06-1.06l2.22 2.22V3.5a.75.75 0 01.75-.75zM3.5 14.25a.75.75 0 01.75.75v.75c0 .69.56 1.25 1.25 1.25h9c.69 0 1.25-.56 1.25-1.25V15a.75.75 0 011.5 0v.75A2.75 2.75 0 0114.5 18h-9a2.75 2.75 0 01-2.75-2.75V15a.75.75 0 01.75-.75z"
      clip-rule="evenodd"
    />
  </svg>
)

const FilesIcon: Component<{ class?: string }> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class={props.class}>
    <path d="M2 5.75A2.75 2.75 0 014.75 3h4.19a2.75 2.75 0 011.944.806l.56.56c.215.215.507.334.812.334h2.994A2.75 2.75 0 0118 7.45v6.8A2.75 2.75 0 0115.25 17H4.75A2.75 2.75 0 012 14.25v-8.5z" />
  </svg>
)

const NodesIcon: Component<{ class?: string }> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class={props.class}>
    <path d="M4.75 3A2.75 2.75 0 002 5.75v.5A2.75 2.75 0 004.75 9h10.5A2.75 2.75 0 0018 6.25v-.5A2.75 2.75 0 0015.25 3H4.75z" />
    <path d="M4.75 11A2.75 2.75 0 002 13.75v.5A2.75 2.75 0 004.75 17h10.5A2.75 2.75 0 0018 14.25v-.5A2.75 2.75 0 0015.25 11H4.75z" />
  </svg>
)

const FrpIcon: Component<{ class?: string }> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class={props.class}>
    <path d="M4.75 4A1.75 1.75 0 003 5.75v8.5C3 15.216 3.784 16 4.75 16h1.5C7.216 16 8 15.216 8 14.25V11h4v3.25c0 .966.784 1.75 1.75 1.75h1.5c.966 0 1.75-.784 1.75-1.75v-8.5A1.75 1.75 0 0015.25 4h-1.5A1.75 1.75 0 0012 5.75V9H8V5.75A1.75 1.75 0 006.25 4h-1.5z" />
  </svg>
)

const SettingsIcon: Component<{ class?: string }> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class={props.class} aria-hidden="true">
    <path
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M7.83922 1.80388C7.93271 1.33646 8.34312 1 8.81981 1H11.1802C11.6569 1 12.0673 1.33646 12.1608 1.80388L12.4913 3.45629C13.1956 3.72458 13.8454 4.10332 14.4196 4.57133L16.0179 4.03065C16.4694 3.8779 16.966 4.06509 17.2043 4.47791L18.3845 6.52207C18.6229 6.93489 18.5367 7.45855 18.1786 7.77322L16.9119 8.88645C16.9699 9.24909 17 9.62103 17 10C17 10.379 16.9699 10.7509 16.9119 11.1135L18.1786 12.2268C18.5367 12.5414 18.6229 13.0651 18.3845 13.4779L17.2043 15.5221C16.966 15.9349 16.4694 16.1221 16.0179 15.9693L14.4196 15.4287C13.8454 15.8967 13.1956 16.2754 12.4913 16.5437L12.1608 18.1961C12.0673 18.6635 11.6569 19 11.1802 19H8.81981C8.34312 19 7.93271 18.6635 7.83922 18.1961L7.50874 16.5437C6.80443 16.2754 6.1546 15.8967 5.58043 15.4287L3.98214 15.9694C3.5306 16.1221 3.03401 15.9349 2.79567 15.5221L1.61547 13.4779C1.37713 13.0651 1.4633 12.5415 1.82136 12.2268L3.08808 11.1135C3.03012 10.7509 3 10.379 3 10C3 9.62103 3.03012 9.2491 3.08808 8.88647L1.82136 7.77324C1.46331 7.45857 1.37713 6.93491 1.61547 6.52209L2.79567 4.47793C3.03401 4.06511 3.5306 3.87791 3.98214 4.03066L5.58042 4.57134C6.15459 4.10332 6.80442 3.72459 7.50874 3.45629L7.83922 1.80388ZM10 13C11.6569 13 13 11.6569 13 10C13 8.34315 11.6569 7 10 7C8.34315 7 7 8.34315 7 10C7 11.6569 8.34315 13 10 13Z"
    />
  </svg>
)

export const UI_TAB_REGISTRY: ReadonlyArray<UiTabRegistryItem> = [
  { id: 'instances', labelKey: 'tab.instances', icon: InstancesIcon },
  { id: 'downloads', labelKey: 'tab.downloads', icon: DownloadsIcon },
  { id: 'files', labelKey: 'tab.files', icon: FilesIcon },
  { id: 'nodes', labelKey: 'tab.nodes', icon: NodesIcon },
  { id: 'frp', labelKey: 'tab.frp', icon: FrpIcon },
  { id: 'settings', labelKey: 'tab.settings', icon: SettingsIcon, adminOnly: true },
]

const UI_TAB_SET = new Set<UiTab>(UI_TAB_REGISTRY.map((item) => item.id))

export function isUiTab(value: string | null | undefined): value is UiTab {
  return value != null && UI_TAB_SET.has(value as UiTab)
}

export function getVisibleUiTabs(isAdmin: boolean): ReadonlyArray<UiTabRegistryItem> {
  return isAdmin ? UI_TAB_REGISTRY : UI_TAB_REGISTRY.filter((item) => !item.adminOnly)
}

export function coerceUiTabForRole(tab: UiTab, isAdmin: boolean): UiTab {
  if (isAdmin) return tab
  const item = UI_TAB_REGISTRY.find((entry) => entry.id === tab)
  if (!item?.adminOnly) return tab
  return 'instances'
}

export function readUiRouteFromLocation(defaultTab: UiTab = 'instances'): UiRouteSelection {
  if (typeof window === 'undefined') {
    return { tab: defaultTab, instanceId: null, fsPath: null, selectedFilePath: null, filesTarget: null, filesNodeId: null }
  }
  const params = new URLSearchParams(window.location.search)
  const candidate = params.get('tab')
  const tab = isUiTab(candidate) ? candidate : defaultTab
  const instanceId = tab === 'instances' ? params.get('instance') : null
  const fsPath = tab === 'files' ? params.get('path') : null
  const selectedFilePath = tab === 'files' ? params.get('file') : null
  const filesTarget = tab === 'files' ? params.get('files_target') : null
  const filesNodeId = tab === 'files' ? params.get('files_node') : null
  return {
    tab,
    instanceId: instanceId && instanceId.trim() ? instanceId.trim() : null,
    fsPath: fsPath && fsPath.trim() ? fsPath.trim() : null,
    selectedFilePath: selectedFilePath && selectedFilePath.trim() ? selectedFilePath.trim() : null,
    filesTarget: filesTarget && filesTarget.trim() ? filesTarget.trim() : null,
    filesNodeId: filesNodeId && filesNodeId.trim() ? filesNodeId.trim() : null,
  }
}

export function buildTabUrl(route: UiRouteSelection | { tab: UiTab }): string {
  const tab = route.tab
  if (typeof window === 'undefined') return `?tab=${encodeURIComponent(tab)}`
  const url = new URL(window.location.href)
  url.searchParams.set('tab', tab)
  if (tab === 'instances') {
    const instanceId = 'instanceId' in route ? route.instanceId : null
    if (instanceId && instanceId.trim()) url.searchParams.set('instance', instanceId.trim())
    else url.searchParams.delete('instance')
    url.searchParams.delete('path')
    url.searchParams.delete('file')
  } else if (tab === 'files') {
    const fsPath = 'fsPath' in route ? route.fsPath : null
    const selectedFilePath = 'selectedFilePath' in route ? route.selectedFilePath : null
    const filesTarget = 'filesTarget' in route ? route.filesTarget : null
    const filesNodeId = 'filesNodeId' in route ? route.filesNodeId : null
    if (fsPath && fsPath.trim()) url.searchParams.set('path', fsPath.trim())
    else url.searchParams.delete('path')
    if (selectedFilePath && selectedFilePath.trim()) url.searchParams.set('file', selectedFilePath.trim())
    else url.searchParams.delete('file')
    if (filesTarget && filesTarget.trim()) url.searchParams.set('files_target', filesTarget.trim())
    else url.searchParams.delete('files_target')
    if (filesNodeId && filesNodeId.trim()) url.searchParams.set('files_node', filesNodeId.trim())
    else url.searchParams.delete('files_node')
    url.searchParams.delete('instance')
  } else {
    url.searchParams.delete('instance')
    url.searchParams.delete('path')
    url.searchParams.delete('file')
    url.searchParams.delete('files_target')
    url.searchParams.delete('files_node')
  }
  return `${url.pathname}${url.search}${url.hash}`
}
