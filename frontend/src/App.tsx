import { useRef, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LayoutDashboard, History as HistoryIcon, FolderOpen, LogOut, Camera } from 'lucide-react'
import { Dashboard } from './components/Dashboard'
import { History } from './components/History'
import { FileManager } from './components/FileManager'
import { LoginPage } from './components/LoginPage'
import { useAuth } from './hooks/useAuth'
import { UploadProvider } from './contexts/UploadContext'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
})

type Page = 'dashboard' | 'history' | 'files'

const NAV = [
  { id: 'dashboard' as Page, label: 'Dashboard', sub: 'Übersicht & Auslieferung', icon: <LayoutDashboard className="w-[17px] h-[17px]" /> },
  { id: 'history'   as Page, label: 'Historie',  sub: 'Verlauf & Protokolle',   icon: <HistoryIcon     className="w-[17px] h-[17px]" /> },
  { id: 'files'     as Page, label: 'Dateien',   sub: 'Server-Dateiverwaltung', icon: <FolderOpen      className="w-[17px] h-[17px]" /> },
]

const PAGE_TITLES: Record<Page, { title: string; sub: string }> = {
  dashboard: { title: 'Dashboard',   sub: 'Auslieferungen starten & überwachen' },
  history:   { title: 'Historie',    sub: 'Vollständiger Verlauf aller Auslieferungen' },
  files:     { title: 'Dateiverwaltung', sub: 'ZIPs, Metadaten, Covers auf dem Server' },
}

function useAvatar() {
  const [avatar, setAvatarState] = useState<string | null>(() => localStorage.getItem('dav_avatar'))
  const set = (dataUrl: string) => { localStorage.setItem('dav_avatar', dataUrl); setAvatarState(dataUrl) }
  return { avatar, set }
}

export function App() {
  const { auth, login, logout } = useAuth()
  const [page, setPage] = useState<Page>('dashboard')
  const { avatar, set: setAvatar } = useAvatar()
  const avatarRef = useRef<HTMLInputElement>(null)

  function handleAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    const r = new FileReader(); r.onload = () => setAvatar(r.result as string); r.readAsDataURL(file)
  }

  if (!auth.token) return <LoginPage onLogin={login} />

  const { title, sub } = PAGE_TITLES[page]

  return (
    <QueryClientProvider client={queryClient}>
      <UploadProvider>

        {/* ── Fullscreen background stage ───────────────── */}
        <div className="app-stage">
          <div className="orb orb-1" />
          <div className="orb orb-2" />
          <div className="orb orb-3" />
          <div className="grain" />

          {/* ── Floating App Shell ─────────────────────── */}
          <div className="app-shell">

            {/* Sidebar */}
            <aside className="shell-sidebar">

              {/* Logo */}
              <div className="px-5 pt-6 pb-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 overflow-hidden"
                    style={{ background: 'white', boxShadow: '0 4px 16px rgba(232,0,45,0.35)' }}>
                    <img src="/logo.png" alt="DAV" className="w-7 h-7 object-contain" />
                  </div>
                  <div>
                    <p style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-100)', letterSpacing: '-0.01em' }}>Distro</p>
                    <p style={{ fontSize: '0.6875rem', color: 'var(--text-400)' }}>Audio Distribution</p>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="mx-4 mb-5" style={{ height: '1px', background: 'linear-gradient(90deg, transparent, var(--glass-border), transparent)' }} />

              {/* Nav */}
              <nav className="flex-1 px-3 space-y-1">
                {NAV.map((item, i) => {
                  const active = page === item.id
                  return (
                    <button
                      key={item.id}
                      onClick={() => setPage(item.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150 fade-up stagger-${Math.min(i + 1, 4)}`}
                      style={active
                        ? { background: 'linear-gradient(135deg,rgba(34,211,238,0.12),rgba(167,139,250,0.07))', border: '1px solid rgba(34,211,238,0.18)', color: '#22d3ee' }
                        : { color: 'var(--text-300)', border: '1px solid transparent' }}
                      onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--text-200)' }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--text-300)' }}
                    >
                      {item.icon}
                      <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: active ? 600 : 500, fontSize: '0.875rem' }}>
                        {item.label}
                      </span>
                      {active && (
                        <span className="ml-auto w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: 'var(--cyan)', boxShadow: '0 0 8px var(--cyan)' }} />
                      )}
                    </button>
                  )
                })}
              </nav>

              {/* Divider */}
              <div className="mx-4 mt-3 mb-4" style={{ height: '1px', background: 'linear-gradient(90deg, transparent, var(--glass-border), transparent)' }} />

              {/* User */}
              <div className="px-4 pb-5">
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div className="relative group shrink-0 cursor-pointer" onClick={() => avatarRef.current?.click()} title="Profilbild ändern">
                    <div className="w-9 h-9 rounded-xl overflow-hidden"
                      style={{ border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 0 0 0 transparent', transition: 'box-shadow 0.2s' }}
                      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 0 0 2px rgba(34,211,238,0.4)')}
                      onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 0 0 0 transparent')}>
                      {avatar
                        ? <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center"
                            style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                            <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, color: 'white', fontSize: '0.875rem', textTransform: 'uppercase' }}>
                              {auth.username?.charAt(0) ?? '?'}
                            </span>
                          </div>
                      }
                    </div>
                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: 'rgba(9,13,32,0.9)', border: '1px solid var(--glass-border)' }}>
                      <Camera className="w-2.5 h-2.5" style={{ color: 'var(--cyan)' }} />
                    </div>
                    <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p style={{ fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-100)', textTransform: 'capitalize' }} className="truncate">
                      {auth.username}
                    </p>
                    <p style={{ fontSize: '0.6875rem', color: 'var(--text-400)' }}>Benutzer</p>
                  </div>

                  <button onClick={logout} title="Abmelden"
                    className="p-1.5 rounded-lg shrink-0 transition-colors"
                    style={{ color: 'var(--text-400)' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-200)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-400)')}>
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </aside>

            {/* Main */}
            <main className="shell-main">
              <div className="px-8 py-7" style={{ minHeight: '100%' }}>
                {/* Page header */}
                <div className="mb-7 fade-up">
                  <h1 style={{
                    fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '1.625rem',
                    letterSpacing: '-0.02em', color: 'var(--text-100)', lineHeight: 1.1
                  }}>{title}</h1>
                  <p style={{ fontSize: '0.8125rem', color: 'var(--text-300)', marginTop: '0.2rem' }}>{sub}</p>
                </div>

                {/* Pages — all mounted, inactive hidden */}
                <div className={page !== 'dashboard' ? 'hidden' : 'fade-up stagger-2'}><Dashboard /></div>
                <div className={page !== 'history'   ? 'hidden' : 'fade-up stagger-2'}><History /></div>
                <div className={page !== 'files'     ? 'hidden' : 'fade-up stagger-2'}><FileManager /></div>
              </div>
            </main>

          </div>{/* /app-shell */}
        </div>{/* /app-stage */}

      </UploadProvider>
    </QueryClientProvider>
  )
}
