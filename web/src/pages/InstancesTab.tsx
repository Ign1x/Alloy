import { Show } from 'solid-js'
import InstancesCreatePanel from './InstancesCreatePanel'
import InstancesGridPanel from './InstancesGridPanel'
import InstancesPage from './InstancesPage'

export type InstancesTabProps = {
  [key: string]: unknown
}

export default function InstancesTab(props: InstancesTabProps) {
  const { tab } = props as any
  const panelProps = props as any
  let createInstanceNameEl: HTMLInputElement | undefined

  return (
    <Show when={tab() === 'instances'}>
      <InstancesPage
        tabLabel="Instances"
        left={
          <InstancesCreatePanel
            {...panelProps}
            setCreateInstanceNameRef={(el: HTMLInputElement) => {
              createInstanceNameEl = el
            }}
          />
        }
        right={<InstancesGridPanel {...panelProps} getCreateInstanceNameRef={() => createInstanceNameEl} />}
      />
    </Show>
  )
}
