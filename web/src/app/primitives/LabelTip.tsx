import type { JSX } from 'solid-js'
import { Tooltip } from '../../components/ui/Tooltip'

export function LabelTip(props: { label: string; content: JSX.Element }) {
  return (
    <Tooltip content={props.content}>
      <span class="cursor-help underline decoration-dotted underline-offset-4">{props.label}</span>
    </Tooltip>
  )
}

