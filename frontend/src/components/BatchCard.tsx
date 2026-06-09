import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2, Play, Trash2, ChevronDown, AlertTriangle, Upload } from 'lucide-react'
import { useUpload } from '../contexts/UploadContext'
import type { BatchPreview, BookInfo, FileCategory } from '../types'

const PORTAL_COLORS: Record<string, { bg: string; text: string }> = {
  audible:         { bg: 'rgba(251,146,60,0.15)', text: '#fb923c' },
  audible_moa:     { bg: 'rgba(251,146,60,0.15)', text: '#fb923c' },
  audible_fulfill: { bg: 'rgba(251,146,60,0.15)', text: '#fb923c' },
  audible_corr:    { bg: 'rgba(251,146,60,0.15)', text: '#fb923c' },
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
  onStart: (portal: string, takedown: boolean) => void
  onRemove: () => void
  isStarting: boolean
}

/**
 * Inline-Upload-Button für fehlende ZIPs / Cover.
 * Beim Klick öffnet sich ein Dateidialog; nach erfolgreichem Upload wird
 * das Batch-Preview neu geladen, damit der Status auf "vorhanden" wechselt.
 */
function MissingFileUpload({ ean, category, accept }: {
  ean: string
  category: FileCategory
  accept: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const { uploads, startUpload } = useUpload()
  const [done, setDone] = useState(false)

  const expectedName = category === 'covers' ? `${ean}.jpg` : `${ean}.zip`
  const task = uploads.find(u => u.filename === expectedName && u.status !== 'done')
  const busy = task && (task.status === 'uploading' || task.status === 'queued')

  function pickFile() {
    inputRef.current?.click()
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    // Datei wird unter dem erwarteten Namen hochgeladen, damit der Parser sie findet
    const renamed = new File([file], expectedName, { type: file.type })
    startUpload(category, renamed, () => {
      setDone(true)
      // Preview neu laden — invalidates queries für 'preview' und 'files'
      qc.invalidateQueries({ queryKey: ['files', category] })
    })
  }

  if (done) {
    return <CheckCircle2 className="w-4 h-4" style={{ color: '#4ade80' }} />
  }

  return (
    <>
      <button
        onClick={pickFile}
        disabled={busy}
        title={busy ? `${task!.progress}%` : `${category === 'covers' ? 'Cover' : 'ZIP'} hochladen`}
        className="p-1 rounded-md transition-colors disabled:opacity-60"
        style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171', border: '1px solid rgba(248,113,113,0.25)' }}
      >
        {busy
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <Upload className="w-3.5 h-3.5" />
        }
      </button>
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={onFile} />
    </>
  )
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
  const [takedown, setTakedown] = useState(false)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const { startUpload } = useUpload()

  const isMoA        = selectedPortal.endsWith('_moa')
  const missingCount = preview.books.filter(b => isMoA ? !b.cover_available : !b.zip_available).length
  const totalCount   = preview.books.length
  const colors       = PORTAL_COLORS[selectedPortal] ?? PORTAL_COLORS.unknown
  const selectedLabel = preview.portal_variants.find(v => v.key === selectedPortal)?.label ?? 'Standard'
  const fileLabel    = isMoA ? 'Cover' : 'ZIP'
  const category: FileCategory = isMoA ? 'covers' : 'zips'
  const expectedExt = isMoA ? ['.jpg', '.jpeg', '.png'] : ['.zip']

  /**
   * Moderne Variante (Chrome/Edge): User wählt EINMAL den Ordner; die App
   * greift sich dann gezielt selbst die Dateien {EAN}.zip / {EAN}.jpg der
   * fehlenden Titel heraus — ohne manuelles Auswählen.
   */
  async function handlePickFolder() {
    const missingEans = preview.books
      .filter(b => isMoA ? !b.cover_available : !b.zip_available)
      .map(b => b.ean)
    if (missingEans.length === 0) return

    // @ts-expect-error — File System Access API noch nicht in allen TS-libs
    const picker = window.showDirectoryPicker
    if (typeof picker !== 'function') {
      // Fallback: klassische Mehrfachauswahl
      folderInputRef.current?.click()
      return
    }

    let dirHandle: any
    try {
      dirHandle = await picker({ id: 'dav-source', mode: 'read' })
    } catch {
      return // User hat abgebrochen
    }

    let matched = 0
    const notFound: string[] = []
    for (const ean of missingEans) {
      let fileObj: File | null = null
      for (const ext of expectedExt) {
        try {
          const fh = await dirHandle.getFileHandle(`${ean}${ext}`)
          fileObj = await fh.getFile()
          break
        } catch {
          // diese Endung gibt es nicht — nächste probieren
        }
      }
      if (!fileObj) { notFound.push(ean); continue }
      matched++
      startUpload(category, fileObj, () => {
        qc.invalidateQueries({ queryKey: ['files', category] })
      })
    }

    if (matched === 0) {
      alert(`Im gewählten Ordner wurde keine der fehlenden ${fileLabel}-Dateien gefunden.\nErwartet: nach EAN benannte Dateien (z.B. ${missingEans[0]}${expectedExt[0]}).`)
    } else if (notFound.length > 0) {
      alert(`${matched} ${fileLabel}(s) werden hochgeladen.\nNicht gefunden für EAN: ${notFound.join(', ')}`)
    }
  }

  /** Fallback für Browser ohne File System Access API. */
  function handleFolderPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return

    const missingEans = new Set(
      preview.books
        .filter(b => isMoA ? !b.cover_available : !b.zip_available)
        .map(b => b.ean)
    )

    const matchedEans = new Set<string>()
    for (const file of files) {
      const name = file.name
      const dot = name.lastIndexOf('.')
      const stem = dot > 0 ? name.slice(0, dot) : name
      const ext = dot > 0 ? name.slice(dot).toLowerCase() : ''
      if (!expectedExt.includes(ext)) continue
      if (!missingEans.has(stem)) continue
      if (matchedEans.has(stem)) continue
      matchedEans.add(stem)
      startUpload(category, file, () => {
        qc.invalidateQueries({ queryKey: ['files', category] })
      })
    }

    const matched = matchedEans.size
    if (matched === 0) {
      alert(`Keine passenden ${fileLabel}-Dateien gefunden. Erwartet werden Dateien, die nach der EAN benannt sind (z.B. 9783742441454${expectedExt[0]}).`)
    }
  }

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
            <>
              <span className="text-xs font-medium" style={{ color: '#f87171' }}>
                {missingCount} {fileLabel} fehlt{missingCount > 1 ? 'en' : ''}
              </span>
              <button
                onClick={handlePickFolder}
                title={`Ordner wählen — die fehlenden ${fileLabel}s ({EAN}${expectedExt[0]}) werden automatisch herausgesucht und hochgeladen`}
                className="flex items-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors"
                style={{ background: 'rgba(248,113,113,0.18)', color: '#f87171', border: '1px solid rgba(248,113,113,0.35)' }}
              >
                <Upload className="w-3.5 h-3.5" />
                Fehlende laden
              </button>
              <input
                ref={folderInputRef}
                type="file"
                multiple
                accept={expectedExt.join(',')}
                className="hidden"
                onChange={handleFolderPick}
              />
            </>
          )}
          {/* Takedown toggle */}
          <button
            onClick={() => setTakedown(v => !v)}
            title="Takedown: nur Metadaten senden"
            className="flex items-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors"
            style={takedown
              ? { background: 'rgba(251,146,60,0.2)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.4)' }
              : { background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.08)' }
            }
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Takedown
          </button>
          <button
            onClick={() => onStart(selectedPortal, takedown)}
            disabled={isStarting || totalCount === 0}
            className="btn-accent flex items-center gap-1.5 py-1.5 px-3"
            style={takedown ? { background: 'rgba(251,146,60,0.8)' } : {}}
          >
            {isStarting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {takedown ? 'Takedown' : 'Starten'}
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
            <span className="text-center w-6">{fileLabel}</span>
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
                  {(isMoA ? book.cover_available : book.zip_available)
                    ? <CheckCircle2 className="w-4 h-4" style={{ color: '#4ade80' }} />
                    : <MissingFileUpload
                        ean={book.ean}
                        category={isMoA ? 'covers' : 'zips'}
                        accept={isMoA ? '.jpg,.jpeg,.png' : '.zip'}
                      />
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
          <span className="text-xs font-medium" style={{ color: '#4ade80' }}>✓ Alle {fileLabel}s vorhanden</span>
        )}
        {missingCount > 0 && (
          <span className="text-xs font-medium" style={{ color: '#f87171' }}>
            {totalCount - missingCount} / {totalCount} {fileLabel}s vorhanden
          </span>
        )}
      </div>
    </div>
  )
}
