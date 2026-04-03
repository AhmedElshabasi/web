'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUploadsWorkspace } from '@/contexts/UploadsWorkspaceContext'
import { supabaseBrowser } from '@/lib/supabaseBrowser'
import { emitWorkspaceActivity } from '@/lib/workspaceActivityEvents'
import type {
  RubricInsightNeedsAttentionItem,
  RubricInsightQuickBreakdown,
} from '@/types/rubricInsights'
import type { UploadPackageRow, UploadReportStatus } from '@/types/uploadWorkspace'
import { UPLOAD_REPORT_STATUS_LABELS } from '@/types/uploadWorkspace'

export type { UploadFileRow, UploadNoteRow, UploadPackageRow } from '@/types/uploadWorkspace'

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

function sortPackagesByCreatedDesc(a: UploadPackageRow, b: UploadPackageRow) {
  const ta = a.created_at ? new Date(a.created_at).getTime() : 0
  const tb = b.created_at ? new Date(b.created_at).getTime() : 0
  return tb - ta
}

function packagePrimaryLabel(u: UploadPackageRow): string {
  const files = u.upload_files || []
  const first = files[0]
  if (!first) return 'Upload'
  if (files.length === 1) return first.original_name
  return `${first.original_name} (+${files.length - 1} more)`
}

type InsightsWizard =
  | { phase: 'idle' }
  | {
      phase: 'running'
      rubricLabel: string
      reportLabel: string
      rubricUploadId: string
      reportUploadId: string
      reportFileId: string
    }

