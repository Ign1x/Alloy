import { Show } from 'solid-js'

export function VisibilityToggle(props: {
  visible: boolean
  labelWhenHidden: string
  labelWhenVisible: string
  onToggle: () => void
}) {
  const label = () => (props.visible ? props.labelWhenVisible : props.labelWhenHidden)
  return (
    <button
      type="button"
      class="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 dark:focus-visible:ring-amber-400/35"
      aria-label={label()}
      title={label()}
      onClick={props.onToggle}
    >
      <Show
        when={props.visible}
        fallback={
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4" aria-hidden="true">
            <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
            <path
              fill-rule="evenodd"
              d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.382.147.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
              clip-rule="evenodd"
            />
          </svg>
        }
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4" aria-hidden="true">
          <path d="M13.359 11.238l1.36 1.36a4 4 0 01-5.317-5.317l1.36 1.36a2.5 2.5 0 002.597 2.597z" />
          <path
            fill-rule="evenodd"
            d="M2 4.25a.75.75 0 011.28-.53l14.5 14.5a.75.75 0 11-1.06 1.06l-2.294-2.294A9.961 9.961 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41a1.651 1.651 0 010-1.186 10.03 10.03 0 012.924-4.167L2.22 3.78A.75.75 0 012 4.25zm6.12 6.12a2.5 2.5 0 003.51 3.51l-3.51-3.51z"
            clip-rule="evenodd"
          />
          <path d="M12.454 8.214L9.31 5.07A4 4 0 0114.93 10.69l-2.476-2.476z" />
          <path d="M15.765 12.585l1.507 1.507a10.03 10.03 0 002.064-3.502 1.651 1.651 0 000-1.186A10.004 10.004 0 0010 3a9.961 9.961 0 00-3.426.608l1.65 1.65A8.473 8.473 0 0110 4.5c3.49 0 6.574 2.138 7.773 5.5a8.5 8.5 0 01-2.008 2.585z" />
        </svg>
      </Show>
    </button>
  )
}

