import { useEffect, useRef, useState } from 'react'
import type { DevCommand } from '@shared/types/projectIndex'

type Status = 'idle' | 'running' | 'stopped' | 'error'

function commandToText(c: DevCommand | null): string {
  return c ? [c.command, ...c.args].join(' ') : ''
}

/** Splits "npm run dev -- --port 3001" into argv without a shell — kept
 * intentionally simple (whitespace-split, quote-aware) since this only
 * feeds spawn(command, args, {shell:false}); it never reaches a shell. */
function textToCommand(text: string): DevCommand | null {
  const parts = text.match(/"[^"]*"|'[^']*'|\S+/g)?.map((p) => p.replace(/^["']|["']$/g, '')) ?? []
  if (parts.length === 0) return null
  return { command: parts[0], args: parts.slice(1) }
}

export function LivePreviewPanel({ devCommand }: { devCommand: DevCommand | null }) {
  const [status, setStatus] = useState<Status>('idle')
  const [lines, setLines] = useState<string[]>([])
  const [url, setUrl] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const [effectiveCommand, setEffectiveCommand] = useState<DevCommand | null>(devCommand)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    // Prefer the main process's effective command (which may hold a
    // user override from a previous session) over the freshly-detected
    // prop, so a saved "Edit Command" choice doesn't get silently reverted
    // by a rescan.
    void window.frameui.preview.getCommand().then((c) => setEffectiveCommand(c ?? devCommand))
  }, [devCommand])

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

  function beginEdit() {
    setDraft(commandToText(effectiveCommand))
    setEditing(true)
  }

  async function commitEdit() {
    const parsed = textToCommand(draft)
    if (parsed) {
      await window.frameui.preview.setCommand(parsed)
      setEffectiveCommand(parsed)
    }
    setEditing(false)
  }

  return (
    <div className="rounded-[6px] border border-border bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] text-text-3">Live Preview</div>
        <StatusPill status={status} />
      </div>

      {editing ? (
        <div className="mb-3 flex items-center gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitEdit()
              if (e.key === 'Escape') setEditing(false)
            }}
            placeholder="npm run dev"
            className="flex-1 rounded-[5px] border border-accent-2 bg-panel-2 px-2.5 py-1.5 font-mono text-[11px] text-text outline-none"
          />
          <button
            type="button"
            onClick={() => void commitEdit()}
            className="rounded-[5px] bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-[5px] border border-border bg-panel-2 px-2.5 py-1.5 text-[11px] font-semibold text-text-2"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="font-mono text-[12.5px] text-text-2">
            {effectiveCommand ? `${effectiveCommand.command} ${effectiveCommand.args.join(' ')}` : 'No preview command detected'}
          </span>
          <button type="button" onClick={beginEdit} className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold text-text-3 hover:text-text">
            Edit Command
          </button>
        </div>
      )}

      {status === 'error' && (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger/[0.06] px-2.5 py-2 text-[11.5px] text-danger">
          The project couldn't be started with this command. Edit it above, then Retry.
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        {status === 'running' ? (
          <button type="button" onClick={() => void handleStop()} className="rounded-[5px] border border-danger/30 bg-danger/10 px-3 py-1.5 text-[11px] font-semibold text-danger">
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleStart()}
            disabled={!effectiveCommand}
            className="rounded-[5px] bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            {status === 'error' ? 'Retry' : 'Start Preview'}
          </button>
        )}
        {url && (
          <button
            type="button"
            onClick={() => void window.frameui.preview.openExternal(url)}
            className="rounded-[5px] border border-border bg-panel-2 px-3 py-1.5 text-[11px] font-semibold text-text-2 hover:text-text"
          >
            Open {url}
          </button>
        )}
      </div>

      {lines.length > 0 && (
        <div ref={logRef} className="max-h-32 overflow-y-auto rounded-[4px] bg-bg p-2 font-mono text-[10.5px] leading-relaxed text-text-3">
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
