import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Mail, X, Paperclip, ExternalLink, Loader2, Inbox, Check } from 'lucide-react'
import { getStoredAuth } from '../hooks/useAuth'
import { api } from '../api/client'
import type { MailDraft } from '../types'

interface Props {
  runId: string
  draft: MailDraft
  portalName: string
  queueCount?: number
  onClose: () => void
}

/**
 * Quoted-Printable-Kodierung (RFC 2045) auf UTF-8-Basis.
 * Harte Zeilenumbrüche werden als CRLF erhalten, Nicht-ASCII (Umlaute) als =XX
 * kodiert, Zeilen auf max. 76 Zeichen mit Soft-Breaks (=) umgebrochen.
 */
/**
 * Outlook übernimmt beim Öffnen von .eml-Entwürfen (X-Unsent) nur HTML-Bodies
 * zuverlässig — Klartext-Teile gehen verloren (beobachtet bei Zebra- und
 * Update-Mails). Daher wird JEDER Body als HTML eingebettet; Klartext wird
 * hier in schlichtes HTML umgewandelt (escaped, Zeilenumbrüche → <br>).
 */
function toHtmlBody(body: string, isHtml: boolean | undefined): string {
  if (isHtml) return body
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return (
    '<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000000;">'
    + escaped.replace(/\r?\n/g, '<br>')
    + '</div>'
  )
}

