import InstancesCardsArea from './instances-grid/InstancesCardsArea'
import InstancesFilterBar from './instances-grid/InstancesFilterBar'

export type InstancesGridPanelProps = {
  [key: string]: unknown
}

export default function InstancesGridPanel(props: InstancesGridPanelProps) {
  return (
    <>
      <InstancesFilterBar {...props} />
      <InstancesCardsArea {...props} />
    </>
  )
}
