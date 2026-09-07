import { registerAppHandlers } from './handlers/app.handlers'
import { registerWorkspaceHandlers } from './handlers/workspace.handlers'
import { registerProjectHandlers } from './handlers/project.handlers'
import { registerPreviewHandlers } from './handlers/preview.handlers'
import { registerExportHandlers } from './handlers/export.handlers'

// Single place the whole IPC channel surface is wired up. Each capability
// group (project, workspace, preview, export) gets its own handlers file as
// those phases land — nothing is registered here that isn't also declared in
// src/shared/ipc-contract.ts and exposed narrowly from src/preload/index.ts.
export function registerIpc(): void {
  registerAppHandlers()
  registerWorkspaceHandlers()
  registerProjectHandlers()
  registerPreviewHandlers()
  registerExportHandlers()
}
