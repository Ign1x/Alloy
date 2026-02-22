import { onCleanup } from 'solid-js'

type SearchFocusShortcutOptions = {
  input: () => HTMLInputElement | undefined
  queryValue: () => string
  clearQuery: () => void
}

export function useSearchFocusShortcut(options: SearchFocusShortcutOptions): void {
  const onKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    const tag = target?.tagName.toLowerCase()
    const isTypingContext = tag === 'input' || tag === 'textarea' || target?.isContentEditable

    if (
      event.key === '/' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !isTypingContext
    ) {
      event.preventDefault()
      const el = options.input()
      el?.focus()
      el?.select()
      return
    }

    if (event.key !== 'Escape') return
    const el = options.input()
    if (!el) return
    if (document.activeElement !== el) return
    if (options.queryValue().trim().length === 0) return
    event.preventDefault()
    options.clearQuery()
  }

  window.addEventListener('keydown', onKey)
  onCleanup(() => window.removeEventListener('keydown', onKey))
}
