import electron from 'electron'
/** Only generated reference images are compressed; imported image layers stay lossless. */
export function referenceImage(data:string,width?:number):string {
 const image=electron.nativeImage.createFromDataURL(data)
 if(image.isEmpty())return data
 const size=image.getSize(),scaled=width&&size.width>width?image.resize({width}):image
 return 'data:image/jpeg;base64,'+scaled.toJPEG(92).toString('base64')
}
