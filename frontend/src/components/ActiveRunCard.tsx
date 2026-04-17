import { FileArchive, FileText, AlertCircle } from 'lucide-react'
import { ProgressBar } from './ProgressBar'
import { StatusBadge } from './StatusBadge'
import type { DeliveryRun, ActiveTransfer } from '../types'

interface Props {
  run: DeliveryRun
  transfers: ActiveTransfer[]
}

export function ActiveRunCard({ run, transfers }: Props) {
  const overallPct = run.total_files > 0
    ? Math.round(((run.completed_files + run.failed_files + run.skipped_files) / run.total_files) * 100)
    : 0

  return (
    <div className="glass-card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--glass-border)' }}>
        <div>
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-white/90 text-base">{run.portal.toUpperCase()}</h3>
            <StatusBadge status={run.status} />
          </div>
          {run.metadata_filename && (
            <p className="text-xs mt-0.5 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
              <FileText className="w-3 h-3" />
              {run.metadata_filename}
            </p>
          )}
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold" style={{
            background: 'linear-gradient(135deg,#22d3ee,#a78bfa)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>{overallPct}%</div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {run.completed_files}/{run.total_files} Dateien
          </div>
        </div>
      </div>

      {/* Progress bar area */}
      <div className="px-5 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: 'rgba(0,0,0,0.15)' }}>
        <div className="flex gap-4 text-xs mb-2">
          <span style={{ color: '#4ade80' }}>✓ {run.completed_files} OK</span>
          {run.failed_files > 0 && <span style={{ color: '#f87171' }}>✗ {run.failed_files} Fehler</span>}
          {run.skipped_files > 0 && <span style={{ color: 'var(--text-muted)' }}>⊘ {run.skipped_files} übersprungen</span>}
          <span className="ml-auto font-mono" style={{ color: 'var(--text-muted)' }}>{run.id.slice(0, 8)}…</span>
        </div>
        {/* Segmented progress */}
        <div className="w-full rounded-full h-2 overflow-hidden flex" style={{ background: 'rgba(255,255,255,0.06)' }}>
          {run.total_files > 0 && (
            <>
              <div className="h-2 transition-all duration-500"
                style={{ width: `${(run.completed_files / run.total_files) * 100}%`, background: 'linear-gradient(90deg,#4ade80,#22c55e)' }} />
              <div className="h-2 transition-all duration-500"
                style={{ width: `${(run.failed_files / run.total_files) * 100}%`, background: '#f87171' }} />
              <div className="h-2 transition-all duration-500"
                style={{ width: `${(run.skipped_files / run.total_files) * 100}%`, background: 'rgba(255,255,255,0.2)' }} />
            </>
          )}
        </div>
      </div>

      {/* Active transfers */}
      {transfers.length > 0 && (
        <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
          {transfers.map((t, i) => (
            <TransferRow key={`${t.run_id}-${t.file_name}-${i}`} transfer={t} />
          ))}
        </div>
      )}

      {transfers.length === 0 && run.status === 'running' && (
        <div className="px-5 py-4 text-sm italic" style={{ color: 'var(--text-muted)' }}>
          Vorbereitung läuft…
        </div>
      )}
    </div>
  )
}

function TransferRow({ transfer }: { transfer: ActiveTransfer }) {
  const isFailed  = transfer.status === 'failed'
  const isSuccess = transfer.status === 'success'

  return (
    <div className="px-5 py-3 glass-row"
      style={{
        background: isFailed ? 'rgba(248,113,113,0.06)' : isSuccess ? 'rgba(74,222,128,0.04)' : undefined,
      }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {transfer.file_type === 'metadata'
            ? <FileText    className="w-4 h-4 shrink-0" style={{ color: '#a78bfa' }} />
            : <FileArchive className="w-4 h-4 shrink-0" style={{ color: '#22d3ee' }} />
          }
          <div className="min-w-0">
            <p className="text-sm font-medium text-white/80 truncate">{transfer.file_name}</p>
            {transfer.ean && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>EAN: {transfer.ean}</p>
            )}
          </div>
        </div>
        <StatusBadge status={transfer.status} className="shrink-0" />
      </div>

      {transfer.status === 'uploading' && (
        <ProgressBar current={transfer.current_bytes} total={transfer.total_bytes}
          status={transfer.status} className="mt-2" />
      )}

      {isFailed && transfer.error && (
        <div className="mt-2 flex items-start gap-1.5 text-xs" style={{ color: '#f87171' }}>
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="break-all">{transfer.error}</span>
        </div>
      )}
    </div>
  )
}
