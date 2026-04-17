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

const NAV_ITEMS: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard',    icon: <LayoutDashboard className="w-[18px] h-[18px]" /> },
  { id: 'history',   label: 'Historie',     icon: <HistoryIcon     className="w-[18px] h-[18px]" /> },
  { id: 'files',     label: 'Dateien',      icon: <FolderOpen      className="w-[18px] h-[18px]" /> },
]

// Persist avatar in localStorage
function useAvatar() {
  const [avatar, setAvatarState] = useState<string | null>(
    () => localStorage.getItem('dav_avatar')
  )
  const setAvatar = (dataUrl: string) => {
    localStorage.setItem('dav_avatar', dataUrl)
    setAvatarState(dataUrl)
  }
  return { avatar, setAvatar }
}

export function App() {
  const { auth, login, logout } = useAuth()
  const [page, setPage] = useState<Page>('dashboard')
  const { avatar, setAvatar } = useAvatar()
  const avatarInputRef = useRef<HTMLInputElement>(null)

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setAvatar(reader.result as string)
    reader.readAsDataURL(file)
  }

  if (!auth.token) {
    return <LoginPage onLogin={login} />
  }

  return (
    <QueryClientProvider client={queryClient}>
      <UploadProvider>
        <div className="app-bg">
          <div className="vignette" />

          <div className="relative z-10 flex min-h-screen">
            {/* ── Sidebar ─────────────────────────────────────── */}
            <aside className="glass-sidebar w-56 flex-shrink-0 flex flex-col h-screen sticky top-0 z-20">

              {/* Logo */}
              <div className="px-5 pt-6 pb-5">
                <div className="flex items-center gap-3">
                  {/* DAV logo mark */}
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: 'linear-gradient(135deg,#e8002d,#b50024)' }}>
                    <span className="text-white font-bold text-xs tracking-wide leading-none">DAV</span>
                  </div>
                  <div>
                    <p className="font-semibold text-white/90 text-sm leading-tight">Distro</p>
                    <p className="text-white/35 text-[10px] leading-tight">Audio Distribution</p>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="mx-4 mb-4" style={{ height: '1px', background: 'var(--glass-border)' }} />

              {/* Nav label */}
              <p className="section-label px-5 mb-2">Navigation</p>

              {/* Nav items */}
              <nav className="flex-1 px-3 space-y-1">
                {NAV_ITEMS.map(item => (
                  <button
                    key={item.id}
                    onClick={() => setPage(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                      page === item.id
                        ? 'nav-active'
                        : 'text-white/50 hover:text-white/80 hover:bg-white/[0.05]'
                    }`}
                  >
                    {item.icon}
                    {item.label}
                    {page === item.id && (
                      <span className="ml-auto w-1 h-1 rounded-full bg-accent" />
                    )}
                  </button>
                ))}
              </nav>

              {/* Divider */}
              <div className="mx-4 mt-4" style={{ height: '1px', background: 'var(--glass-border)' }} />

              {/* User profile */}
              <div className="p-4">
                <div className="flex items-center gap-3">
                  {/* Avatar — click to change */}
                  <div className="relative group shrink-0">
                    <div
                      onClick={() => avatarInputRef.current?.click()}
                      className="w-9 h-9 rounded-xl overflow-hidden cursor-pointer ring-1 ring-white/15 hover:ring-accent/50 transition-all"
                      title="Profilbild ändern"
                    >
                      {avatar ? (
                        <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"
                          style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                          <span className="text-white font-semibold text-sm uppercase">
                            {auth.username?.charAt(0) ?? '?'}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-night/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      onClick={() => avatarInputRef.current?.click()}>
                      <Camera className="w-2 h-2 text-white/70" />
                    </div>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarChange}
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-white/80 text-sm font-medium capitalize truncate">{auth.username}</p>
                    <p className="text-white/35 text-xs">Benutzer</p>
                  </div>

                  <button
                    onClick={logout}
                    title="Abmelden"
                    className="p-1.5 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-colors shrink-0"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </aside>

            {/* ── Main ────────────────────────────────────────── */}
            <main className="flex-1 min-h-screen overflow-y-auto">
              <div className="max-w-6xl mx-auto px-6 py-7">
                {/* Page header */}
                <div className="mb-6">
                  <h1 className="text-2xl font-semibold text-white/90">
                    {NAV_ITEMS.find(n => n.id === page)?.label}
                  </h1>
                  <p className="text-white/40 text-sm mt-0.5">
                    {page === 'dashboard' && 'Auslieferungen vorbereiten und überwachen'}
                    {page === 'history'   && 'Verlauf aller Auslieferungen'}
                    {page === 'files'     && 'Dateien auf dem Server verwalten'}
                  </p>
                </div>

                {/* All pages stay mounted — CSS hides inactive ones */}
                <div className={page !== 'dashboard' ? 'hidden' : 'fade-in'}><Dashboard /></div>
                <div className={page !== 'history'   ? 'hidden' : 'fade-in'}><History /></div>
                <div className={page !== 'files'     ? 'hidden' : 'fade-in'}><FileManager /></div>
              </div>
            </main>
          </div>
        </div>
      </UploadProvider>
    </QueryClientProvider>
  )
}