function reportOptionValue(uploadId: string, fileId: string) {
  return `${uploadId}:${fileId}`
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
  const [reportStatus, setReportStatus] = useState<UploadReportStatus>('todo')
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [lastBatchMeta, setLastBatchMeta] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [teamDeleteConfirm, setTeamDeleteConfirm] = useState<TeamDeleteConfirmTarget | null>(null)
  const [deletingTeamId, setDeletingTeamId] = useState<string | null>(null)
  const [insightsWizard, setInsightsWizard] = useState<InsightsWizard>({ phase: 'idle' })
  const [insightsResult, setInsightsResult] = useState<{
    comment: string
    scorePercent: number
    rubricLabel: string
    reportLabel: string
    overallCompletionPercent?: number
    needsAttention: RubricInsightNeedsAttentionItem[]
    quickBreakdown: RubricInsightQuickBreakdown | null
  } | null>(null)
  const insightsAbortRef = useRef<AbortController | null>(null)
  const activeTeamIdRef = useRef(activeTeamId)
  const [selectedRubricUploadId, setSelectedRubricUploadId] = useState('')
  const [selectedReportValue, setSelectedReportValue] = useState('')

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

  const rubricPackages = useMemo(() => {
    return initialUploads
      .filter((u) => u.is_rubric && (u.upload_files?.length ?? 0) > 0)
      .sort(sortPackagesByCreatedDesc)
  }, [initialUploads])

  const reportPackages = useMemo(() => {
    return initialUploads
      .filter((u) => !u.is_rubric && (u.upload_files?.length ?? 0) > 0)
      .sort(sortPackagesByCreatedDesc)
  }, [initialUploads])

  const reportOptions = useMemo(() => {
    const rows: { uploadId: string; fileId: string; label: string; fileName: string }[] = []
    for (const u of reportPackages) {
      for (const f of u.upload_files || []) {
        rows.push({
          uploadId: u.id,
          fileId: f.id,
          fileName: f.original_name,
          label: `${f.original_name} · ${formatShortDate(u.created_at)}`,
        })
      }
    }
    return rows
  }, [reportPackages])

  const hasReportUploads = reportPackages.length > 0
  const hasRubricUploads = rubricPackages.length > 0

  useEffect(() => {
    activeTeamIdRef.current = activeTeamId
  }, [activeTeamId])

  useEffect(() => {
    insightsAbortRef.current?.abort()
    insightsAbortRef.current = null
    setInsightsWizard({ phase: 'idle' })
    setInsightsResult(null)
  }, [activeTeamId])

  useEffect(() => {
    if (rubricPackages.length === 0) {
      setSelectedRubricUploadId('')
      return
    }
    setSelectedRubricUploadId((prev) =>
      rubricPackages.some((p) => p.id === prev) ? prev : rubricPackages[0].id,
    )
  }, [rubricPackages])

  useEffect(() => {
    if (reportOptions.length === 0) {
      setSelectedReportValue('')
      return
    }
    setSelectedReportValue((prev) =>
      reportOptions.some((r) => reportOptionValue(r.uploadId, r.fileId) === prev)
        ? prev
        : reportOptionValue(reportOptions[0].uploadId, reportOptions[0].fileId),
    )
  }, [reportOptions])

  useEffect(() => {
    if (!teamDeleteConfirm) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (deletingTeamId) return
      setTeamDeleteConfirm(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [teamDeleteConfirm, deletingTeamId])

  useEffect(() => {
    if (insightsWizard.phase !== 'running') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      insightsAbortRef.current?.abort()
      insightsAbortRef.current = null
      setInsightsWizard({ phase: 'idle' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [insightsWizard.phase])

  const startGenerateInsights = useCallback(() => {
    if (!activeTeamId) return
    if (reportOptions.length === 0) return
    if (rubricPackages.length === 0) {
      showToast('Please upload a rubric first.')
      return
    }
    const rubricPkg = rubricPackages.find((p) => p.id === selectedRubricUploadId) ?? rubricPackages[0]
    const reportParts = selectedReportValue.split(':')
    const reportUploadId = reportParts[0]
    const reportFileId = reportParts[1]
    if (!reportUploadId || !reportFileId) return
    const reportRow = reportOptions.find(
      (r) => r.uploadId === reportUploadId && r.fileId === reportFileId,
    )
    if (!reportRow) return

    const rubricLabel = packagePrimaryLabel(rubricPkg)
    const reportLabel = reportRow.fileName
    const teamSnapshot = activeTeamId

    insightsAbortRef.current?.abort()
    const ac = new AbortController()
    insightsAbortRef.current = ac

    setInsightsWizard({
      phase: 'running',
      rubricLabel,
      reportLabel,
      rubricUploadId: rubricPkg.id,
      reportUploadId: reportRow.uploadId,
      reportFileId: reportRow.fileId,
    })

    void (async () => {
      try {
        const res = await fetch('/api/ai/insights-rubric-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          signal: ac.signal,
          body: JSON.stringify({
            rubricUploadId: rubricPkg.id,
            reportFileId: reportRow.fileId,
          }),
        })
        const text = await res.text()
        let payload: {
          error?: string
          comment?: string
          scorePercent?: unknown
          needsAttention?: unknown
          quickBreakdown?: unknown
          rubricLabel?: string
          reportLabel?: string
          persisted?: boolean
          persistErrors?: string[]
        } = {}
        try {
          payload = JSON.parse(text) as typeof payload
        } catch {
          showToast('Unexpected response from server.')
          return
        }
        if (!res.ok) {
          showToast(typeof payload.error === 'string' ? payload.error : 'Could not generate insights.')
          return
        }
        const score = Number(payload.scorePercent)
        if (typeof payload.comment !== 'string' || !payload.comment.trim() || !Number.isFinite(score)) {
          showToast('Invalid insights response.')
          return
        }
        if (ac.signal.aborted || activeTeamIdRef.current !== teamSnapshot) return
        const clamped = Math.min(100, Math.max(0, Math.round(score)))
        const commentText = payload.comment.trim()

        const needsAttention = Array.isArray(payload.needsAttention)
          ? (payload.needsAttention as RubricInsightNeedsAttentionItem[])
          : []

        let quickBreakdown: RubricInsightQuickBreakdown | null = null
        const qb = payload.quickBreakdown
        if (qb && typeof qb === 'object' && qb !== null) {
          const o = qb as Record<string, unknown>
          const ocp = Number(o.overallCompletionPercent)
          if (
            Number.isFinite(ocp) &&
            typeof o.synthesis === 'string' &&
            typeof o.gapsAndRisks === 'string' &&
            Array.isArray(o.contributors)
          ) {
            quickBreakdown = {
              overallCompletionPercent: Math.min(100, Math.max(0, Math.round(ocp))),
              contributors: (o.contributors as { label?: string; appearsToBeWorkingOn?: string; inferredFromNotesOrDocs?: string | null }[])
                .filter((c) => typeof c?.label === 'string' && typeof c?.appearsToBeWorkingOn === 'string')
                .map((c) => ({
                  label: c.label!,
                  appearsToBeWorkingOn: c.appearsToBeWorkingOn!,
                  inferredFromNotesOrDocs: c.inferredFromNotesOrDocs ?? null,
                })),
              synthesis: o.synthesis as string,
              gapsAndRisks: o.gapsAndRisks as string,
            }
          }
        }

        if (payload.persisted === false) {
          const detail = payload.persistErrors?.length ? ` (${payload.persistErrors[0]})` : ''
          showToast(`Insights ready, but saving to the team failed${detail}.`)
        }

        router.refresh()
        emitWorkspaceActivity()

        setInsightsResult({
          comment: commentText,
          scorePercent: clamped,
          rubricLabel: typeof payload.rubricLabel === 'string' ? payload.rubricLabel : rubricLabel,
          reportLabel: typeof payload.reportLabel === 'string' ? payload.reportLabel : reportLabel,
          overallCompletionPercent: quickBreakdown?.overallCompletionPercent,
          needsAttention,
          quickBreakdown,
        })
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        if (e instanceof Error && e.name === 'AbortError') return
        showToast('Network error while generating insights.')
      } finally {
        if (insightsAbortRef.current === ac) insightsAbortRef.current = null
        setInsightsWizard({ phase: 'idle' })
      }
    })()
  }, [
    activeTeamId,
    reportOptions,
    router,
    rubricPackages,
    selectedRubricUploadId,
    selectedReportValue,
    showToast,
  ])

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
          report_status: isRubric ? null : reportStatus,
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
        isRubric ? ' • Rubric' : ` • ${UPLOAD_REPORT_STATUS_LABELS[reportStatus]}`
      }`
      setLastBatchMeta(meta)
      setQueue([])
      setNote('')
      setIsRubric(false)
      setReportStatus('todo')
      setShowResult(true)
      showToast('Upload complete.')
      router.refresh()
      emitWorkspaceActivity()
      window.setTimeout(() => {
        router.refresh()
      }, 600)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setBusy(false)
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

  return (
    <>
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
              Upload reports and
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
              {!isRubric ? (
                <div className="form-field full">
                  <label htmlFor="upload-report-status">Status</label>
                  <select
                    id="upload-report-status"
                    value={reportStatus}
                    onChange={(e) => setReportStatus(e.target.value as UploadReportStatus)}
                  >
                    {(Object.keys(UPLOAD_REPORT_STATUS_LABELS) as UploadReportStatus[]).map((key) => (
                      <option key={key} value={key}>
                        {UPLOAD_REPORT_STATUS_LABELS[key]}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
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
                {lastBatchMeta || 'Your files are ready — open Insights to generate a report.'}
              </div>
            </div>
          </div>
        </section>

        <section className="card card--accent-gold">
          <div className="card-header">
            <div className="card-title">📥 Insights</div>
          </div>
          <div className="card-body">
            <div className="insights-panel" id="insights-panel">
              {!activeTeamId ? (
                <p className="insights-placeholder insights-placeholder--muted">
                  Select a team in the sidebar to use insights.
                </p>
              ) : insightsWizard.phase === 'running' ? (
                <>
                  <div className="insights-running-rows">
                    <div className="insights-running-line">
                      <span className="insights-running-label">Rubric</span>
                      <span className="insights-running-value">{insightsWizard.rubricLabel}</span>
                    </div>
                    <div className="insights-running-line">
                      <span className="insights-running-label">Report</span>
                      <span className="insights-running-value">{insightsWizard.reportLabel}</span>
                    </div>
                  </div>
                  <div className="insights-spinner-wrap" aria-live="polite">
                    <div className="insights-spinner" />
                    <p className="insights-spinner-text">Generating insights…</p>
                    <p className="insights-spinner-hint">Press Esc to cancel</p>
                  </div>
                </>
              ) : (
                <>
                  {insightsResult ? (
                    <div className="insights-result">
                      <div className="insights-result-top">
                        <div className="insights-score-block" aria-label="Rubric alignment score">
                          <span className="insights-score-number">{insightsResult.scorePercent}</span>
                          <span className="insights-score-percent">%</span>
                        </div>
                        <div className="insights-result-headlines">
                          <div className="insights-result-pair">
                            <span className="insights-result-pair-label">Rubric</span>
                            <span className="insights-result-pair-value">{insightsResult.rubricLabel}</span>
                          </div>
                          <div className="insights-result-pair">
                            <span className="insights-result-pair-label">Report</span>
                            <span className="insights-result-pair-value">{insightsResult.reportLabel}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="secondary-btn insights-result-dismiss"
                          onClick={() => setInsightsResult(null)}
                        >
                          Dismiss
                        </button>
                      </div>
                      <p className="insights-comment">{insightsResult.comment}</p>
                      {typeof insightsResult.overallCompletionPercent === 'number' ? (
                        <div className="insights-team-completion">
                          <span className="insights-team-completion-label">Team rubric completion (all linked work)</span>
                          <span className="insights-team-completion-value">
                            {insightsResult.overallCompletionPercent}%
                          </span>
                        </div>
                      ) : null}
                      {insightsResult.needsAttention.length > 0 ? (
                        <div className="insights-subsection">
                          <div className="insights-subsection-title">Needs attention</div>
                          <ul className="insights-attention-list">
                            {insightsResult.needsAttention.map((item, i) => (
                              <li key={`${item.fileLabel}-${i}`} className="insights-attention-item">
                                <div className="insights-attention-file">{item.fileLabel}</div>
                                <div className="insights-attention-reason">{item.reason}</div>
                                {item.severity ? (
                                  <span className={`insights-severity insights-severity--${item.severity}`}>
                                    {item.severity}
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {insightsResult.quickBreakdown ? (
                        <div className="insights-subsection">
                          <div className="insights-subsection-title">Quick breakdown</div>
                          <p className="insights-breakdown-text">{insightsResult.quickBreakdown.synthesis}</p>
                          <p className="insights-breakdown-text insights-breakdown-text--muted">
                            {insightsResult.quickBreakdown.gapsAndRisks}
                          </p>
                          {insightsResult.quickBreakdown.contributors.length > 0 ? (
                            <ul className="insights-contributors">
                              {insightsResult.quickBreakdown.contributors.map((c, idx) => (
                                <li key={`${c.label}-${idx}`} className="insights-contributor">
                                  <div className="insights-contributor-label">{c.label}</div>
                                  <div className="insights-contributor-on">{c.appearsToBeWorkingOn}</div>
                                  {c.inferredFromNotesOrDocs ? (
                                    <div className="insights-contributor-hint">{c.inferredFromNotesOrDocs}</div>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="insights-placeholder">Upload a report to gain some insights</p>
                  <div className="insights-select-row">
                    <div className="insights-select-field">
                      <label className="insights-select-label" htmlFor="insights-rubric-select">
                        Rubric
                      </label>
                      <select
                        id="insights-rubric-select"
                        className="insights-select"
                        value={selectedRubricUploadId}
                        onChange={(e) => setSelectedRubricUploadId(e.target.value)}
                        disabled={!hasRubricUploads}
                      >
                        {!hasRubricUploads ? (
                          <option value="">No rubrics uploaded yet</option>
                        ) : (
                          rubricPackages.map((pkg) => (
                            <option key={pkg.id} value={pkg.id}>
                              {packagePrimaryLabel(pkg)} · {formatShortDate(pkg.created_at)}
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                    <div className="insights-select-field">
                      <label className="insights-select-label" htmlFor="insights-report-select">
                        Report
                      </label>
                      <select
                        id="insights-report-select"
                        className="insights-select"
                        value={selectedReportValue}
                        onChange={(e) => setSelectedReportValue(e.target.value)}
                        disabled={!hasReportUploads}
                      >
                        {!hasReportUploads ? (
                          <option value="">No reports uploaded yet</option>
                        ) : (
                          reportOptions.map((row) => (
                            <option
                              key={reportOptionValue(row.uploadId, row.fileId)}
                              value={reportOptionValue(row.uploadId, row.fileId)}
                            >
                              {row.label}
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                  </div>
                  {hasReportUploads ? (
                    <button
                      type="button"
                      className="primary-btn insights-generate-btn"
                      onClick={startGenerateInsights}
                    >
                      Generate insights
                    </button>
                  ) : null}
                </>
              )}
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
