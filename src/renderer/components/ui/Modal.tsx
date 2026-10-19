import {
  createContext,
  cloneElement,
  isValidElement,
  Children,
  type ReactElement,
  useContext,
  useEffect,
  useId,
  useRef,
  type ElementType,
  type FormEventHandler,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { AlertCircle, Check, Info, Loader2, TriangleAlert, X } from 'lucide-react'
import './modal.css'

export type ModalSize = 'compact' | 'standard' | 'large' | 'wide'
export type ModalVariant =
  | 'confirmation'
  | 'destructive'
  | 'information'
  | 'form'
  | 'selection'
  | 'progress'
  | 'setup'
  | 'error'
  | 'warning'
  | 'completion'

const ModalContext = createContext<{ titleId: string; descriptionId: string } | null>(null)

const focusableSelector = [
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function ModalShell({
  children,
  size = 'standard',
  variant = 'information',
  onClose,
  closeOnEscape = true,
  closeOnBackdrop = false,
  critical = false,
  as = 'div',
  onSubmit,
  className = '',
  ariaLabel,
  onDialogKeyDown,
}: {
  children: ReactNode
  size?: ModalSize
  variant?: ModalVariant
  onClose?: () => void
  closeOnEscape?: boolean
  closeOnBackdrop?: boolean
  critical?: boolean
  as?: ElementType
  onSubmit?: FormEventHandler<HTMLFormElement>
  className?: string
  ariaLabel?: string
  onDialogKeyDown?: (event: KeyboardEvent) => void
}) {
  const panelRef = useRef<HTMLElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const previousFocus = useRef<HTMLElement | null>(null)
  const Component = as

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const focus = () => {
      if (!panel?.contains(document.activeElement)) {
        const target = panel?.querySelector<HTMLElement>('[autofocus], [data-modal-initial-focus]')
          ?? panel?.querySelector<HTMLElement>(focusableSelector)
        if (target) target.focus()
        else panel?.focus()
      }
    }
    const frame = requestAnimationFrame(focus)
    return () => {
      cancelAnimationFrame(frame)
      previousFocus.current?.focus?.()
    }
  }, [])

  useEffect(() => {
    if (!onClose || critical || !closeOnEscape) return
    const closeFromEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const dialogs=document.querySelectorAll('[role=dialog],[role=alertdialog]')
      if(dialogs[dialogs.length-1]!==panelRef.current)return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', closeFromEscape)
    return () => document.removeEventListener('keydown', closeFromEscape)
  }, [closeOnEscape, critical, onClose])

  function handleKeyDown(event: KeyboardEvent) {
    if((event.target as Element).closest('[role=dialog],[role=alertdialog]')!==panelRef.current)return
    onDialogKeyDown?.(event)
    if (event.defaultPrevented) return
    if (event.key === 'Escape' && !critical && closeOnEscape && onClose) {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
      .filter((node) => node.offsetParent !== null)
    if (!focusable.length) {
      event.preventDefault()
      panelRef.current?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function handleBackdrop(event: PointerEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && closeOnBackdrop && !critical) onClose?.()
  }

  return (
    <div className="frame-modal-backdrop" onPointerDown={handleBackdrop}>
      <ModalContext.Provider value={{ titleId, descriptionId }}>
        <Component
          ref={panelRef}
          className={`frame-modal frame-modal--${size} frame-modal--${variant} ${className}`.trim()}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabel ? undefined : titleId}
          aria-describedby={ariaLabel ? undefined : descriptionId}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          onSubmit={onSubmit}
        >
          {children}
        </Component>
      </ModalContext.Provider>
    </div>
  )
}

export function ModalHeader({
  title,
  description,
  icon,
  eyebrow,
  onClose,
  closeLabel = 'Close dialog',
  closeDisabled = false,
  meta,
}: {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  eyebrow?: ReactNode
  onClose?: () => void
  closeLabel?: string
  closeDisabled?: boolean
  meta?: ReactNode
}) {
  const context = useContext(ModalContext)
  return (
    <header className="frame-modal-header">
      {icon && <ModalIcon>{icon}</ModalIcon>}
      <div className="frame-modal-heading">
        {eyebrow && <span className="frame-modal-eyebrow">{eyebrow}</span>}
        <h2 id={context?.titleId}>{title}</h2>
        {description && <ModalDescription>{description}</ModalDescription>}
        {meta && <div className="frame-modal-header-meta">{meta}</div>}
      </div>
      {onClose && (
        <button className="frame-modal-close" type="button" aria-label={closeLabel} onClick={onClose} disabled={closeDisabled}>
          <X size={16} />
        </button>
      )}
    </header>
  )
}

export function ModalBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`frame-modal-body ${className}`.trim()}>{children}</div>
}

