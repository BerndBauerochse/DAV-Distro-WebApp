import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LayoutDashboard, History as HistoryIcon, Package } from 'lucide-react'
import { clsx } from 'clsx'
import { Dashboard } from './components/Dashboard'
import { History } from './components/History'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 1 },
  },
})

type Page = 'dashboard' | 'history'

export function App() {
  const [page, setPage] = useState<Page>('dashboard')

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-gray-100 flex flex-col">
        {/* Top nav */}
        <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Package className="w-6 h-6 text-blue-600" />
              <span className="font-bold text-gray-900 text-base tracking-tight">DAV Distro</span>
              <span className="text-gray-300">|</span>
              <span className="text-xs text-gray-400">Audio Distribution</span>
            </div>

            <nav className="flex items-center gap-1">
              <NavButton
                active={page === 'dashboard'}
                onClick={() => setPage('dashboard')}
                icon={<LayoutDashboard className="w-4 h-4" />}
                label="Dashboard"
              />
              <NavButton
                active={page === 'history'}
                onClick={() => setPage('history')}
                icon={<HistoryIcon className="w-4 h-4" />}
                label="Historie"
              />
            </nav>
          </div>
        </header>

        {/* Main */}
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
          {page === 'dashboard' && <Dashboard />}
          {page === 'history' && <History />}
        </main>
      </div>
    </QueryClientProvider>
  )
}

function NavButton({
  active, onClick, icon, label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
        active
          ? 'bg-blue-50 text-blue-700'
          : 'text-gray-600 hover:bg-gray-100'
      )}
    >
      {icon}
      {label}
    </button>
  )
}
