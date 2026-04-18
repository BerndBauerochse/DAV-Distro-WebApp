import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, Trash2, Download, FileArchive, FileText, File, Image, Database, Loader2, AlertCircle, CheckSquare, Square } from 'lucide-react'
import { api } from '../api/client'
import { useUpload } from '../contexts/UploadContext'
import { getStoredAuth } from '../hooks/useAuth'
import type { FileCategory, FileEntry } from '../types'

const CATEGORIES: { key: FileCategory; label: string; icon: React.ReactNode; accept: string; desc: string }[] = [
  { key: 'zips',     label: 'ZIPs',      icon: <FileArchive className="w-4 h-4" />, accept: '.zip',             desc: 'Audiobook-Master-ZIPs' },
  { key: 'toc',      label: 'TOC',       icon: <FileText    className="w-4 h-4" />, accept: '.xlsx,.xls,.csv',  desc: 'Table of Contents (Excel)' },
  { key: 'pdf',      label: 'PDFs',      icon: <File        className="w-4 h-4" />, accept: '.pdf',             desc: 'Booklets & Beilagen' },
  { key: 'covers',   label: 'Cover',     icon: <Image       className="w-4 h-4" />, accept: '.jpg,.jpeg,.png',  desc: 'Cover-Bilder (Audible MoA & andere)' },
  { key: 'metadata', label: 'Metadaten', icon: <Database    className="w-4 h-4" />, accept: '.xml,.xlsx',       desc: 'Metadaten-Dateien (XML, Excel)' },
]

function extractEan(filename: string): string | null {
  const m = filename.match(/(\d{13})/)
  return m ? m[1] : null
}

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** Authenticated thumbnail — lazy-loads only when visible, fetches thumb endpoint */
function AuthImage({ filename, alt, className }: { filename: string; alt: string; className?: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let url: string | null = null
    let cancelled = false

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      const { token } = getStoredAuth()
      const thumbUrl = `/api/files/covers/${encodeURIComponent(filename)}/thumb`
      fetch(thumbUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        .then(r => r.ok ? r.blob() : Promise.reject())
        .then(blob => { if (!cancelled) { url = URL.createObjectURL(blob); setBlobUrl(url) } })
        .catch(() => {})
    }, { rootMargin: '100px' })

    observer.observe(el)
    return () => { cancelled = true; observer.disconnect(); if (url) URL.revokeObjectURL(url) }
  }, [filename])

  return (
    <div ref={ref} className={className}>
      {blobUrl
        ? <img src={blobUrl} alt={alt} className="w-full h-full object-cover" />
        : <div className={`skeleton w-full h-full`} />
      }
    </div>
  )
}

