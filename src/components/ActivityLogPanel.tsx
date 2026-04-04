'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUploadsWorkspace } from '@/contexts/UploadsWorkspaceContext'
import { supabaseBrowser } from '@/lib/supabaseBrowser'
import { WORKSPACE_ACTIVITY_EVENT } from '@/lib/workspaceActivityEvents'
import type { ActivityLogPayload, ActivityTimelineItem } from '@/types/activityLog'
import type { UploadPackageRow } from '@/types/uploadWorkspace'

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

function formatShortDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function isSameLocalDay(iso: string): boolean {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

function timelineIcon(kind: ActivityTimelineItem['kind']): string {
  switch (kind) {
    case 'insight':
      return '✦'
    case 'note':
      return '✎'
    case 'file_deleted':
      return '⌫'
    default:
      return '•'
  }
}

function timelineKindLabel(kind: ActivityTimelineItem['kind']): string {
  switch (kind) {
    case 'insight':
      return 'AI insight'
    case 'note':
      return 'Note'
    case 'file_deleted':
      return 'Delete'
    default:
      return 'Event'
  }
}

export function ActivityLogPanel() {
  const { initialUploads, activeTeamId } = useUploadsWorkspace()

  const rubricPackages = useMemo(() => {
    return initialUploads
      .filter((u) => u.is_rubric && (u.upload_files?.length ?? 0) > 0)
      .sort(sortPackagesByCreatedDesc)
  }, [initialUploads])

  const [selectedRubricId, setSelectedRubricId] = useState('')
  const [logData, setLogData] = useState<ActivityLogPayload | null>(null)
  const [logLoading, setLogLoading] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | ActivityTimelineItem['kind']>('all')
  const [severityFilter, setSeverityFilter] = useState<'all' | ActivityTimelineItem['badge']>('all')

  useEffect(() => {
    if (rubricPackages.length === 0) {
      setSelectedRubricId('')
      return
    }
    setSelectedRubricId((prev) =>
      rubricPackages.some((p) => p.id === prev) ? prev : rubricPackages[0].id,
    )
  }, [rubricPackages])

  const loadLog = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!activeTeamId || !selectedRubricId) {
      setLogData(null)
      if (!silent) setLogError(null)
      return
    }
    if (!silent) {
      setLogLoading(true)
      setLogError(null)
    }
    try {
      const res = await fetch(
        `/api/activity-log?rubricUploadId=${encodeURIComponent(selectedRubricId)}`,
        { credentials: 'include' },
      )
      const text = await res.text()
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        if (!silent) {
          setLogError('Invalid response from server.')
          setLogData(null)
        }
        return
      }
      if (!res.ok) {
        const err = json as { error?: string }
        if (!silent) {
          setLogError(err.error || 'Could not load activity log.')
          setLogData(null)
        }
        return
      }
      setLogData(json as ActivityLogPayload)
      if (!silent) setLogError(null)
    } catch {
      if (!silent) {
        setLogError('Network error loading activity log.')
        setLogData(null)
      }
    } finally {
      if (!silent) setLogLoading(false)
    }
  }, [activeTeamId, selectedRubricId])

  const loadLogRef = useRef(loadLog)
  loadLogRef.current = loadLog

  const silentDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSilentRefresh = useCallback(() => {
    if (silentDebounceRef.current) clearTimeout(silentDebounceRef.current)
    silentDebounceRef.current = setTimeout(() => {
      silentDebounceRef.current = null
      void loadLogRef.current({ silent: true })
    }, 420)
  }, [])

  useEffect(() => {
    void loadLog()
  }, [loadLog])

  useEffect(() => {
    const onWorkspaceActivity = () => scheduleSilentRefresh()
    window.addEventListener(WORKSPACE_ACTIVITY_EVENT, onWorkspaceActivity)
    return () => {
      window.removeEventListener(WORKSPACE_ACTIVITY_EVENT, onWorkspaceActivity)
      if (silentDebounceRef.current) clearTimeout(silentDebounceRef.current)
    }
  }, [scheduleSilentRefresh])

  useEffect(() => {
    const supabase = supabaseBrowser
    if (!supabase || !activeTeamId) return
    const channel = supabase
      .channel(`activity-log-rt:${activeTeamId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ai_insight_runs',
          filter: `team_id=eq.${activeTeamId}`,
        },
        () => scheduleSilentRefresh(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rubric_insight_snapshots',
          filter: `team_id=eq.${activeTeamId}`,
        },
        () => scheduleSilentRefresh(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'activity_events',
          filter: `team_id=eq.${activeTeamId}`,
        },
        () => scheduleSilentRefresh(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'upload_notes' },
        () => scheduleSilentRefresh(),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [activeTeamId, scheduleSilentRefresh])

  const filteredTimeline = useMemo(() => {
    const list = logData?.timeline ?? []
    let out = list
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      out = out.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.meta.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q),
      )
    }
    if (kindFilter !== 'all') {
      out = out.filter((item) => item.kind === kindFilter)
    }
    if (severityFilter !== 'all') {
      out = out.filter((item) => item.badge === severityFilter)
    }
    return out
  }, [logData, searchQuery, kindFilter, severityFilter])

  const stats = useMemo(() => {
    const timeline = logData?.timeline ?? []
    const eventsToday = timeline.filter((t) => isSameLocalDay(t.at)).length
    const attention =
      (logData?.needsAttention.fromAi.length ?? 0) + (logData?.needsAttention.fromNotes.length ?? 0)
    const authors = new Set<string>()
    for (const t of timeline) {
      const m = t.meta.split('·')[0]?.trim()
      if (m) authors.add(m)
    }
    return {
      eventsToday,
      attention,
      authors: authors.size,
      deletes: timeline.filter((t) => t.kind === 'file_deleted').length,
    }
  }, [logData])

  const hasRubrics = rubricPackages.length > 0

  return (
    <div className="activity-log-page">
      <section className="al-hero">
        <div className="al-hero-inner">
          <div>
            <div className="al-kicker">Workspace monitoring</div>
            <h1>Activity Log</h1>
            <p>
              Track meaningful actions across uploads, transfers, and access. This is where you catch what happened,
              who touched what, and whether it matters.
            </p>
          </div>
          <div className="al-rubric-dropdown-wrap">
            <label className="al-rubric-dropdown-label" htmlFor="al-rubric-select">
              Rubric
            </label>
            <select
              id="al-rubric-select"
              className="al-rubric-dropdown"
              aria-label="Choose rubric"
              value={selectedRubricId}
              onChange={(e) => setSelectedRubricId(e.target.value)}
              disabled={!activeTeamId || !hasRubrics}
            >
              {!activeTeamId ? (
                <option value="">Select a team in the sidebar</option>
              ) : !hasRubrics ? (
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
        </div>
      </section>

      <div className="al-layout">
        <section className="card al-section-card">
          <div className="al-section-banner al-section-banner--blue">
            <div className="card-title">🕘 Timeline</div>
          </div>
          <div className="card-header al-section-card-toolbar">
            <div className="al-toolbar">
              <input
                className="al-search"
                type="search"
                placeholder="Search title, people, or details"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Filter timeline"
              />
              <select
                className="al-filter"
                value={kindFilter}
                onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}
                aria-label="Filter by event type"
              >
                <option value="all">All types</option>
                <option value="insight">AI insights</option>
                <option value="note">Notes</option>
                <option value="file_deleted">File deletes</option>
              </select>
              <select
                className="al-filter"
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value as typeof severityFilter)}
                aria-label="Filter by badge"
              >
                <option value="all">All badges</option>
                <option value="info">Info</option>
                <option value="success">Success</option>
                <option value="warn">Warning</option>
                <option value="danger">Critical</option>
              </select>
              <button type="button" className="secondary-btn al-refresh-btn" onClick={() => void loadLog()}>
                Refresh
              </button>
            </div>
          </div>
          <div className="card-body">
            {logError ? (
              <div className="empty-state" style={{ margin: 16, borderColor: 'var(--red)' }}>
                {logError}
              </div>
            ) : null}
            {logLoading ? (
              <p className="al-loading">Loading activity…</p>
            ) : null}
            <div className="activity-timeline">
              {!logLoading && !logError && filteredTimeline.length === 0 ? (
                <p className="al-empty-timeline">
                  No events for this rubric yet. Generate insights, add notes on linked reports, or remove files to see
                  activity here.
                </p>
              ) : null}
              {filteredTimeline.map((item) => (
                <div key={item.id} className="activity-item">
                  <div className={`activity-icon ${item.badge}`}>{timelineIcon(item.kind)}</div>
                  <div className="activity-content">
                    <div className="activity-top">
                      <div>
                        <div className="activity-title">{item.title}</div>
                        <div className="activity-meta">{item.meta}</div>
                      </div>
                      <span className={`activity-badge ${item.badge}`}>{timelineKindLabel(item.kind)}</span>
                    </div>
                    {item.description ? <div className="activity-desc">{item.description}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="rt-side-stack">
          <section className="card al-section-card">
            <div className="al-section-banner al-section-banner--red">
              <div className="card-title">⚠ Needs attention</div>
            </div>
            <div className="card-body">
              <div className="rt-mini-list">
                {!logData || logLoading ? (
                  <p className="al-side-hint">{logLoading ? 'Loading…' : 'Pick a rubric to load items.'}</p>
                ) : null}
                {logData && !logLoading ? (
                  <>
                    {logData.needsAttention.fromNotes.length === 0 &&
                    logData.needsAttention.fromAi.length === 0 ? (
                      <p className="al-side-hint">Nothing flagged for this rubric right now.</p>
                    ) : null}
                    {logData.needsAttention.fromNotes.map((n) => (
                      <div key={n.noteId} className="rt-mini-item al-attention-item">
                        <div>
                          <div className="rt-mini-title">{n.uploadLabel}</div>
                          <div className="rt-mini-sub">
                            <span className={`al-priority-pill al-priority-pill--${n.priority}`}>{n.priority}</span>{' '}
                            {n.authorEmail ?? 'Someone'}: {n.bodyPreview}
                            {n.bodyPreview.length >= 220 ? '…' : ''}
                          </div>
                        </div>
                        <div className="rt-metric">
                          <div className="rt-mini-sub">note</div>
                        </div>
                      </div>
                    ))}
                    {logData.needsAttention.fromAi.map((item, idx) => (
                      <div key={`ai-${item.fileLabel}-${idx}`} className="rt-mini-item al-attention-item">
                        <div>
                          <div className="rt-mini-title">{item.fileLabel}</div>
                          <div className="rt-mini-sub">{item.reason}</div>
                          {item.severity ? (
                            <span className={`al-priority-pill al-priority-pill--${item.severity}`}>
                              {item.severity}
                            </span>
                          ) : null}
                        </div>
                        <div className="rt-metric">
                          <div className="rt-mini-sub">AI</div>
                        </div>
                      </div>
                    ))}
                  </>
                ) : null}
              </div>
            </div>
          </section>
          <section className="card al-section-card">
            <div className="al-section-banner al-section-banner--green">
              <div className="card-title">📊 Quick breakdown</div>
            </div>
            <div className="card-body">
              {!logData?.quickBreakdown || logLoading ? (
                <p className="al-side-hint">
                  {logLoading
                    ? 'Loading…'
                    : 'Run Generate insights on File Share for this rubric to build a team snapshot.'}
                </p>
              ) : (
                <div className="al-breakdown-live">
                  <div className="al-breakdown-meter">
                    <span className="al-breakdown-meter-label">Overall completion (team vs rubric)</span>
                    <span className="al-breakdown-meter-value">
                      {logData.quickBreakdown.overallCompletionPercent}%
                    </span>
                  </div>
                  <p className="al-breakdown-prose">{logData.quickBreakdown.synthesis}</p>
                  <p className="al-breakdown-prose al-breakdown-prose--muted">{logData.quickBreakdown.gapsAndRisks}</p>
                  {logData.quickBreakdown.contributors.length > 0 ? (
                    <ul className="al-breakdown-contribs">
                      {logData.quickBreakdown.contributors.map((c, i) => (
                        <li key={`${c.label}-${i}`}>
                          <strong>{c.label}</strong> — {c.appearsToBeWorkingOn}
                          {c.inferredFromNotesOrDocs ? (
                            <span className="al-breakdown-hint"> ({c.inferredFromNotesOrDocs})</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {logData.snapshotUpdatedAt ? (
                    <p className="al-breakdown-updated">
                      Updated {formatShortDate(logData.snapshotUpdatedAt)}
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>

      <section className="al-stats">
        <div className="al-stat red">
          <div className="al-stat-label">Events today</div>
          <div className="al-stat-value">{logLoading ? '—' : stats.eventsToday}</div>
          <div className="al-stat-sub">On this rubric&apos;s timeline</div>
        </div>
        <div className="al-stat gold">
          <div className="al-stat-label">Needs attention</div>
          <div className="al-stat-value">{logLoading ? '—' : stats.attention}</div>
          <div className="al-stat-sub">High-priority notes + AI flags</div>
        </div>
        <div className="al-stat blue">
          <div className="al-stat-label">Voices in timeline</div>
          <div className="al-stat-value">{logLoading ? '—' : stats.authors}</div>
          <div className="al-stat-sub">Distinct people in recent meta</div>
        </div>
        <div className="al-stat green">
          <div className="al-stat-label">Files removed</div>
          <div className="al-stat-value">{logLoading ? '—' : stats.deletes}</div>
          <div className="al-stat-sub">Logged deletes for this rubric</div>
        </div>
      </section>
    </div>
  )
}
