import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Search, FileArchive, FileText, AlertCircle } from 'lucide-react'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { StatusBadge } from './StatusBadge'
import { api } from '../api/client'
import type { DeliveryRun, DeliveryLog } from '../types'

export function History() {
  const [portalFilter, setPortalFilter] = useState('')
  const [search, setSearch] = useState('')
  const [expandedRun, setExpandedRun] = useState<string | null>(null)

  const { data: portals = [] } = useQuery({
    queryKey: ['portals'],
    queryFn: api.getPortals,
  })

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['runs', portalFilter],
    queryFn: () => api.getRuns(portalFilter || undefined, 100),
  })

  const filtered = runs.filter(r => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      r.portal.toLowerCase().includes(s) ||
      r.id.toLowerCase().includes(s) ||
      r.metadata_filename?.toLowerCase().includes(s)
    )
  })

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="EAN, Portal, Datei…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={portalFilter}
          onChange={e => setPortalFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Alle Portale</option>
          {portals.map(p => (
            <option key={p.key} value={p.key}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
          Lädt…
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
          Keine Einträge gefunden
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3 w-8"></th>
                <th className="px-4 py-3">Portal</th>
                <th className="px-4 py-3">Metadatei</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Dateien</th>
                <th className="px-4 py-3">Gestartet</th>
                <th className="px-4 py-3">Dauer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(run => (
                <RunRow
                  key={run.id}
                  run={run}
                  expanded={expandedRun === run.id}
                  onToggle={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RunRow({ run, expanded, onToggle }: { run: DeliveryRun; expanded: boolean; onToggle: () => void }) {
  const { data: logs } = useQuery({
    queryKey: ['run-logs', run.id],
    queryFn: () => api.getRunLogs(run.id),
    enabled: expanded,
  })

  const duration = run.finished_at
    ? durationStr(new Date(run.started_at), new Date(run.finished_at))
    : run.status === 'running' ? 'Läuft…' : '—'

  return (
    <>
      <tr
        className="hover:bg-gray-50 cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-4 py-3 text-gray-400">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </td>
        <td className="px-4 py-3 font-medium text-gray-900">{run.portal.toUpperCase()}</td>
        <td className="px-4 py-3 text-gray-500 max-w-xs truncate">
          {run.metadata_filename ?? <span className="text-gray-300">—</span>}
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={run.status} />
        </td>
        <td className="px-4 py-3 text-gray-600">
          <span className="text-green-700">{run.completed_files}</span>
          {' / '}
          {run.total_files}
          {run.failed_files > 0 && (
            <span className="text-red-500 ml-1">({run.failed_files} Fehler)</span>
          )}
        </td>
        <td className="px-4 py-3 text-gray-500">
          {format(new Date(run.started_at), 'dd.MM.yy HH:mm', { locale: de })}
        </td>
        <td className="px-4 py-3 text-gray-400 text-xs">{duration}</td>
      </tr>

      {expanded && logs && (
        <tr>
          <td colSpan={7} className="px-0 py-0 bg-gray-50 border-b border-gray-100">
            <LogTable logs={logs} />
          </td>
        </tr>
      )}
    </>
  )
}

function LogTable({ logs }: { logs: DeliveryLog[] }) {
  if (logs.length === 0) {
    return <p className="px-8 py-4 text-sm text-gray-400 italic">Keine Log-Einträge</p>
  }

  return (
    <div className="px-8 py-3 overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-400 font-semibold uppercase tracking-wider text-left border-b border-gray-200">
            <th className="pb-2 pr-4">EAN</th>
            <th className="pb-2 pr-4">Datei</th>
            <th className="pb-2 pr-4">Typ</th>
            <th className="pb-2 pr-4">Ziel</th>
            <th className="pb-2 pr-4">Größe</th>
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2">Zeit</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {logs.map(log => (
            <tr key={log.id} className={log.status === 'failed' ? 'bg-red-50/50' : ''}>
              <td className="py-2 pr-4 font-mono text-gray-500">{log.ean ?? '—'}</td>
              <td className="py-2 pr-4 max-w-xs">
                <div className="flex items-center gap-1">
                  {log.file_type === 'metadata'
                    ? <FileText className="w-3 h-3 text-purple-400 shrink-0" />
                    : <FileArchive className="w-3 h-3 text-blue-400 shrink-0" />
                  }
                  <span className="truncate text-gray-700">{log.file_name ?? '—'}</span>
                </div>
              </td>
              <td className="py-2 pr-4 text-gray-400">{log.file_type}</td>
              <td className="py-2 pr-4 text-gray-400 max-w-xs truncate font-mono text-xs">{log.destination ?? '—'}</td>
              <td className="py-2 pr-4 text-gray-400">{log.file_size_bytes ? formatBytes(log.file_size_bytes) : '—'}</td>
              <td className="py-2 pr-4">
                <StatusBadge status={log.status} />
                {log.status === 'failed' && log.error_log && (
                  <div className="flex items-start gap-1 mt-1 text-red-600">
                    <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                    <span className="break-all">{log.error_log}</span>
                  </div>
                )}
              </td>
              <td className="py-2 text-gray-400">
                {log.finished_at
                  ? format(new Date(log.finished_at), 'HH:mm:ss')
                  : '—'
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function durationStr(start: Date, end: Date): string {
  const secs = Math.round((end.getTime() - start.getTime()) / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const rem = secs % 60
  return `${mins}m ${rem}s`
}
