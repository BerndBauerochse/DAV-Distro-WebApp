import { useState, useRef } from 'react'
import { Upload, Play } from 'lucide-react'
import { clsx } from 'clsx'
import type { Portal } from '../types'
import { api } from '../api/client'

interface Props {
  portals: Portal[]
  onStarted: (runId: string) => void
}

export function StartDelivery({ portals, onStarted }: Props) {
  const [portal, setPortal] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!portal) return
    setLoading(true)
    setError(null)
    try {
      const result = await api.startRun(portal, file ?? undefined)
      onStarted(result.run_id)
      setPortal('')
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Play className="w-4 h-4 text-blue-600" />
        Neue Auslieferung starten
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Portal</label>
          <select
            value={portal}
            onChange={e => setPortal(e.target.value)}
            required
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Portal auswählen…</option>
            {portals.map(p => (
              <option key={p.key} value={p.key}>{p.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Metadatei <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <div
            className={clsx(
              'flex items-center gap-3 rounded-lg border-2 border-dashed px-4 py-3 cursor-pointer transition-colors',
              file ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
            )}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="text-sm text-gray-600 truncate">
              {file ? file.name : 'XML oder Excel hochladen…'}
            </span>
            {file && (
              <button
                type="button"
                className="ml-auto text-xs text-gray-400 hover:text-red-500"
                onClick={e => { e.stopPropagation(); setFile(null); if (fileRef.current) fileRef.current.value = '' }}
              >
                ✕
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xml,.xlsx,.xls"
            className="hidden"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={!portal || loading}
          className={clsx(
            'w-full py-2.5 px-4 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2',
            !portal || loading
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800'
          )}
        >
          {loading ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Starte…
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Auslieferung starten
            </>
          )}
        </button>
      </form>
    </div>
  )
}
