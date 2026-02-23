import { Show } from 'solid-js'
import InstancesCreatePanel from './InstancesCreatePanel'
import InstancesGridPanel from './InstancesGridPanel'
import InstancesPage from './InstancesPage'

export type InstancesTabProps = {
  [key: string]: unknown
}

export default function InstancesTab(props: InstancesTabProps) {
  const { tab, t } = props as any
  const panelProps = props as any
  let createInstanceNameEl: HTMLInputElement | undefined
  let focusCreateEntry: (() => void) | undefined

  return (
    <Show when={tab() === 'instances'}>
      <InstancesPage
        tabLabel={t('tab.instances')}
        left={
          <InstancesCreatePanel
            {...panelProps}
            setCreateInstanceNameRef={(el: HTMLInputElement) => {
              createInstanceNameEl = el
            }}
            setFocusCreateEntry={(fn: () => void) => {
              focusCreateEntry = fn
            }}
          />
        }
        right={
          <InstancesGridPanel
            {...panelProps}
            getCreateInstanceNameRef={() => createInstanceNameEl}
            focusCreateEntry={() => focusCreateEntry?.()}
          />
        }
      />
    </Show>
  )
}
