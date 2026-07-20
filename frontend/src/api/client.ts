import type { DeliveryRun, DeliveryLog, Portal, FileEntry, FileCategory, BatchPreview, CatalogMap } from '../types'
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
  outlookStatus(): Promise<{ configured: boolean; mailbox: string | null; default_cc: string | null }> {
    return request('/mail/outlook/status')
  },

  createOutlookDraft(payload: {
    to: string
    subject: string
    body: string
    is_html?: boolean
    cc?: string | null
    bcc?: string | null
    run_id?: string | null
    with_attachment?: boolean
  }): Promise<{ ok: boolean; web_link: string | null }> {
    return request('/mail/outlook/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  },

  sendOutlookMail(payload: {
    to: string
    subject: string
    body: string
    is_html?: boolean
    cc?: string | null
    bcc?: string | null
    run_id?: string | null
    with_attachment?: boolean
  }): Promise<{ ok: boolean }> {
    return request('/mail/outlook/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  },

  login(username: string, password: string): Promise<{ access_token: string; username: string }> {
    return request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
  },

  getRuns(portal?: string, limit = 50, offset = 0, initiated_by?: string): Promise<DeliveryRun[]> {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    if (portal) params.set('portal', portal)
    if (initiated_by) params.set('initiated_by', initiated_by)
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

  async startRun(portal: string, file?: File, takedown = false, updateField?: string): Promise<{ run_id: string }> {
    const form = new FormData()
    form.append('portal', portal)
    if (file) form.append('metadata_file', file)
    if (takedown) form.append('takedown', 'true')
    if (updateField) form.append('update_field', updateField)
    return request('/runs', { method: 'POST', body: form })
  },

  async startRunByServerFile(portal: string, serverFilename: string, takedown = false, updateField?: string): Promise<{ run_id: string }> {
    const form = new FormData()
    form.append('portal', portal)
    form.append('metadata_server_file', serverFilename)
    if (takedown) form.append('takedown', 'true')
    if (updateField) form.append('update_field', updateField)
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

  getCatalog(): Promise<CatalogMap> {
    return request('/catalog')
  },

  getCoverExchangePortals(): Promise<Portal[]> {
    return request('/covers/exchange/portals')
  },

  exchangeCovers(portals: string[], filenames: string[]): Promise<{
    results: { portal: string; filename: string | null; status: string; error: string | null }[]
  }> {
    return request('/covers/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portals, filenames }),
    })
  },

  updateTocAtAudible(filenames: string[]): Promise<{
    results: { filename: string; ean: string | null; status: string; error: string | null }[]
  }> {
    return request('/toc/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames }),
    })
  },

  syncCatalog(): Promise<{ synced: number }> {
    return request('/catalog/sync', { method: 'POST' })
  },

  cancelRun(runId: string): Promise<void> {
    return request(`/runs/${runId}/cancel`, { method: 'POST' })
  },

  async exportRuns(format: 'csv' | 'xlsx', portal?: string, initiated_by?: string): Promise<void> {
    const params = new URLSearchParams({ format })
    if (portal) params.set('portal', portal)
    if (initiated_by) params.set('initiated_by', initiated_by)
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
