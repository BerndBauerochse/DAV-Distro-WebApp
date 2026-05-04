import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown, ChevronRight, Search, FileArchive, FileText, AlertCircle,
  Settings, Image, Trash2, X, Download, FileSpreadsheet,
} from 'lucide-react'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { StatusBadge } from './StatusBadge'
import { api } from '../api/client'
import type { DeliveryRun, DeliveryLog } from '../types'

const PAGE_SIZE = 20

export function History() {
  const [portalFilter, setPortalFilter] = useState('')
  const [search, setSearch] = useState('')
  const [expandedRun, setExpandedRun] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null)
  const qc = useQueryClient()

  const { data: portals = [] } = useQuery({ queryKey: ['portals'], queryFn: api.getPortals })
  const portalNames = Object.fromEntries(portals.map(p => [p.key, p.name]))

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['runs', portalFilter, limit],
    queryFn: () => api.getRuns(portalFilter || undefined, limit),
  })

  const deleteMutation = useMutation({
    mutationFn: (runId: string) => api.deleteRun(runId),
    onMutate: async (runId) => {
      await qc.cancelQueries({ queryKey: ['runs'] })
      const previous = qc.getQueryData(['runs', portalFilter, limit])
      qc.setQueryData(['runs', portalFilter, limit], (old: DeliveryRun[] = []) =>
        old.filter(r => r.id !== runId)
      )
      return { previous }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(['runs', portalFilter, limit], ctx.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['runs'] }),
  })

  const cancelMutation = useMutation({
    mutationFn: (runId: string) => api.cancelRun(runId),
  })

  const filtered = runs.filter(r => {
    if (!search) return true
    const s = search.toLowerCase()
    return r.portal.toLowerCase().includes(s) ||
      r.id.toLowerCase().includes(s) ||
      r.metadata_filename?.toLowerCase().includes(s) ||
      r.initiated_by?.toLowerCase().includes(s)
  })

  async function handleExport(fmt: 'csv' | 'xlsx') {
    setExporting(fmt)
    try { await api.exportRuns(fmt, portalFilter || undefined) }
    catch (e) { console.error('Export fehlgeschlagen', e) }
    finally { setExporting(null) }
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="EAN, Portal, Datei, Benutzer…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="glass-input w-full pl-9"
          />
        </div>
        <select
          value={portalFilter}
          onChange={e => setPortalFilter(e.target.value)}
          className="glass-select"
        >
          <option value="">Alle Portale</option>
          {portals.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
        </select>

        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => handleExport('csv')} disabled={exporting !== null}
            className="btn-ghost flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5" />
            {exporting === 'csv' ? 'Exportiert…' : 'CSV'}
          </button>
          <button onClick={() => handleExport('xlsx')} disabled={exporting !== null}
            className="btn-ghost flex items-center gap-1.5">
            <FileSpreadsheet className="w-3.5 h-3.5" />
            {exporting === 'xlsx' ? 'Exportiert…' : 'Excel'}
          </button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="glass-card p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Lädt…</div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          Keine Einträge gefunden
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                {['', 'Portal', 'Metadatei', 'Status', 'Dateien', 'Benutzer', 'Gestartet', 'Dauer', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 text-left"
                    style={{ fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.07em',
                      textTransform: 'uppercase', color: 'var(--text-muted)',
                      background: 'rgba(0,0,0,0.2)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(run => (
                <RunRow
                  key={run.id}
                  run={run}
                  portalName={portalNames[run.portal] ?? run.portal.toUpperCase()}
                  expanded={expandedRun === run.id}
                  onToggle={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                  onDelete={() => deleteMutation.mutate(run.id)}
                  onCancel={() => cancelMutation.mutate(run.id)}
                  isDeleting={deleteMutation.isPending && deleteMutation.variables === run.id}
                  isCancelling={cancelMutation.isPending && cancelMutation.variables === run.id}
                />
              ))}
            </tbody>
          </table>

          {runs.length === limit && (
            <div className="px-4 py-3 text-center" style={{ borderTop: '1px solid var(--glass-border)' }}>
              <button
                onClick={() => setLimit(l => l + PAGE_SIZE)}
                className="text-sm font-medium"
                style={{ color: '#22d3ee' }}
              >
                Mehr laden
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface RunRowProps {
  run: DeliveryRun; portalName: string; expanded: boolean
  onToggle: () => void; onDelete: () => void; onCancel: () => void
  isDeleting: boolean; isCancelling: boolean
}

function RunRow({ run, portalName, expanded, onToggle, onDelete, onCancel, isDeleting, isCancelling }: RunRowProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)

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
        className="glass-row cursor-pointer"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
        onClick={onToggle}
      >
        <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>
          {expanded
            ? <ChevronDown  className="w-4 h-4" />
            : <ChevronRight className="w-4 h-4" />}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white/85">{portalName}</span>
            {run.takedown && (
              <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold"
                style={{ background: 'rgba(251,146,60,0.18)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.35)' }}>
                Takedown
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-3 max-w-xs truncate" style={{ color: 'var(--text-secondary)' }}>
          {run.metadata_filename ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}
        </td>
        <td className="px-4 py-3"><StatusBadge status={run.status} /></td>
        <td className="px-4 py-3">
          <span className="font-medium" style={{ color: '#4ade80' }}>{run.completed_files}</span>
          <span style={{ color: 'var(--text-muted)' }}> / {run.total_files}</span>
          {run.failed_files > 0 && <span className="ml-1.5 text-xs" style={{ color: '#f87171' }}>({run.failed_files} Fehler)</span>}
          {run.skipped_files > 0 && <span className="ml-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>({run.skipped_files} übersp.)</span>}
        </td>
        <td className="px-4 py-3 capitalize" style={{ color: 'var(--text-secondary)' }}>
          {run.initiated_by ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}
        </td>
        <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {format(new Date(run.started_at), 'dd.MM.yy HH:mm', { locale: de })}
        </td>
        <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{duration}</td>
        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1 justify-end">
            {run.status === 'running' && (
              <button onClick={onCancel} disabled={isCancelling}
                className="p-1.5 rounded-lg transition-colors disabled:opacity-50"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#fb923c')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                title="Abbrechen">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <button onClick={() => { onDelete(); setConfirmDelete(false) }} disabled={isDeleting}
                  className="px-2 py-1 text-xs rounded-lg font-medium disabled:opacity-50 transition-colors"
                  style={{ background: 'rgba(248,113,113,0.2)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' }}>
                  {isDeleting ? '…' : 'Löschen'}
                </button>
                <button onClick={() => setConfirmDelete(false)}
                  className="px-2 py-1 text-xs rounded-lg"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>
                  Nein
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} disabled={run.status === 'running'}
                className="p-1.5 rounded-lg transition-colors disabled:opacity-25"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                title="Löschen">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </td>
      </tr>

      {expanded && logs && (
        <tr>
          <td colSpan={9} className="p-0" style={{ background: 'rgba(0,0,0,0.2)' }}>
            <LogTable logs={logs} />
          </td>
        </tr>
      )}
    </>
  )
}

function LogTable({ logs }: { logs: DeliveryLog[] }) {
  const visible = logs.filter(l => l.status !== 'pending' && l.status !== 'uploading')
  const eans = [...new Set(logs.map(l => l.ean).filter(Boolean) as string[])]

  if (logs.length === 0) {
    return <p className="px-8 py-4 text-sm italic" style={{ color: 'var(--text-muted)' }}>Keine Log-Einträge</p>
  }

  return (
    <div className="px-8 py-3 overflow-x-auto">
      {eans.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {eans.map(ean => (
            <span key={ean} className="inline-block text-xs font-mono px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(34,211,238,0.1)', color: '#22d3ee', border: '1px solid rgba(34,211,238,0.2)' }}>
              {ean}
            </span>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-xs italic py-1" style={{ color: 'var(--text-muted)' }}>Keine abgeschlossenen Einträge</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              {['EAN', 'Datei', 'Typ', 'Ziel', 'Größe', 'Status', 'Zeit'].map(h => (
                <th key={h} className="pb-2 pr-4 text-left section-label">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map(log => (
              <tr key={log.id}
                style={{ borderBottom: '1px solid rgba(255,255,255,0.03)',
                  background: log.status === 'failed' ? 'rgba(248,113,113,0.05)' : undefined }}>
                <td className="py-2 pr-4 font-mono" style={{ color: 'var(--text-secondary)' }}>{log.ean ?? '—'}</td>
                <td className="py-2 pr-4 max-w-xs">
                  <div className="flex items-center gap-1">
                    {log.file_type === 'metadata'   ? <FileText       className="w-3 h-3 shrink-0" style={{ color: '#a78bfa' }} />
                    : log.file_type === 'system'   ? <Settings       className="w-3 h-3 shrink-0" style={{ color: '#fb923c' }} />
                    : log.file_type === 'cover'    ? <Image          className="w-3 h-3 shrink-0" style={{ color: '#4ade80' }} />
                    : log.file_type === 'toc'      ? <FileSpreadsheet className="w-3 h-3 shrink-0" style={{ color: '#fbbf24' }} />
                    : log.file_type === 'pdf'      ? <FileText       className="w-3 h-3 shrink-0" style={{ color: '#fb923c' }} />
                    :                               <FileArchive     className="w-3 h-3 shrink-0" style={{ color: '#22d3ee' }} />}
                    <span className="truncate text-white/70">{log.file_name ?? '—'}</span>
                  </div>
                </td>
                <td className="py-2 pr-4" style={{ color: 'var(--text-muted)' }}>
                  {log.file_type === 'toc' ? '📋 TOC' : log.file_type === 'pdf' ? '📄 PDF' : log.file_type}
                </td>
                <td className="py-2 pr-4 max-w-xs truncate font-mono" style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                  {log.destination ?? '—'}
                </td>
                <td className="py-2 pr-4" style={{ color: 'var(--text-muted)' }}>
                  {log.file_size_bytes ? fmtBytes(log.file_size_bytes) : '—'}
                </td>
                <td className="py-2 pr-4">
                  <StatusBadge status={log.status} />
                  {log.status === 'failed' && log.error_log && (
                    <div className="flex items-start gap-1 mt-1" style={{ color: '#f87171' }}>
                      <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                      <span className="break-all">{log.error_log}</span>
                    </div>
                  )}
                </td>
                <td className="py-2" style={{ color: 'var(--text-muted)' }}>
                  {log.finished_at ? format(new Date(log.finished_at), 'HH:mm:ss') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

function durationStr(start: Date, end: Date) {
  const s = Math.round((end.getTime() - start.getTime()) / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}
