/// <reference types="vite/client" />

import type { FrameUiApi } from '@shared/ipc-contract'

declare global {
  interface Window {
    frameui: FrameUiApi
  }
}

export {}
