import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const blocked = /(^|\/)(?:\.env(?:\.[^/]*)?|\.git|\.ssh|\.aws|\.azure|\.config|node_modules|vendor|\.npmrc|\.pypirc|\.netrc|\.git-credentials|(?:auth|tokens?|service[-_]?account)\.json|credentials?[^/]*|secrets?[^/]*|id_rsa[^/]*|id_ed25519[^/]*)(\/|$)|\.(?:pem|key|p12|pfx|keystore|sqlite3?|db|sql|dump|bak)$/i
const readable = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|html?|css|scss|sass|less|json|ya?ml|md|txt|php|cs|cshtml|razor|xml|toml|svg)$/i
export function safeRepoPath(root: string, relative: string, newFile = false): string {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').includes('..') || blocked.test(relative) || !readable.test(relative)) throw new Error('This file is outside the allowed project source files.')
  const realRoot = fs.realpathSync(root)
  const target = path.resolve(realRoot, relative)
  let ancestor = target
  while (!fs.existsSync(ancestor)) { const parent = path.dirname(ancestor); if (parent === ancestor) throw new Error('Invalid source path.'); ancestor = parent }
  const realAncestor = fs.realpathSync(ancestor)
  const within = path.relative(realRoot, realAncestor)
  if (within.startsWith('..') || path.isAbsolute(within)) throw new Error('Source symlinks must remain inside the project.')
  const canonicalRelative = path.relative(realRoot, path.join(realAncestor, path.relative(ancestor, target))).replaceAll(path.sep, '/')
  if (blocked.test(canonicalRelative)) throw new Error('Restricted file.')
  if (!newFile && !fs.statSync(target).isFile()) throw new Error('A source file is required.')
  return target
}
export function redactSecrets(text: string): string {
  return text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:sk-ant-[\w-]+|sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[\w]{20,})\b/g, '[REDACTED]')
    .replace(/((?:password|secret|api[_-]?key|access[_-]?token|authorization)\s*[:=]\s*)(["'`])[^\n]*?\2/gi, '$1"[REDACTED]"')
    .replace(/(["']?(?:password|secret|api[_-]?key|access[_-]?token|private[_-]?key)["']?\s*[:=]\s*)(["'`])[^\n]*?\2/gi, '$1"[REDACTED]"')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED TOKEN]')
    .replace(/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"'`]+/gi, '[REDACTED CONNECTION]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
}
export function readSource(root: string, relative: string): string {
  const file = safeRepoPath(root, relative)
  if (fs.statSync(file).size > 200_000) throw new Error('File exceeds the 200 KB source limit. Choose a smaller source file.')
  return redactSecrets(fs.readFileSync(file, 'utf8'))
}
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
