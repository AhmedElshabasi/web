'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

export type UploadFileRow = {
  id: string
  original_name: string
  mime: string | null
  size: number | null
  storage_path: string
}

export type UploadPackageRow = {
  id: string
  uploader_email: string | null
  note: string | null
  created_at: string | null
  upload_files: UploadFileRow[] | null
}

type DeleteConfirmTarget = {
  uploadId: string
  fileId: string
  storagePath: string
  originalName: string
}

function ext(name: string) {
  const parts = name.split('.')
  return parts.length > 1 ? parts.pop()!.slice(0, 4).toUpperCase() : 'FILE'
}

function fmtSize(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`
  return `${(b / 1073741824).toFixed(2)} GB`
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function formatShortDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const ALLOWED_EXT = new Set(['pdf', 'docx'])
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

function extensionLower(name: string) {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

function isAllowedFile(file: File) {
  if (ALLOWED_EXT.has(extensionLower(file.name))) return true
  if (file.type && ALLOWED_MIME.has(file.type)) return true
  return false
}

function publicFileUrl(storagePath: string) {
  if (!supabaseBrowser) return null
  const { data } = supabaseBrowser.storage.from('uploads').getPublicUrl(storagePath)
  return data.publicUrl ?? null
}

export function FileShareDashboard({
  initialUploads,
  serverUploadCount,
  serverTotalBytes,
}: {
  initialUploads: UploadPackageRow[]
  serverUploadCount: number
  serverTotalBytes: number
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [queue, setQueue] = useState<File[]>([])
  const [note, setNote] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [lastBatchMeta, setLastBatchMeta] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmTarget | null>(null)

  const queueBytes = useMemo(() => queue.reduce((a, f) => a + f.size, 0), [queue])

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 2200)
  }, [])

  useEffect(() => {
    if (!deleteConfirm) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deletingId) setDeleteConfirm(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleteConfirm, deletingId])

  useEffect(() => {
    const supabase = supabaseBrowser
    if (!supabase) return

    let debounce: ReturnType<typeof setTimeout> | undefined
    const scheduleRefresh = () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        router.refresh()
        debounce = undefined
      }, 120)
    }

    const channel = supabase
      .channel('workspace-uploads-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'uploads' },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'upload_files' },
        scheduleRefresh,
      )
      .subscribe()

    return () => {
      if (debounce) clearTimeout(debounce)
      void supabase.removeChannel(channel)
    }
  }, [router])

  const addFiles = (newFiles: File[]) => {
    const allowed: File[] = []
    let skipped = 0
    for (const f of newFiles) {
      if (!isAllowedFile(f)) {
        skipped += 1
        continue
      }
      allowed.push(f)
    }
    if (skipped > 0) {
      showToast(`Only PDF and DOCX allowed. ${skipped} file${skipped === 1 ? '' : 's'} skipped.`)
    }
    if (!allowed.length) {
      setShowResult(false)
      setError(null)
      return
    }
    setQueue((prev) => {
      const next = [...prev]
      for (const f of allowed) {
        if (!next.find((x) => x.name === f.name && x.size === f.size)) next.push(f)
      }
      return next
    })
    setShowResult(false)
    setError(null)
  }

  const removeAt = (idx: number) => {
    setQueue((prev) => prev.filter((_, i) => i !== idx))
    setShowResult(false)
  }

  const hasFiles = queue.length > 0

  const generateShare = async () => {
    if (!queue.length) return
    setError(null)
    setBusy(true)
    try {
      if (!supabaseBrowser) {
        throw new Error('Configure Supabase env vars to enable uploads.')
      }
      const {
        data: { user },
        error: userErr,
      } = await supabaseBrowser.auth.getUser()
      if (userErr) throw userErr
      if (!user) throw new Error('Not signed in.')

      const { data: uploadRow, error: uploadErr } = await supabaseBrowser
        .from('uploads')
        .insert({
          user_id: user.id,
          uploader_email: user.email ?? null,
          note: note.trim() || null,
        })
        .select('id')
        .single()

      if (uploadErr) throw uploadErr
      const uploadId: string = uploadRow.id

      for (const f of queue) {
        const fileId = crypto.randomUUID()
        const storagePath = `demo/${user.id}/${uploadId}/${fileId}__${sanitizeFilename(f.name)}`

        const { error: storageUploadErr } = await supabaseBrowser.storage
          .from('uploads')
          .upload(storagePath, f, {
            contentType: f.type || undefined,
            upsert: false,
          })

        if (storageUploadErr) throw storageUploadErr

        const { error: insertFileErr } = await supabaseBrowser.from('upload_files').insert({
          upload_id: uploadId,
          original_name: f.name,
          mime: f.type || 'application/octet-stream',
          size: f.size,
          storage_path: storagePath,
        })

        if (insertFileErr) throw insertFileErr
      }

      const n = queue.length
      const meta = `${n} file${n === 1 ? '' : 's'} • ${fmtSize(queueBytes)}${note.trim() ? ' • note added' : ''}`
      setLastBatchMeta(meta)
      setQueue([])
      setNote('')
      setShowResult(true)
      showToast('Upload complete.')
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  const runDeleteSharedFile = async (target: DeleteConfirmTarget) => {
    if (!supabaseBrowser) {
      showToast('Supabase is not configured.')
      return
    }
    setDeletingId(target.fileId)
    try {
      const { error: storageErr } = await supabaseBrowser.storage.from('uploads').remove([target.storagePath])
      if (storageErr) {
        console.warn('[uploads] storage remove:', storageErr.message)
      }

      const { data: deletedRows, error: fileErr } = await supabaseBrowser
        .from('upload_files')
        .delete()
        .eq('id', target.fileId)
        .select('id')

      if (fileErr) throw fileErr
      if (!deletedRows?.length) {
        throw new Error(
          'Delete did not remove any row. If you own this file, re-run supabase/migrations/003_uploads_delete_policies.sql in the SQL editor.',
        )
      }

      const { data: remaining } = await supabaseBrowser
        .from('upload_files')
        .select('id')
        .eq('upload_id', target.uploadId)
        .limit(1)
      if (!remaining?.length) {
        const { error: uploadErr } = await supabaseBrowser.from('uploads').delete().eq('id', target.uploadId)
        if (uploadErr) console.warn('[uploads] delete package:', uploadErr.message)
      }

      setDeleteConfirm(null)
      showToast('File deleted.')
      router.refresh()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Delete failed.')
    } finally {
      setDeletingId(null)
    }
  }

  const shareListBody =
    initialUploads.length === 0 ? (
      <div className="empty-state">No files yet. Upload a PDF or DOCX and it will show up here.</div>
    ) : (
      initialUploads.map((u) => {
        const files = u.upload_files || []
        const total = files.reduce((s, f) => s + (typeof f.size === 'number' ? f.size : 0), 0)

        return (
          <div key={u.id} className="share-item">
            <div className="share-head">
              <div>
                <div className="share-title">
                  {files.length} file{files.length === 1 ? '' : 's'} • {fmtSize(total)}
                </div>
                <div className="share-sub">
                  {u.uploader_email ?? 'Unknown'} • {formatShortDate(u.created_at)}
                  {u.note ? ` • ${u.note}` : ''}
                </div>
              </div>
            </div>
            <div className="share-file-rows">
              {files.map((f) => {
                const url = publicFileUrl(f.storage_path)
                const size = typeof f.size === 'number' ? f.size : 0
                return (
                  <div key={f.id} className="file-row share-file-row">
                    <div className="file-row-left">
                      <div className="file-badge">{ext(f.original_name)}</div>
                      <div>
                        <div className="file-name">{f.original_name}</div>
                        <div className="file-meta">{fmtSize(size)}</div>
                      </div>
                    </div>
                    <div className="share-file-actions">
                      {url ? (
                        <a className="mini-btn download-link" href={url} download={f.original_name}>
                          Download
                        </a>
                      ) : (
                        <span className="share-sub" style={{ flexShrink: 0 }}>
                          Unavailable
                        </span>
                      )}
                      <button
                        type="button"
                        className="file-remove share-file-delete"
                        disabled={deletingId === f.id}
                        aria-label={`Delete ${f.original_name}`}
                        onClick={() =>
                          setDeleteConfirm({
                            uploadId: u.id,
                            fileId: f.id,
                            storagePath: f.storage_path,
                            originalName: f.original_name,
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })
    )

  return (
    <>
      {deleteConfirm ? (
        <div
          className="confirm-overlay"
          role="presentation"
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-dialog-title" className="confirm-dialog-title">
              Delete this file?
            </h2>
            <p className="confirm-dialog-body">
              <strong>{deleteConfirm.originalName}</strong> will be removed from storage and the database. This
              cannot be undone.
            </p>
            <div className="confirm-dialog-actions">
              <button type="button" className="secondary-btn" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="confirm-dialog-delete"
                disabled={deletingId === deleteConfirm.fileId}
                onClick={() => void runDeleteSharedFile(deleteConfirm)}
              >
                {deletingId === deleteConfirm.fileId ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="hero">
        <div className="hero-inner">
          <div>
            <h1>
              Share files
              <br />
              without the clutter.
            </h1>
            <p>Upload PDF and DOCX files only. Keep transfers simple without link expiry or download limits.</p>
          </div>
          <div className="hero-meta">Secure file sharing workspace</div>
        </div>
      </section>

      <div className="dashboard-grid">
        <div className="stat-card red">
          <div className="stat-label">Files queued</div>
          <div className="stat-value">{queue.length}</div>
          <div className="stat-sub">Ready to send</div>
        </div>
        <div className="stat-card gold">
          <div className="stat-label">Transfers created</div>
          <div className="stat-value">{serverUploadCount}</div>
          <div className="stat-sub">Upload batches</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-label">Total size moved</div>
          <div className="stat-value">{fmtSize(serverTotalBytes + queueBytes)}</div>
          <div className="stat-sub">Across all shares</div>
        </div>
      </div>

      {error ? (
        <div className="empty-state" style={{ marginBottom: 16, borderColor: 'var(--red)', color: 'var(--ink)' }}>
          {error}
        </div>
      ) : null}

      <div className="layout">
        <section className="card">
          <div className="card-header">
            <div className="card-title">📤 Create share</div>
          </div>
          <div className="card-body">
            <div
              className={`drop-zone${dragOver ? ' dragover' : ''}`}
              id="drop-zone"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button')) return
                inputRef.current?.click()
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                addFiles([...e.dataTransfer.files])
              }}
              role="presentation"
            >
              <div className="drop-icon">↥</div>
              <div className="drop-title">Drag files here</div>
              <div className="drop-sub">PDF and DOCX only — or choose files manually</div>
              <input
                id="file-input"
                ref={inputRef}
                type="file"
                multiple
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                hidden
                onChange={(e) => {
                  const files = [...(e.target.files || [])]
                  if (files.length) addFiles(files)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                className="secondary-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  inputRef.current?.click()
                }}
              >
                Browse files
              </button>
            </div>

            <div className="file-queue" id="file-queue">
              {queue.map((file, index) => (
                <div key={`${file.name}-${file.size}-${index}`} className="file-row">
                  <div className="file-row-left">
                    <div className="file-badge">{ext(file.name)}</div>
                    <div>
                      <div className="file-name">{file.name}</div>
                      <div className="file-meta">{fmtSize(file.size)}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="file-remove"
                    onClick={() => removeAt(index)}
                    aria-label="Remove file"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="form-grid" id="share-settings" style={{ display: hasFiles ? undefined : 'none' }}>
              <div className="form-field full">
                <label htmlFor="note">Share note</label>
                <textarea
                  id="note"
                  placeholder="Optional note for the recipient"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>

            <button
              type="button"
              className="primary-btn"
              id="generate-btn"
              style={{ display: hasFiles ? undefined : 'none' }}
              onClick={() => void generateShare()}
              disabled={busy}
            >
              {busy ? 'Uploading…' : 'Upload files'}
            </button>

            <div className="result-box" id="share-result" style={{ display: showResult ? 'block' : 'none' }}>
              <div className="result-head">Upload complete</div>
              <div className="helper" id="share-meta-text">
                {lastBatchMeta || 'Your files are listed in Shared files.'}
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div className="card-title">📥 Shared files</div>
          </div>
          <div className="card-body">
            <div className="share-list" id="share-list">
              {shareListBody}
            </div>
          </div>
        </section>
      </div>

      <div className={`toast${toast ? ' show' : ''}`} id="toast" role="status">
        {toast ?? ''}
      </div>
    </>
  )
}
