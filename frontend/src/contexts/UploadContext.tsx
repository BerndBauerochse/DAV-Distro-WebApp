/**
 * Global upload context — upload progress survives tab switches and page navigation.
 * Actual XHR uploads are managed here, not inside components.
 */
import { createContext, useContext, useRef, useState, useCallback, type ReactNode } from 'react'
import { getStoredAuth } from '../hooks/useAuth'
import type { FileCategory, FileEntry } from '../types'

const BASE = '/api'
const CHUNK_SIZE = 10 * 1024 * 1024   // 10 MB per chunk
const MAX_PARALLEL = 4                 // concurrent chunk uploads
const MAX_RETRIES  = 3                 // retries per chunk

export type UploadStatus = 'uploading' | 'done' | 'error'

export interface UploadTask {
  id: string
  filename: string
  category: FileCategory
  progress: number         // 0–100
  status: UploadStatus
  error?: string
}

interface ContextValue {
  uploads: UploadTask[]
  startUpload: (category: FileCategory, file: File, onDone?: (entry: FileEntry) => void) => void
  clearDone: () => void
}

const UploadContext = createContext<ContextValue | null>(null)

export function useUpload() {
  const ctx = useContext(UploadContext)
  if (!ctx) throw new Error('useUpload must be used inside UploadProvider')
  return ctx
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function UploadProvider({ children }: { children: ReactNode }) {
  const [uploads, setUploads] = useState<UploadTask[]>([])
  // Keep a ref to avoid stale closures inside XHR callbacks
  const uploadsRef = useRef<UploadTask[]>([])

  const update = useCallback((id: string, patch: Partial<UploadTask>) => {
    setUploads(prev => {
      const next = prev.map(u => u.id === id ? { ...u, ...patch } : u)
      uploadsRef.current = next
      return next
    })
  }, [])

  const startUpload = useCallback((
    category: FileCategory,
    file: File,
    onDone?: (entry: FileEntry) => void,
  ) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const task: UploadTask = { id, filename: file.name, category, progress: 0, status: 'uploading' }

    setUploads(prev => {
      const next = [...prev, task]
      uploadsRef.current = next
      return next
    })

    _uploadFile(id, category, file, update, onDone)
  }, [update])

  const clearDone = useCallback(() => {
    setUploads(prev => {
      const next = prev.filter(u => u.status === 'uploading')
      uploadsRef.current = next
      return next
    })
  }, [])

  return (
    <UploadContext.Provider value={{ uploads, startUpload, clearDone }}>
      {children}
    </UploadContext.Provider>
  )
}

// ─── Upload engine ────────────────────────────────────────────────────────────

async function _uploadFile(
  id: string,
  category: FileCategory,
  file: File,
  update: (id: string, patch: Partial<UploadTask>) => void,
  onDone?: (entry: FileEntry) => void,
) {
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE))
  // Track bytes sent per chunk for accurate overall progress
  const chunkSent = new Array<number>(totalChunks).fill(0)

  const reportProgress = () => {
    const sent = chunkSent.reduce((a, b) => a + b, 0)
    update(id, { progress: Math.round((sent / file.size) * 100) })
  }

  try {
    // Upload all chunks except the last one in parallel batches
    const nonFinalIndices = Array.from({ length: totalChunks - 1 }, (_, i) => i)

    for (let i = 0; i < nonFinalIndices.length; i += MAX_PARALLEL) {
      const batch = nonFinalIndices.slice(i, i + MAX_PARALLEL)
      await Promise.all(batch.map(idx =>
        _uploadChunk(category, file, idx, totalChunks, chunkSent, reportProgress)
      ))
    }

    // Last chunk triggers server-side assembly — send it last, with expected_size
    const entry = await _uploadChunk(
      category, file, totalChunks - 1, totalChunks, chunkSent, reportProgress, file.size
    ) as FileEntry

    // ── Size integrity check ──────────────────────────────────────────────────
    if (entry.size !== file.size) {
      // Delete the corrupt file on the server
      await _deleteFile(category, file.name)
      throw new Error(
        `Größenprüfung fehlgeschlagen: erwartet ${file.size} Bytes, erhalten ${entry.size} Bytes. Datei wurde entfernt.`
      )
    }

    update(id, { progress: 100, status: 'done' })
    onDone?.(entry)

  } catch (err) {
    update(id, { status: 'error', error: (err as Error).message })
  }
}

async function _uploadChunk(
  category: FileCategory,
  file: File,
  index: number,
  total: number,
  chunkSent: number[],
  reportProgress: () => void,
  expectedSize?: number,
): Promise<unknown> {
  const start = index * CHUNK_SIZE
  const blob  = file.slice(start, Math.min(start + CHUNK_SIZE, file.size))

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await _xhrChunk(category, file.name, blob, index, total, chunkSent, reportProgress, expectedSize)
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) throw err
      // Exponential backoff: 500ms, 1000ms, 2000ms
      await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)))
      // Reset progress for this chunk on retry
      chunkSent[index] = 0
      reportProgress()
    }
  }
}

function _xhrChunk(
  category: FileCategory,
  filename: string,
  blob: Blob,
  index: number,
  total: number,
  chunkSent: number[],
  reportProgress: () => void,
  expectedSize?: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const { token } = getStoredAuth()
    const form = new FormData()
    form.append('chunk', blob, filename)
    form.append('filename', filename)
    form.append('chunk_index', String(index))
    form.append('total_chunks', String(total))
    if (expectedSize !== undefined) {
      form.append('expected_size', String(expectedSize))
    }

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/files/${category}/chunks`)
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        chunkSent[index] = e.loaded
        reportProgress()
      }
    }

    xhr.onload = () => {
      if (xhr.status === 401) {
        localStorage.removeItem('dav_token')
        localStorage.removeItem('dav_username')
        window.location.reload()
        reject(new Error('Unauthorized'))
      } else if (xhr.status >= 200 && xhr.status < 300) {
        chunkSent[index] = blob.size
        reportProgress()
        resolve(JSON.parse(xhr.responseText))
      } else {
        reject(new Error(`Chunk ${index} fehlgeschlagen: ${xhr.status} ${xhr.responseText}`))
      }
    }

    xhr.onerror = () => reject(new Error(`Netzwerkfehler bei Chunk ${index}`))
    xhr.send(form)
  })
}

async function _deleteFile(category: FileCategory, filename: string) {
  const { token } = getStoredAuth()
  await fetch(`${BASE}/files/${category}/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}
