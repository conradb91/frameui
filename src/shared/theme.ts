/** FrameUI chrome tokens. Also used by native windows and standalone exports. */
export const UI_FONT = "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
export const MONO_FONT = "SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", monospace"
export const themes = {
  "dark": {
    "bg": "#202020",
    "bg-raised": "#252525",
    "panel": "#252525",
    "panel-2": "#2b2b2b",
    "toolbar": "#252525",
    "canvas": "#191919",
    "artboard": "#ffffff",
    "grid": "#383838",
    "input": "#202020",
    "overlay": "#2b2b2b",
    "border": "#3a3a3a",
    "border-strong": "#555555",
    "text": "#ededed",
    "text-2": "#bdbdbd",
    "text-3": "#a0a0a0",
    "hover": "#343434",
    "selected": "#283e59",
    "accent": "#2563eb",
    "accent-hover": "#1d4ed8",
    "accent-2": "#8ab8ff",
    "on-accent": "#ffffff",
    "on-status": "#191919",
    "scrim": "#00000066",
    "success": "#7cc99b",
    "warning": "#e8bf70",
    "danger": "#ff9292"
  },
  "light": {
    "bg": "#f4f4f4",
    "bg-raised": "#fafafa",
    "panel": "#fafafa",
    "panel-2": "#eeeeee",
    "toolbar": "#fafafa",
    "canvas": "#e5e5e5",
    "artboard": "#ffffff",
    "grid": "#c7c7c7",
    "input": "#ffffff",
    "overlay": "#ffffff",
    "border": "#d5d5d5",
    "border-strong": "#adadad",
    "text": "#242424",
    "text-2": "#555555",
    "text-3": "#686868",
    "hover": "#e8e8e8",
    "selected": "#dce9fa",
    "accent": "#2563eb",
    "accent-hover": "#1d4ed8",
    "accent-2": "#1d4ed8",
    "on-accent": "#ffffff",
    "on-status": "#ffffff",
    "scrim": "#00000066",
    "success": "#246e43",
    "warning": "#825c13",
    "danger": "#b52b35"
  }
} as const

function declarations(theme: typeof themes.dark | typeof themes.light): string {
  return Object.entries(theme).map(([name, value]) => `--ui-${name}:${value};`).join('')
}
export const themeStyleSheet = `:root{color-scheme:dark;--ui-font-sans:${UI_FONT};--ui-font-mono:${MONO_FONT};${declarations(themes.dark)}}:root[data-theme="light"]{color-scheme:light;${declarations(themes.light)}}`
