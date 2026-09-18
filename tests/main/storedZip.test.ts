import { expect, test } from 'bun:test'
import { createStoredZip, crc32 } from '../../src/main/export/storedZip'

test('writes a standard stored ZIP with UTF-8 entry names', () => {
  const zip = createStoredZip([{ path: 'manifest.json', data: Buffer.from('{"ok":true}') }, { path: 'assets/images/brand.png', data: Buffer.from([1, 2, 3, 4]) }])
  expect(zip.readUInt32LE(0)).toBe(0x04034b50)
  expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50)
  expect(zip.includes(Buffer.from('manifest.json'))).toBe(true)
  expect(zip.includes(Buffer.from('assets/images/brand.png'))).toBe(true)
  expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
})
