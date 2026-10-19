/** One repository-grounded approach, shared by chat, generation, review and handoff. */
export const designApproaches = ['improve', 'redesign', 'create'] as const
export type DesignApproach = typeof designApproaches[number]
export interface AiDesignSettings { approach: DesignApproach }
export const approachOptions = [
  {id:'improve',name:'Improve Current Screen',description:'Refine appearance, usability and spacing while retaining the page’s general organisation.'},
  {id:'redesign',name:'Redesign Screen',description:'Restructure the experience using your project’s design language and components.'},
  {id:'create',name:'Create New Screen or Process',description:'Design new functionality with your project’s framework, components and conventions.'},
] as const
export function defaultDesignSettings(approach:DesignApproach='improve'):AiDesignSettings {return {approach}}
/** Read earlier draft policies as grounded approaches; unrestricted generation is no longer offered. */
export function resolveDesignSettings(design?:AiDesignSettings|{direction?:string;freedom?:string},legacyStructure?:'preserve'|'explore'):AiDesignSettings {
  const selected=design&&('approach' in design?design.approach:design.direction)
  return {approach:designApproaches.includes(selected as DesignApproach)?selected as DesignApproach:legacyStructure==='explore'?'redesign':'improve'}
}
export function designStructure(design:AiDesignSettings):'preserve'|'explore' {return design.approach==='improve'?'preserve':'explore'}
export function designPolicy(design:AiDesignSettings) {
  return {design,approach:approachOptions.find(o=>o.id===design.approach)!.description,priorities:['Explicit user requirements','Actual repository framework, architecture and design language','Required functionality and business rules','Suitable existing components, fonts, icons, tokens and assets','Current layout as a reference; retain general organisation only for Improve Current Screen'],foundation:'Use the actual project framework, language, routes, styling and component/import conventions. Use available fonts, existing icons, brand colours and tokens. Do not introduce another UI library, framework, font or unrelated visual style. Layouts and UX may change substantially while the application identity remains consistent.',components:'Inspect suitable components before creating replacements. Reuse existing buttons, inputs, tables and other controls, or propose improved variants using their existing conventions. If no suitable component exists, introduce a necessary native editable component and record_design_decision with its rationale and considered repository component. Never add meaningless reuse to satisfy a quota.',quality:'Act as an expert UI/UX designer: improve hierarchy, wording, navigation, spacing, responsive structure, accessibility and feedback. Do not merely copy an outdated screen or mechanically rearrange controls. Preserve important requirements and make interactions testable with simulated state. Validate foundations and rendered text, then review the full interface visually.',approval:'Keep designs isolated and editable. Identify existing bindings, proposed variants, new elements and shared token changes for review and developer handoff. Never modify repository source.'}
}
