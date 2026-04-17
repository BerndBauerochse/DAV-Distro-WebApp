import { useState, FormEvent } from 'react'
import { LogIn, Loader2 } from 'lucide-react'
import { api } from '../api/client'

interface Props {
  onLogin: (token: string, username: string) => void
}

export function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError(''); setLoading(true)
    try { const d = await api.login(username, password); onLogin(d.access_token, d.username) }
    catch { setError('Falscher Benutzername oder Passwort') }
    finally { setLoading(false) }
  }

  return (
    <div className="app-stage">
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />
      <div className="grain" />

      {/* Login card */}
      <div className="relative z-10 w-full max-w-sm px-4 fade-up">
        <div className="glass-card p-8" style={{ boxShadow: '0 40px 100px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05) inset, 0 2px 0 rgba(255,255,255,0.07) inset' }}>

          {/* Top accent */}
          <div className="absolute top-0 left-12 right-12 h-px"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(34,211,238,0.5), rgba(167,139,250,0.4), transparent)' }} />

          {/* Logo */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg,#e8002d,#8b0013)', boxShadow: '0 4px 20px rgba(232,0,45,0.4)' }}>
              <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, color: 'white', fontSize: '12px', letterSpacing: '0.04em' }}>DAV</span>
            </div>
            <div>
              <p style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '1rem', color: 'var(--text-100)' }}>DAV Distro</p>
              <p style={{ fontSize: '0.6875rem', color: 'var(--text-400)' }}>Audio Distribution Platform</p>
            </div>
          </div>

          <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '1.375rem', letterSpacing: '-0.02em', color: 'var(--text-100)', marginBottom: '0.25rem' }}>
            Anmelden
          </h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-300)', marginBottom: '1.75rem' }}>
            Melde dich mit deinen Zugangsdaten an.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label block mb-1.5">Benutzername</label>
              <input type="text" autoComplete="username" value={username}
                onChange={e => setUsername(e.target.value)} required
                className="glass-input w-full" placeholder="benutzername" />
            </div>
            <div>
              <label className="label block mb-1.5">Passwort</label>
              <input type="password" autoComplete="current-password" value={password}
                onChange={e => setPassword(e.target.value)} required
                className="glass-input w-full" placeholder="••••••••" />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm rounded-xl px-3 py-2.5"
                style={{ background: 'rgba(248,113,113,0.09)', border: '1px solid rgba(248,113,113,0.22)', color: '#f87171' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="btn-accent w-full flex items-center justify-center gap-2 py-2.5 mt-1">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              {loading ? 'Anmelden…' : 'Anmelden'}
            </button>
          </form>
        </div>

        {/* Bottom ambient glow */}
        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-2/3 h-16 rounded-full blur-3xl pointer-events-none"
          style={{ background: 'rgba(34,211,238,0.1)' }} />
      </div>
    </div>
  )
}
