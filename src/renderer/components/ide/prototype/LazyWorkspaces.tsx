import {createPortal} from 'react-dom'
import { lazy, Suspense, type ComponentProps, type ReactNode } from 'react'
const Flow = lazy(() => import('./FlowWorkspace').then(module => ({ default: module.FlowWorkspace })))
const Runner = lazy(() => import('./PrototypeRunner').then(module => ({ default: module.PrototypeRunner })))
const Studio = lazy(() => import('./PrototypeStudio').then(module => ({ default: module.PrototypeStudio })))
function WorkspaceLoading({children,label}:{children:ReactNode;label:string}) {
 return <Suspense fallback={<div className="studio-workspace-loading" role="status">{label}</div>}>{children}</Suspense>
}
export function FlowWorkspace(props:ComponentProps<typeof import('./FlowWorkspace')['FlowWorkspace']>) {
 return <WorkspaceLoading label="Opening flow workspace…"><Flow {...props}/></WorkspaceLoading>
}
export function PrototypeRunner(props:ComponentProps<typeof import('./PrototypeRunner')['PrototypeRunner']>) {
 return <WorkspaceLoading label="Opening prototype…"><Runner {...props}/></WorkspaceLoading>
}
export function PrototypeStudio(props:ComponentProps<typeof import('./PrototypeStudio')['PrototypeStudio']>) {
 return <Suspense fallback={createPortal(<section className="ai-prototype-studio" aria-label="AI Prototype Studio"><p role="status">Opening Prototype Studio…</p></section>,window.document.querySelector('.ide')??window.document.body)}><Studio {...props}/></Suspense>
}
