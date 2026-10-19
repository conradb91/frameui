import electron, { type BrowserWindow } from 'electron'
export function installDesignMenu(win: BrowserWindow) {
  const action = (
    label: string,
    id: string,
    accelerator?: string,
  ): Electron.MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: async () => {
      if (win.isDestroyed()) return
      const editing = [
        'copy',
        'paste',
        'cut',
        'selectAll',
        'undo',
        'redo',
      ].includes(id)
      if (editing) {
        const focused =
          electron.webContents.getFocusedWebContents() ?? win.webContents
        const textTarget =
          focused !== win.webContents ||
          (await focused
            .executeJavaScript(
              `!!document.activeElement?.closest('input,textarea,[contenteditable="true"],[contenteditable=""]')`,
            )
            .catch(() => false))
        if (textTarget && !focused.isDestroyed()) {
          if (id === 'copy') focused.copy()
          if (id === 'paste') focused.paste()
          if (id === 'cut') focused.cut()
          if (id === 'selectAll') focused.selectAll()
          if (id === 'undo') focused.undo()
          if (id === 'redo') focused.redo()
          return
        }
      }
      win.webContents.send('design:command', id)
    },
  })
  const mac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        action('New Design', 'new-design', 'CmdOrCtrl+N'),
        action('Open Codebase…', 'open', 'CmdOrCtrl+O'),
        action('Save', 'save', 'CmdOrCtrl+S'),
        { type: 'separator' },
        action('Capture / Refresh from App…', 'capture'),
        {label:'Export',submenu:[action('Export Design…','export','CmdOrCtrl+Shift+E'),action('Adobe XD · Sketch Bridge…','export-xd')]},
        { type: 'separator' },
        { role: mac ? 'close' : 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        action('Undo', 'undo', 'CmdOrCtrl+Z'),
        action('Redo', 'redo', 'CmdOrCtrl+Shift+Z'),
        { type: 'separator' },
        action('Cut', 'cut', 'CmdOrCtrl+X'),
        action('Select All', 'selectAll', 'CmdOrCtrl+A'),
        action('Copy', 'copy', 'CmdOrCtrl+C'),
        action('Paste', 'paste', 'CmdOrCtrl+V'),
        action('Duplicate', 'duplicate', 'CmdOrCtrl+D'),
        { type: 'separator' },
        action('Search and Commands…', 'palette', 'CmdOrCtrl+K'),
        action('Workspace Settings…', 'settings', 'CmdOrCtrl+,'),
      ],
    },
    {
      label: 'View',
      submenu: [
        action('Zoom to Fit', 'fit'),
        action('Zoom to Selection', 'selection-fit'),
        action('Toggle Panels', 'panels'),
        { type: 'separator' },
        action('Application Map', 'map'),
        action('Design System', 'system'),
        action('Present', 'present'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Object',
      submenu: [
        action('Group', 'group', 'CmdOrCtrl+G'),
        action('Ungroup', 'ungroup', 'CmdOrCtrl+Shift+G'),
        action('Create Component', 'component', 'CmdOrCtrl+Alt+K'),
        { type: 'separator' },
        action('Lock / Unlock', 'lock'),
        action('Hide / Show', 'hide'),
      ],
    },
    {
      label: 'Arrange',
      submenu: [
        action('Bring Forward', 'forward', 'CmdOrCtrl+]'),
        action('Send Backward', 'backward', 'CmdOrCtrl+['),
      ],
    },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        action('Keyboard Shortcuts', 'shortcuts', 'CmdOrCtrl+/'),
        action('Getting Started', 'getting-started'),
      ],
    },
  ]
  electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate(template))
}
