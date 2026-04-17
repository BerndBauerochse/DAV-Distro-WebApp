import { useState, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Zap } from 'lucide-react'
import { ActiveRunCard } from './ActiveRunCard'
import { BatchBuilder } from './BatchBuilder'
import { MailDraftModal } from './MailDraftModal'
import { useWebSocket } from '../hooks/useWebSocket'
import { api } from '../api/client'
import type { DeliveryRun, WsEvent, ActiveTransfer, MailDraft } from '../types'

export function Dashboard() {
  const qc = useQueryClient()
  const [activeRuns, setActiveRuns] = useState<Map<string, DeliveryRun>>(new Map())
  const [transfers, setTransfers] = useState<Map<string, ActiveTransfer[]>>(new Map())
  const [mailDraft, setMailDraft] = useState<{ runId: string; draft: MailDraft; portalName: string } | null>(null)

  const { data: initialRuns } = useQuery({
    queryKey: ['active-runs'],
    queryFn: () => api.getRuns(undefined, 20, 0),
  })

  useEffect(() => {
    if (initialRuns) {
      const running = initialRuns.filter(r => r.status === 'running')
      setActiveRuns(new Map(running.map(r => [r.id, r])))
    }
  }, [initialRuns])

  const handleWsEvent = useCallback((event: WsEvent) => {
    if (event.type === 'run_update') {
      if (event.status === 'running') {
        setActiveRuns(prev => {
          const next = new Map(prev)
          const existing = next.get(event.run_id)
          next.set(event.run_id, {
            id: event.run_id,
            portal: event.portal,
            metadata_filename: existing?.metadata_filename ?? null,
            initiated_by: existing?.initiated_by ?? null,
            status: event.status,
            total_files: event.total_files,
            completed_files: event.completed_files,
            failed_files: event.failed_files,
            skipped_files: event.skipped_files,
            started_at: existing?.started_at ?? new Date().toISOString(),
            finished_at: null,
          })
          return next
        })
      } else {
        setActiveRuns(prev => { const n = new Map(prev); n.delete(event.run_id); return n })
        setTransfers(prev => { const n = new Map(prev); n.delete(event.run_id); return n })
        qc.invalidateQueries({ queryKey: ['runs'] })
        if (event.mail_draft) {
          const portalName = event.portal.charAt(0).toUpperCase() + event.portal.slice(1)
          setMailDraft({ runId: event.run_id, draft: event.mail_draft, portalName })
        }
      }
    }

    if (event.type === 'progress') {
      setActiveRuns(prev => {
        const run = prev.get(event.run_id)
        if (!run) return prev
        const next = new Map(prev)
        next.set(event.run_id, { ...run })
        return next
      })
      setTransfers(prev => {
        const runTransfers = prev.get(event.run_id) ?? []
        const existing = runTransfers.findIndex(t => t.file_name === event.file_name)
        const updated: ActiveTransfer = {
          run_id: event.run_id, portal: event.portal, ean: event.ean,
          file_name: event.file_name, file_type: event.file_type,
          current_bytes: event.current_bytes, total_bytes: event.total_bytes,
          status: event.status, error: event.error,
        }
        const newTransfers = existing >= 0
          ? runTransfers.map((t, i) => i === existing ? updated : t)
          : [updated, ...runTransfers].slice(0, 20)
        const next = new Map(prev)
        next.set(event.run_id, newTransfers)
        return next
      })
    }
  }, [qc])

  useWebSocket(handleWsEvent)

  const handleStarted = useCallback((runId: string) => {
    setActiveRuns(prev => {
      const next = new Map(prev)
      next.set(runId, {
        id: runId, portal: '…', metadata_filename: null, initiated_by: null,
        status: 'running', total_files: 0, completed_files: 0, failed_files: 0,
        skipped_files: 0, started_at: new Date().toISOString(), finished_at: null,
      })
      return next
    })
  }, [])

  const activeRunList = Array.from(activeRuns.values())

  return (
    <div className="space-y-6">
      {mailDraft && (
        <MailDraftModal
          runId={mailDraft.runId}
          draft={mailDraft.draft}
          portalName={mailDraft.portalName}
          onClose={() => setMailDraft(null)}
        />
      )}

      {/* Layout: two column on large screens */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">

        {/* Left: Batch builder */}
        <div className="glass-card p-5">
          <BatchBuilder onStarted={handleStarted} />
        </div>

        {/* Right: Active runs */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4" style={{ color: '#22d3ee' }} />
            <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider">
              Aktive Auslieferungen
            </h2>
            {activeRunList.length > 0 && (
              <span className="ml-1 text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: 'rgba(34,211,238,0.15)', color: '#22d3ee', border: '1px solid rgba(34,211,238,0.25)' }}>
                {activeRunList.length}
              </span>
            )}
          </div>

          {activeRunList.length === 0 ? (
            <div className="glass-card px-5 py-10 text-center">
              <div className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--glass-border)' }}>
                <Zap className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
              </div>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Keine aktiven Auslieferungen</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
                Lade eine Metadatei und starte eine Auslieferung
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeRunList.map(run => (
                <ActiveRunCard
                  key={run.id}
                  run={run}
                  transfers={transfers.get(run.id) ?? []}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
