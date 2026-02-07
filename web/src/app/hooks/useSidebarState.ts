import { createEffect, createSignal } from 'solid-js'

const SIDEBAR_STORAGE_KEY = 'alloy.sidebar'

function readSidebarExpanded(): boolean {
  try {
    const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY)
    if (saved === 'expanded') return true
    if (saved === 'collapsed') return false
  } catch {
    // ignore
  }
  // Default to collapsed for a console-like feel.
  return false
}

export function useSidebarState() {
  const [sidebarExpanded, setSidebarExpanded] = createSignal<boolean>(readSidebarExpanded())

  createEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarExpanded() ? 'expanded' : 'collapsed')
    } catch {
      // ignore
    }
  })

  return {
    sidebarExpanded,
    setSidebarExpanded,
  }
}
