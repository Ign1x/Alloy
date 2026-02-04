import type { JSX } from 'solid-js'

export type SpinnerProps = {
  class?: string
  title?: string
}

export function Spinner(props: SpinnerProps): JSX.Element {
  return (
    <svg
      class={props.class ?? 'h-4 w-4'}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="status"
      aria-label={props.title ?? 'Loading'}
    >
      <path
        d="M12 3a9 9 0 1 0 9 9"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        class="opacity-25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        class="animate-spin origin-center"
      />
    </svg>
  )
}