function CategoryPanel({ category }: { category: typeof CATEGORIES[number] }) {
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [deletingFile, setDeletingFile] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const { uploads, startUpload } = useUpload()

  const { data: files = [], isLoading, isError } = useQuery({
    queryKey: ['files', category.key],
    queryFn: () => api.listFiles(category.key),
  })

  const { data: covers = [] } = useQuery({
    queryKey: ['files', 'covers'],
    queryFn: () => api.listFiles('covers'),
    enabled: category.key !== 'covers',
  })
  const coverEans = new Set((covers as FileEntry[]).map((c: FileEntry) => extractEan(c.name)).filter(Boolean))

  const deleteMutation = useMutation({
    mutationFn: (fn: string) => api.deleteFile(category.key, fn),
    onSuccess: () => { setDeletingFile(null); qc.invalidateQueries({ queryKey: ['files', category.key] }) },
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: async (fns: string[]) => { await Promise.all(fns.map(fn => api.deleteFile(category.key, fn))) },
    onSuccess: () => { setSelected(new Set()); qc.invalidateQueries({ queryKey: ['files', category.key] }) },
  })

  function handleFiles(fl: FileList | null) {
    if (!fl) return
    Array.from(fl).forEach(file => startUpload(category.key, file, () => {
      qc.invalidateQueries({ queryKey: ['files', category.key] })
    }))
  }

  function toggleSelect(name: string) {
    setSelected(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n })
  }

  function toggleAll() {
    setSelected(selected.size === files.length ? new Set() : new Set(files.map((f: FileEntry) => f.name)))
  }

  const activeUploads = uploads.filter(u => u.category === category.key && u.status !== 'done')
  const queuedCount   = activeUploads.filter(u => u.status === 'queued').length
  const totalSize = files.reduce((s: number, f: FileEntry) => s + f.size, 0)
  const isCovers = category.key === 'covers'
  const allSelected = files.length > 0 && selected.size === files.length

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        className="rounded-2xl p-8 text-center cursor-pointer transition-all duration-200"
        style={{
          border: `2px dashed ${dragOver ? 'rgba(34,211,238,0.6)' : 'rgba(255,255,255,0.1)'}`,
          background: dragOver ? 'rgba(34,211,238,0.05)' : 'rgba(255,255,255,0.02)',
        }}
      >
        <input ref={inputRef} type="file" accept={category.accept} multiple className="hidden"
          onChange={e => handleFiles(e.target.files)} />
        <div className="w-10 h-10 rounded-xl mx-auto mb-3 flex items-center justify-center"
          style={{ background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.15)' }}>
          <Upload className="w-4 h-4" style={{ color: '#22d3ee' }} />
        </div>
        <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          Dateien hierher ziehen oder klicken
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          {category.accept.replace(/\./g, '').toUpperCase()}
        </p>
      </div>

      {/* Upload progress */}
      {activeUploads.length > 0 && (
        <div className="rounded-xl p-4 space-y-2"
          style={{ background: 'rgba(34,211,238,0.05)', border: '1px solid rgba(34,211,238,0.15)' }}>
          <div className="flex items-center justify-between mb-3">
            <p className="section-label">Upload läuft…</p>
            {queuedCount > 0 && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {queuedCount} in Warteschlange
              </span>
            )}
          </div>
          {activeUploads.map(task => (
            <div key={task.id} className="space-y-1">
              <div className="flex justify-between items-center gap-2">
                <span className="text-sm text-white/60 truncate">{task.filename}</span>
                {task.status === 'error'
                  ? <span className="text-xs shrink-0 flex items-center gap-1" style={{ color: '#f87171' }}>
                      <AlertCircle className="w-3 h-3" /> Fehler
                    </span>
                  : task.status === 'queued'
                  ? <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>wartet</span>
                  : <span className="text-xs font-medium shrink-0 w-9 text-right" style={{ color: '#22d3ee' }}>
                      {task.progress}%
                    </span>
                }
              </div>
              <div className="w-full rounded-full h-1.5 overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <div className="h-1.5 rounded-full transition-all duration-200"
                  style={{
                    width: task.status === 'queued' ? '0%' : `${task.status === 'error' ? 100 : task.progress}%`,
                    background: task.status === 'error' ? '#f87171' : 'linear-gradient(90deg,#22d3ee,#0ea5e9)',
                  }} />
              </div>
              {task.status === 'error' && task.error && (
                <p className="text-xs" style={{ color: '#f87171' }}>{task.error}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* File count + bulk delete */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="section-label">{files.length} {files.length === 1 ? 'Datei' : 'Dateien'}</span>
          {files.length > 0 && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{fmtBytes(totalSize)} gesamt</span>
          )}
        </div>
        {selected.size > 0 && (
          <button
            onClick={() => bulkDeleteMutation.mutate([...selected])}
            disabled={bulkDeleteMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl disabled:opacity-50 transition-colors"
            style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.25)' }}
          >
            <Trash2 className="w-3 h-3" />
            {bulkDeleteMutation.isPending ? 'Löscht…' : `${selected.size} löschen`}
          </button>
        )}
      </div>

      {isLoading && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-muted)' }} /></div>}
      {isError  && <div className="text-sm text-center py-4" style={{ color: '#f87171' }}>Fehler beim Laden</div>}
      {!isLoading && !isError && files.length === 0 && (
        <div className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Noch keine Dateien vorhanden</div>
      )}

      {/* Cover grid */}
      {isCovers && files.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <button onClick={toggleAll} style={{ color: allSelected ? '#22d3ee' : 'var(--text-muted)' }}>
              {allSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            </button>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Alle auswählen</span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {files.map((f: FileEntry) => (
              <div key={f.name}
                className="relative group rounded-xl overflow-hidden cursor-pointer transition-all duration-150"
                style={{
                  border: `2px solid ${selected.has(f.name) ? '#22d3ee' : 'rgba(255,255,255,0.08)'}`,
                  boxShadow: selected.has(f.name) ? '0 0 12px rgba(34,211,238,0.2)' : undefined,
                }}
                onClick={() => toggleSelect(f.name)}
              >
                <AuthImage filename={f.name} alt={f.name}
                  className="w-full aspect-square overflow-hidden" />
                {/* Select indicator */}
                <div className="absolute top-1.5 left-1.5">
                  {selected.has(f.name)
                    ? <CheckSquare className="w-4 h-4 drop-shadow" style={{ color: '#22d3ee' }} />
                    : <Square className="w-4 h-4 drop-shadow text-white opacity-0 group-hover:opacity-60 transition-opacity" />
                  }
                </div>
                {/* Hover overlay */}
                <div className="absolute inset-x-0 bottom-0 py-1.5 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'linear-gradient(to top,rgba(0,0,0,0.75),transparent)' }}>
                  <p className="text-white text-xs truncate">{f.name}</p>
                </div>
                {/* Actions */}
                <div className="absolute top-1.5 right-1.5 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <a href={api.getFileDownloadUrl('covers', f.name)} download={f.name}
                    onClick={e => e.stopPropagation()}
                    className="p-1 rounded-lg transition-colors"
                    style={{ background: 'rgba(0,0,0,0.6)', color: 'white' }}>
                    <Download className="w-3 h-3" />
                  </a>
                  {deletingFile === f.name ? (
                    <button onClick={e => { e.stopPropagation(); deleteMutation.mutate(f.name) }}
                      disabled={deleteMutation.isPending}
                      className="p-1 rounded-lg disabled:opacity-50"
                      style={{ background: '#ef4444', color: 'white' }}>
                      <Trash2 className="w-3 h-3" />
                    </button>
                  ) : (
                    <button onClick={e => { e.stopPropagation(); setDeletingFile(f.name) }}
                      className="p-1 rounded-lg transition-colors"
                      style={{ background: 'rgba(0,0,0,0.6)', color: 'white' }}>
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* List view */}
      {!isCovers && files.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--glass-border)' }}>
          <div className="flex items-center gap-3 px-4 py-2" style={{ background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid var(--glass-border)' }}>
            <button onClick={toggleAll} style={{ color: allSelected ? '#22d3ee' : 'var(--text-muted)' }}>
              {allSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            </button>
            <span className="section-label">Alle auswählen</span>
          </div>
          {files.map((f: FileEntry) => {
            const ean = extractEan(f.name)
            const hasCover = ean !== null && coverEans.has(ean)
            const coverFilename = hasCover ? `${ean}.jpg` : null
            return (
            <div key={f.name}
              className="flex items-center gap-3 px-4 py-2.5 glass-row group"
              style={{
                borderBottom: '1px solid rgba(255,255,255,0.03)',
                background: selected.has(f.name) ? 'rgba(34,211,238,0.04)' : undefined,
              }}
            >
              <button onClick={() => toggleSelect(f.name)} className="shrink-0 transition-colors"
                style={{ color: selected.has(f.name) ? '#22d3ee' : 'var(--text-muted)' }}>
                {selected.has(f.name) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
              </button>
              {coverFilename
                ? <AuthImage filename={coverFilename} alt={f.name} className="shrink-0 w-10 h-10 rounded-lg overflow-hidden" />
                : <div className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)' }}>{category.icon}</div>
              }
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white/80 truncate">{f.name}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {fmtBytes(f.size)} · {fmtDate(f.modified)}
                </p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <a href={api.getFileDownloadUrl(category.key, f.name)} download={f.name}
                  onClick={e => e.stopPropagation()}
                  className="p-1.5 rounded-lg transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#22d3ee')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                  title="Herunterladen">
                  <Download className="w-3.5 h-3.5" />
                </a>
                {deletingFile === f.name ? (
                  <div className="flex items-center gap-1">
                    <button onClick={() => deleteMutation.mutate(f.name)} disabled={deleteMutation.isPending}
                      className="px-2 py-1 text-xs rounded-lg disabled:opacity-50"
                      style={{ background: 'rgba(248,113,113,0.2)', color: '#f87171' }}>
                      {deleteMutation.isPending ? '…' : 'Löschen'}
                    </button>
                    <button onClick={() => setDeletingFile(null)}
                      className="px-2 py-1 text-xs rounded-lg"
                      style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>
                      Abbruch
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setDeletingFile(f.name)}
                    className="p-1.5 rounded-lg transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                    title="Löschen">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )})}
        </div>
      )}
    </div>
  )
}

export function FileManager() {
  const [activeTab, setActiveTab] = useState<FileCategory>('zips')
  const active = CATEGORIES.find(c => c.key === activeTab)!

  return (
    <div className="space-y-5">
      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)' }}>
        {CATEGORIES.map(cat => (
          <button key={cat.key} onClick={() => setActiveTab(cat.key)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150"
            style={activeTab === cat.key
              ? { background: '#6d28d9', color: '#ffffff', border: '1px solid #7c3aed' }
              : { color: 'var(--text-muted)', border: '1px solid transparent' }
            }
            onMouseEnter={e => { if (activeTab !== cat.key) { (e.currentTarget as HTMLElement).style.background = 'rgba(109,40,217,0.18)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-100)' } }}
            onMouseLeave={e => { if (activeTab !== cat.key) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' } }}
          >
            {cat.icon}
            {cat.label}
          </button>
        ))}
      </div>

      {/* Panel */}
      <div className="glass-card p-6">
        <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>{active.desc}</p>
        <CategoryPanel category={active} />
      </div>
    </div>
  )
}
