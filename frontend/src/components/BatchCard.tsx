import { useState } from 'react'
import { CheckCircle2, XCircle, Loader2, Play, Trash2, ChevronDown } from 'lucide-react'
import type { BatchPreview, BookInfo } from '../types'

const PORTAL_COLORS: Record<string, { bg: string; text: string }> = {
  audible:         { bg: 'rgba(251,146,60,0.15)', text: '#fb923c' },
  audible_moa:     { bg: 'rgba(251,146,60,0.15)', text: '#fb923c' },
  audible_fulfill: { bg: 'rgba(251,146,60,0.15)', text: '#fb923c' },
  bookwire:        { bg: 'rgba(96,165,250,0.15)', text: '#60a5fa' },
  bookwire_moa:    { bg: 'rgba(96,165,250,0.15)', text: '#60a5fa' },
  bookbeat:        { bg: 'rgba(167,139,250,0.15)', text: '#a78bfa' },
  spotify:         { bg: 'rgba(74,222,128,0.15)', text: '#4ade80' },
  google:          { bg: 'rgba(250,204,21,0.15)', text: '#facc15' },
  zebra:           { bg: 'rgba(255,255,255,0.08)', text: 'rgba(255,255,255,0.6)' },
  rtl:             { bg: 'rgba(248,113,113,0.15)', text: '#f87171' },
  divibib:         { bg: 'rgba(34,211,238,0.15)', text: '#22d3ee' },
  unknown:         { bg: 'rgba(255,255,255,0.06)', text: 'rgba(255,255,255,0.4)' },
}

interface Props {
  preview: BatchPreview
  onStart: (portal: string) => void
  onRemove: () => void
  isStarting: boolean
}

function AbridgedBadge({ abridged }: { abridged: boolean | null }) {
  if (abridged === null) return null
  return abridged
    ? <span className="text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}>
        Gekürzt
      </span>
    : <span className="text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ background: 'rgba(96,165,250,0.15)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.2)' }}>
        Ungekürzt
      </span>
}

export function BatchCard({ preview, onStart, onRemove, isStarting }: Props) {
  const hasVariants = preview.portal_variants.length > 1
  const [selectedPortal, setSelectedPortal] = useState(
    preview.portal_variants[0]?.key ?? preview.detected_portal
  )

  const missingCount = preview.books.filter(b => !b.zip_available).length
  const totalCount   = preview.books.length
  const colors       = PORTAL_COLORS[selectedPortal] ?? PORTAL_COLORS.unknown
  const selectedLabel = preview.portal_variants.find(v => v.key === selectedPortal)?.label ?? 'Standard'

  return (
    <div className="glass-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.15)' }}>
        <div className="flex items-center gap-3 min-w-0">
          {hasVariants ? (
            <div className="relative">
              <select
                value={selectedPortal}
                onChange={e => setSelectedPortal(e.target.value)}
                className="appearance-none pl-3 pr-6 py-1 rounded-full text-xs font-semibold cursor-pointer outline-none"
                style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.text}30` }}
              >
                {preview.portal_variants.map(v => (
                  <option key={v.key} value={v.key} style={{ background: '#101830' }}>{v.label}</option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-60"
                style={{ color: colors.text }} />
            </div>
          ) : (
            <span className="px-3 py-1 rounded-full text-xs font-semibold"
              style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.text}30` }}>
              {selectedLabel}
            </span>
          )}
          <span className="text-sm text-white/50 truncate">{preview.filename}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {missingCount > 0 && (
            <span className="text-xs font-medium" style={{ color: '#f87171' }}>
              {missingCount} ZIP fehlt{missingCount > 1 ? 'en' : ''}
            </span>
          )}
          <button
            onClick={() => onStart(selectedPortal)}
            disabled={isStarting || totalCount === 0}
            className="btn-accent flex items-center gap-1.5 py-1.5 px-3"
          >
            {isStarting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Starten
          </button>
          <button
            onClick={onRemove}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            title="Entfernen"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Book list */}
      {preview.books.length === 0 ? (
        <p className="px-5 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>Keine Titel gefunden.</p>
      ) : (
        <div>
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 px-5 py-2 section-label"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span>Titel / Autor</span>
            <span className="text-center w-24">Art</span>
            <span className="text-center w-6">ZIP</span>
          </div>

          <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
            {preview.books.map((book: BookInfo) => (
              <div key={book.ean}
                className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-center px-5 py-2.5 glass-row">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white/80 truncate leading-snug">
                    {book.title || '—'}
                  </p>
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                    {book.author || '—'}
                  </p>
                </div>
                <div className="w-24 flex justify-center">
                  <AbridgedBadge abridged={book.abridged} />
                </div>
                <div className="w-6 flex justify-center">
                  {book.zip_available
                    ? <CheckCircle2 className="w-4 h-4" style={{ color: '#4ade80' }} />
                    : <XCircle      className="w-4 h-4" style={{ color: '#f87171' }} />
                  }
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-5 py-2.5 flex items-center justify-between"
        style={{ borderTop: '1px solid rgba(255,255,255,0.04)', background: 'rgba(0,0,0,0.12)' }}>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {totalCount} {totalCount === 1 ? 'Titel' : 'Titel'}
        </span>
        {missingCount === 0 && totalCount > 0 && (
          <span className="text-xs font-medium" style={{ color: '#4ade80' }}>✓ Alle ZIPs vorhanden</span>
        )}
        {missingCount > 0 && (
          <span className="text-xs font-medium" style={{ color: '#f87171' }}>
            {totalCount - missingCount} / {totalCount} ZIPs vorhanden
          </span>
        )}
      </div>
    </div>
  )
}
