import { useState } from 'react'
import { CheckCircle2, XCircle, Loader2, Play, Trash2, ChevronDown } from 'lucide-react'
import type { BatchPreview, BookInfo } from '../types'

const PORTAL_COLORS: Record<string, string> = {
  audible:        'bg-orange-100 text-orange-700',
  audible_moa:    'bg-orange-100 text-orange-700',
  audible_fulfill:'bg-orange-100 text-orange-700',
  bookwire:       'bg-blue-100 text-blue-700',
  bookwire_moa:   'bg-blue-100 text-blue-700',
  bookbeat:       'bg-purple-100 text-purple-700',
  spotify:        'bg-green-100 text-green-700',
  google:         'bg-yellow-100 text-yellow-700',
  zebra:          'bg-zinc-100 text-zinc-700',
  rtl:            'bg-red-100 text-red-700',
  divibib:        'bg-teal-100 text-teal-700',
  unknown:        'bg-gray-100 text-gray-600',
}

interface Props {
  preview: BatchPreview
  onStart: (portal: string, file: File) => void
  onRemove: () => void
  file: File
  isStarting: boolean
}

function AbridgedBadge({ abridged }: { abridged: boolean | null }) {
  if (abridged === null) return null
  return abridged
    ? <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium shrink-0">Gekürzt</span>
    : <span className="text-xs px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 font-medium shrink-0">Ungekürzt</span>
}

function ZipIcon({ available }: { available: boolean }) {
  return available
    ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
    : <XCircle className="w-4 h-4 text-red-400 shrink-0" />
}

export function BatchCard({ preview, onStart, onRemove, file, isStarting }: Props) {
  const hasVariants = preview.portal_variants.length > 1
  const [selectedPortal, setSelectedPortal] = useState(preview.portal_variants[0]?.key ?? preview.detected_portal)

  const missingCount = preview.books.filter(b => !b.zip_available).length
  const totalCount   = preview.books.length

  const colorClass = PORTAL_COLORS[selectedPortal] ?? PORTAL_COLORS.unknown
  const selectedLabel = preview.portal_variants.find(v => v.key === selectedPortal)?.label ?? 'Standard'

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-3 min-w-0">
          {/* Portal badge / variant selector */}
          {hasVariants ? (
            <div className="relative">
              <select
                value={selectedPortal}
                onChange={e => setSelectedPortal(e.target.value)}
                className={`appearance-none pl-3 pr-7 py-1 rounded-full text-xs font-semibold cursor-pointer border-0 outline-none ${colorClass}`}
              >
                {preview.portal_variants.map(v => (
                  <option key={v.key} value={v.key}>{v.label}</option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
            </div>
          ) : (
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${colorClass}`}>
              {selectedLabel}
            </span>
          )}

          <span className="text-sm text-gray-500 truncate">{preview.filename}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Missing ZIP warning */}
          {missingCount > 0 && (
            <span className="text-xs text-red-500 font-medium">
              {missingCount} ZIP fehlt{missingCount > 1 ? 'en' : ''}
            </span>
          )}

          {/* Start button */}
          <button
            onClick={() => onStart(selectedPortal, file)}
            disabled={isStarting || totalCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-medium transition-colors"
          >
            {isStarting
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Play className="w-3.5 h-3.5" />
            }
            Starten
          </button>

          <button
            onClick={onRemove}
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="Entfernen"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Book list */}
      {preview.books.length === 0 ? (
        <p className="px-5 py-4 text-sm text-gray-400">Keine Titel gefunden.</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 px-5 py-2 text-xs font-medium text-gray-400 uppercase tracking-wider">
            <span>Titel / Autor</span>
            <span className="text-center w-20">Art</span>
            <span className="text-center w-6">ZIP</span>
          </div>

          {preview.books.map((book: BookInfo) => (
            <div
              key={book.ean}
              className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-center px-5 py-2.5 hover:bg-gray-50"
            >
              {/* Title + author */}
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate leading-snug">{book.title || '—'}</p>
                <p className="text-xs text-gray-400 truncate">{book.author || '—'}</p>
              </div>

              {/* Abridged badge */}
              <div className="w-20 flex justify-center">
                <AbridgedBadge abridged={book.abridged} />
              </div>

              {/* ZIP status */}
              <div className="w-6 flex justify-center">
                <ZipIcon available={book.zip_available} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer summary */}
      <div className="px-5 py-2 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
        <span className="text-xs text-gray-400">
          {totalCount} {totalCount === 1 ? 'Titel' : 'Titel'}
        </span>
        {missingCount === 0 && totalCount > 0 && (
          <span className="text-xs text-green-600 font-medium">Alle ZIPs vorhanden</span>
        )}
        {missingCount > 0 && (
          <span className="text-xs text-red-500">
            {totalCount - missingCount} / {totalCount} ZIPs vorhanden
          </span>
        )}
      </div>
    </div>
  )
}
