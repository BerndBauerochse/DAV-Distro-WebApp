import { forwardRef, useImperativeHandle, useRef, useState, useCallback } from 'react'
import { Upload, Loader2, Play } from 'lucide-react'
import { BatchCard } from './BatchCard'
import { api } from '../api/client'
import type { BatchPreview } from '../types'

interface BatchEntry {
  id: string
  file: File | null
  serverFilename: string | null
  preview: BatchPreview | null
  loading: boolean
  error: string | null
}

export interface BatchBuilderHandle {
  addServerFile: (filename: string) => void
}

interface Props {
  onStarted: (runId: string) => void
}

export const BatchBuilder = forwardRef<BatchBuilderHandle, Props>(function BatchBuilder({ onStarted }, ref) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [batches, setBatches] = useState<BatchEntry[]>([])
  const [startingIds, setStartingIds] = useState<Set<string>>(new Set())

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files)
    const newEntries: BatchEntry[] = fileArr.map(file => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      serverFilename: null,
      preview: null,
      loading: true,
      error: null,
    }))
    setBatches(prev => [...prev, ...newEntries])
    await Promise.all(
      newEntries.map(async entry => {
        try {
          const preview = await api.previewMetadata(entry.file!)
          setBatches(prev => prev.map(b => b.id === entry.id ? { ...b, preview, loading: false } : b))
        } catch (err) {
          setBatches(prev => prev.map(b =>
            b.id === entry.id ? { ...b, loading: false, error: (err as Error).message } : b
          ))
        }
      })
    )
  }, [])

  const addServerFile = useCallback(async (filename: string) => {
    const entry: BatchEntry = {
      id: `${Date.now()}-${Math.random()}`,
      file: null,
      serverFilename: filename,
      preview: null,
      loading: true,
      error: null,
    }
    setBatches(prev => [...prev, entry])
    try {
      const preview = await api.previewMetadataByName(filename)
      setBatches(prev => prev.map(b => b.id === entry.id ? { ...b, preview, loading: false } : b))
    } catch (err) {
      setBatches(prev => prev.map(b =>
        b.id === entry.id ? { ...b, loading: false, error: (err as Error).message } : b
      ))
    }
  }, [])

  useImperativeHandle(ref, () => ({ addServerFile }), [addServerFile])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
  }

  function handleRemove(id: string) {
    setBatches(prev => prev.filter(b => b.id !== id))
  }

  async function handleStart(id: string, portal: string, takedown = false) {
    const batch = batches.find(b => b.id === id)
    if (!batch) return
    setStartingIds(prev => new Set(prev).add(id))
    try {
      const { run_id } = batch.serverFilename
        ? await api.startRunByServerFile(portal, batch.serverFilename, takedown)
        : await api.startRun(portal, batch.file ?? undefined, takedown)
      onStarted(run_id)
      setBatches(prev => prev.filter(b => b.id !== id))
    } catch (err) {
      setBatches(prev => prev.map(b => b.id === id ? { ...b, error: (err as Error).message } : b))
    } finally {
      setStartingIds(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  async function handleStartAll() {
    const ready = batches.filter(b => b.preview && !b.loading)
    for (const batch of ready) {
      if (!batch.preview) continue
      const portal = batch.preview.portal_variants[0]?.key ?? batch.preview.detected_portal
      await handleStart(batch.id, portal)
    }
  }

  const readyCount = batches.filter(b => b.preview && !b.loading).length

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white/70">Auslieferung vorbereiten</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Metadatei laden, Portal prüfen, Auslieferung starten
          </p>
        </div>
        {readyCount > 1 && (
          <button onClick={handleStartAll} className="btn-accent flex items-center gap-1.5">
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
        className="rounded-2xl p-8 text-center cursor-pointer transition-all duration-200"
        style={{
          border: `2px dashed ${dragOver ? 'rgba(34,211,238,0.6)' : 'rgba(255,255,255,0.12)'}`,
          background: dragOver ? 'rgba(34,211,238,0.06)' : 'rgba(255,255,255,0.025)',
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xml,.xlsx,.xls"
          multiple
          className="hidden"
          onChange={e => e.target.files && addFiles(e.target.files)}
        />
        <div className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center"
          style={{ background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.2)' }}>
          <Upload className="w-5 h-5" style={{ color: '#22d3ee' }} />
        </div>
        <p className="text-sm font-medium text-white/60">
          Metadateien hierher ziehen oder klicken
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          XML oder Excel — mehrere Dateien gleichzeitig möglich
        </p>
      </div>

      {/* Batch cards */}
      {batches.length > 0 && (
        <div className="space-y-3">
          {batches.map(batch => {
            const displayName = batch.file?.name ?? batch.serverFilename ?? '…'
            if (batch.loading) {
              return (
                <div key={batch.id} className="glass-card px-5 py-4 flex items-center gap-3">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" style={{ color: '#22d3ee' }} />
                  <span className="text-sm text-white/60 truncate">{displayName}</span>
                  <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>
                    wird analysiert…
                  </span>
                </div>
              )
            }
            if (batch.error || !batch.preview) {
              return (
                <div key={batch.id} className="glass-card px-5 py-4 flex items-center justify-between gap-3"
                  style={{ borderColor: 'rgba(248,113,113,0.25)' }}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white/70 truncate">{displayName}</p>
                    <p className="text-xs mt-0.5" style={{ color: '#f87171' }}>
                      {batch.error ?? 'Unbekannter Fehler'}
                    </p>
                  </div>
                  <button onClick={() => handleRemove(batch.id)} className="btn-ghost text-xs shrink-0">
                    Entfernen
                  </button>
                </div>
              )
            }
            return (
              <BatchCard
                key={batch.id}
                preview={batch.preview}
                isStarting={startingIds.has(batch.id)}
                onStart={(portal, takedown) => handleStart(batch.id, portal, takedown)}
                onRemove={() => handleRemove(batch.id)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
})
