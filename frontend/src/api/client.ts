import type { DeliveryRun, DeliveryLog, Portal, FileEntry, FileCategory } from '../types'
import { getStoredAuth } from '../hooks/useAuth'

const BASE = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const { token } = getStoredAuth()
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers })

  if (res.status === 401) {
    // Token expired or invalid — clear storage and reload to show login
    localStorage.removeItem('dav_token')
    localStorage.removeItem('dav_username')
    window.location.reload()
    throw new Error('Unauthorized')
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${text}`)
  }
  return res.json()
}

export const api = {
  login(username: string, password: string): Promise<{ access_token: string; username: string }> {
    return request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
  },

  getRuns(portal?: string, limit = 50, offset = 0): Promise<DeliveryRun[]> {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    if (portal) params.set('portal', portal)
    return request(`/runs?${params}`)
  },

  getRun(runId: string): Promise<DeliveryRun & { logs: DeliveryLog[] }> {
    return request(`/runs/${runId}`)
  },

  getRunLogs(runId: string, status?: string): Promise<DeliveryLog[]> {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    return request(`/runs/${runId}/logs?${params}`)
  },

  getPortals(): Promise<Portal[]> {
    return request('/portals')
  },

  async startRun(portal: string, file?: File): Promise<{ run_id: string }> {
    const form = new FormData()
    form.append('portal', portal)
    if (file) form.append('metadata_file', file)
    return request('/runs', { method: 'POST', body: form })
  },

  listFiles(category: FileCategory): Promise<FileEntry[]> {
    return request(`/files/${category}`)
  },

  async uploadFile(
    category: FileCategory,
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<FileEntry> {
    const CHUNK_SIZE = 5 * 1024 * 1024  // 5 MB — safely under Traefik's 60s readTimeout
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE))
    let result: FileEntry | null = null

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE
      const blob = file.slice(start, Math.min(start + CHUNK_SIZE, file.size))

      const form = new FormData()
      form.append('chunk', blob, file.name)
      form.append('filename', file.name)
      form.append('chunk_index', String(i))
      form.append('total_chunks', String(totalChunks))

      result = await new Promise<FileEntry>((resolve, reject) => {
        const { token } = getStoredAuth()
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `${BASE}/files/${category}/chunks`)
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) {
            const overall = ((i + e.loaded / e.total) / totalChunks) * 100
            onProgress(Math.round(overall))
          }
        }

        xhr.onload = () => {
          if (xhr.status === 401) {
            localStorage.removeItem('dav_token')
            localStorage.removeItem('dav_username')
            window.location.reload()
            reject(new Error('Unauthorized'))
          } else if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText))
          } else {
            reject(new Error(`${xhr.status} ${xhr.responseText}`))
          }
        }

        xhr.onerror = () => reject(new Error('Netzwerkfehler'))
        xhr.send(form)
      })
    }

    return result!
  },

  deleteFile(category: FileCategory, filename: string): Promise<void> {
    return request(`/files/${category}/${encodeURIComponent(filename)}`, { method: 'DELETE' })
  },

  getFileDownloadUrl(category: FileCategory, filename: string): string {
    return `${BASE}/files/${category}/${encodeURIComponent(filename)}/download`
  },
}
