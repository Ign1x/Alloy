/* @refresh reload */
import { render } from 'solid-js/web'
import './index.css'
import App from './App.tsx'
import { rspc, client, queryClient } from './rspc'

const root = document.getElementById('root')
const boot = document.getElementById('boot')
const showBootError = (window as any).__ALLOY_SHOW_BOOT_ERROR__ as undefined | ((reason: unknown) => void)

// Keep providers close to the app entry; avoids threading through props.
try {
  render(
    () => (
      <rspc.Provider client={client} queryClient={queryClient}>
        <App />
      </rspc.Provider>
    ),
    root!,
  )
  if (boot) boot.style.display = 'none'
} catch (err) {
  if (showBootError) showBootError(err)
  throw err
}
