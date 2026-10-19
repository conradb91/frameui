import { spawn } from 'node:child_process'
import electron from 'electron'

function processOutput(command: string, args: string[], input = '', timeout = 120000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let output = ''
    const timer = setTimeout(() => child.kill(), timeout)
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 100000) child.kill() })
    child.stderr.resume() // Never log credential process output or errors.
    child.on('error', () => { clearTimeout(timer); reject(new Error('Secure credential operation is unavailable.')) })
    child.on('close', code => { clearTimeout(timer); if(code === 0) resolve(output.trim()); else reject(new Error('Credential operation was cancelled or could not be completed.')) })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}
const service = 'com.frameui.anthropic'
// Windows stores the key with CredWrite in Credential Manager, not a project or settings file.
const windowsNative = `Add-Type @'
using System; using System.Runtime.InteropServices;
public class FrameUiCredential {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CRED { public int Flags; public int Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
 [DllImport("advapi32", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredWrite(ref CRED c, int flags);
 [DllImport("advapi32", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target,int type,int flags,out IntPtr ptr);
 [DllImport("advapi32", CharSet=CharSet.Unicode)] public static extern bool CredDelete(string target,int type,int flags);
 [DllImport("advapi32")] public static extern void CredFree(IntPtr ptr);
}
'@
`
async function windows(action: 'get' | 'set' | 'remove', key = '') {
  const operation = action === 'get' ? `$p=[IntPtr]::Zero;if([FrameUiCredential]::CredRead('${service}',1,0,[ref]$p)){try{$c=[Runtime.InteropServices.Marshal]::PtrToStructure($p,[type][FrameUiCredential+CRED]);[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringUni($c.CredentialBlob,$c.CredentialBlobSize/2))}finally{[FrameUiCredential]::CredFree($p)}}`
    : action === 'remove' ? `[void][FrameUiCredential]::CredDelete('${service}',1,0)`
    : `$v=[Console]::In.ReadToEnd();$p=[Runtime.InteropServices.Marshal]::StringToCoTaskMemUni($v);try{$c=New-Object FrameUiCredential+CRED;$c.Type=1;$c.TargetName='${service}';$c.UserName='api';$c.CredentialBlob=$p;$c.CredentialBlobSize=[Text.Encoding]::Unicode.GetByteCount($v);$c.Persist=2;if(-not [FrameUiCredential]::CredWrite([ref]$c,0)){throw 'Credential storage failed'}}finally{[Runtime.InteropServices.Marshal]::ZeroFreeCoTaskMemUnicode($p)}`
  return processOutput('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("$ErrorActionPreference='Stop';" + windowsNative + operation, 'utf16le').toString('base64')], key)
}
export async function promptApiKey(): Promise<string> {
  if (process.platform === 'darwin') return processOutput('/usr/bin/osascript', ['-e', 'text returned of (display dialog "Enter your Anthropic Console API key. It will be saved in Keychain." default answer "" with hidden answer buttons {"Cancel", "Connect"} default button "Connect" with title "Connect Claude · FrameUI")'])
  if (process.platform === 'win32') return processOutput('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', Buffer.from(`Add-Type -AssemblyName System.Windows.Forms;$f=New-Object Windows.Forms.Form;$f.Text='Connect Claude · FrameUI';$f.Width=460;$f.Height=160;$t=New-Object Windows.Forms.TextBox;$t.UseSystemPasswordChar=$true;$t.Width=400;$t.Top=20;$t.Left=20;$b=New-Object Windows.Forms.Button;$b.Text='Connect';$b.Top=60;$b.Left=20;$b.DialogResult='OK';$f.Controls.AddRange(@($t,$b));$f.AcceptButton=$b;if($f.ShowDialog() -eq 'OK'){[Console]::Write($t.Text)}else{exit 1}`, 'utf16le').toString('base64')])
  throw new Error('Claude credential entry currently supports macOS and Windows.')
}
export async function savedApiKey(): Promise<string | null> {
  if (process.platform === 'win32') return (await windows('get')) || null
  if (process.platform !== 'darwin') return null
  return processOutput('/usr/bin/security', ['find-generic-password', '-s', service, '-a', 'api', '-w']).catch(() => null)
}
export async function saveApiKey(key: string): Promise<void> {
  if (process.platform === 'win32') { await windows('set', key); return }
  if (process.platform !== 'darwin') throw new Error('Secure credential storage is unavailable.')
  if(!/^sk-ant-api[\w-]+$/.test(key))throw new Error('Invalid Console API key.')
  await processOutput('/usr/bin/security', ['-i'], `add-generic-password -U -s ${service} -a api -w ${key}\nquit\n`)
  if(await savedApiKey()!==key)throw new Error('Keychain could not save this API key.')
}
export async function removeApiKey(): Promise<void> {
  if (process.platform === 'win32') { await windows('remove'); return }
  if (process.platform === 'darwin') await processOutput('/usr/bin/security', ['delete-generic-password', '-s', service, '-a', 'api']).catch(() => {})
}
export async function cliToken(login = false): Promise<string> {
  if (login && electron.app.isPackaged) throw new Error('Browser login is a development-only option pending distribution approval. Use your Console API key or an existing official CLI login.')
  const env = { ...process.env }
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_WORKSPACE_ID']) delete env[key]
  const run = (args: string[]) => new Promise<string>((resolve, reject) => {
    const child = spawn('ant', [...args, '--profile', 'frameui'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let out = ''; const timer = setTimeout(() => child.kill(), login ? 180000 : 20000)
    child.stdout.on('data', chunk => { out += chunk; if(out.length > 100000) child.kill() }); child.stderr.resume()
    child.on('error', () => { clearTimeout(timer); reject(new Error('Install the official ant CLI or use an API key.')) })
    child.on('close', code => { clearTimeout(timer); if(code === 0) resolve(out.trim()); else reject(new Error('The frameui CLI profile is not authenticated. Run ant auth login --profile frameui, or connect an API key.')) })
  })
  if (login) await run(['auth', 'login'])
  const token = await run(['auth', 'print-credentials', '--access-token'])
  if (!token || /\s/.test(token)) throw new Error('The CLI did not return an access token.')
  return token
}
export async function cliAvailable(): Promise<boolean> { return processOutput('ant', ['--version'], '', 5000).then(() => true, () => false) }
