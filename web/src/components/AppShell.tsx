import { Show, type ComponentProps } from 'solid-js'

import AppAuthOverlay from './AppAuthOverlay'
import AppMainPanels from './AppMainPanels'
import AppMobileDrawer from './AppMobileDrawer'
import AppSidebarNav from './AppSidebarNav'
import AppStatusBanners from './AppStatusBanners'
import AppTopHeader from './AppTopHeader'

interface AppShellProps {
  isAuthed: boolean
  sidebarNavProps: ComponentProps<typeof AppSidebarNav>
  topHeaderProps: ComponentProps<typeof AppTopHeader>
  mobileDrawerProps: ComponentProps<typeof AppMobileDrawer>
  authOverlayProps: ComponentProps<typeof AppAuthOverlay>
  statusBannersProps: ComponentProps<typeof AppStatusBanners>
  mainPanelsProps: ComponentProps<typeof AppMainPanels>
}

export default function AppShell(props: AppShellProps) {
  return (
    <div class="flex h-full">
      <AppSidebarNav {...props.sidebarNavProps} />

      <div class="flex min-w-0 flex-1 flex-col">
        <AppTopHeader {...props.topHeaderProps} />
        <AppMobileDrawer {...props.mobileDrawerProps} />

        <main class="relative flex min-h-0 flex-1 overflow-hidden">
          <Show when={!props.isAuthed}>
            <AppAuthOverlay {...props.authOverlayProps} />
          </Show>

          <div class={`flex min-h-0 flex-1 flex-col ${!props.isAuthed ? 'pointer-events-none blur-sm grayscale opacity-50' : ''}`}>
            <div class="flex-none px-4 pt-4">
              <AppStatusBanners {...props.statusBannersProps} />
            </div>

            <AppMainPanels {...props.mainPanelsProps} />
          </div>
        </main>
      </div>
    </div>
  )
}
