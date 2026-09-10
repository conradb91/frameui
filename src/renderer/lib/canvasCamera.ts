export interface Camera { x: number; y: number; zoom: number }
export function zoomAt(camera: Camera, zoom: number, x: number, y: number): Camera {
  const next = Math.max(.1, Math.min(8, zoom))
  return { zoom: next, x: x - (x - camera.x) * next / camera.zoom, y: y - (y - camera.y) * next / camera.zoom }
}
export function wheelCamera(camera: Camera, input: { deltaX: number; deltaY: number; deltaMode: number; zoom: boolean; x: number; y: number; height: number }): Camera {
  const unit = input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? input.height : 1
  const dx = input.deltaX * unit, dy = input.deltaY * unit
  return input.zoom ? zoomAt(camera, camera.zoom * Math.exp(-Math.max(-300, Math.min(300, dy)) * .006), input.x, input.y) : { ...camera, x: camera.x - dx, y: camera.y - dy }
}