export function MailDraftModal({ runId, draft, portalName, queueCount = 1, onClose }: Props) {
  const [attachmentError, setAttachmentError] = useState('')
  const [loading, setLoading] = useState(false)
  const [outlookState, setOutlookState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [outlookError, setOutlookError] = useState('')
  const [webLink, setWebLink] = useState<string | null>(null)

  // Bearbeitbare Entwurfsfelder — vorbefüllt aus dem generierten Entwurf.
  const [to, setTo] = useState(draft.to)
  const [bcc, setBcc] = useState(draft.bcc ?? '')
  const [subject, setSubject] = useState(draft.subject)
  const [textBody, setTextBody] = useState(draft.is_html ? '' : draft.body)
  // HTML-Bodies (z. B. Audible-Tabellen) werden direkt im gerenderten Zustand
  // bearbeitet (contentEditable); gelesen wird beim Senden aus dem DOM.
  const htmlBodyRef = useRef<HTMLDivElement>(null)

  // Wenn der nächste Entwurf aus der Queue nachrückt: Felder + Status zurücksetzen
  useEffect(() => {
    setTo(draft.to)
    setBcc(draft.bcc ?? '')
    setSubject(draft.subject)
    setTextBody(draft.is_html ? '' : draft.body)
    if (draft.is_html && htmlBodyRef.current) {
      htmlBodyRef.current.innerHTML = draft.body
    }
    setOutlookState('idle')
    setOutlookError('')
    setWebLink(null)
    setAttachmentError('')
  }, [draft])

  function currentBody(): string {
    return draft.is_html ? (htmlBodyRef.current?.innerHTML ?? draft.body) : textBody
  }

  const sendDisabled = !to.trim() || !subject.trim()

  // Ist die Outlook-365-Übergabe auf dem Server eingerichtet?
  const { data: outlookStatus } = useQuery({
    queryKey: ['outlook-status'],
    queryFn: () => api.outlookStatus(),
    staleTime: 5 * 60 * 1000,
  })

  async function sendToOutlook() {
    setOutlookState('loading')
    setOutlookError('')
    try {
      const res = await api.createOutlookDraft({
        to,
        subject,
        body: currentBody(),
        is_html: draft.is_html,
        bcc: bcc.trim() || null,
        run_id: runId,
        with_attachment: !!draft.attachment,
      })
      setWebLink(res.web_link)
      setOutlookState('done')
    } catch (e) {
      setOutlookState('idle')
      const msg = e instanceof Error ? e.message : 'Unbekannter Fehler'
      // Server-Detail aus "502 {...detail...}" herausziehen, sonst Rohtext
      const m = msg.match(/"detail"\s*:\s*"([^"]+)"/)
      setOutlookError(m ? m[1] : msg)
    }
  }

  async function openAsEml() {
    setLoading(true)
    setAttachmentError('')
    try {
    // Body immer als HTML einbetten — der einzige Pfad, den Outlook beim
    // Öffnen von X-Unsent-Entwürfen nachweislich zuverlässig übernimmt.
    const htmlBody = toHtmlBody(currentBody(), draft.is_html)
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
      // Read attachment in chunks to avoid call-stack overflow on large files
      const bytes = new Uint8Array(await res.arrayBuffer())
      let binary = ''
      const CHUNK = 0x8000
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
      }
      const b64 = btoa(binary)
      const boundary = `----=_Part_${Date.now()}`

      eml = [
        'MIME-Version: 1.0',
        'X-Unsent: 1',
        `To: ${to}`,
        ...(bcc.trim() ? [`Bcc: ${bcc}`] : []),
        `Subject: ${subject}`,
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset=utf-8',
        '',
        htmlBody,
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
      // Single-part EML (identisch zum von Anfang an funktionierenden
      // Audible-HTML-Pfad: Body inline, ohne Transfer-Kodierung)
      eml = [
        'MIME-Version: 1.0',
        'X-Unsent: 1',
        `To: ${to}`,
        ...(bcc.trim() ? [`Bcc: ${bcc}`] : []),
        `Subject: ${subject}`,
        'Content-Type: text/html; charset=utf-8',
        '',
        htmlBody,
      ].join('\r\n')
    }

    // Sicherstellen, dass das gesamte EML konsequent CRLF nutzt
    eml = eml.replace(/\r?\n/g, '\r\n')

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
                {queueCount > 1
                  ? `Auslieferung abgeschlossen · noch ${queueCount - 1} weitere${queueCount - 1 > 1 ? '' : ''} ausstehend`
                  : 'Auslieferung abgeschlossen'}
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

        {/* Mail-Felder — bearbeitbar vor der Übergabe */}
        <div className="px-6 py-5 space-y-3">
          <div className="space-y-1">
            <p className="text-xs" style={{ color: 'var(--text-300)' }}>An</p>
            <input type="text" value={to} onChange={e => setTo(e.target.value)}
              className="glass-input w-full text-sm" placeholder="empfaenger@portal.de" />
          </div>
          <div className="space-y-1">
            <p className="text-xs" style={{ color: 'var(--text-300)' }}>Bcc (optional)</p>
            <input type="text" value={bcc} onChange={e => setBcc(e.target.value)}
              className="glass-input w-full text-sm" placeholder="" />
          </div>
          <div className="space-y-1">
            <p className="text-xs" style={{ color: 'var(--text-300)' }}>Betreff</p>
            <input type="text" value={subject} onChange={e => setSubject(e.target.value)}
              className="glass-input w-full text-sm" />
          </div>

          {/* Inhalt — bearbeitbar (HTML direkt im gerenderten Zustand) */}
          <div className="space-y-1">
            <p className="text-xs" style={{ color: 'var(--text-300)' }}>Inhalt (bearbeitbar)</p>
            {draft.is_html ? (
              <div ref={htmlBodyRef} contentEditable suppressContentEditableWarning
                className="glass-input w-full text-sm max-h-48 overflow-y-auto"
                style={{ color: 'var(--text-200)', minHeight: '6rem' }}
                dangerouslySetInnerHTML={{ __html: draft.body }} />
            ) : (
              <textarea value={textBody} onChange={e => setTextBody(e.target.value)}
                rows={7}
                className="glass-input w-full text-sm max-h-48"
                style={{ color: 'var(--text-200)', fontFamily: 'inherit', resize: 'vertical' }} />
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

          {/* Outlook-Übergabe: Erfolg / Fehler */}
          {outlookState === 'done' && (
            <div className="rounded-xl p-3 flex items-center gap-2"
              style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)' }}>
              <Check className="w-4 h-4 flex-shrink-0" style={{ color: '#4ade80' }} />
              <div>
                <p className="text-xs font-medium" style={{ color: '#4ade80' }}>
                  Entwurf liegt im Postfach{outlookStatus?.mailbox ? ` (${outlookStatus.mailbox})` : ''}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-300)' }}>
                  Zum Prüfen und Absenden in Outlook öffnen.
                  {webLink && <> <a href={webLink} target="_blank" rel="noreferrer"
                    style={{ color: '#4ade80', textDecoration: 'underline' }}>Direkt öffnen</a></>}
                </p>
              </div>
            </div>
          )}
          {outlookError && (
            <p className="text-xs" style={{ color: '#f87171' }}>{outlookError}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex items-center justify-end gap-3"
          style={{ borderTop: '1px solid var(--glass-border)' }}>
          <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm">
            {queueCount > 1 ? 'Nächste' : 'Schließen'}
          </button>
          <button onClick={openAsEml} disabled={loading || sendDisabled}
            className={outlookStatus?.configured ? 'btn-ghost flex items-center gap-2 px-4 py-2 text-sm' : 'btn-accent flex items-center gap-2 px-5 py-2 text-sm'}
            style={loading || sendDisabled ? { opacity: 0.6, cursor: loading ? 'wait' : 'not-allowed' } : {}}>
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" />Laden…</>
              : <><ExternalLink className="w-4 h-4" />Als EML öffnen</>
            }
          </button>
          {outlookStatus?.configured && (
            <button onClick={sendToOutlook} disabled={outlookState !== 'idle' || sendDisabled}
              className="btn-accent flex items-center gap-2 px-5 py-2 text-sm"
              style={outlookState !== 'idle' || sendDisabled ? { opacity: 0.6, cursor: outlookState === 'loading' ? 'wait' : 'not-allowed' } : {}}>
              {outlookState === 'loading'
                ? <><Loader2 className="w-4 h-4 animate-spin" />Übergeben…</>
                : outlookState === 'done'
                  ? <><Check className="w-4 h-4" />Im Postfach</>
                  : <><Inbox className="w-4 h-4" />In Outlook ablegen</>
              }
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
