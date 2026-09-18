/** FrameUI chrome tokens. Also used by native windows and standalone exports. */
export const UI_FONT = "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
export const MONO_FONT = "SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", monospace"
export const themes = {
  dark: {
    bg: '#171a20', 'bg-raised': '#20242c', panel: '#20242c', 'panel-2': '#282d37',
    toolbar: '#252a33', canvas: '#14171c', artboard: '#ffffff', grid: '#303641',
    input: '#191d24', overlay: '#252a33', border: '#333a46', 'border-strong': '#4a5363',
    text: '#edf0f6', 'text-2': '#c0c8d6', 'text-3': '#9ba7bb', hover: '#2d3440',
    selected: '#253d63', accent: '#3369e0', 'accent-hover': '#3b72e3', 'accent-2': '#a8c9ff',
    'on-accent': '#ffffff', 'on-status': '#14171c', scrim: '#060b1666',
    success: '#86d4ac', warning: '#edc17a', danger: '#ff9aab',
  },
  light: {
    bg: '#f5f7fa', 'bg-raised': '#f8f9fc', panel: '#ffffff', 'panel-2': '#eff2f7',
    toolbar: '#ffffff', canvas: '#e9edf4', artboard: '#ffffff', grid: '#c4cddc',
    input: '#f2f4f8', overlay: '#ffffff', border: '#dfe5ee', 'border-strong': '#bac5d6',
    text: '#202a3b', 'text-2': '#505e73', 'text-3': '#66758c', hover: '#eaf0f8',
    selected: '#e6eeff', accent: '#2864ed', 'accent-hover': '#1d50cf', 'accent-2': '#245acd',
    'on-accent': '#ffffff', 'on-status': '#ffffff', scrim: '#18263b66',
    success: '#23724d', warning: '#885d13', danger: '#bd344c',
  },
} as const

function declarations(theme: typeof themes.dark | typeof themes.light): string {
  return Object.entries(theme).map(([name, value]) => `--ui-${name}:${value};`).join('')
}
export const themeStyleSheet = `:root{color-scheme:dark;--ui-font-sans:${UI_FONT};--ui-font-mono:${MONO_FONT};${declarations(themes.dark)}}:root[data-theme="light"]{color-scheme:light;${declarations(themes.light)}}`
