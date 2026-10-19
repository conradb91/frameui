/** Some application servers mislabel valid images as JSON/octet-stream. Inspect
 * recognised image signatures instead of rejecting bytes the browser rendered. */
export function captureImageMime(bytes:Uint8Array,declared:string):string{
 const starts=(values:number[])=>values.every((v,i)=>bytes[i]===v)
 const ascii=(start:number,end:number)=>String.fromCharCode(...bytes.subarray(start,end))
 if(starts([137,80,78,71,13,10,26,10]))return 'image/png'
 if(starts([255,216,255]))return 'image/jpeg'
 if(['GIF87a','GIF89a'].includes(ascii(0,6)))return 'image/gif'
 if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP')return 'image/webp'
 if(ascii(4,8)==='ftyp'&&/avif|avis/.test(ascii(8,32)))return 'image/avif'
 if(declared.startsWith('image/'))return declared
 throw new Error('Resource is not a recognised image')
}
