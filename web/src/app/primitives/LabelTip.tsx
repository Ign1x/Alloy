import type { JSX } from 'solid-js'
export function LabelTip(props: { label: string; content: JSX.Element }) {
  return <span>{props.label}</span>
}

