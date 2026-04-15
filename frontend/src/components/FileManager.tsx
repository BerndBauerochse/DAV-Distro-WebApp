import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, Trash2, Download, FileArchive, FileText, File, Image, Loader2, AlertCircle } from 'lucide-react'
import { api } from '../api/client'
import type { FileCategory, FileEntry } from '../types'

const CATEGORIES: { key: FileCategory; label: string; icon: React.ReactNode; accept: string; desc: string }[] = [
  {
    key: 'zips',
    label: 'ZIPs',
    icon: <FileArchive className="w-4 h-4" />,
    accept: '.zip',
    desc: 'Audiobook-Master-ZIPs',
  },
  {
    key: 'toc',
    label: 'TOC',
    icon: <FileText className="w-4 h-4" />,
    accept: '.xlsx,.xls,.csv',
    desc: 'Table of Contents (Excel)',
  },
  {
    key: 'pdf',
    label: 'PDFs',
    icon: <File className="w-4 h-4" />,
    accept: '.pdf',
    desc: 'Booklets & Beilagen',
  },
  {
    key: 'covers',
    label: 'Cover',
    icon: <Image className="w-4 h-4" />,
    accept: '.jpg,.jpeg,.png',
    desc: 'Cover-Bilder (Audible MoA & andere)',
  },
]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

interface CategoryPanelProps {
  category: typeof CATEGORIES[number]
}

function CategoryPanel({ category }: CategoryPanelProps) {
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [deletingFile, setDeletingFile] = useState<string | null>(null)

  const { data: files = [], isLoading, isError } = useQuery({
    queryKey: ['files', category.key],
    queryFn: () => api.listFiles(category.key),
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => api.uploadFile(category.key, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['files', category.key] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (filename: string) => api.deleteFile(category.key, filename),
    onSuccess: () => {
      setDeletingFile(null)
      qc.invalidateQueries({ queryKey: ['files', category.key] })
    },
  })

  function handleFiles(fileList: FileList | null) {
    if (!fileList) return
    Array.from(fileList).forEach(f => uploadMutation.mutate(f))
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  const totalSize = files.reduce((sum: number, f: FileEntry) => sum + f.size, 0)

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          dragOver
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-200 hover:border-blue-400 hover:bg-gray-50'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={category.accept}
          multiple
          className="hidden"
          onChange={e => handleFiles(e.target.files)}
        />
        {uploadMutation.isPending ? (
          <div className="flex items-center justify-center gap-2 text-blue-600">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm font-medium">Wird hochgeladen…</span>
          </div>
        ) : (
          <>
            <Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-gray-600">
              Dateien hierher ziehen oder klicken
            </p>
            <p className="text-xs text-gray-400 mt-1">{category.accept.replace(/\./g, '').toUpperCase()}</p>
          </>
        )}
      </div>

      {uploadMutation.isError && (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-lg px-3 py-2 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Upload fehlgeschlagen
        </div>
      )}

      {/* File List */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            {files.length} {files.length === 1 ? 'Datei' : 'Dateien'}
          </span>
          {files.length > 0 && (
            <span className="text-xs text-gray-400">{formatBytes(totalSize)} gesamt</span>
          )}
        </div>

        {isLoading && (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        )}

        {isError && (
          <div className="text-sm text-red-500 text-center py-4">Fehler beim Laden</div>
        )}

        {!isLoading && !isError && files.length === 0 && (
          <div className="text-sm text-gray-400 text-center py-8">
            Noch keine Dateien vorhanden
          </div>
        )}

        {files.length > 0 && (
          <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
            {files.map((f: FileEntry) => (
              <div key={f.name} className="flex items-center gap-3 px-4 py-2.5 bg-white hover:bg-gray-50 group">
                <div className="text-gray-400 shrink-0">{category.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{f.name}</p>
                  <p className="text-xs text-gray-400">{formatBytes(f.size)} · {formatDate(f.modified)}</p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <a
                    href={api.getFileDownloadUrl(category.key, f.name)}
                    download={f.name}
                    onClick={e => e.stopPropagation()}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                    title="Herunterladen"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                  {deletingFile === f.name ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => deleteMutation.mutate(f.name)}
                        disabled={deleteMutation.isPending}
                        className="px-2 py-1 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                      >
                        {deleteMutation.isPending ? '…' : 'Löschen'}
                      </button>
                      <button
                        onClick={() => setDeletingFile(null)}
                        className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                      >
                        Abbruch
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeletingFile(f.name)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Löschen"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function FileManager() {
  const [activeTab, setActiveTab] = useState<FileCategory>('zips')
  const active = CATEGORIES.find(c => c.key === activeTab)!

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Dateiverwaltung</h1>
        <p className="text-sm text-gray-500 mt-0.5">Verwalte ZIPs, TOC-Dateien und PDFs auf dem Server</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {CATEGORIES.map(cat => (
          <button
            key={cat.key}
            onClick={() => setActiveTab(cat.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === cat.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {cat.icon}
            {cat.label}
          </button>
        ))}
      </div>

      {/* Panel */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="mb-4">
          <p className="text-xs text-gray-400">{active.desc}</p>
        </div>
        <CategoryPanel key={activeTab} category={active} />
      </div>
    </div>
  )
}
