export interface DeliveryRun {
  id: string
  portal: string
  metadata_filename: string | null
  initiated_by: string | null
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  total_files: number
  completed_files: number
  failed_files: number
  skipped_files: number
  started_at: string
  finished_at: string | null
}

export interface DeliveryLog {
  id: number
  run_id: string
  portal: string
  ean: string | null
  file_type: string
  file_name: string | null
  destination: string | null
  status: 'pending' | 'uploading' | 'success' | 'failed' | 'skipped'
  error_log: string | null
  file_size_bytes: number | null
  created_at: string
  finished_at: string | null
}

export interface Portal {
  key: string
  name: string
}

// WebSocket event types
export interface ProgressEvent {
  type: 'progress'
  run_id: string
  portal: string
  ean: string | null
  file_name: string
  file_type: string
  current_bytes: number
  total_bytes: number
  status: 'uploading' | 'success' | 'failed' | 'skipped'
  error: string | null
}

export interface RunUpdateEvent {
  type: 'run_update'
  run_id: string
  portal: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  total_files: number
  completed_files: number
  failed_files: number
  skipped_files: number
}

export type WsEvent = ProgressEvent | RunUpdateEvent

export interface ActiveTransfer {
  run_id: string
  portal: string
  ean: string | null
  file_name: string
  file_type: string
  current_bytes: number
  total_bytes: number
  status: string
  error: string | null
}
