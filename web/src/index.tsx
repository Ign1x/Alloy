/* @refresh reload */
import { render } from 'solid-js/web'
import './index.css'
import App from './App.tsx'
import { rspc, client, queryClient } from './rspc'

const root = document.getElementById('root')

// Keep providers close to the app entry; avoids threading through props.
render(
  () => (
    <rspc.Provider client={client} queryClient={queryClient}>
      <App />
    </rspc.Provider>
  ),
  root!,
)
