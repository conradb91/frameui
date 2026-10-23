import {z} from 'zod'
export const artifactStepSchema=z.object({selector:z.string().max(8192),event:z.enum(['click','hover','input','select','open-select','key','scroll']),value:z.string().max(2000).optional(),key:z.string().max(40).optional(),x:z.number().finite().optional(),y:z.number().finite().optional()})
export const replayStepSchema=z.union([z.string().max(8192),artifactStepSchema])
export type ArtifactStep=z.infer<typeof artifactStepSchema>
export type ReplayStep=z.infer<typeof replayStepSchema>
export const coverageEntrySchema=z.object({state:z.string(),selector:z.string(),label:z.string(),event:z.string(),value:z.string().optional(),status:z.enum(['captured','unchanged','blocked','failed','pending']),reason:z.string().optional(),destination:z.string().optional()})
export type CoverageEntry=z.infer<typeof coverageEntrySchema>
export type ArtifactImportMode='simple'|'detailed'
export const discoveryCoverageSchema=z.object({version:z.literal(2),mode:z.enum(['simple','detailed']).optional(),complete:z.boolean(),attempted:z.number(),captured:z.number(),unchanged:z.number(),blocked:z.number(),failed:z.number(),pending:z.number(),entries:z.array(coverageEntrySchema),limits:z.object({states:z.number(),attempts:z.number(),depth:z.number(),milliseconds:z.number()})})
export type DiscoveryCoverage=z.infer<typeof discoveryCoverageSchema>
export type ArtifactInteractionKind='tab'|'dropdown'|'disclosure'|'drawer'|'modal'|'navigation'|'filter'|'scroll'|'control'
export type ArtifactComponentType='button'|'link'|'tab'|'dropdown'|'disclosure'|'input'|'checkbox'|'radio'|'row'|'scroll'|'control'
export interface DetectedArtifactTransition {componentType?:ArtifactComponentType;source:string;destination:string;selector:string;label:string;kind?:ArtifactInteractionKind;trigger?:'click'|'hover'|'change'|'key'|'swipe';action?:'navigate'|'state'|'open-modal'|'open-drawer'|'open-overlay'|'close-modal'|'close-drawer'|'close-overlay'|'scroll';value?:string;key?:string;reconstructed?:boolean}
export const stepOf=(step:ReplayStep):ArtifactStep=>typeof step==='string'?{selector:step,event:'click'}:step
