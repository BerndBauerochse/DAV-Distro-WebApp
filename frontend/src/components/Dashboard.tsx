import { useState, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import { ActiveRunCard } from './ActiveRunCard'
import { StartDelivery } from './StartDelivery'
import { useWebSocket } from '../hooks/useWebSocket'
import { api } from '../api/client'
import type { DeliveryRun, WsEvent, ActiveTransfer } from '../types'

export function Dashboard() {
  const qc = useQueryClient()
  const [activeRuns, setActiveRuns] = useState<Map<string, DeliveryRun>>(new Map())
  const [transfers, setTransfers] = useState<Map<string, ActiveTransfer[]>>(new Map())

  const { data: portals = [] } = useQuery({
    queryKey: ['portals'],
    queryFn: api.getPortals,
  })

  // Fetch currently running runs on mount
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
        // Run finished — remove from active, refresh history
        setActiveRuns(prev => {
          const next = new Map(prev)
          next.delete(event.run_id)
          return next
        })
        setTransfers(prev => {
          const next = new Map(prev)
          next.delete(event.run_id)
          return next
        })
        qc.invalidateQueries({ queryKey: ['runs'] })
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
          run_id: event.run_id,
          portal: event.portal,
          ean: event.ean,
          file_name: event.file_name,
          file_type: event.file_type,
          current_bytes: event.current_bytes,
          total_bytes: event.total_bytes,
          status: event.status,
          error: event.error,
        }

        let newTransfers: ActiveTransfer[]
        if (existing >= 0) {
          newTransfers = [...runTransfers]
          newTransfers[existing] = updated
        } else {
          // Keep last 20 transfers per run
          newTransfers = [updated, ...runTransfers].slice(0, 20)
        }

        const next = new Map(prev)
        next.set(event.run_id, newTransfers)
        return next
      })
    }
  }, [qc])

  useWebSocket(handleWsEvent)

  const handleStarted = useCallback((runId: string) => {
    // Optimistically add to active runs
    setActiveRuns(prev => {
      const next = new Map(prev)
      next.set(runId, {
        id: runId,
        portal: '…',
        metadata_filename: null,
        status: 'running',
        total_files: 0,
        completed_files: 0,
        failed_files: 0,
        skipped_files: 0,
        started_at: new Date().toISOString(),
        finished_at: null,
      })
      return next
    })
  }, [])

  const activeRunList = Array.from(activeRuns.values())

  return (
    <div className="space-y-6">
      {/* Start panel */}
      <StartDelivery portals={portals} onStarted={handleStarted} />

      {/* Active runs */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Aktive Auslieferungen
          {activeRunList.length > 0 && (
            <span className="ml-1 bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
              {activeRunList.length}
            </span>
          )}
        </h2>

        {activeRunList.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 px-5 py-8 text-center">
            <Activity className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Keine aktiven Auslieferungen</p>
          </div>
        ) : (
          <div className="space-y-4">
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
  )
}
