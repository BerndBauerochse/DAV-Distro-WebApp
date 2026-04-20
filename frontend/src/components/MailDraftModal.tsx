import { useState } from 'react'
import { Mail, X, Paperclip, ExternalLink, Loader2 } from 'lucide-react'
import { getStoredAuth } from '../hooks/useAuth'
import type { MailDraft } from '../types'

interface Props {
  runId: string
  draft: MailDraft
  portalName: string
  onClose: () => void
}

export function MailDraftModal({ runId, draft, portalName, onClose }: Props) {
  const [attachmentError, setAttachmentError] = useState('')
  const [loading, setLoading] = useState(false)

  async function openAsEml() {
    setLoading(true)
    setAttachmentError('')
    try {
    let eml: string

    if (draft.attachment) {
      // Fetch attachment and embed as base64 in multipart EML
      const { token } = getStoredAuth()
      const res = await fetch(draft.attachment.download_url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        setAttachmentError('Anhang konnte nicht geladen werden.')
        return
      }
      const buf = await res.arrayBuffer()
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
      const boundary = `----=_Part_${Date.now()}`
      const bodyType = draft.is_html ? 'text/html' : 'text/plain'
      // Base64-encode body so umlauts and special chars survive MIME encoding
      const bodyBytes = new TextEncoder().encode(draft.body)
      const bodyB64 = btoa(String.fromCharCode(...bodyBytes)).match(/.{1,76}/g)!.join('\r\n')

      eml = [
        'MIME-Version: 1.0',
        'X-Unsent: 1',
        `To: ${draft.to}`,
        `Subject: ${draft.subject}`,
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        `Content-Type: ${bodyType}; charset=utf-8`,
        'Content-Transfer-Encoding: base64',
        '',
        bodyB64,
        '',
        `--${boundary}`,
        'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${draft.attachment.filename}"`,
        '',
        b64.match(/.{1,76}/g)!.join('\r\n'),
        '',
        `--${boundary}--`,
      ].join('\r\n')
    } else {
      // Simple single-part EML
      const bodyType = draft.is_html ? 'text/html' : 'text/plain'
      eml = [
        'MIME-Version: 1.0',
        'X-Unsent: 1',
        `To: ${draft.to}`,
        `Subject: ${draft.subject}`,
        `Content-Type: ${bodyType}; charset=utf-8`,
        '',
        draft.body,
      ].join('\r\n')
    }

    const blob = new Blob([eml], { type: 'message/rfc822' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${portalName.toLowerCase()}-mail.eml`
    a.click()
    URL.revokeObjectURL(url)
    } catch {
      setAttachmentError('EML konnte nicht erstellt werden.')
    } finally {
      setLoading(false)
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
              <div className="text-sm max-h-40 overflow-y-auto"
                style={{ color: 'var(--text-200)' }}
                dangerouslySetInnerHTML={{ __html: draft.body }} />
            ) : (
              <pre className="text-sm whitespace-pre-wrap max-h-40 overflow-y-auto"
                style={{ color: 'var(--text-200)', fontFamily: 'inherit' }}>
                {draft.body}
              </pre>
            )}
          </div>

          {/* Attachment info */}
          {draft.attachment && (
            <div className="rounded-xl p-3 flex items-center gap-2"
              style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.25)' }}>
              <Paperclip className="w-4 h-4 flex-shrink-0" style={{ color: '#fbbf24' }} />
              <div>
                <p className="text-xs font-medium" style={{ color: '#fbbf24' }}>Anhang wird eingebettet</p>
                <p className="text-xs" style={{ color: 'var(--text-300)' }}>{draft.attachment.filename} ist in der EML enthalten</p>
              </div>
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
          <button onClick={openAsEml} disabled={loading}
            className="btn-accent flex items-center gap-2 px-5 py-2 text-sm"
            style={loading ? { opacity: 0.7, cursor: 'wait' } : {}}>
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" />Laden…</>
              : <><ExternalLink className="w-4 h-4" />In Outlook öffnen</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}
