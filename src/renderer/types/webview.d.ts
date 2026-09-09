import type { DetailedHTMLProps, HTMLAttributes } from 'react'

/**
 * Deliberately NOT importing Electron's own `WebviewTag`/ambient types here
 * — the renderer's tsconfig never references `electron` (renderer code
 * must never touch main-process APIs, see the preload's narrow-bridge
 * comment), so this declares only the subset of the real `<webview>`
 * element's surface CaptureSessionView actually uses.
 */
export interface FrameUiWebviewElement extends HTMLElement {
  src: string
  reload(): void
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
  getURL(): string
  loadURL(url: string): Promise<void>
  stop(): void
  /** Embedder-privileged — runs in the guest page's own JS context but is
   * called from FrameUI's renderer, independent of the guest's own
   * sandboxing (see `captureWebviewGuard.ts`). Used for one-shot runtime
   * capture (spec §3), never for anything the guest page itself invokes. */
  executeJavaScript(code: string): Promise<unknown>
  /** Real return type is Electron's `NativeImage`; only `toDataURL()` is
   * used here, so only that's declared — same narrow-typing convention as
   * the rest of this file. */
  capturePage(): Promise<{ toDataURL(): string }>
}

type WebviewAttributes = DetailedHTMLProps<HTMLAttributes<FrameUiWebviewElement>, FrameUiWebviewElement> & {
  src?: string
  partition?: string
  allowpopups?: string
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: WebviewAttributes
    }
  }
}
