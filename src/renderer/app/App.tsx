import { useUiStore } from '../state/uiStore'
import { OpenProjectView } from './views/OpenProjectView'
import { ProjectSummaryView } from './views/ProjectSummaryView'
import { FlowWorkspaceView } from './views/FlowWorkspaceView'
import { ScreenDesignerView } from './views/ScreenDesignerView'
import { PreviewModeView } from './views/PreviewModeView'
import { ExportPanelView } from './views/ExportPanelView'

export function App() {
  const view = useUiStore((s) => s.view)

  switch (view) {
    case 'export':
      return <ExportPanelView />
    case 'preview':
      return <PreviewModeView />
    case 'screen-designer':
      return <ScreenDesignerView />
    case 'flow-workspace':
      return <FlowWorkspaceView />
    case 'project-summary':
      return <ProjectSummaryView />
    case 'open-project':
    default:
      return <OpenProjectView />
  }
}
