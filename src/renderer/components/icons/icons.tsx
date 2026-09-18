import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

export function FrameMark(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" {...props}>
      <path fill="currentColor" d="M4 17V7a4 4 0 0 1 4-4h5v2a2 2 0 0 1-2 2H8v10H4Zm6-5a3 3 0 0 1 3-3h4v1a3 3 0 0 1-3 3h-2l-2 2v-3Z"/><rect x="15" y="3" width="3" height="3" rx=".8" fill="var(--color-accent)"/>
    </svg>
  )
}

export function FolderIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" {...props}>
      <path
        d="M2.5 6.5C2.5 5.67 3.17 5 4 5H8L9.5 7H16C16.83 7 17.5 7.67 17.5 8.5V14.5C17.5 15.33 16.83 16 16 16H4C3.17 16 2.5 15.33 2.5 14.5V6.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" {...props}>
      <circle cx="9.5" cy="9.5" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M14 14L17.5 17.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" {...props}>
      <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AlertCircleIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" {...props}>
      <path d="M10 6.5V11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10" cy="13.6" r="0.9" fill="currentColor" />
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}
