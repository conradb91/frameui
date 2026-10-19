export interface TextGradient {
  image: string
  size?: string
  position?: string
  repeat?: string
  fragments?: { x: number; y: number; width: number; height: number; offset: number }[]
  clone?: boolean
  /** Source paint box relative to its owning editable text layer. */
  bounds?: { x: number; y: number; width: number; height: number }
}
export interface TextStyleRun {
  /** UTF-16 offsets, matching DOM Range and the characters API. */
  start: number
  end: number
  fontWeight?: string
  color?: string
  fontStyle?: string
  fontFamily?: string
  fontSize?: number
  lineHeight?: number
  letterSpacing?: number
  textDecoration?: string
  gradient?: TextGradient
}
