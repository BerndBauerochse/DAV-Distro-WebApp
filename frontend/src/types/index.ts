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
  mail_draft?: MailDraft | null
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

export interface BookInfo {
  ean: string
  title: string
  author: string
  abridged: boolean | null   // true=Gekürzt, false=Ungekürzt, null=unbekannt
  zip_available: boolean
}

export interface PortalVariant {
  key: string
  label: string
}

export interface BatchPreview {
  filename: string
  detected_portal: string
  portal_variants: PortalVariant[]
  books: BookInfo[]
}

export interface MailDraft {
  to: string
  subject: string
  body: string
  is_html?: boolean
  attachment?: { filename: string; download_url: string }
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
  mail_draft?: MailDraft
}

export type WsEvent = ProgressEvent | RunUpdateEvent

export interface FileEntry {
  name: string
  size: number
  modified: number
}

export type FileCategory = 'zips' | 'toc' | 'pdf' | 'covers'

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
