import type { JSX } from 'solid-js'
import { Show, createEffect, createUniqueId } from 'solid-js'
import { cn } from './cn'

export type FieldProps = {
  label?: JSX.Element
  description?: JSX.Element
  error?: string | null | undefined
  required?: boolean
  right?: JSX.Element
  class?: string
  children: JSX.Element
}

export function Field(props: FieldProps) {
  let rootEl: HTMLDivElement | undefined
  const fieldId = createUniqueId()
  const labelId = `field-label-${fieldId}`
  const descriptionId = `field-description-${fieldId}`
  const errorId = `field-error-${fieldId}`

  createEffect(() => {
    const root = rootEl
    if (!root) return

    const control = root.querySelector<HTMLElement>(
      'input:not([type="hidden"]), textarea, select, button[aria-haspopup="listbox"], [role="combobox"], [contenteditable="true"]',
    )
    if (!control) return

    const prevManaged = (control.getAttribute('data-field-a11y-managed') ?? '')
      .split(/\s+/)
      .filter(Boolean)

    const previousLabelId = prevManaged.find((id) => id.startsWith('field-label-'))
    const previousDescriptionId = prevManaged.find((id) => id.startsWith('field-description-'))
    const previousErrorId = prevManaged.find((id) => id.startsWith('field-error-'))

    const describedBy = (control.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .filter((id) => id !== descriptionId && id !== errorId)

    if (previousDescriptionId) {
      const index = describedBy.indexOf(previousDescriptionId)
      if (index >= 0) describedBy.splice(index, 1)
    }
    if (previousErrorId) {
      const index = describedBy.indexOf(previousErrorId)
      if (index >= 0) describedBy.splice(index, 1)
    }

    if (props.description) describedBy.push(descriptionId)
    if (props.error) describedBy.push(errorId)

    const uniqueDescribedBy = Array.from(new Set(describedBy))
    if (uniqueDescribedBy.length > 0) {
      control.setAttribute('aria-describedby', uniqueDescribedBy.join(' '))
    } else {
      control.removeAttribute('aria-describedby')
    }

    const labelledBy = (control.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .filter((id) => id !== labelId)

    if (previousLabelId) {
      const index = labelledBy.indexOf(previousLabelId)
      if (index >= 0) labelledBy.splice(index, 1)
    }

    if (props.label != null && !control.hasAttribute('aria-label')) labelledBy.push(labelId)

    const uniqueLabelledBy = Array.from(new Set(labelledBy))
    if (uniqueLabelledBy.length > 0) {
      control.setAttribute('aria-labelledby', uniqueLabelledBy.join(' '))
    } else if (control.getAttribute('aria-labelledby')?.includes(labelId)) {
      control.removeAttribute('aria-labelledby')
    }

    if (props.error) {
      control.setAttribute('aria-invalid', 'true')
      control.setAttribute('aria-errormessage', errorId)
    } else {
      if (control.getAttribute('aria-errormessage') === errorId) control.removeAttribute('aria-errormessage')
      if (previousErrorId && control.getAttribute('aria-errormessage') === previousErrorId) control.removeAttribute('aria-errormessage')
      if (control.getAttribute('aria-invalid') === 'true' && !control.hasAttribute('data-force-invalid')) {
        control.removeAttribute('aria-invalid')
      }
    }

    const nextManagedIds = [
      props.label != null && !control.hasAttribute('aria-label') ? labelId : null,
      props.description ? descriptionId : null,
      props.error ? errorId : null,
    ].filter((id): id is string => Boolean(id))

    if (nextManagedIds.length > 0) {
      control.setAttribute('data-field-a11y-managed', nextManagedIds.join(' '))
    } else {
      control.removeAttribute('data-field-a11y-managed')
    }
  })

  return (
    <div ref={(el) => (rootEl = el)} class={cn('space-y-2.5 sm:space-y-2', props.class)}>
      <Show when={props.label != null}>
        <div class="flex items-center justify-between gap-3">
          <div id={labelId} class="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {props.label}
            <Show when={props.required}>
              <span class="ml-1 text-rose-600 dark:text-rose-400">*</span>
            </Show>
          </div>
          <Show when={props.right}>
            <div class="flex items-center gap-2">{props.right}</div>
          </Show>
        </div>
      </Show>

      {props.children}

      <Show when={props.description}>
        <div id={descriptionId} class="text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">{props.description}</div>
      </Show>
      <Show when={props.error}>
        <div id={errorId} role="alert" aria-live="assertive" class="text-[12px] font-medium text-rose-700 dark:text-rose-300">
          {props.error}
        </div>
      </Show>
    </div>
  )
}
