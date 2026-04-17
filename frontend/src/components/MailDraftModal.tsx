import { useState } from 'react'
import { Mail, X, Download, Loader2 } from 'lucide-react'
import { getStoredAuth } from '../hooks/useAuth'
import type { MailDraft } from '../types'

interface Props {
  runId: string
  draft: MailDraft
  portalName: string
  onClose: () => void
}

export function MailDraftModal({ runId, draft, portalName, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function openEml() {
    setLoading(true)
    setError('')
    try {
      const { token } = getStoredAuth()
      const res = await fetch(`/api/runs/${runId}/mail.eml`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `audible-${runId}.eml`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('EML-Datei konnte nicht geladen werden.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}>
      <div className="glass-card w-full max-w-md overflow-hidden fade-up">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.2)' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.2)' }}>
              <Mail className="w-4 h-4" style={{ color: '#22d3ee' }} />
            </div>
            <div>
              <p className="font-semibold text-sm" style={{ color: 'var(--text-100)' }}>
                Mail-Entwurf – {portalName}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-300)' }}>
                Auslieferung abgeschlossen
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--text-300)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-100)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-300)')}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info */}
        <div className="px-6 py-5 space-y-4">
          <div className="rounded-xl p-4 space-y-1.5"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)' }}>
            <p className="text-xs" style={{ color: 'var(--text-300)' }}>An</p>
            <p className="text-sm" style={{ color: 'var(--text-100)' }}>{draft.to}</p>
          </div>
          <div className="rounded-xl p-4 space-y-1.5"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)' }}>
            <p className="text-xs" style={{ color: 'var(--text-300)' }}>Betreff</p>
            <p className="text-sm" style={{ color: 'var(--text-100)' }}>{draft.subject}</p>
          </div>

          <div className="rounded-xl p-4"
            style={{ background: 'rgba(34,211,238,0.05)', border: '1px solid rgba(34,211,238,0.2)' }}>
            <p className="text-sm" style={{ color: 'var(--text-200)' }}>
              Die E-Mail wird als <strong style={{ color: 'var(--text-100)' }}>.eml-Datei</strong> heruntergeladen
              — einfach doppelklicken und direkt in Outlook senden. Tabelle und Formatierung sind korrekt.
            </p>
          </div>

          {error && (
            <p className="text-sm" style={{ color: '#f87171' }}>{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex items-center justify-end gap-3"
          style={{ borderTop: '1px solid var(--glass-border)' }}>
          <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm">
            Schließen
          </button>
          <button onClick={openEml} disabled={loading} className="btn-accent flex items-center gap-2 px-5 py-2">
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Download className="w-4 h-4" />
            }
            {loading ? 'Lädt…' : 'Als .eml öffnen'}
          </button>
        </div>
      </div>
    </div>
  )
}
