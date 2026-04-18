import type { DeliveryRun, DeliveryLog, Portal, FileEntry, FileCategory, BatchPreview } from '../types'
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

  async previewMetadata(file: File): Promise<BatchPreview> {
    const form = new FormData()
    form.append('metadata_file', file)
    return request('/runs/preview', { method: 'POST', body: form })
  },

  async previewMetadataByName(serverFilename: string): Promise<BatchPreview> {
    const form = new FormData()
    form.append('metadata_server_file', serverFilename)
    return request('/runs/preview', { method: 'POST', body: form })
  },

  async checkRun(portal: string, file?: File): Promise<{ missing: string[] }> {
    const form = new FormData()
    form.append('portal', portal)
    if (file) form.append('metadata_file', file)
    return request('/runs/check', { method: 'POST', body: form })
  },

  async startRun(portal: string, file?: File): Promise<{ run_id: string }> {
    const form = new FormData()
    form.append('portal', portal)
    if (file) form.append('metadata_file', file)
    return request('/runs', { method: 'POST', body: form })
  },

  async startRunByServerFile(portal: string, serverFilename: string): Promise<{ run_id: string }> {
    const form = new FormData()
    form.append('portal', portal)
    form.append('metadata_server_file', serverFilename)
    return request('/runs', { method: 'POST', body: form })
  },

  listFiles(category: FileCategory): Promise<FileEntry[]> {
    return request(`/files/${category}`)
  },

  deleteFile(category: FileCategory, filename: string): Promise<void> {
    return request(`/files/${category}/${encodeURIComponent(filename)}`, { method: 'DELETE' })
  },

  getFileDownloadUrl(category: FileCategory, filename: string): string {
    return `${BASE}/files/${category}/${encodeURIComponent(filename)}/download`
  },

  async downloadWithAuth(url: string, filename: string): Promise<void> {
    const { token } = getStoredAuth()
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error(`Download fehlgeschlagen: ${res.status}`)
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = filename
    a.click()
    URL.revokeObjectURL(blobUrl)
  },

  deleteRun(runId: string): Promise<void> {
    return request(`/runs/${runId}`, { method: 'DELETE' })
  },

  cancelRun(runId: string): Promise<void> {
    return request(`/runs/${runId}/cancel`, { method: 'POST' })
  },

  async exportRuns(format: 'csv' | 'xlsx', portal?: string): Promise<void> {
    const params = new URLSearchParams({ format })
    if (portal) params.set('portal', portal)
    const { token } = getStoredAuth()
    const res = await fetch(`${BASE}/runs/export?${params}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error(`Export fehlgeschlagen: ${res.status}`)
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = `auslieferungen.${format}`
    a.click()
    URL.revokeObjectURL(blobUrl)
  },
}
