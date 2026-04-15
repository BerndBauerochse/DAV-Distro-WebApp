import type { DeliveryRun, DeliveryLog, Portal } from '../types'
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
}
