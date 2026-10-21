import {formatElapsed} from '../../lib/formatElapsed'
import { useEffect, useState } from 'react'
import { Check, CircleAlert, LoaderCircle } from 'lucide-react'
import { ModalBody, ModalFooter, ModalHeader, ModalProgress, ModalShell } from './Modal'

export interface ActivityStep {
  id: string
  title: string
  detail?: string
  status?: 'pending' | 'active' | 'complete'
}

interface Props {
  open: boolean
  title: string
  description?: string
  steps?: ActivityStep[]
  current?: number
  operation?: string
  detail?: string
  logs?: string[]
  percentage?: number
  state?: 'working' | 'complete' | 'warning' | 'recoverable' | 'fatal'
  onCancel?: () => void
  cancelLabel?: string
  onRetry?: () => void
  onAlternative?: () => void
}

export function ProgressModal({
  open,
  title,
  description = 'FrameUI is preparing the project resources needed by the design workspace.',
  steps = [],
  current = 0,
  operation,
  detail,
  logs = [],
  percentage,
  state = 'working',
  onCancel,
  cancelLabel = 'Cancel',
  onRetry,
  onAlternative,
}: Props) {
  const [activity, setActivity] = useState(false)
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!open) return
    setActivity(false)
    setSeconds(0)
    const started = Date.now()
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [open])
  if (!open) return null

  const failed = state === 'fatal' || state === 'recoverable'
  const active = Math.min(current, Math.max(0, steps.length - 1))
  const progress = state === 'complete' ? 100 : percentage

  return (
    <ModalShell
      size="standard"
      className="ide-activity-dialog"
      variant={failed ? 'error' : state === 'warning' ? 'warning' : state === 'complete' ? 'completion' : 'progress'}
      onClose={onCancel}
      critical={state === 'working' && !onCancel}
      closeOnEscape={state !== 'working' || !!onCancel}
    >
      <ModalHeader
        title={title}
        description={description}
        icon={failed || state === 'warning' ? <CircleAlert size={17} /> : state === 'complete' ? <Check size={17} /> : <LoaderCircle size={17} className="frame-modal-spinner" />}
        onClose={onCancel}
        closeDisabled={state === 'working' && !onCancel}
      />
      <ModalBody>
        <div className={`progress-operation status-${state}`} role="status">
          <div>
            <strong>{operation || steps[active]?.title || 'Working locally'}</strong>
            <p>{detail || steps[active]?.detail || 'Your source project stays unchanged.'}</p>
          </div>
        </div>
        {!!steps.length && (
          <ol className="progress-sequence">
            {steps.map((step, index) => {
              const stepState = step.status ?? (state === 'complete' || index < current ? 'complete' : index === current ? 'active' : 'pending')
              return <li key={step.id} data-state={stepState}>{stepState === 'complete' ? <Check size={13} /> : stepState === 'active' ? <span className="activity-dot" /> : <span className="pending-dot" />}<span>{step.title}</span></li>
            })}
          </ol>
        )}
        <ModalProgress
          value={progress}
          paused={failed}
          label={state === 'complete' ? 'Complete' : failed ? 'Stopped' : steps.length ? `Step ${Math.min(current + 1, steps.length)} of ${steps.length}` : 'Processing locally'}
          detail={seconds >= 15 ? `${formatElapsed(seconds)} elapsed` : undefined}
        />
        <p className="progress-context">{state === 'working' ? 'Continue once FrameUI verifies the application. Larger projects can take a few minutes.' : state === 'complete' ? 'The project is ready to continue.' : 'Your workspace is saved. Review the next step below.'}</p>
        {(logs.length > 0 || activity) && <button type="button" className="ide-text-button" aria-expanded={activity} onClick={() => setActivity(!activity)}>{activity ? 'Hide activity' : 'Show activity'}</button>}
        {activity && <pre className="activity-console" tabIndex={0}>{logs.join('\n') || 'Waiting for activity…'}</pre>}
      </ModalBody>
      {(onCancel || onRetry || onAlternative) && (
        <ModalFooter note={state === 'working' ? 'Processing stays on this computer.' : undefined}>
          {onAlternative && <button type="button" onClick={onAlternative}>Change setup method</button>}
          {onCancel && <button type="button" onClick={onCancel}>{cancelLabel}</button>}
          {onRetry && <button type="button" className="primary" onClick={onRetry}>Try again</button>}
        </ModalFooter>
      )}
    </ModalShell>
  )
}
