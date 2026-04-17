import { useState } from 'react'
import { Mail, X, Copy, Check, Paperclip, Download } from 'lucide-react'
import { api } from '../api/client'
import type { MailDraft } from '../types'

interface Props {
  draft: MailDraft
  portalName: string
  onClose: () => void
}

export function MailDraftModal({ draft, portalName, onClose }: Props) {
  const [copied, setCopied] = useState<'to' | 'subject' | 'body' | null>(null)
  const [downloading, setDownloading] = useState(false)

  function copy(field: 'to' | 'subject' | 'body', value: string) {
    navigator.clipboard.writeText(value)
    setCopied(field)
    setTimeout(() => setCopied(null), 2000)
  }

  async function downloadAttachment() {
    if (!draft.attachment) return
    setDownloading(true)
    try {
      await api.downloadWithAuth(draft.attachment.download_url, draft.attachment.filename)
    } catch (e) {
      console.error('Anhang-Download fehlgeschlagen', e)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}>
      <div className="glass-card w-full max-w-2xl overflow-hidden fade-in">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.2)' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.2)' }}>
              <Mail className="w-4 h-4" style={{ color: '#22d3ee' }} />
            </div>
            <div>
              <p className="font-semibold text-white/85 text-sm">Mail-Entwurf – {portalName}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Auslieferung abgeschlossen · Bitte Mail prüfen und in Outlook senden
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Fields */}
        <div className="px-6 py-5 space-y-4">
          {[
            { key: 'to' as const, label: 'An', value: draft.to, mono: true },
            { key: 'subject' as const, label: 'Betreff', value: draft.subject, mono: false },
          ].map(({ key, label, value, mono }) => (
            <div key={key}>
              <label className="section-label">{label}</label>
              <div className="mt-1.5 flex items-start gap-2">
                <div className="flex-1 rounded-xl px-3 py-2 text-sm break-all"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid var(--glass-border)',
                    color: 'var(--text-secondary)',
                    fontFamily: mono ? 'monospace' : undefined,
                  }}>
                  {value}
                </div>
                <button onClick={() => copy(key, value)}
                  className="shrink-0 p-2 rounded-lg transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#22d3ee')}
                  onMouseLeave={e => { if (copied !== key) e.currentTarget.style.color = 'var(--text-muted)' }}
                  title="Kopieren">
                  {copied === key
                    ? <Check className="w-4 h-4" style={{ color: '#4ade80' }} />
                    : <Copy  className="w-4 h-4" />
                  }
                </button>
              </div>
            </div>
          ))}

          {/* Body */}
          <div>
            <label className="section-label">Nachricht</label>
            <div className="mt-1.5 flex items-start gap-2">
              <div className="flex-1 rounded-xl px-3 py-2 text-sm max-h-56 overflow-y-auto"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}>
                {draft.is_html
                  ? <div dangerouslySetInnerHTML={{ __html: draft.body }} />
                  : <pre className="whitespace-pre-wrap font-sans">{draft.body}</pre>
                }
              </div>
              <button onClick={() => copy('body', draft.body)}
                className="shrink-0 p-2 rounded-lg transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#22d3ee')}
                onMouseLeave={e => { if (copied !== 'body') e.currentTarget.style.color = 'var(--text-muted)' }}
                title="Kopieren">
                {copied === 'body'
                  ? <Check className="w-4 h-4" style={{ color: '#4ade80' }} />
                  : <Copy  className="w-4 h-4" />
                }
              </button>
            </div>
          </div>
        </div>

        {/* Attachment */}
        {draft.attachment && (
          <div className="px-6 pb-4">
            <label className="section-label">Anhang</label>
            <div className="mt-1.5 flex items-center gap-3 rounded-xl px-3 py-2.5"
              style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
              <Paperclip className="w-4 h-4 shrink-0" style={{ color: '#fbbf24' }} />
              <span className="flex-1 text-sm text-white/70 truncate">{draft.attachment.filename}</span>
              <button onClick={downloadAttachment} disabled={downloading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                style={{ background: 'rgba(251,191,36,0.2)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}>
                <Download className="w-3.5 h-3.5" />
                {downloading ? 'Lädt…' : 'Herunterladen'}
              </button>
            </div>
            <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
              Datei herunterladen und manuell als Anhang in Outlook hinzufügen
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 flex justify-end" style={{ borderTop: '1px solid var(--glass-border)' }}>
          <button onClick={onClose} className="btn-accent px-6 py-2">
            Schließen
          </button>
        </div>
      </div>
    </div>
  )
}
