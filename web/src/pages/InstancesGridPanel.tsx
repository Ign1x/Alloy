import InstancesCardsArea from './instances-grid/InstancesCardsArea'
import InstancesFilterBar from './instances-grid/InstancesFilterBar'

export type InstancesGridPanelProps = {
  [key: string]: unknown
}

export default function InstancesGridPanel(props: InstancesGridPanelProps) {
  const { focusCreateEntry, ...rest } = props as any

  return (
    <>
      <InstancesFilterBar {...rest} focusCreateEntry={focusCreateEntry} />
      <InstancesCardsArea {...rest} focusCreateEntry={focusCreateEntry} />
    </>
  )
}
