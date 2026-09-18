import electron from 'electron'
/** An explicitly requested, local login. Credentials are never written to a profile or document. */
export async function loginForCapture(
  url: string,
  partition: string,
  username: string,
  password: string,
): Promise<{ ok: boolean; message: string }> {
  const origin = new URL(url).origin
  const win = new electron.BrowserWindow({
    show: false,
    webPreferences: {
      partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, target) => {
    if (new URL(target).origin !== origin) e.preventDefault()
  })
  win.webContents.on('will-redirect', (e, target) => {
    if (new URL(target).origin !== origin) e.preventDefault()
  })
  try {
    await Promise.race([
      win.loadURL(url),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 15000),
      ),
    ])

    // Password forms may be hidden behind a passkey-first choice or hydration.
    // Only activate an explicit password sign-in choice, never reset/signup.
    const formDeadline = Date.now() + 8000
    let switched = false
    while (Date.now() < formDeadline) {
      if (win.webContents.isLoading()) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        continue
      }
      const state = await win.webContents.executeJavaScript(`(()=>{
        const visible=el=>el.getClientRects().length && getComputedStyle(el).visibility!=='hidden';
        if(Array.from(document.querySelectorAll('input[type="password"]')).some(visible)) return 'ready';
        if(${JSON.stringify(switched)}) return 'waiting';
        const choice=Array.from(document.querySelectorAll('button,[role="button"],a')).find(el=>{
          const label=(el.textContent||el.getAttribute('aria-label')||'').trim();
          return visible(el) && /password/i.test(label) && /sign.?in|log.?in|use|continue/i.test(label)
            && !/reset|forgot|create|register|change|recover/i.test(label)
            && !(el instanceof HTMLButtonElement && el.form && el.type==='submit')
            && (!(el instanceof HTMLAnchorElement) || new URL(el.href,location.href).origin===location.origin);
        });
        if(choice){choice.click();return 'switched'}
        return 'waiting';
      })()`)
      if (state === 'ready') break
      if (state === 'switched') switched = true
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    const result = await win.webContents.executeJavaScript(`(()=>{
      const passwordField=Array.from(document.querySelectorAll('input[type="password"]')).find(input=>input.getClientRects().length);
      if(!passwordField) return 'manual';
      const form=passwordField.form;
      if(!form || new URL(form.action,location.href).origin!==location.origin || form.method.toLowerCase()!=='post') return 'manual';
      const usernameField=form.querySelector('input[autocomplete="username"],input[type="email"],input[name="email"],input[name="username"],input[type="text"],input:not([type])');
      if(!usernameField) return 'manual';
      const setValue=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))};
      setValue(usernameField,${JSON.stringify(username)});setValue(passwordField,${JSON.stringify(password)});
      const submitter=form.querySelector('button[type="submit"],button:not([type]),input[type="submit"]');
      if(!form.reportValidity()) return 'invalid';
      form.requestSubmit(submitter||undefined); return 'submitted';
    })()`)
    if (result !== 'submitted')
      return {
        ok: false,
        message:
          'This sign-in needs the embedded browser. Complete passkey, multi-step or custom sign-in below.',
      }
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 300))
      if (win.webContents.isLoading()) continue
      const signedIn = await win.webContents.executeJavaScript(
        `!document.querySelector('input[type="password"]') && !/\\/(login|signin|sign-in)(\\/|$)/i.test(location.pathname)`,
      )
      if (signedIn) return { ok: true, message: 'Signed in for capture.' }
    }
    return {
      ok: false,
      message:
        'Sign-in needs attention. Check your details or finish signing in below.',
    }
  } catch {
    return {
      ok: false,
      message:
        'Automatic sign-in could not finish. Sign in yourself using the browser below.',
    }
  } finally {
    win.destroy()
  }
}
