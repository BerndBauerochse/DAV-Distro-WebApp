import { clsx } from 'clsx'

const CONFIG = {
  running:   { label: 'Läuft',      cls: 'bg-blue-100 text-blue-800 border-blue-200' },
  uploading: { label: 'Überträgt',  cls: 'bg-blue-100 text-blue-800 border-blue-200' },
  completed: { label: 'Abgeschlossen', cls: 'bg-green-100 text-green-800 border-green-200' },
  success:   { label: 'Erfolgreich', cls: 'bg-green-100 text-green-800 border-green-200' },
  failed:    { label: 'Fehler',     cls: 'bg-red-100 text-red-800 border-red-200' },
  skipped:   { label: 'Übersprungen', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  pending:   { label: 'Ausstehend', cls: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  cancelled: { label: 'Abgebrochen', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
} as const

type Status = keyof typeof CONFIG

interface Props {
  status: string
  className?: string
}

export function StatusBadge({ status, className }: Props) {
  const cfg = CONFIG[status as Status] ?? { label: status, cls: 'bg-gray-100 text-gray-600 border-gray-200' }
  return (
    <span className={clsx(
      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border',
      cfg.cls,
      className
    )}>
      {status === 'running' || status === 'uploading' ? (
        <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5 animate-pulse" />
      ) : null}
      {cfg.label}
    </span>
  )
}
