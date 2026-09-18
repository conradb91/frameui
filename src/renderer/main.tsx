import { themeStyleSheet } from '@shared/theme'
import { pendingWorkspaceSaves, reportSaveError } from './state/pendingSaves'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './app/App'
import './styles/globals.css'

import { applyAppearance, usePreferencesStore } from './state/preferencesStore'

Object.assign(window, { frameuiFlushSaves: () => pendingWorkspaceSaves.flush() })
let reloading = false
window.addEventListener('beforeunload', (event) => {
  if (!pendingWorkspaceSaves.hasPending) return
  event.preventDefault()
  event.returnValue = ''
  if (reloading) return
  reloading = true
  void pendingWorkspaceSaves.flush().then(() => window.location.reload()).catch((error: unknown) => { reloading = false; reportSaveError(error) })
})

const themeStyle = document.createElement('style')
themeStyle.dataset.frameuiTheme = ''
themeStyle.textContent = themeStyleSheet
document.head.append(themeStyle)

applyAppearance(usePreferencesStore.getState().appearance)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
