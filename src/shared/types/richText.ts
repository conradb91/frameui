export interface TextStyleRun {
  /** UTF-16 offsets, matching DOM Range and the Figma characters API. */
  start: number
  end: number
  fontWeight?: string
  color?: string
}
