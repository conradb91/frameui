import type { StyleToken } from '@shared/types/styleTokens'

/**
 * A small, bundled snapshot of Tailwind's own default theme — used only as
 * the visible fallback when a project's config can't be statically resolved
 * (a function value, an imported/3rd-party theme, a spread we can't trace).
 * Every entry here is marked 'unresolved' by the callers that use it, never
 * passed off as read from the project.
 */
export function defaultColorTokens(): Omit<StyleToken, 'confidence'>[] {
  return [
    { name: 'slate-500', value: '#64748b' },
    { name: 'blue-500', value: '#3b82f6' },
    { name: 'emerald-500', value: '#10b981' },
    { name: 'amber-500', value: '#f59e0b' },
    { name: 'red-500', value: '#ef4444' },
    { name: 'white', value: '#ffffff' },
  ]
}

export function defaultSpacingTokens(): Omit<StyleToken, 'confidence'>[] {
  return [
    { name: '1', value: '0.25rem' },
    { name: '2', value: '0.5rem' },
    { name: '4', value: '1rem' },
    { name: '6', value: '1.5rem' },
    { name: '8', value: '2rem' },
  ]
}

export function defaultRadiusTokens(): Omit<StyleToken, 'confidence'>[] {
  return [
    { name: 'sm', value: '0.125rem' },
    { name: 'md', value: '0.375rem' },
    { name: 'lg', value: '0.5rem' },
    { name: 'full', value: '9999px' },
  ]
}

export function defaultBreakpointTokens(): Omit<StyleToken, 'confidence'>[] {
  return [
    { name: 'sm', value: '640px' },
    { name: 'md', value: '768px' },
    { name: 'lg', value: '1024px' },
    { name: 'xl', value: '1280px' },
  ]
}

export function defaultFontFamilyTokens(): Omit<StyleToken, 'confidence'>[] {
  return [
    { name: 'sans', value: 'ui-sans-serif, system-ui, sans-serif' },
    { name: 'serif', value: 'ui-serif, Georgia, serif' },
    { name: 'mono', value: 'ui-monospace, monospace' },
  ]
}

export function defaultFontSizeTokens(): Omit<StyleToken, 'confidence'>[] {
  return [
    { name: 'xs', value: '0.75rem' },
    { name: 'sm', value: '0.875rem' },
    { name: 'base', value: '1rem' },
    { name: 'lg', value: '1.125rem' },
    { name: 'xl', value: '1.25rem' },
    { name: '2xl', value: '1.5rem' },
  ]
}
