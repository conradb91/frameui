import { useEffect, useRef, useState } from 'react'
import type { DevCommand } from '@shared/types/projectIndex'

type Status = 'idle' | 'running' | 'stopped' | 'error'

export function LivePreviewPanel({ devCommand }: { devCommand: DevCommand | null }) {
  const [status, setStatus] = useState<Status>('idle')
  const [lines, setLines] = useState<string[]>([])
  const [url, setUrl] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const offOutput = window.frameui.preview.onOutput(({ line }) => {
      setLines((prev) => [...prev.slice(-199), line])
    })
    const offStatus = window.frameui.preview.onStatus(({ status }) => setStatus(status))
    const offUrl = window.frameui.preview.onUrlDetected(({ url }) => setUrl(url))
    return () => {
      offOutput()
      offStatus()
      offUrl()
    }
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [lines])

  async function handleStart() {
    setLines([])
    setUrl(null)
    const result = await window.frameui.preview.start()
    if (!result.ok) setStatus('error')
  }

  async function handleStop() {
    await window.frameui.preview.stop()
  }

  return (
    <div className="rounded-xl border border-border bg-panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] text-text-3">Live Preview</div>
        <StatusPill status={status} />
      </div>
      <div className="mb-3 font-mono text-[12.5px] text-text-2">
        {devCommand ? `${devCommand.command} ${devCommand.args.join(' ')}` : 'No preview command detected'}
      </div>

      <div className="mb-3 flex items-center gap-2">
        {status === 'running' ? (
          <button type="button" onClick={() => void handleStop()} className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-1.5 text-[12px] font-semibold text-danger">
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleStart()}
            disabled={!devCommand}
            className="rounded-lg border border-accent bg-gradient-to-b from-[#8676F4] to-[#7461EE] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            Start Preview
          </button>
        )}
        {url && (
          <button
            type="button"
            onClick={() => void window.frameui.preview.openExternal(url)}
            className="rounded-lg border border-border bg-panel-2 px-3 py-1.5 text-[12px] font-semibold text-text-2 hover:text-text"
          >
            Open {url}
          </button>
        )}
      </div>

      {lines.length > 0 && (
        <div ref={logRef} className="max-h-32 overflow-y-auto rounded-lg bg-bg p-2 font-mono text-[10.5px] leading-relaxed text-text-3">
          {lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: Status }) {
  const styles: Record<Status, string> = {
    idle: 'text-text-3 border-border bg-panel-2',
    running: 'text-success border-success/30 bg-success/10',
    stopped: 'text-text-3 border-border bg-panel-2',
    error: 'text-danger border-danger/30 bg-danger/10',
  }
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${styles[status]}`}>{status}</span>
}
