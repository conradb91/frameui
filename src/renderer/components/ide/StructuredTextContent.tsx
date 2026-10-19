import type { CSSProperties } from 'react'
import type { StructuredTypography } from '@shared/types/structuredDesign'
import {
  capturedTextParts,
  textRunStyle,
  gradientTextStyle,
} from '@core/capture-compiler/textPaint'
import { textSegments } from '@core/visual/textRuns'
export function StructuredTextContent({ typography: t }: { typography: StructuredTypography }) {
  if (t.captureLines?.length)
    return (
      <>
        {capturedTextParts(t).map((line, i) => (
          <span
            key={i}
            style={
              {
                position: 'absolute',
                left: line.x,
                top: line.y,
                width: line.width,
                height: line.height,
                whiteSpace: 'pre',
                textAlign: 'left',
                lineHeight: line.height + 'px',
                ...gradientTextStyle(t.gradient, line),
              } as CSSProperties
            }
          >
            {line.segments.map((segment) => (
              <span key={segment.start} style={textRunStyle(segment, line) as CSSProperties}>
                {segment.text}
              </span>
            ))}
          </span>
        ))}
      </>
    )
  return (
    <>
      {textSegments(t.text, t.textRuns).map((segment) => (
        <span key={segment.start} style={textRunStyle(segment) as CSSProperties}>
          {segment.text}
        </span>
      ))}
    </>
  )
}
