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
  return parts.length > 1 ? parts.pop()!.slice(0, 5).toUpperCase() : 'FILE'
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
      const meta = `${n} file${n === 1 ? '' : 's'} • expires in ${expiryHours}h • max ${maxDownloads} download${maxDownloads === 1 ? '' : 's'}${note.trim() ? ` • ${note.trim()}` : ''}`
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
    const text = `${publicBaseUrl}/receive`
    void navigator.clipboard.writeText(text).then(() => {
      showToast('Link copied.')
    })
  }

  const renderShareList = () => {
    if (!initialUploads.length) {
      return (
        <div className="empty-state">No share links yet. Generate one and it will show up here.</div>
      )
    }

    return initialUploads.flatMap((u) => {
      const files = u.upload_files || []
      return files.map((f) => {
        const url = supabaseBrowser?.storage.from('uploads').getPublicUrl(f.storage_path).data.publicUrl ?? '#'
        const size = typeof f.size === 'number' ? f.size : 0
        return (
          <div key={f.id} className="share-item">
            <div className="file-ext">{ext(f.original_name)}</div>
            <div className="share-meta">
              <div className="share-name">{f.original_name}</div>
              <div className="share-detail">
                {fmtSize(size)} · {u.uploader_email || 'unknown'} · {formatShortDate(u.created_at)}
                {u.note ? ` · ${u.note}` : ''}
              </div>
            </div>
            <a className="download-btn" href={url} download={f.original_name}>
              Download
            </a>
          </div>
        )
      })
    })
  }

  const workspaceLink = `${publicBaseUrl}/receive`

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
              This version matches the Sign_In_Page styling and removes the old 6-character share code flow. It now
              generates direct share links only.
            </p>
          </div>
          <div className="hero-meta">UCalgary-inspired visual theme</div>
        </div>
      </section>

      <div className="dashboard-grid">
        <div className="stat-card red">
          <div className="stat-label">Files queued</div>
          <div className="stat-value">{queue.length}</div>
          <div className="stat-sub">Ready to share</div>
        </div>
        <div className="stat-card gold">
          <div className="stat-label">Shared this session</div>
          <div className="stat-value">{serverUploadCount}</div>
          <div className="stat-sub">Links generated</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-label">Total data</div>
          <div className="stat-value">{fmtSize(serverTotalBytes + queueBytes)}</div>
          <div className="stat-sub">Across generated shares</div>
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
            <div className="card-title">📤 Upload files</div>
          </div>
          <div className="card-body">
            <div
              className={`drop-zone${dragOver ? ' dragover' : ''}`}
              id="drop-zone"
              onClick={() => inputRef.current?.click()}
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
              <div className="drop-icon">↑</div>
              <h2>Drop files here</h2>
              <p>Or click to browse. Duplicate files are ignored automatically.</p>
            </div>
            <input
              id="file-input"
              ref={inputRef}
              type="file"
              multiple
              onChange={(e) => {
                const files = [...(e.target.files || [])]
                if (files.length) addFiles(files)
                e.target.value = ''
              }}
            />

            <div className="file-queue" id="file-queue">
              {!queue.length ? (
                <div className="empty-state">No files queued yet.</div>
              ) : (
                queue.map((file, index) => (
                  <div key={`${file.name}-${file.size}-${index}`} className="file-item">
                    <div className="file-ext">{ext(file.name)}</div>
                    <div className="file-meta">
                      <div className="file-name">{file.name}</div>
                      <div className="file-size">{fmtSize(file.size)}</div>
                    </div>
                    <button type="button" className="remove-btn" onClick={() => removeAt(index)}>
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="form-grid" id="share-settings" style={{ display: hasFiles ? undefined : 'none' }}>
              <div className="form-field">
                <label htmlFor="expiry">Expires after</label>
                <select
                  id="expiry"
                  value={expiryHours}
                  onChange={(e) => setExpiryHours(Number(e.target.value))}
                >
                  <option value={1}>1 hour</option>
                  <option value={6}>6 hours</option>
                  <option value={24}>24 hours</option>
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
            <div id="share-list">{renderShareList()}</div>
          </div>
        </section>
      </div>

      <div className={`toast${toast ? ' show' : ''}`} id="toast" role="status">
        {toast ?? ''}
      </div>
    </>
  )
}
