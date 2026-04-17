import { clsx } from 'clsx'

interface Props {
  current: number
  total: number
  status: string
  className?: string
}

export function ProgressBar({ current, total, status, className }: Props) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0

  const barStyle: React.CSSProperties =
    status === 'uploading' ? { background: 'linear-gradient(90deg, #22d3ee, #0ea5e9)' } :
    status === 'success'   ? { background: 'linear-gradient(90deg, #4ade80, #22c55e)' } :
    status === 'failed'    ? { background: 'linear-gradient(90deg, #f87171, #ef4444)' } :
                             { background: 'rgba(255,255,255,0.2)' }

  return (
    <div className={clsx('w-full', className)}>
      <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
        <span>{formatBytes(current)} / {formatBytes(total)}</span>
        <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{pct}%</span>
      </div>
      <div className="w-full rounded-full h-1.5 overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <div
          className="h-1.5 rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, ...barStyle }}
        />
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
