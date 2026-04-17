import { useRef, useState, useCallback } from 'react'
import { Upload, Loader2, PackagePlus, Play } from 'lucide-react'
import { BatchCard } from './BatchCard'
import { api } from '../api/client'
import type { BatchPreview } from '../types'

interface BatchEntry {
  id: string
  file: File
  preview: BatchPreview | null
  loading: boolean
  error: string | null
}

interface Props {
  onStarted: (runId: string) => void
}

export function BatchBuilder({ onStarted }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [batches, setBatches] = useState<BatchEntry[]>([])
  const [startingIds, setStartingIds] = useState<Set<string>>(new Set())

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files)

    // Add entries with loading state immediately
    const newEntries: BatchEntry[] = fileArr.map(file => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      preview: null,
      loading: true,
      error: null,
    }))

    setBatches(prev => [...prev, ...newEntries])

    // Parse each file
    await Promise.all(
      newEntries.map(async entry => {
        try {
          const preview = await api.previewMetadata(entry.file)
          setBatches(prev => prev.map(b =>
            b.id === entry.id ? { ...b, preview, loading: false } : b
          ))
        } catch (err) {
          setBatches(prev => prev.map(b =>
            b.id === entry.id
              ? { ...b, loading: false, error: (err as Error).message }
              : b
          ))
        }
      })
    )
  }, [])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
  }

  function handleRemove(id: string) {
    setBatches(prev => prev.filter(b => b.id !== id))
  }

  async function handleStart(id: string, portal: string, file: File) {
    setStartingIds(prev => new Set(prev).add(id))
    try {
      const { run_id } = await api.startRun(portal, file)
      onStarted(run_id)
      setBatches(prev => prev.filter(b => b.id !== id))
    } catch (err) {
      setBatches(prev => prev.map(b =>
        b.id === id ? { ...b, error: (err as Error).message } : b
      ))
    } finally {
      setStartingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  async function handleStartAll() {
    const ready = batches.filter(b => b.preview && !b.loading)
    for (const batch of ready) {
      if (!batch.preview) continue
      const portal = batch.preview.portal_variants[0]?.key ?? batch.preview.detected_portal
      await handleStart(batch.id, portal, batch.file)
    }
  }

  const readyCount = batches.filter(b => b.preview && !b.loading).length

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PackagePlus className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
            Auslieferung vorbereiten
          </h2>
        </div>
        {readyCount > 1 && (
          <button
            onClick={handleStartAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            Alle starten ({readyCount})
          </button>
        )}
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors ${
          dragOver
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-200 hover:border-blue-400 hover:bg-gray-50'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xml,.xlsx,.xls"
          multiple
          className="hidden"
          onChange={e => e.target.files && addFiles(e.target.files)}
        />
        <Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm font-medium text-gray-600">
          Metadateien hierher ziehen oder klicken
        </p>
        <p className="text-xs text-gray-400 mt-1">
          XML oder Excel — mehrere Dateien gleichzeitig möglich
        </p>
      </div>

      {/* Batch cards */}
      {batches.length > 0 && (
        <div className="space-y-3">
          {batches.map(batch => {
            // Loading skeleton
            if (batch.loading) {
              return (
                <div key={batch.id} className="bg-white rounded-2xl border border-gray-200 p-5 flex items-center gap-3 text-sm text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-500 shrink-0" />
                  <span className="truncate">{batch.file.name}</span>
                  <span className="text-xs text-gray-400">wird analysiert…</span>
                </div>
              )
            }

            // Error state
            if (batch.error || !batch.preview) {
              return (
                <div key={batch.id} className="bg-white rounded-2xl border border-red-200 p-5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-700 truncate">{batch.file.name}</p>
                    <p className="text-xs text-red-500 mt-0.5">{batch.error ?? 'Unbekannter Fehler'}</p>
                  </div>
                  <button
                    onClick={() => handleRemove(batch.id)}
                    className="text-xs text-gray-400 hover:text-red-500 shrink-0"
                  >
                    Entfernen
                  </button>
                </div>
              )
            }

            return (
              <BatchCard
                key={batch.id}
                preview={batch.preview}
                file={batch.file}
                isStarting={startingIds.has(batch.id)}
                onStart={(portal, file) => handleStart(batch.id, portal, file)}
                onRemove={() => handleRemove(batch.id)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
