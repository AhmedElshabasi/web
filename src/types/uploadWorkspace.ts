/** Stored on `uploads.report_status` for non-rubric batches only. */
export type UploadReportStatus = 'todo' | 'in_progress' | 'urgent' | 'done'

export const UPLOAD_REPORT_STATUS_LABELS: Record<UploadReportStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  urgent: 'Urgent',
  done: 'Done',
}

export function isUploadReportStatus(value: string | null | undefined): value is UploadReportStatus {
  return value === 'todo' || value === 'in_progress' || value === 'urgent' || value === 'done'
}

export type UploadFileRow = {
  id: string
  original_name: string
  mime: string | null
  size: number | null
  storage_path: string
}

/** Notes left by other workspace members on an upload (not the uploader’s share note). */
export type UploadNoteRow = {
  id: string
  author_email: string | null
  body: string
  created_at: string | null
}

export type UploadPackageRow = {
  id: string
  uploader_email: string | null
  /** Set when creating the upload in File Share. */
  note: string | null
  /** True when the uploader marked the batch as a rubric. */
  is_rubric?: boolean | null
  /** Set for report uploads; null for rubrics. */
  report_status?: UploadReportStatus | null
  /** Rubric package this report was last evaluated against (set on successful Generate insights). */
  linked_rubric_upload_id?: string | null
  created_at: string | null
  team_id?: string | null
  upload_files: UploadFileRow[] | null
  upload_notes?: UploadNoteRow[] | null
}
