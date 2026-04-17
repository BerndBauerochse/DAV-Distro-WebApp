/**
 * Global upload context — upload progress survives tab switches and page navigation.
 * Files are queued and processed with limited concurrency to avoid flooding the server.
 */
import { createContext, useContext, useRef, useState, useCallback, type ReactNode } from 'react'
import { getStoredAuth } from '../hooks/useAuth'
import type { FileCategory, FileEntry } from '../types'

const BASE = '/api'
const CHUNK_SIZE         = 5 * 1024 * 1024  // 5 MB per chunk — reliable through proxies
const MAX_CHUNK_PARALLEL = 8               // sliding-window concurrency per file
const MAX_FILE_CONCURRENCY = 2             // max simultaneous file uploads (ZIPs are large)
const MAX_RETRIES        = 4              // retries per chunk
const CHUNK_TIMEOUT_MS   = 120_000        // abort + retry if chunk takes > 2 min

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error'

export interface UploadTask {
  id: string
  filename: string
  category: FileCategory
  progress: number         // 0–100
  status: UploadStatus
  error?: string
}

interface QueueItem {
  id: string
  category: FileCategory
  file: File
  onDone?: (entry: FileEntry) => void
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

  const update = useCallback((id: string, patch: Partial<UploadTask>) => {
    setUploads(prev => prev.map(u => u.id === id ? { ...u, ...patch } : u))
  }, [])

  // File-level queue
  const queueRef      = useRef<QueueItem[]>([])
  const activeRef     = useRef(0)

  const processQueue = useCallback(() => {
    while (activeRef.current < MAX_FILE_CONCURRENCY && queueRef.current.length > 0) {
      const item = queueRef.current.shift()!
      activeRef.current++
      update(item.id, { status: 'uploading' })
      _uploadFile(item.id, item.category, item.file, update, item.onDone).finally(() => {
        activeRef.current--
        processQueue()
      })
    }
  }, [update])

  const startUpload = useCallback((
    category: FileCategory,
    file: File,
    onDone?: (entry: FileEntry) => void,
  ) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const task: UploadTask = { id, filename: file.name, category, progress: 0, status: 'queued' }

    setUploads(prev => [...prev, task])
    queueRef.current.push({ id, category, file, onDone })
    processQueue()
  }, [processQueue])

  const clearDone = useCallback(() => {
    setUploads(prev => prev.filter(u => u.status === 'uploading' || u.status === 'queued'))
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
): Promise<void> {
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE))
  const chunkSent = new Array<number>(totalChunks).fill(0)

  const reportProgress = () => {
    const sent = chunkSent.reduce((a, b) => a + b, 0)
    update(id, { progress: Math.round((sent / file.size) * 100) })
  }

  try {
    // Sliding-window: always keep MAX_CHUNK_PARALLEL chunks in flight.
    // All chunks except the last are uploaded first; the last triggers assembly.
    const nonFinalIndices = Array.from({ length: totalChunks - 1 }, (_, i) => i)
    await _pooled(nonFinalIndices, MAX_CHUNK_PARALLEL, async idx => {
      await _uploadChunk(category, file, idx, totalChunks, chunkSent, reportProgress)
    })

    // Last chunk triggers server-side assembly
    const entry = await _uploadChunk(
      category, file, totalChunks - 1, totalChunks, chunkSent, reportProgress, file.size
    ) as FileEntry

    if (entry.size !== file.size) {
      await _deleteFile(category, file.name)
      throw new Error(
        `Größenprüfung fehlgeschlagen: erwartet ${file.size} Bytes, erhalten ${entry.size} Bytes.`
      )
    }

    update(id, { progress: 100, status: 'done' })
    onDone?.(entry)

  } catch (err) {
    update(id, { status: 'error', error: (err as Error).message })
  }
}

/** Run tasks with at most `concurrency` in flight at any time (sliding window). */
async function _pooled<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let idx = 0
  async function worker() {
    while (idx < items.length) {
      const i = idx++
      await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
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
      await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)))
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
    if (expectedSize !== undefined) form.append('expected_size', String(expectedSize))

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/files/${category}/chunks`)
    xhr.timeout = CHUNK_TIMEOUT_MS
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) { chunkSent[index] = e.loaded; reportProgress() }
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

    xhr.onerror   = () => reject(new Error(`Netzwerkfehler bei Chunk ${index}`))
    xhr.ontimeout = () => reject(new Error(`Timeout bei Chunk ${index} — wird wiederholt`))
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
