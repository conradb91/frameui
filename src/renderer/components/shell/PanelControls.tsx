import { Maximize, PanelLeft, PanelRight } from 'lucide-react'
export function PanelControls({ left, right, setLeft, setRight }: { left: boolean; right: boolean; setLeft: (value: boolean) => void; setRight: (value: boolean) => void }) {
  return <div className="flex items-center gap-1">{[
    { title: 'Toggle left panel', Icon: PanelLeft, active: left, action: () => setLeft(!left) },
    { title: 'Focus canvas', Icon: Maximize, active: !left && !right, action: () => { const restore = !left && !right; setLeft(restore); setRight(restore) } },
    { title: 'Toggle inspector', Icon: PanelRight, active: right, action: () => setRight(!right) },
  ].map(({title,Icon,active,action}) => <button key={title} title={title} aria-label={title} aria-pressed={active} onClick={action} className={`flex h-7 w-7 items-center justify-center rounded ${active ? 'bg-selected text-accent-2' : 'text-text-3 hover:bg-panel-2'}`}><Icon size={14}/></button>)}</div>
}
