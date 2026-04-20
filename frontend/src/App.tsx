import { useRef, useState, useEffect, useCallback } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LayoutDashboard, History as HistoryIcon, FolderOpen, LogOut, Camera, FileArchive, FileText, File, Image, Database } from 'lucide-react'
import { Dashboard } from './components/Dashboard'
import { History } from './components/History'
import { FileManager } from './components/FileManager'
import { LoginPage } from './components/LoginPage'
import { MailDraftModal } from './components/MailDraftModal'
import { useAuth, getStoredAuth } from './hooks/useAuth'
import { UploadProvider } from './contexts/UploadContext'
import type { MailDraft, FileCategory } from './types'
import type { BatchBuilderHandle } from './components/BatchBuilder'

const APP_VERSION = '1.4'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
})

type Page = 'dashboard' | 'history' | 'files'

const NAV = [
  { id: 'dashboard' as Page, label: 'Dashboard', icon: <LayoutDashboard className="w-[17px] h-[17px]" /> },
  { id: 'history'   as Page, label: 'Historie',  icon: <HistoryIcon     className="w-[17px] h-[17px]" /> },
  { id: 'files'     as Page, label: 'Dateien',   icon: <FolderOpen      className="w-[17px] h-[17px]" /> },
]

const FILE_TABS: { key: FileCategory; label: string; icon: React.ReactNode }[] = [
  { key: 'zips',     label: 'ZIPs',      icon: <FileArchive className="w-3.5 h-3.5" /> },
  { key: 'toc',      label: 'TOC',       icon: <FileText    className="w-3.5 h-3.5" /> },
  { key: 'pdf',      label: 'PDFs',      icon: <File        className="w-3.5 h-3.5" /> },
  { key: 'covers',   label: 'Cover',     icon: <Image       className="w-3.5 h-3.5" /> },
  { key: 'metadata', label: 'Metadaten', icon: <Database    className="w-3.5 h-3.5" /> },
]

const PAGE_TITLES: Record<Page, { title: string; sub: string }> = {
  dashboard: { title: 'Dashboard',   sub: 'Auslieferungen starten & überwachen' },
  history:   { title: 'Historie',    sub: 'Vollständiger Verlauf aller Auslieferungen' },
  files:     { title: 'Dateiverwaltung', sub: 'ZIPs, Metadaten, Covers auf dem Server' },
}

/** Resize image to max 256×256 via canvas before storing (keeps DB size small). */
function resizeAvatar(dataUrl: string): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const size = 256
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const ctx = canvas.getContext('2d')!
      const scale = Math.min(size / img.width, size / img.height)
      const w = img.width * scale, h = img.height * scale
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.src = dataUrl
  })
}

function useAvatar(username: string | null) {
  const [avatar, setAvatarState] = useState<string | null>(() => localStorage.getItem('dav_avatar'))

  // Sync from server whenever the user logs in
  useEffect(() => {
    if (!username) return
    const { token } = getStoredAuth()
    fetch('/api/users/me/avatar', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.avatar_data) {
          localStorage.setItem('dav_avatar', data.avatar_data)
          setAvatarState(data.avatar_data)
        }
      })
      .catch(() => {})
  }, [username])

  const set = async (dataUrl: string) => {
    const resized = await resizeAvatar(dataUrl)
    localStorage.setItem('dav_avatar', resized)
    setAvatarState(resized)
    // Persist to server so all devices see the same avatar
    const { token } = getStoredAuth()
    fetch('/api/users/me/avatar', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ avatar_data: resized }),
    }).catch(() => {})
  }

  return { avatar, set }
}

