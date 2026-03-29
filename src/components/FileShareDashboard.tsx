'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useRef, useState } from 'react'
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

export function FileShareDashboard({
  initialUploads,
  serverUploadCount,
  serverTotalBytes,
  publicBaseUrl,
}: {
  initialUploads: UploadPackageRow[]
  serverUploadCount: number
  serverTotalBytes: number
  publicBaseUrl: string
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [queue, setQueue] = useState<File[]>([])
  const [note, setNote] = useState('')
  const [expiryHours, setExpiryHours] = useState(24)
  const [maxDownloads, setMaxDownloads] = useState(5)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [lastBatchMeta, setLastBatchMeta] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const queueBytes = useMemo(() => queue.reduce((a, f) => a + f.size, 0), [queue])

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 2200)
  }, [])

  const workspaceLink = `${publicBaseUrl}/receive`

  const addFiles = (newFiles: File[]) => {
    setQueue((prev) => {
      const next = [...prev]
      for (const f of newFiles) {
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
      const meta = `${n} file${n === 1 ? '' : 's'} • ${fmtSize(queueBytes)} • expires in ${expiryHours}h • max ${maxDownloads} download${maxDownloads === 1 ? '' : 's'}${note.trim() ? ' • note added' : ''}`
      setLastBatchMeta(meta)
      setQueue([])
      setNote('')
      setShowResult(true)
      showToast('Share link generated.')
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  const copyWorkspaceLink = () => {
    void navigator.clipboard.writeText(workspaceLink).then(() => {
      showToast('Link copied.')
    })
  }

  const shareListBody =
    initialUploads.length === 0 ? (
      <div className="empty-state">No shares yet. Generate a link and it will show up here.</div>
    ) : (
      initialUploads.map((u) => {
        const files = u.upload_files || []
        const total = files.reduce((s, f) => s + (typeof f.size === 'number' ? f.size : 0), 0)
        const first = files[0]
        const title =
          first && files.length > 1
            ? `${first.original_name} +${files.length - 1}`
            : (first?.original_name ?? 'Share')
        const names = files.map((f) => f.original_name).join(', ')

        return (
          <div key={u.id} className="share-item">
            <div className="share-head">
              <div>
                <div className="share-title">{title}</div>
                <div className="share-sub">
                  {files.length} file{files.length === 1 ? '' : 's'} • {fmtSize(total)} • shared{' '}
                  {formatShortDate(u.created_at)}
                  {u.note ? ` • ${u.note}` : ''}
                </div>
              </div>
              <span className="share-pill active">Active</span>
            </div>
            <div className="share-sub" style={{ marginBottom: 8 }}>
              {names}
            </div>
            <div className="share-sub" style={{ fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>
              {workspaceLink}
            </div>
            <div className="share-actions">
              <button type="button" className="mini-btn" onClick={copyWorkspaceLink}>
                Copy link
              </button>
              <button type="button" className="mini-btn" onClick={() => showToast('Extend is not available yet.')}>
                Extend 24h
              </button>
            </div>
          </div>
        )
      })
    )

  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div>
            <h1>
              Share files
              <br />
              without the clutter.
            </h1>
            <p>
              Create direct share links, manage expiry, and keep transfers clean without the old code-based mess.
            </p>
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
          <div className="stat-sub">Generated links</div>
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
              <div className="drop-sub">or choose files manually</div>
              <input
                id="file-input"
                ref={inputRef}
                type="file"
                multiple
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
              <div className="form-field">
                <label htmlFor="expiry">Link expiry</label>
                <select
                  id="expiry"
                  value={expiryHours}
                  onChange={(e) => setExpiryHours(Number(e.target.value))}
                >
                  <option value={12}>12 hours</option>
                  <option value={24}>24 hours</option>
                  <option value={48}>48 hours</option>
                  <option value={72}>72 hours</option>
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="max-dl">Max downloads</label>
                <input
                  id="max-dl"
                  type="number"
                  min={1}
                  value={maxDownloads}
                  onChange={(e) => setMaxDownloads(Number(e.target.value) || 1)}
                />
              </div>
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
              {busy ? 'Uploading…' : 'Generate share link'}
            </button>

            <div className="result-box" id="share-result" style={{ display: showResult ? 'block' : 'none' }}>
              <div className="result-head">Share link ready</div>
              <div className="link-row">
                <div className="share-link" id="share-link-display">
                  {workspaceLink}
                </div>
                <button type="button" className="secondary-btn" id="copy-btn" onClick={copyWorkspaceLink}>
                  Copy link
                </button>
              </div>
              <div className="helper" id="share-meta-text">
                {lastBatchMeta || 'Open this workspace link while signed in to browse all uploads.'}
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
