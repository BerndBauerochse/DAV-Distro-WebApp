import { useState } from 'react'
import { Mail, X, Paperclip, Copy, Check, ExternalLink } from 'lucide-react'
import { getStoredAuth } from '../hooks/useAuth'
import type { MailDraft } from '../types'

interface Props {
  runId: string
  draft: MailDraft
  portalName: string
  onClose: () => void
}

export function MailDraftModal({ runId, draft, portalName, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const [attachmentError, setAttachmentError] = useState('')

  function htmlToPlainText(html: string): string {
    return html
      // Block elements → newlines before stripping
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      // Table rows → newline after each row
      .replace(/<\/tr>/gi, '\n')
      // Table cells/headers → tab separator (produces readable columns)
      .replace(/<\/th>/gi, '\t')
      .replace(/<\/td>/gi, '\t')
      // Strip all remaining tags
      .replace(/<[^>]+>/g, '')
      // Decode HTML entities
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      // Clean up trailing tabs on each line
      .replace(/\t+\n/g, '\n')
      // Collapse 3+ blank lines to 2
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  function buildMailtoLink() {
    const to = encodeURIComponent(draft.to)
    const subject = encodeURIComponent(draft.subject)
    const plainBody = draft.is_html ? htmlToPlainText(draft.body) : draft.body
    const body = encodeURIComponent(plainBody)
    return `mailto:${to}?subject=${subject}&body=${body}`
  }

  async function copyBody() {
    try {
      const text = draft.is_html ? htmlToPlainText(draft.body) : draft.body
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  async function downloadAttachment() {
    if (!draft.attachment) return
    setAttachmentError('')
    try {
      const { token } = getStoredAuth()
      const res = await fetch(draft.attachment.download_url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = draft.attachment.filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setAttachmentError('Anhang konnte nicht geladen werden.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}>
      <div className="glass-card w-full max-w-lg overflow-hidden fade-up">

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

        {/* Mail info */}
        <div className="px-6 py-5 space-y-3">
          <div className="rounded-xl p-3 space-y-1"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)' }}>
            <p className="text-xs" style={{ color: 'var(--text-300)' }}>An</p>
            <p className="text-sm" style={{ color: 'var(--text-100)' }}>{draft.to}</p>
          </div>
          <div className="rounded-xl p-3 space-y-1"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)' }}>
            <p className="text-xs" style={{ color: 'var(--text-300)' }}>Betreff</p>
            <p className="text-sm" style={{ color: 'var(--text-100)' }}>{draft.subject}</p>
          </div>

          {/* Body preview */}
          <div className="rounded-xl p-3 space-y-1"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)' }}>
            <p className="text-xs" style={{ color: 'var(--text-300)' }}>Inhalt</p>
            {draft.is_html ? (
              <div className="text-sm max-h-32 overflow-y-auto"
                style={{ color: 'var(--text-200)' }}
                dangerouslySetInnerHTML={{ __html: draft.body }} />
            ) : (
              <pre className="text-sm whitespace-pre-wrap max-h-32 overflow-y-auto"
                style={{ color: 'var(--text-200)', fontFamily: 'inherit' }}>
                {draft.body}
              </pre>
            )}
          </div>

          {/* Attachment hint */}
          {draft.attachment && (
            <div className="rounded-xl p-3 flex items-center justify-between gap-3"
              style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.25)' }}>
              <div className="flex items-center gap-2">
                <Paperclip className="w-4 h-4 flex-shrink-0" style={{ color: '#fbbf24' }} />
                <div>
                  <p className="text-xs font-medium" style={{ color: '#fbbf24' }}>Anhang</p>
                  <p className="text-xs" style={{ color: 'var(--text-300)' }}>{draft.attachment.filename}</p>
                </div>
              </div>
              <button onClick={downloadAttachment}
                className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors flex-shrink-0"
                style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(251,191,36,0.25)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(251,191,36,0.15)')}>
                Herunterladen
              </button>
            </div>
          )}
          {attachmentError && (
            <p className="text-xs" style={{ color: '#f87171' }}>{attachmentError}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex items-center justify-end gap-3"
          style={{ borderTop: '1px solid var(--glass-border)' }}>
          <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm">
            Schließen
          </button>
          <button onClick={copyBody}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-200)', border: '1px solid var(--glass-border)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}>
            {copied ? <Check className="w-4 h-4" style={{ color: '#4ade80' }} /> : <Copy className="w-4 h-4" />}
            {copied ? 'Kopiert!' : 'Text kopieren'}
          </button>
          <a href={buildMailtoLink()}
            className="btn-accent flex items-center gap-2 px-5 py-2 text-sm"
            style={{ textDecoration: 'none' }}>
            <ExternalLink className="w-4 h-4" />
            In Outlook öffnen
          </a>
        </div>
      </div>
    </div>
  )
}
