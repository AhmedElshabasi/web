'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUploadsWorkspace } from '@/contexts/UploadsWorkspaceContext'
import { supabaseBrowser } from '@/lib/supabaseBrowser'
import type { UploadFileRow, UploadNoteRow, UploadPackageRow } from '@/types/uploadWorkspace'

export type { UploadFileRow, UploadNoteRow, UploadPackageRow } from '@/types/uploadWorkspace'

type DeleteConfirmTarget = {
  uploadId: string
  fileId: string
  storagePath: string
  originalName: string
}

type TeamDeleteConfirmTarget = {
  id: string
  name: string
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

export function FileShareDashboard() {
  const {
    initialUploads,
    serverUploadCount,
    serverTotalBytes,
    loadError,
    teams,
    activeTeamId,
    refreshTeams,
  } = useUploadsWorkspace()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [queue, setQueue] = useState<File[]>([])
  const [note, setNote] = useState('')
  const [isRubric, setIsRubric] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [lastBatchMeta, setLastBatchMeta] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmTarget | null>(null)
  const [teamDeleteConfirm, setTeamDeleteConfirm] = useState<TeamDeleteConfirmTarget | null>(null)
  const [deletingTeamId, setDeletingTeamId] = useState<string | null>(null)

  const queueBytes = useMemo(() => queue.reduce((a, f) => a + f.size, 0), [queue])

  const teamsSorted = useMemo(() => {
    const list = [...teams]
    list.sort((a, b) => {
      const aActive = a.id === activeTeamId ? 0 : 1
      const bActive = b.id === activeTeamId ? 0 : 1
      if (aActive !== bActive) return aActive - bActive
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    return list
  }, [teams, activeTeamId])

  const teamInsightCounts = useMemo(() => {
    let owned = 0
    let joined = 0
    for (const t of teams) {
      if (t.role === 'owner') owned += 1
      else if (t.role === 'member') joined += 1
    }
    return { owned, joined }
  }, [teams])

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 2200)
  }, [])

  const copyInviteCode = useCallback(
    (code: string) => {
      if (!navigator.clipboard) {
        showToast('Clipboard not available.')
        return
      }
      void navigator.clipboard.writeText(code)
      showToast('Invite code copied.')
    },
    [showToast],
  )

  const downloadFile = useCallback(
    async (storagePath: string, filename: string) => {
      if (!supabaseBrowser) {
        showToast('Supabase is not configured.')
        return
      }
      const { data, error } = await supabaseBrowser.storage.from('uploads').createSignedUrl(storagePath, 3600)
      if (error || !data?.signedUrl) {
        showToast('Could not download file.')
        return
      }
      const a = document.createElement('a')
      a.href = data.signedUrl
      a.download = filename
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      a.remove()
    },
    [showToast],
  )

  useEffect(() => {
    if (!deleteConfirm && !teamDeleteConfirm) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (deletingId || deletingTeamId) return
      setDeleteConfirm(null)
      setTeamDeleteConfirm(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleteConfirm, teamDeleteConfirm, deletingId, deletingTeamId])

  useEffect(() => {
    const supabase = supabaseBrowser
    if (!supabase) return

    let debounceTimer: ReturnType<typeof setTimeout> | undefined
    let followUpTimer: ReturnType<typeof setTimeout> | undefined

    const clearTimers = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      if (followUpTimer) clearTimeout(followUpTimer)
      debounceTimer = undefined
      followUpTimer = undefined
    }

    // Uploads commit in two steps (uploads row, then storage + upload_files). A single refresh right after
    // the first INSERT often loads nested upload_files as []. Deletes are one step, so they worked before.
    const scheduleRefresh = () => {
      clearTimers()
      debounceTimer = setTimeout(() => {
        router.refresh()
        debounceTimer = undefined
        followUpTimer = setTimeout(() => {
          router.refresh()
          followUpTimer = undefined
        }, 550)
      }, 220)
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
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'upload_notes' },
        scheduleRefresh,
      )
      .subscribe()

    return () => {
      clearTimers()
      void supabase.removeChannel(channel)
    }
  }, [router])

  const addFiles = (newFiles: File[]) => {
    if (!activeTeamId) {
      showToast('Create or join a team in the sidebar first.')
      return
    }
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
      if (!activeTeamId) throw new Error('Select or create a team in the sidebar first.')

      const { data: uploadRow, error: uploadErr } = await supabaseBrowser
        .from('uploads')
        .insert({
          user_id: user.id,
          team_id: activeTeamId,
          uploader_email: user.email ?? null,
          note: note.trim() || null,
          is_rubric: isRubric,
        })
        .select('id')
        .single()

      if (uploadErr) throw uploadErr
      const uploadId: string = uploadRow.id

      for (const f of queue) {
        const fileId = crypto.randomUUID()
        const storagePath = `teams/${activeTeamId}/${user.id}/${uploadId}/${fileId}__${sanitizeFilename(f.name)}`

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
      const meta = `${n} file${n === 1 ? '' : 's'} • ${fmtSize(queueBytes)}${note.trim() ? ' • note added' : ''}${
        isRubric ? ' • Rubric' : ''
      }`
      setLastBatchMeta(meta)
      setQueue([])
      setNote('')
      setIsRubric(false)
      setShowResult(true)
      showToast('Upload complete.')
      router.refresh()
      window.setTimeout(() => {
        router.refresh()
      }, 600)
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
          'Delete did not remove any file. You are not the owner of this file.',
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

  const runDeleteTeam = async (target: TeamDeleteConfirmTarget) => {
    if (!supabaseBrowser) {
      showToast('Supabase is not configured.')
      return
    }
    setDeletingTeamId(target.id)
    try {
      const { error: rpcErr } = await supabaseBrowser.rpc('delete_team', { p_team_id: target.id })
      if (rpcErr) throw rpcErr
      setTeamDeleteConfirm(null)
      showToast('Team deleted.')
      await refreshTeams()
      router.refresh()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Could not delete team.')
    } finally {
      setDeletingTeamId(null)
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
                  {u.is_rubric ? (
                    <span className="share-rubric-badge" title="Marked as rubric">
                      Rubric
                    </span>
                  ) : null}
                </div>
                <div className="share-sub">
                  {u.uploader_email ?? 'Unknown'} • {formatShortDate(u.created_at)}
                  {u.note ? ` • ${u.note}` : ''}
                </div>
              </div>
            </div>
            <div className="share-file-rows">
              {files.map((f) => {
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
                      {supabaseBrowser ? (
                        <button
                          type="button"
                          className="mini-btn download-link"
                          onClick={() => void downloadFile(f.storage_path, f.original_name)}
                        >
                          Download
                        </button>
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

      {teamDeleteConfirm ? (
        <div
          className="confirm-overlay"
          role="presentation"
          onClick={() => {
            if (!deletingTeamId) setTeamDeleteConfirm(null)
          }}
        >
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-team-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-team-dialog-title" className="confirm-dialog-title">
              Delete this team?
            </h2>
            <p className="confirm-dialog-body">
              <strong>{teamDeleteConfirm.name}</strong> and all of its shared uploads will be removed for every
              member. This cannot be undone.
            </p>
            <div className="confirm-dialog-actions">
              <button
                type="button"
                className="secondary-btn"
                disabled={deletingTeamId !== null}
                onClick={() => setTeamDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="confirm-dialog-delete"
                disabled={deletingTeamId === teamDeleteConfirm.id}
                onClick={() => void runDeleteTeam(teamDeleteConfirm)}
              >
                {deletingTeamId === teamDeleteConfirm.id ? 'Deleting…' : 'Delete team'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="hero">
        <div className="hero-inner">
          <div>
            <h1>
              Upload files and
              <br />
               get AI-powered insights.
            </h1>
            <p>
              Upload PDF and DOCX files only. Files are visible only to members of the team you select in the sidebar.
            </p>
          </div>
          <div className="hero-meta">Secure file sharing workspace</div>
        </div>
      </section>

      {loadError ? (
        <div className="empty-state" style={{ marginBottom: 16, borderColor: 'var(--red)', color: 'var(--ink)' }}>
          {loadError}
        </div>
      ) : null}
      {!activeTeamId ? (
        <div className="empty-state" style={{ marginBottom: 16 }}>
          Create a team or join with an invite code in the sidebar to upload and see shared files for that group.
        </div>
      ) : null}
      {error ? (
        <div className="empty-state" style={{ marginBottom: 16, borderColor: 'var(--red)', color: 'var(--ink)' }}>
          {error}
        </div>
      ) : null}

      <div className="layout">
        <section className="card card--accent-red">
          <div className="card-header">
            <div className="card-title">📤 Upload</div>
          </div>
          <div className="card-body">
            <div
              className={`drop-zone${dragOver ? ' dragover' : ''}`}
              id="drop-zone"
              style={!activeTeamId ? { opacity: 0.55, pointerEvents: 'none' } : undefined}
              onClick={(e) => {
                if (!activeTeamId) return
                if ((e.target as HTMLElement).closest('button')) return
                inputRef.current?.click()
              }}
              onDragOver={(e) => {
                if (!activeTeamId) return
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                if (!activeTeamId) return
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
                <label className="upload-rubric-check" htmlFor="upload-is-rubric">
                  <input
                    id="upload-is-rubric"
                    type="checkbox"
                    checked={isRubric}
                    onChange={(e) => setIsRubric(e.target.checked)}
                  />
                  <span>Rubric</span>
                </label>
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
              disabled={busy || !activeTeamId}
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

        <section className="card card--accent-gold">
          <div className="card-header">
            <div className="card-title">📥 Insights </div>
          </div>
          <div className="card-body">
            <div className="share-list" id="share-list">
              {shareListBody}
            </div>
          </div>
        </section>
      </div>

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

      <section className="card fs-team-insights" aria-labelledby="fs-team-insights-title">
        <div className="card-header">
          <div className="card-title" id="fs-team-insights-title">
            Your teams &amp; invite codes
          </div>
        </div>
        <div className="card-body">
          {teams.length === 0 ? (
            <p className="fs-team-insights-lead">
              You are not in any team yet. Use the sidebar to create one (you will get an invite code) or join with
              someone else&apos;s code. Then pick the active team there — uploads on this page go to that group only.
            </p>
          ) : (
            <>
              <p className="fs-team-insights-lead">
                You are in <strong>{teams.length}</strong> team{teams.length === 1 ? '' : 's'} (
                {teamInsightCounts.owned} you created, {teamInsightCounts.joined} you joined). New uploads use the team
                selected in the sidebar (<strong>Active</strong> in this list). Share the invite code so people can join
                the same group and see those files.
              </p>
              <ul className="fs-team-insights-list">
                {teamsSorted.map((t) => {
                  const isActive = t.id === activeTeamId
                  const roleLabel =
                    t.role === 'owner' ? 'Owner' : t.role === 'member' ? 'Member' : null
                  return (
                    <li key={t.id} className="fs-team-insights-row">
                      <div className="fs-team-insights-top">
                        <span className="fs-team-insights-name">{t.name}</span>
                        <span className="fs-team-insights-badges">
                          {isActive ? (
                            <span className="fs-team-insights-badge fs-team-insights-badge--active">Active</span>
                          ) : null}
                          {roleLabel ? (
                            <span
                              className={`fs-team-insights-badge fs-team-insights-badge--${t.role ?? 'member'}`}
                            >
                              {roleLabel}
                            </span>
                          ) : null}
                        </span>
                      </div>
                      <div className="fs-team-insights-code-block">
                        <div className="fs-team-insights-code-label">Invite code</div>
                        <div className="fs-team-insights-code-row">
                          <code className="fs-team-insights-code">{t.invite_code}</code>
                          <div className="fs-team-insights-code-actions">
                            <button
                              type="button"
                              className="secondary-btn fs-team-insights-copy"
                              onClick={() => copyInviteCode(t.invite_code)}
                            >
                              Copy
                            </button>
                            {t.role === 'owner' ? (
                              <button
                                type="button"
                                className="fs-team-insights-delete"
                                disabled={deletingTeamId === t.id}
                                onClick={() => setTeamDeleteConfirm({ id: t.id, name: t.name })}
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      </section>

      <div className={`toast${toast ? ' show' : ''}`} id="toast" role="status">
        {toast ?? ''}
      </div>
    </>
  )
}