export function ModalSection({ title, description, children, className = '' }: { title?: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`frame-modal-section ${className}`.trim()}>
      {(title || description) && <div className="frame-modal-section-heading">{title && <h3>{title}</h3>}{description && <p>{description}</p>}</div>}
      {children}
    </section>
  )
}

export function ModalFooter({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return <footer className="frame-modal-footer">{note && <div className="frame-modal-footer-note">{note}</div>}<ModalActions>{children}</ModalActions></footer>
}

export function ModalActions({ children }: { children: ReactNode }) {
  return <div className="frame-modal-actions">{children}</div>
}

export function ModalIcon({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' }) {
  return <span className={`frame-modal-icon frame-modal-icon--${tone}`} aria-hidden="true">{children}</span>
}

export function ModalDescription({ children }: { children: ReactNode }) {
  const context = useContext(ModalContext)
  return <p id={context?.descriptionId} className="frame-modal-description">{children}</p>
}

export function ModalNotice({ children, title, tone = 'info' }: { children: ReactNode; title?: ReactNode; tone?: 'info' | 'warning' | 'danger' | 'success' }) {
  const Icon = tone === 'success' ? Check : tone === 'warning' ? TriangleAlert : tone === 'danger' ? AlertCircle : Info
  return <div className={`frame-modal-notice frame-modal-notice--${tone}`} role={tone === 'danger' ? 'alert' : 'note'}><Icon size={15} /><div>{title && <strong>{title}</strong>}<div>{children}</div></div></div>
}

export function ModalField({ label, hint, error, children, className = '' }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  const descriptionId=useId()
  const controls=Children.map(children,child=>{
    if(!isValidElement(child)||typeof child.type!=='string'||!['input','select','textarea'].includes(child.type))return child
    const control=child as ReactElement<{'aria-describedby'?:string;'aria-invalid'?:boolean}>
    return cloneElement(control,{'aria-invalid':!!error||undefined,'aria-describedby':([control.props['aria-describedby'],error||hint?descriptionId:undefined].filter(Boolean).join(' ')||undefined)})
  })
  return <label className={`frame-modal-field ${className}`.trim()}><span>{label}</span>{controls}{error && <small id={descriptionId} className="frame-modal-field-error" role="alert">{error}</small>}{!error && hint && <small id={descriptionId}>{hint}</small>}</label>
}

export function ModalProgress({ value, label, detail, paused = false }: { value?: number; label: ReactNode; detail?: ReactNode; paused?: boolean }) {
  const labelId = useId()
  const normalized = value === undefined ? undefined : Math.max(0, Math.min(100, value))
  return <div className="frame-modal-progress"><div><strong id={labelId}>{label}</strong>{detail && <span>{detail}</span>}{normalized !== undefined && <b>{Math.round(normalized)}%</b>}</div><div className={`frame-modal-progress-track ${paused ? 'is-paused' : normalized === undefined ? 'is-indeterminate' : ''}`} role="progressbar" aria-labelledby={labelId} aria-valuemin={0} aria-valuemax={100} aria-valuenow={normalized}><i style={normalized === undefined ? undefined : { width: `${normalized}%` }} /></div></div>
}

export function ModalSummary({ items, children }: { items?: { label: ReactNode; value: ReactNode }[]; children?: ReactNode }) {
  return <div className="frame-modal-summary">{children}{items?.map((item, index) => <div key={index}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div>
}

export function ModalList({ children, label }: { children: ReactNode; label?: string }) {
  return <div className="frame-modal-list" role="list" aria-label={label}>{children}</div>
}

export function ModalEmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return <div className="frame-modal-empty"><strong>{title}</strong>{children && <p>{children}</p>}{action}</div>
}

export function ModalError({ title = 'FrameUI could not complete this action', children, details }: { title?: ReactNode; children: ReactNode; details?: ReactNode }) {
  return <ModalNotice title={title} tone="danger"><div>{children}</div>{details && <details><summary>View technical details</summary><pre>{details}</pre></details>}</ModalNotice>
}

export function ModalSuccess({ title, children }: { title: ReactNode; children: ReactNode }) {
  return <ModalNotice title={title} tone="success">{children}</ModalNotice>
}

export function ModalDangerZone({ title, children }: { title: ReactNode; children: ReactNode }) {
  return <section className="frame-modal-danger-zone"><h3>{title}</h3>{children}</section>
}

export function ModalActivity({ label, detail }: { label: ReactNode; detail?: ReactNode }) {
  return <div className="frame-modal-activity" role="status"><Loader2 className="frame-modal-spinner" size={16} /><div><strong>{label}</strong>{detail && <span>{detail}</span>}</div></div>
}
