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
  created_at: string | null
  team_id?: string | null
  upload_files: UploadFileRow[] | null
  upload_notes?: UploadNoteRow[] | null
}
