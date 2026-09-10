import { Monitor, Moon, Sun } from 'lucide-react'
import { usePreferencesStore, type Appearance } from '../../state/preferencesStore'
import { FrameMark } from '../icons/icons'

export function AppearancePicker() {
  const appearance = usePreferencesStore((s) => s.appearance)
  const setAppearance = usePreferencesStore((s) => s.setAppearance)
  return <fieldset className="appearance-picker"><legend>Appearance</legend>{([
    ['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'Use System Appearance', Monitor],
  ] as const).map(([value, label, Icon]) => <label key={value} className={appearance === value ? 'selected' : ''}>
    <input type="radio" name="appearance" value={value} checked={appearance === value} onChange={() => setAppearance(value as Appearance)}/><Icon size={18}/><span>{label}</span>
  </label>)}</fieldset>
}

export function WelcomeScreen() {
  const finish = usePreferencesStore((s) => s.finishWelcome)
  return <main className="welcome-screen"><div className="welcome-content">
    <div className="brand-icon"><FrameMark /></div><p className="welcome-name">FrameUI</p>
    <h1>Your codebase.<br/>A new perspective.</h1>
    <p className="welcome-description">A design studio for the application you’re building. Explore real pages, shape new ideas, and connect complete flows.</p>
    <ul><li>Bring your local project’s pages, components and assets into view.</li><li>Design alternatives on an open, responsive canvas.</li><li>Keep your work and workspace on this computer.</li></ul>
    <AppearancePicker/><button className="home-primary" onClick={finish}>Get started <span aria-hidden="true">→</span></button>
    <p className="mt-3 text-xs text-text-3">Choose a project next. No account needed.</p>
  </div><div className="welcome-art" aria-hidden="true"><div className="welcome-art-frame"><FrameMark/><span>From application to possibility.</span></div></div></main>
}
