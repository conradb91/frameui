/**
 * How confidently a token's value was determined without ever executing the
 * opened project's code (spec §23) — 'full' for literal values (and simple,
 * locally-resolvable references), 'unresolved' for anything that would
 * require running JS (a function, an imported/3rd-party value, a spread we
 * can't trace), in which case a bundled Tailwind-default fallback is used
 * and clearly labeled as such. There is no silent in-between: a value is
 * either confidently read from the project's own source, or it visibly
 * isn't.
 */
export type Confidence = 'full' | 'unresolved'

export interface StyleToken {
  name: string
  value: string
  confidence: Confidence
}

export type StyleTokenSource = 'tailwind-v3' | 'tailwind-v4' | 'css-custom-properties' | 'none'

export interface StyleTokens {
  source: StyleTokenSource
  colors: StyleToken[]
  spacing: StyleToken[]
  radius: StyleToken[]
  breakpoints: StyleToken[]
}
