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
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await api.login(username, password)
      onLogin(data.access_token, data.username)
    } catch {
      setError('Falscher Benutzername oder Passwort')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-bg min-h-screen flex items-center justify-center p-4">
      <div className="vignette" />

      <div className="relative z-10 w-full max-w-sm fade-in">
        {/* Glass card */}
        <div className="glass-card p-8">

          {/* Logo */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-glow"
              style={{ background: 'linear-gradient(135deg,#e8002d,#b50024)' }}>
              <span className="text-white font-bold text-sm tracking-wide">DAV</span>
            </div>
            <div>
              <p className="font-semibold text-white/90 text-base leading-tight">DAV Distro</p>
              <p className="text-white/35 text-xs">Audio Distribution Platform</p>
            </div>
          </div>

          <h2 className="text-xl font-semibold text-white/90 mb-1">Anmelden</h2>
          <p className="text-white/40 text-sm mb-6">Bitte melde dich mit deinen Zugangsdaten an.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5 uppercase tracking-wider">
                Benutzername
              </label>
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                className="glass-input w-full"
                placeholder="benutzername"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5 uppercase tracking-wider">
                Passwort
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="glass-input w-full"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-xl px-3 py-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-accent w-full flex items-center justify-center gap-2 py-2.5 mt-2"
            >
              {loading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <LogIn className="w-4 h-4" />
              }
              {loading ? 'Anmelden…' : 'Anmelden'}
            </button>
          </form>
        </div>

        {/* Subtle bottom glow */}
        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-3/4 h-12 rounded-full blur-2xl"
          style={{ background: 'rgba(34,211,238,0.12)' }} />
      </div>
    </div>
  )
}
