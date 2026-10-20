import {test,expect} from 'bun:test'
import {userFacingError} from '../../src/renderer/lib/userFacingError'
test('export errors never expose embedded image data or grow with the source asset',()=>{
 const message=userFacingError(new Error('Unsupported XD colour: url("data:image/jpeg;base64,'+'A'.repeat(1_000_000)+'")'))
 expect(message).toContain('[embedded asset]')
 expect(message).not.toContain('AAAA')
 expect(message.length).toBeLessThanOrEqual(500)
 expect(userFacingError('x'.repeat(1000)).length).toBeLessThanOrEqual(500)
})
test('plain Electron transport errors stay actionable',()=>{
 expect(userFacingError("Error invoking remote method 'export:saveXd': Error: Permission denied")).toBe('Permission denied')
})
