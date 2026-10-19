/** FrameUI chrome tokens. Also used by native windows and standalone exports. */
export const UI_FONT = "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
export const MONO_FONT = "SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", monospace"
export const themes = {
  dark: {
    bg: '#18191c', 'bg-raised': '#202125', panel: '#202125', 'panel-2': '#282a2f',
    toolbar: '#202125', canvas: '#17181b', artboard: '#ffffff', grid: '#303238',
    input: '#25262b', overlay: '#25262b', border: '#34363d', 'border-strong': '#535762',
    text: '#edf0f6', 'text-2': '#c0c8d6', 'text-3': '#9ba7bb', hover: '#2d3440',
    selected: '#253d63', accent: '#3369e0', 'accent-hover': '#3b72e3', 'accent-2': '#a8c9ff',
    'on-accent': '#ffffff', 'on-status': '#14171c', scrim: '#060b1666',
    success: '#86d4ac', warning: '#edc17a', danger: '#ff9aab',
  },
  light: {
    bg: '#fafafa', 'bg-raised': '#fafafa', panel: '#ffffff', 'panel-2': '#f4f4f5',
    toolbar: '#ffffff', canvas: '#f4f4f6', artboard: '#ffffff', grid: '#d9dce3',
    input: '#ffffff', overlay: '#ffffff', border: '#e6e7eb', 'border-strong': '#c8cbd3',
    text: '#23252c', 'text-2': '#585e6d', 'text-3': '#707887', hover: '#f2f3f6',
    selected: '#e6eeff', accent: '#2864ed', 'accent-hover': '#1d50cf', 'accent-2': '#245acd',
    'on-accent': '#ffffff', 'on-status': '#ffffff', scrim: '#18263b66',
    success: '#23724d', warning: '#885d13', danger: '#bd344c',
  },
} as const

function declarations(theme: typeof themes.dark | typeof themes.light): string {
  return Object.entries(theme).map(([name, value]) => `--ui-${name}:${value};`).join('')
}
export const themeStyleSheet = `:root{color-scheme:dark;--ui-font-sans:${UI_FONT};--ui-font-mono:${MONO_FONT};${declarations(themes.dark)}}:root[data-theme="light"]{color-scheme:light;${declarations(themes.light)}}`
