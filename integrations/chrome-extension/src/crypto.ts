import {sha256} from '@noble/hashes/sha2.js'
import {md5} from '@noble/hashes/legacy.js'
import {Buffer} from 'buffer'
export const randomUUID=()=>globalThis.crypto.randomUUID()
export function createHash(name:string){
 const hash=name==='sha256'?sha256.create():name==='md5'?md5.create():null
 if(!hash)throw Error('Unsupported capture hash: '+name)
 const api={update(data:string|Uint8Array){hash.update(typeof data==='string'?new TextEncoder().encode(data):data);return api},digest(encoding?:string){const value=Buffer.from(hash.digest());return encoding==='hex'?value.toString('hex'):value}}
 return api
}
