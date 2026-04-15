import { clsx } from 'clsx'
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
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-gray-900 text-lg">{run.portal.toUpperCase()}</h3>
            <StatusBadge status={run.status} />
          </div>
          {run.metadata_filename && (
            <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5" />
              {run.metadata_filename}
            </p>
          )}
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-gray-900">{overallPct}%</div>
          <div className="text-xs text-gray-500">
            {run.completed_files}/{run.total_files} Dateien
          </div>
        </div>
      </div>

      {/* Overall progress */}
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
        <div className="flex gap-4 text-sm mb-2">
          <span className="text-green-700 font-medium">✓ {run.completed_files} OK</span>
          {run.failed_files > 0 && (
            <span className="text-red-700 font-medium">✗ {run.failed_files} Fehler</span>
          )}
          {run.skipped_files > 0 && (
            <span className="text-gray-500">⊘ {run.skipped_files} übersprungen</span>
          )}
          <span className="text-gray-400 ml-auto text-xs">Run: {run.id.slice(0, 8)}…</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden flex">
          {run.total_files > 0 && (
            <>
              <div
                className="h-3 bg-green-500 transition-all duration-500"
                style={{ width: `${(run.completed_files / run.total_files) * 100}%` }}
              />
              <div
                className="h-3 bg-red-400 transition-all duration-500"
                style={{ width: `${(run.failed_files / run.total_files) * 100}%` }}
              />
              <div
                className="h-3 bg-gray-400 transition-all duration-500"
                style={{ width: `${(run.skipped_files / run.total_files) * 100}%` }}
              />
            </>
          )}
        </div>
      </div>

      {/* Active transfers */}
      {transfers.length > 0 && (
        <div className="divide-y divide-gray-50">
          {transfers.map((t, i) => (
            <TransferRow key={`${t.run_id}-${t.file_name}-${i}`} transfer={t} />
          ))}
        </div>
      )}

      {transfers.length === 0 && run.status === 'running' && (
        <div className="px-5 py-4 text-sm text-gray-400 italic">
          Vorbereitung läuft…
        </div>
      )}
    </div>
  )
}

function TransferRow({ transfer }: { transfer: ActiveTransfer }) {
  return (
    <div className={clsx(
      'px-5 py-3',
      transfer.status === 'failed' && 'bg-red-50',
      transfer.status === 'success' && 'bg-green-50/50',
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {transfer.file_type === 'metadata' ? (
            <FileText className="w-4 h-4 text-purple-500 shrink-0" />
          ) : (
            <FileArchive className="w-4 h-4 text-blue-500 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-800 truncate">{transfer.file_name}</p>
            {transfer.ean && (
              <p className="text-xs text-gray-400">EAN: {transfer.ean}</p>
            )}
          </div>
        </div>
        <StatusBadge status={transfer.status} className="shrink-0" />
      </div>

      {transfer.status === 'uploading' && (
        <ProgressBar
          current={transfer.current_bytes}
          total={transfer.total_bytes}
          status={transfer.status}
          className="mt-2"
        />
      )}

      {transfer.status === 'failed' && transfer.error && (
        <div className="mt-2 flex items-start gap-1.5 text-xs text-red-600">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="break-all">{transfer.error}</span>
        </div>
      )}
    </div>
  )
}
