import { FolderOpen, Files, Frame, Component, Palette, Image, PanelsTopLeft, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useStoredValue } from './preferences'
// Primary hierarchy: Designs / Pages / Components / Styles — everything a
// designer needs day to day. Designs are the user's work; Pages/Components/
// Styles are project resources used inside that work. Capture is not a
// destination of its own — it's a tool reached from New Design ("Capture
// from application") or from inside a design ("Capture page"), so it has no
// entry here. Assets and Archive are real, working features but secondary
// to the primary hierarchy, with labeled controls below a divider. 'Overview' and 'States' are
// gone: Overview's content now lives at the top of the Designs section
// itself, and States was an empty placeholder with no feature behind it.
const projectSections = ['Designs','Pages','Components','Styles'] as const
const secondarySections = ['Assets'] as const
export type ProjectSection = typeof projectSections[number] | typeof secondarySections[number] | 'Archive'
const icons = [Files, Frame, Component, Palette]
const secondaryIcons = [Image]
export function ProjectNav({name, section, onSelect, onBack, disabled = false, counts = {}}: {name: string; section: string; onSelect: (section: ProjectSection) => void; onBack: () => void; disabled?: boolean; counts?: Partial<Record<ProjectSection,number>>}) {
  const [collapsed, setCollapsed] = useStoredValue('frameui:rail-collapsed', false)
  return <nav className={`ide-project-nav ${collapsed ? 'collapsed' : ''}`} aria-label="Project navigation">
    <button disabled={disabled} onClick={onBack} title="Back to Projects"><FolderOpen size={16}/> {!collapsed && <span>Projects</span>}</button>
    <div className="ide-project-identity" title={name}><span><PanelsTopLeft size={18}/></span>{!collapsed && <div><strong>{name}</strong><small>Project workspace</small></div>}</div>{!collapsed && <small className="ide-nav-eyebrow">WORKSPACE</small>}
    {projectSections.map((label,index) => {
      const Icon = icons[index]
      return <button disabled={disabled} key={label} className={section===label?'active':''} aria-current={section===label?'page':undefined} title={label} aria-label={label} onClick={() => onSelect(label)}><Icon size={16}/>{!collapsed && <span>{label}</span>}{!collapsed && counts[label] ? <small>{counts[label]}</small> : null}</button>
    })}
    <div className="ide-project-nav-secondary">
      {secondarySections.map((label,index) => {const Icon=secondaryIcons[index];return <button disabled={disabled} key={label} className={section===label?'active':''} aria-current={section===label?'page':undefined} aria-label={label} title={`${label}${counts[label] ? ` (${counts[label]})` : ''}`} onClick={() => onSelect(label)}><Icon size={15}/>{!collapsed && <span>{label}</span>}</button>})}
    </div>
    <button className="ide-nav-collapse" title={collapsed ? 'Expand' : 'Collapse'} aria-label={collapsed ? 'Expand project rail' : 'Collapse project rail'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronsRight size={14}/> : <ChevronsLeft size={14}/>}</button>
  </nav>
}
