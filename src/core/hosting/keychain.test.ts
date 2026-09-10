import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
const { Keychain } = createRequire(import.meta.url)('../../../hosting/stacker/lib/keychain.cjs')
test('portable credentials encrypt, isolate accounts, replace atomically and delete', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'frameui-vault-'))
  const storage = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value).map(byte => byte ^ 42), decryptString: (value: Buffer) => Buffer.from(value).map(byte => byte ^ 42).toString(), getSelectedStorageBackend: () => { throw new Error('Linux only') } }
  const vault = new Keychain('test', { platform: 'win32', storage, directory })
  try {
    expect(await vault.get('db', 'one')).toBeNull()
    await vault.set('db', 'one', 'private-password')
    const files = await fs.readdir(directory)
    expect(files).toHaveLength(1)
    expect((await fs.readFile(path.join(directory, files[0]))).includes('private-password')).toBe(false)
    expect(await vault.get('db', 'one')).toBe('private-password')
    expect(await vault.get('db', 'two')).toBeNull()
    await vault.set('db', 'one', 'replacement')
    expect(await vault.get('db', 'one')).toBe('replacement')
    storage.decryptString = () => { throw new Error('corrupt') }
    await expect(vault.get('db', 'one')).rejects.toThrow('could not be decrypted')
    await vault.remove('db', 'one')
    expect(await fs.readdir(directory)).toHaveLength(0)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
test('portable credentials refuse unencrypted storage', async () => {
  for (const storage of [{ isEncryptionAvailable: () => false }, { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text' }]) {
    const vault = new Keychain('test', { platform: 'linux', storage, directory: '/unused' })
    await expect(vault.set('db', 'one', 'secret')).rejects.toThrow('unavailable')
  }
})
