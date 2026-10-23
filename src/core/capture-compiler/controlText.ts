import type {StructuredNode} from '../../shared/types/structuredDesign'
type Control=NonNullable<StructuredNode['source']['control']>
/** The text shown by a captured field, independently of browser form state. */
export function capturedControlText(control:Control){
 if(control.type==='select')return control.options?.find(option=>option.value===control.value)?.label??control.options?.[0]?.label??control.value??''
 return control.value||control.placeholder||''
}
export function capturedControlTextField(control:Control):'value'|'placeholder'{return control.value||control.placeholder===undefined?'value':'placeholder'}
