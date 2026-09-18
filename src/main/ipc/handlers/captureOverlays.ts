import type { BrowserWindow } from 'electron'

/** Capture visible states as rendered. Hidden DOM is not evidence of a real state:
 * forcing it open changes layout and cannot execute the component's state logic. */
export async function captureOverlays(win: BrowserWindow, capture: (name: string) => Promise<void>) {
  const names = await win.webContents.executeJavaScript(`(() => {
    const selector = 'dialog,[role="dialog"],[aria-modal="true"],[popover],[data-drawer],[role="menu"],[role="listbox"],[role="alert"],[role="status"],[role="tooltip"],details[open]';
    return Array.from(document.querySelectorAll(selector)).filter(el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return !el.parentElement?.closest(selector) && r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
    }).map(el => el.getAttribute('aria-label') || document.getElementById(el.getAttribute('aria-labelledby'))?.textContent?.trim() || el.querySelector('h1,h2,h3,summary')?.textContent?.trim() || el.getAttribute('role') || 'Open dialog').slice(0, 12);
  })()`) as string[]
  if (names.length) await capture([...new Set(names)].join(' · ').slice(0, 120))
}
