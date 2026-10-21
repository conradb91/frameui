export function formatElapsed(seconds:number):string {
 const elapsed=Math.max(0,Math.floor(seconds))
 return elapsed<60?`${elapsed} sec`:`${Math.floor(elapsed/60)} min | ${elapsed%60} sec`
}
