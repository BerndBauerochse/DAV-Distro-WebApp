import { clsx } from 'clsx'

const CONFIG = {
  running:   { label: 'Läuft',          cls: 'bg-cyan-400/15 text-cyan-300 border-cyan-400/25',   dot: 'bg-cyan-400 animate-pulse' },
  uploading: { label: 'Überträgt',      cls: 'bg-blue-400/15 text-blue-300 border-blue-400/25',   dot: 'bg-blue-400 animate-pulse' },
  completed: { label: 'Abgeschlossen',  cls: 'bg-green-400/15 text-green-300 border-green-400/25', dot: 'bg-green-400' },
  success:   { label: 'Erfolgreich',    cls: 'bg-green-400/15 text-green-300 border-green-400/25', dot: 'bg-green-400' },
  failed:    { label: 'Fehler',         cls: 'bg-red-400/15 text-red-300 border-red-400/25',       dot: 'bg-red-400' },
  skipped:   { label: 'Übersprungen',   cls: 'bg-white/5 text-white/40 border-white/10',           dot: 'bg-white/30' },
  pending:   { label: 'Ausstehend',     cls: 'bg-amber-400/15 text-amber-300 border-amber-400/25', dot: 'bg-amber-400' },
  cancelled: { label: 'Abgebrochen',    cls: 'bg-white/5 text-white/40 border-white/10',           dot: 'bg-white/30' },
} as const

type Status = keyof typeof CONFIG

interface Props {
  status: string
  className?: string
}

export function StatusBadge({ status, className }: Props) {
  const cfg = CONFIG[status as Status] ?? {
    label: status,
    cls: 'bg-white/5 text-white/40 border-white/10',
    dot: 'bg-white/30',
  }

  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border backdrop-blur-sm',
      cfg.cls,
      className,
    )}>
      <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', cfg.dot)} />
      {cfg.label}
    </span>
  )
}