export function App() {
  const { auth, login, logout } = useAuth()
  const [page, setPage] = useState<Page>('dashboard')
  const [fileTab, setFileTab] = useState<FileCategory>('zips')
  const { avatar, set: setAvatar } = useAvatar(auth.username)
  const [mailDraft, setMailDraft] = useState<{ runId: string; draft: MailDraft; portalName: string } | null>(null)
  const batchBuilderRef = useRef<BatchBuilderHandle>(null)

  const handleMailDraft = useCallback((runId: string, draft: MailDraft, portalName: string) => {
    setMailDraft({ runId, draft, portalName })
  }, [])

  const handleUseForDelivery = useCallback((filename: string) => {
    setPage('dashboard')
    setTimeout(() => batchBuilderRef.current?.addServerFile(filename), 50)
  }, [])

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

          {/* ── Mail Draft Modal — rendered at root level so it shows on any page ── */}
          {mailDraft && (
            <MailDraftModal
              runId={mailDraft.runId}
              draft={mailDraft.draft}
              portalName={mailDraft.portalName}
              onClose={() => setMailDraft(null)}
            />
          )}

          {/* ── Floating App Shell ─────────────────────── */}
          <div className="app-shell">

            {/* Sidebar */}
            <aside className="shell-sidebar">

              {/* Logo — vertical brand block */}
              <div className="px-5 pt-7 pb-5">
                <img src="/logo.png" alt="DAV" className="w-10 h-10 object-contain mb-3" />
                <p style={{ fontFamily: 'Manrope, sans-serif', fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-100)', letterSpacing: '-0.01em', lineHeight: 1.2 }}>
                  Der Audio Verlag
                </p>
                <p style={{ fontSize: '0.6875rem', color: 'var(--text-400)', letterSpacing: '0.05em', marginTop: '0.2rem' }}>
                  Digital Distribution
                </p>
              </div>

              {/* Divider */}
              <div className="mx-4 mb-5" style={{ height: '1px', background: 'linear-gradient(90deg, transparent, var(--glass-border), transparent)' }} />

              {/* Nav */}
              <nav className="flex-1 px-3 space-y-1">
                {NAV.map((item, i) => {
                  const active = page === item.id
                  return (
                    <div key={item.id}>
                      <button
                        onClick={() => setPage(item.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150 fade-up stagger-${Math.min(i + 1, 4)}`}
                        style={active
                          ? { background: '#6d28d9', border: '1px solid #7c3aed', color: '#ffffff' }
                          : { color: 'var(--text-300)', border: '1px solid transparent' }}
                        onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'rgba(109,40,217,0.15)'; e.currentTarget.style.color = 'var(--text-100)' } }}
                        onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-300)' } }}
                      >
                        {item.icon}
                        <span style={{ fontFamily: 'Manrope, sans-serif', fontWeight: active ? 600 : 500, fontSize: '0.875rem' }}>
                          {item.label}
                        </span>
                        {active && (
                          <span className="ml-auto w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ background: 'rgba(255,255,255,0.7)' }} />
                        )}
                      </button>

                      {/* File sub-tabs — always visible under Dateien */}
                      {item.id === 'files' && (
                        <div className="ml-3 mt-0.5 space-y-0.5 pl-3"
                          style={{ borderLeft: '1px solid rgba(255,255,255,0.08)' }}>
                          {FILE_TABS.map(tab => {
                            const tabActive = page === 'files' && fileTab === tab.key
                            return (
                              <button
                                key={tab.key}
                                onClick={() => { setPage('files'); setFileTab(tab.key) }}
                                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-all duration-150"
                                style={tabActive
                                  ? { background: 'rgba(109,40,217,0.35)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.4)' }
                                  : { color: 'var(--text-400)', border: '1px solid transparent' }}
                                onMouseEnter={e => { if (!tabActive) { e.currentTarget.style.background = 'rgba(109,40,217,0.12)'; e.currentTarget.style.color = 'var(--text-200)' } }}
                                onMouseLeave={e => { if (!tabActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-400)' } }}
                              >
                                {tab.icon}
                                <span style={{ fontSize: '0.8125rem', fontWeight: tabActive ? 600 : 400 }}>{tab.label}</span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
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
                            <span style={{ fontFamily: 'Manrope, sans-serif', fontWeight: 700, color: 'white', fontSize: '0.875rem', textTransform: 'uppercase' }}>
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
                    <p style={{ fontFamily: 'Manrope, sans-serif', fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-100)', textTransform: 'capitalize' }} className="truncate">
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

              {/* Version */}
              <div className="px-5 pb-4 text-center">
                <span style={{ fontSize: '0.625rem', color: 'var(--text-400)', letterSpacing: '0.06em' }}>
                  v{APP_VERSION}
                </span>
              </div>
            </aside>

            {/* Main */}
            <main className="shell-main">
              <div className="px-8 py-7" style={{ minHeight: '100%' }}>
                {/* Page header */}
                <div className="mb-7 fade-up">
                  <h1 style={{
                    fontFamily: 'Manrope, sans-serif', fontWeight: 800, fontSize: '1.625rem',
                    letterSpacing: '-0.02em', color: 'var(--text-100)', lineHeight: 1.1
                  }}>{title}</h1>
                  <p style={{ fontSize: '0.8125rem', color: 'var(--text-300)', marginTop: '0.2rem' }}>{sub}</p>
                </div>

                {/* Pages — all mounted, inactive hidden */}
                <div className={page !== 'dashboard' ? 'hidden' : 'fade-up stagger-2'}><Dashboard onMailDraft={handleMailDraft} batchBuilderRef={batchBuilderRef} /></div>
                <div className={page !== 'history'   ? 'hidden' : 'fade-up stagger-2'}><History /></div>
                <div className={page !== 'files'     ? 'hidden' : 'fade-up stagger-2'}><FileManager onUseForDelivery={handleUseForDelivery} activeTab={fileTab} onTabChange={setFileTab} /></div>
              </div>
            </main>

          </div>{/* /app-shell */}
        </div>{/* /app-stage */}

      </UploadProvider>
    </QueryClientProvider>
  )
}
