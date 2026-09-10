import { restoreSession } from '../state/restoreSession'
import { useEffect } from 'react'
import { usePreferencesStore, applyAppearance } from '../state/preferencesStore'
import { WelcomeScreen } from '../components/shell/Appearance'
import { useUiStore } from '../state/uiStore'
import { WorkspaceShellView } from './workspace/WorkspaceShellView'
import { FeatureWorkspaceView } from './views/FeatureWorkspaceView'
import { FeaturePreviewView } from './views/FeaturePreviewView'
import { SharePreviewView } from './views/SharePreviewView'
import { FlowWorkspaceView } from './views/FlowWorkspaceView'
import { ScreenDesignerView } from './views/ScreenDesignerView'
import { PreviewModeView } from './views/PreviewModeView'
import { ExportPanelView } from './views/ExportPanelView'
import { CaptureSessionView } from './views/CaptureSessionView'

export function App() {
  useEffect(() => { void restoreSession() }, [])
  const appearance = usePreferencesStore((s) => s.appearance)
  const welcomed = usePreferencesStore((s) => s.welcomed)
  useEffect(() => {
    applyAppearance(appearance)
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => applyAppearance(appearance)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [appearance])
  const view = useUiStore((s) => s.view)

  if (!welcomed) return <WelcomeScreen />

  switch (view) {
    case 'capture-session':
      return <CaptureSessionView />
    case 'export':
      return <WorkspaceShellView><ExportPanelView /></WorkspaceShellView>
    case 'preview':
      return <PreviewModeView />
    case 'feature-workspace':
      return <FeatureWorkspaceView />
    case 'feature-preview':
      return <FeaturePreviewView />
    case 'share-preview':
      return <SharePreviewView />
    case 'screen-designer':
      return <WorkspaceShellView><ScreenDesignerView /></WorkspaceShellView>
    case 'flow-workspace':
      return <WorkspaceShellView><FlowWorkspaceView /></WorkspaceShellView>
    case 'workspace':
    case 'open-project':
    default:
      return <WorkspaceShellView />
  }
}
