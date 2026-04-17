import { useState } from 'react'
import { Mail, X, Copy, Check } from 'lucide-react'
import type { MailDraft } from '../types'

interface Props {
  draft: MailDraft
  portalName: string
  onClose: () => void
}

export function MailDraftModal({ draft, portalName, onClose }: Props) {
  const [copied, setCopied] = useState<'to' | 'subject' | 'body' | null>(null)

  const copy = (field: 'to' | 'subject' | 'body', value: string) => {
    navigator.clipboard.writeText(value)
    setCopied(field)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-blue-50">
          <div className="flex items-center gap-3">
            <Mail className="w-5 h-5 text-blue-600" />
            <div>
              <p className="font-semibold text-gray-900">Mail-Entwurf – {portalName}</p>
              <p className="text-xs text-gray-500">Auslieferung abgeschlossen · Bitte Mail prüfen und in Outlook senden</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Fields */}
        <div className="px-6 py-5 space-y-4">
          {/* To */}
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">An</label>
            <div className="mt-1 flex items-start gap-2">
              <div className="flex-1 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-800 font-mono break-all">
                {draft.to}
              </div>
              <button
                onClick={() => copy('to', draft.to)}
                className="shrink-0 p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                title="Kopieren"
              >
                {copied === 'to' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Subject */}
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Betreff</label>
            <div className="mt-1 flex items-start gap-2">
              <div className="flex-1 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-800">
                {draft.subject}
              </div>
              <button
                onClick={() => copy('subject', draft.subject)}
                className="shrink-0 p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                title="Kopieren"
              >
                {copied === 'subject' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Body */}
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Nachricht</label>
            <div className="mt-1 flex items-start gap-2">
              <div className="flex-1 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-800 max-h-64 overflow-y-auto">
                {draft.is_html ? (
                  <div dangerouslySetInnerHTML={{ __html: draft.body }} />
                ) : (
                  <pre className="whitespace-pre-wrap font-sans">{draft.body}</pre>
                )}
              </div>
              <button
                onClick={() => copy('body', draft.body)}
                className="shrink-0 p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                title="Kopieren"
              >
                {copied === 'body' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  )
}
