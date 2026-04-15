import { clsx } from 'clsx'

interface Props {
  current: number
  total: number
  status: string
  className?: string
}

export function ProgressBar({ current, total, status, className }: Props) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0

  const barColor = clsx({
    'bg-blue-500': status === 'uploading',
    'bg-green-500': status === 'success',
    'bg-red-500': status === 'failed',
    'bg-gray-400': status === 'skipped' || status === 'pending',
  })

  return (
    <div className={clsx('w-full', className)}>
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{formatBytes(current)} / {formatBytes(total)}</span>
        <span className="font-medium">{pct}%</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
        <div
          className={clsx('h-2 rounded-full transition-all duration-300', barColor)}
          style={{ width: `${pct}%` }}
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
