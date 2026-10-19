export interface CanvasCamera {x:number;y:number;zoom:number}
export function zoomAt(camera:CanvasCamera,nextZoom:number,anchor:{x:number;y:number}):CanvasCamera {
 const zoom=Math.min(8,Math.max(.001,nextZoom))
 return {zoom,x:anchor.x-(anchor.x-camera.x)*zoom/camera.zoom,y:anchor.y-(anchor.y-camera.y)*zoom/camera.zoom}
}
