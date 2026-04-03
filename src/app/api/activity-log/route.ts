import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServerClientOrNull } from '@/lib/supabaseServer'
import type {
  ActivityLogPayload,
  ActivityTimelineItem,
  NoteNeedsAttentionItem,
} from '@/types/activityLog'
import type { RubricInsightNeedsAttentionItem, RubricInsightQuickBreakdown } from '@/types/rubricInsights'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  rubricUploadId: z.string().uuid(),
})

function isQuickBreakdown(x: unknown): x is RubricInsightQuickBreakdown {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  const ocp = Number(o.overallCompletionPercent)
  return (
    Number.isFinite(ocp) &&
    typeof o.synthesis === 'string' &&
    typeof o.gapsAndRisks === 'string' &&
    Array.isArray(o.contributors)
  )
}

function parseNeedsAttention(x: unknown): RubricInsightNeedsAttentionItem[] {
  if (!Array.isArray(x)) return []
  return x.filter(
    (row): row is RubricInsightNeedsAttentionItem =>
      row &&
      typeof row === 'object' &&
      typeof (row as RubricInsightNeedsAttentionItem).fileLabel === 'string' &&
      typeof (row as RubricInsightNeedsAttentionItem).reason === 'string',
  )
}

export async function GET(request: Request) {
  const supabase = supabaseServerClientOrNull()
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 })
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse({ rubricUploadId: searchParams.get('rubricUploadId') ?? '' })
  if (!parsed.success) {
    return NextResponse.json({ error: 'rubricUploadId (uuid) required' }, { status: 400 })
  }
  const { rubricUploadId } = parsed.data

  const { data: rubricRow, error: rubricErr } = await supabase
    .from('uploads')
    .select('id, team_id, is_rubric')
    .eq('id', rubricUploadId)
    .maybeSingle()

  if (rubricErr) {
    return NextResponse.json({ error: rubricErr.message }, { status: 500 })
  }
  if (!rubricRow?.team_id || !rubricRow.is_rubric) {
    return NextResponse.json({ error: 'Rubric not found' }, { status: 404 })
  }

  const teamId = rubricRow.team_id as string

  const { data: member, error: memErr } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('team_id', teamId)
    .eq('user_id', userData.user.id)
    .maybeSingle()

  if (memErr || !member) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const uploadNotesSelect = `
        id,
        upload_files ( original_name ),
        upload_notes ( id, author_email, body, created_at, priority )
      `

  const [
    { data: insightRows, error: insightErr },
    { data: eventRows, error: eventErr },
    { data: snapshot, error: snapErr },
  ] = await Promise.all([
    supabase
      .from('ai_insight_runs')
      .select(
        'id, created_at, report_label_snapshot, comment, score_percent, created_by, rubric_upload_id, report_upload_id',
      )
      .eq('team_id', teamId)
      .eq('rubric_upload_id', rubricUploadId)
      .order('created_at', { ascending: false })
      .limit(80),
    supabase
      .from('activity_events')
      .select('id, created_at, actor_email, payload, rubric_upload_id')
      .eq('team_id', teamId)
      .eq('rubric_upload_id', rubricUploadId)
      .eq('event_type', 'file_deleted')
      .order('created_at', { ascending: false })
      .limit(80),
    supabase
      .from('rubric_insight_snapshots')
      .select('needs_attention, quick_breakdown, updated_at')
      .eq('team_id', teamId)
      .eq('rubric_upload_id', rubricUploadId)
      .maybeSingle(),
  ])

  if (insightErr) console.error('[activity-log] insights', insightErr)
  if (eventErr) console.error('[activity-log] events', eventErr)
  if (snapErr) console.error('[activity-log] snapshot', snapErr)

  const reportIdsFromInsights = [
    ...new Set(
      (insightRows ?? [])
        .map((r) => r.report_upload_id as string | undefined)
        .filter((id): id is string => Boolean(id)),
    ),
  ]

  const { data: linkedUploads, error: linkedErr } = await supabase
    .from('uploads')
    .select(uploadNotesSelect)
    .eq('team_id', teamId)
    .eq('linked_rubric_upload_id', rubricUploadId)
    .eq('is_rubric', false)
    .limit(50)

  if (linkedErr) console.error('[activity-log] linked uploads', linkedErr)

  const linkedIdSet = new Set((linkedUploads ?? []).map((u) => u.id as string))
  const missingInsightUploadIds = reportIdsFromInsights.filter((id) => !linkedIdSet.has(id))

  let extraUploads: typeof linkedUploads = []
  if (missingInsightUploadIds.length > 0) {
    const { data: extra, error: extraErr } = await supabase
      .from('uploads')
      .select(uploadNotesSelect)
      .eq('team_id', teamId)
      .eq('is_rubric', false)
      .in('id', missingInsightUploadIds)
    if (extraErr) console.error('[activity-log] insight-linked uploads', extraErr)
    extraUploads = extra ?? []
  }

  const mergedById = new Map<string, NonNullable<typeof linkedUploads>[0]>()
  for (const p of [...(linkedUploads ?? []), ...extraUploads]) {
    mergedById.set(p.id as string, p)
  }
  const mergedPackages = [...mergedById.values()]

  type FlatNote = {
    id: string
    author_email: string | null
    body: string
    created_at: string
    priority: string
    upload_id: string
    upload_files: { original_name: string }[] | null
  }

  const flatNotes: FlatNote[] = []
  for (const pkg of mergedPackages) {
    const files = (pkg.upload_files as { original_name: string }[] | null) ?? []
    const notes = (pkg.upload_notes as Omit<FlatNote, 'upload_id' | 'upload_files'>[] | null) ?? []
    for (const n of notes) {
      flatNotes.push({
        id: n.id,
        author_email: n.author_email,
        body: n.body,
        created_at: n.created_at,
        priority: (n as { priority?: string }).priority ?? 'normal',
        upload_id: pkg.id as string,
        upload_files: files,
      })
    }
  }
  flatNotes.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const noteRows = flatNotes.slice(0, 80)

  const timeline: ActivityTimelineItem[] = []

  for (const row of insightRows ?? []) {
    const at = row.created_at as string
    const score = row.score_percent as number
    const badge: ActivityTimelineItem['badge'] =
      score >= 80 ? 'success' : score >= 55 ? 'info' : 'warn'
    timeline.push({
      id: `insight-${row.id}`,
      kind: 'insight',
      at,
      title: 'AI insight on report',
      meta: `${row.report_label_snapshot ?? 'Report'} · ${score}% · ${new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
      description: (row.comment as string)?.slice(0, 400) ?? '',
      badge,
    })
  }

  for (const row of noteRows) {
    const files = row.upload_files || []
    const label =
      files.length === 1
        ? files[0].original_name
        : files.length > 1
          ? `${files[0].original_name} (+${files.length - 1})`
          : 'Upload'
    const at = row.created_at as string
    const pr = row.priority || 'normal'
    const badge: ActivityTimelineItem['badge'] =
      pr === 'urgent' ? 'danger' : pr === 'high' ? 'warn' : 'info'
    timeline.push({
      id: `note-${row.id}`,
      kind: 'note',
      at,
      title: 'Note added',
      meta: `${row.author_email ?? 'Someone'} · ${label} · ${new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${pr}`,
      description: row.body?.slice(0, 400) ?? '',
      badge,
    })
  }

  for (const row of eventRows ?? []) {
    const p = row.payload as { original_name?: string }
    const at = row.created_at as string
    timeline.push({
      id: `del-${row.id}`,
      kind: 'file_deleted',
      at,
      title: 'File deleted',
      meta: `${row.actor_email ?? 'Someone'} · ${p?.original_name ?? 'File'} · ${new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
      description: `${p?.original_name ?? 'A file'} was removed from the team workspace.`,
      badge: 'danger',
    })
  }

  timeline.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

  const fromAi = snapshot ? parseNeedsAttention(snapshot.needs_attention) : []
  let quickBreakdown: RubricInsightQuickBreakdown | null = null
  if (snapshot?.quick_breakdown && isQuickBreakdown(snapshot.quick_breakdown)) {
    const o = snapshot.quick_breakdown as Record<string, unknown>
    const ocp = Math.min(100, Math.max(0, Math.round(Number(o.overallCompletionPercent))))
    const rawContrib = Array.isArray(o.contributors) ? o.contributors : []
    const contributors = rawContrib
      .filter(
        (c): c is Record<string, unknown> =>
          Boolean(c) && typeof c === 'object' && typeof (c as Record<string, unknown>).label === 'string',
      )
      .map((c) => ({
        label: String(c.label),
        appearsToBeWorkingOn:
          typeof c.appearsToBeWorkingOn === 'string' ? c.appearsToBeWorkingOn : '(unspecified)',
        inferredFromNotesOrDocs:
          typeof c.inferredFromNotesOrDocs === 'string' ? c.inferredFromNotesOrDocs : null,
      }))
    quickBreakdown = {
      overallCompletionPercent: ocp,
      contributors,
      synthesis: o.synthesis as string,
      gapsAndRisks: o.gapsAndRisks as string,
    }
  }

  const fromNotes: NoteNeedsAttentionItem[] = []
  for (const row of noteRows) {
    const pr = row.priority || 'normal'
    if (pr !== 'high' && pr !== 'urgent') continue
    const files = row.upload_files || []
    const label =
      files.length === 1
        ? files[0].original_name
        : files.length > 1
          ? `${files[0].original_name} (+${files.length - 1})`
          : 'Upload'
    fromNotes.push({
      noteId: row.id,
      uploadId: row.upload_id,
      uploadLabel: label,
      authorEmail: row.author_email,
      bodyPreview: (row.body ?? '').slice(0, 220),
      priority: pr as 'high' | 'urgent',
      createdAt: row.created_at,
    })
  }

  fromNotes.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return tb - ta
  })

  const payload: ActivityLogPayload = {
    timeline,
    needsAttention: { fromAi, fromNotes },
    quickBreakdown,
    snapshotUpdatedAt: (snapshot?.updated_at as string | null) ?? null,
    overallCompletionPercent: quickBreakdown?.overallCompletionPercent ?? null,
  }

  return NextResponse.json(payload)
}
