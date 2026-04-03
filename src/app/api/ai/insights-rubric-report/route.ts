import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { extractDocumentPlainText, isSupportedDocumentMime } from '@/lib/documentText'
import { supabaseServerClientOrNull } from '@/lib/supabaseServer'
import { INSIGHTS_WORKSPACE_SYSTEM_PROMPT } from '@/prompts/insightsWorkspacePrompt'
import type {
  RubricInsightNeedsAttentionItem,
  RubricInsightQuickBreakdown,
} from '@/types/rubricInsights'

export const runtime = 'nodejs'
export const maxDuration = 300

const bodySchema = z.object({
  rubricUploadId: z.string().uuid(),
  reportFileId: z.string().uuid(),
})

const MAX_RUBRIC_CHARS = 48_000
const MAX_REPORT_CHARS = 48_000
const MAX_LINKED_PACKAGES = 10
const MAX_CHARS_PER_WORKSPACE_FILE = 10_000
const MAX_WORKSPACE_EXTRACT_TOTAL = 72_000
const MAX_NOTES_SECTION_CHARS = 14_000

type UploadFileRow = {
  id: string
  storage_path: string
  original_name: string
  mime: string | null
}

type UploadPackageContext = {
  id: string
  uploader_email: string | null
  note: string | null
  report_status: string | null
  created_at: string | null
  upload_files: UploadFileRow[] | null
  upload_notes: { id: string; author_email: string | null; body: string; created_at: string | null }[] | null
}

const needsAttentionItemSchema = z.object({
  uploadId: z.string().uuid().optional().nullable(),
  fileId: z.string().uuid().optional().nullable(),
  fileLabel: z.string().min(1),
  reason: z.string().min(1),
  severity: z.enum(['info', 'warning', 'critical']).optional().nullable(),
})

const contributorSchema = z.object({
  label: z.string().min(1),
  appearsToBeWorkingOn: z.string().min(1),
  inferredFromNotesOrDocs: z.string().optional().nullable(),
})

const quickBreakdownSchema = z.object({
  overallCompletionPercent: z.coerce.number().int().min(0).max(100),
  contributors: z.array(contributorSchema).max(12),
  synthesis: z.string().min(1),
  gapsAndRisks: z.string().min(1),
})

const fullInsightsSchema = z.object({
  comment: z.string().min(1),
  scorePercent: z.coerce.number().int().min(0).max(100),
  needsAttention: z.array(needsAttentionItemSchema).max(16),
  quickBreakdown: quickBreakdownSchema,
})

function truncateForModel(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  return { text: text.slice(0, maxChars), truncated: true }
}

function parseFullInsightsJson(raw: string): z.infer<typeof fullInsightsSchema> | null {
  const trimmed = raw.trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(trimmed.slice(start, end + 1))
      } catch {
        return null
      }
    } else {
      return null
    }
  }
  const out = fullInsightsSchema.safeParse(parsed)
  return out.success ? out.data : null
}

function sanitizeNeedsAttention(
  items: RubricInsightNeedsAttentionItem[],
  allowedUploadIds: Set<string>,
  allowedFileIds: Set<string>,
): RubricInsightNeedsAttentionItem[] {
  return items.map((item) => ({
    fileLabel: item.fileLabel,
    reason: item.reason,
    severity: item.severity ?? null,
    uploadId: item.uploadId && allowedUploadIds.has(item.uploadId) ? item.uploadId : null,
    fileId: item.fileId && allowedFileIds.has(item.fileId) ? item.fileId : null,
  }))
}

async function extractWorkspaceTexts(
  supabase: SupabaseClient,
  packages: UploadPackageContext[],
  selectedReportUploadId: string,
  selectedReportFileId: string,
): Promise<{ block: string; truncated: boolean }> {
  const parts: string[] = []
  let total = 0
  let truncated = false
  const sorted = [...packages].sort((a, b) => {
    if (a.id === selectedReportUploadId) return -1
    if (b.id === selectedReportUploadId) return 1
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0
    return tb - ta
  })

  let pkgCount = 0
  for (const pkg of sorted) {
    if (pkgCount >= MAX_LINKED_PACKAGES) {
      truncated = true
      break
    }
    pkgCount += 1
    const files = pkg.upload_files || []
    for (const row of files) {
      if (total >= MAX_WORKSPACE_EXTRACT_TOTAL) {
        truncated = true
        break
      }
      const skipAsDuplicate =
        pkg.id === selectedReportUploadId && row.id === selectedReportFileId
      if (skipAsDuplicate) continue
      if (!isSupportedDocumentMime(row.mime, row.original_name)) continue

      const { data: blob, error: dlErr } = await supabase.storage.from('uploads').download(row.storage_path)
      if (dlErr || !blob) continue

      const buf = Buffer.from(await blob.arrayBuffer())
      let extracted: string
      try {
        extracted = await extractDocumentPlainText(buf, row.mime, row.original_name)
      } catch {
        continue
      }
      const budget = Math.min(MAX_CHARS_PER_WORKSPACE_FILE, MAX_WORKSPACE_EXTRACT_TOTAL - total)
      if (budget <= 0) {
        truncated = true
        break
      }
      const slice = truncateForModel(extracted, budget)
      if (slice.truncated) truncated = true
      total += slice.text.length
      parts.push(
        `### Package ${pkg.id} | file_id: ${row.id} | ${row.original_name}\n\n${slice.text}`,
      )
    }
    if (total >= MAX_WORKSPACE_EXTRACT_TOTAL) truncated = true
  }

  return {
    block: parts.length ? `\n## OTHER LINKED DOCUMENT EXTRACTS\n\n${parts.join('\n\n---\n\n')}` : '',
    truncated,
  }
}

function buildNotesDigest(packages: UploadPackageContext[], selectedReportUploadId: string): string {
  const lines: string[] = []
  for (const pkg of packages) {
    const note = pkg.note?.trim()
    const notes = pkg.upload_notes || []
    if (!note && notes.length === 0) continue
    lines.push(`\n### upload_id ${pkg.id}${pkg.id === selectedReportUploadId ? ' (primary selection)' : ''}`)
    lines.push(`uploader_email: ${pkg.uploader_email ?? '—'}`)
    if (note) lines.push(`share_note: ${note}`)
    for (const n of notes) {
      lines.push(
        `- (${n.author_email ?? 'someone'} @ ${n.created_at ?? '?'}) ${(n.body ?? '').trim().slice(0, 800)}`,
      )
    }
  }
  let digest = lines.join('\n')
  const t = truncateForModel(digest, MAX_NOTES_SECTION_CHARS)
  if (t.truncated) digest = t.text + '\n[Notes digest truncated.]'
  else digest = t.text
  return digest.trim() ? `## NOTES DIGEST\n\n${digest}` : ''
}

function buildManifest(packages: UploadPackageContext[], selectedReportUploadId: string): string {
  const lines: string[] = []
  for (const pkg of packages) {
    const files = pkg.upload_files || []
    const fileLines = files.map(
      (f) => `  - file_id: ${f.id} | ${f.original_name} | mime: ${f.mime ?? '?'}`,
    )
    lines.push(
      [
        `upload_id: ${pkg.id}${pkg.id === selectedReportUploadId ? ' **PRIMARY REPORT PACKAGE**' : ''}`,
        `uploader_email: ${pkg.uploader_email ?? '—'}`,
        `report_status: ${pkg.report_status ?? '—'}`,
        `created_at: ${pkg.created_at ?? '—'}`,
        `share_note: ${pkg.note?.trim() ? pkg.note.trim().slice(0, 500) : '—'}`,
        `files:\n${fileLines.join('\n') || '  (none)'}`,
      ].join('\n'),
    )
  }
  return `## LINKED REPORT PACKAGES MANIFEST (use these ids when precise)\n\n${lines.join('\n\n---\n\n')}`
}

async function handlePost(request: Request): Promise<NextResponse> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OpenAI is not configured. Set OPENAI_API_KEY on the server.' },
      { status: 503 },
    )
  }

  const supabase = supabaseServerClientOrNull()
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 })
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = userData.user.id

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsedBody = bodySchema.safeParse(json)
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'rubricUploadId and reportFileId (uuids) required' }, { status: 400 })
  }

  const { rubricUploadId, reportFileId } = parsedBody.data

  const { data: rubricUpload, error: rubricUploadErr } = await supabase
    .from('uploads')
    .select('id, is_rubric, team_id')
    .eq('id', rubricUploadId)
    .maybeSingle()

  if (rubricUploadErr) {
    return NextResponse.json({ error: rubricUploadErr.message }, { status: 500 })
  }
  if (!rubricUpload?.team_id) {
    return NextResponse.json({ error: 'Rubric package not found' }, { status: 404 })
  }
  if (!rubricUpload.is_rubric) {
    return NextResponse.json({ error: 'Selected package is not marked as a rubric' }, { status: 400 })
  }

  const teamId = rubricUpload.team_id as string

  const { data: rubricFiles, error: rubricFilesErr } = await supabase
    .from('upload_files')
    .select('id, storage_path, original_name, mime')
    .eq('upload_id', rubricUploadId)
    .order('original_name', { ascending: true })

  if (rubricFilesErr) {
    return NextResponse.json({ error: rubricFilesErr.message }, { status: 500 })
  }
  const rubricFileList = (rubricFiles ?? []) as UploadFileRow[]
  if (rubricFileList.length === 0) {
    return NextResponse.json({ error: 'Rubric package has no files' }, { status: 400 })
  }

  const { data: reportFile, error: reportFileErr } = await supabase
    .from('upload_files')
    .select('id, upload_id, storage_path, original_name, mime')
    .eq('id', reportFileId)
    .maybeSingle()

  if (reportFileErr) {
    return NextResponse.json({ error: reportFileErr.message }, { status: 500 })
  }
  if (!reportFile) {
    return NextResponse.json({ error: 'Report file not found' }, { status: 404 })
  }

  const { data: reportUpload, error: reportUploadErr } = await supabase
    .from('uploads')
    .select('id, is_rubric, team_id')
    .eq('id', reportFile.upload_id)
    .maybeSingle()

  if (reportUploadErr) {
    return NextResponse.json({ error: reportUploadErr.message }, { status: 500 })
  }
  if (!reportUpload) {
    return NextResponse.json({ error: 'Report package not found' }, { status: 404 })
  }
  if (reportUpload.is_rubric) {
    return NextResponse.json({ error: 'Selected file belongs to a rubric batch; pick a non-rubric report' }, { status: 400 })
  }
  if (reportUpload.team_id !== teamId) {
    return NextResponse.json({ error: 'Report and rubric must belong to the same team' }, { status: 400 })
  }

  if (!isSupportedDocumentMime(reportFile.mime, reportFile.original_name)) {
    return NextResponse.json(
      { error: 'Report must be a PDF or Word (.docx) file for AI insights' },
      { status: 400 },
    )
  }

  const rubricParts: string[] = []
  let rubricTruncated = false
  let rubricRemaining = MAX_RUBRIC_CHARS

  for (let i = 0; i < rubricFileList.length; i++) {
    const row = rubricFileList[i]
    if (rubricRemaining <= 0) {
      rubricTruncated = true
      break
    }
    if (!isSupportedDocumentMime(row.mime, row.original_name)) {
      return NextResponse.json(
        { error: `Rubric file "${row.original_name}" must be PDF or Word (.docx)` },
        { status: 400 },
      )
    }
    const { data: blob, error: dlErr } = await supabase.storage.from('uploads').download(row.storage_path)
    if (dlErr || !blob) {
      return NextResponse.json({ error: dlErr?.message || 'Could not download rubric file' }, { status: 502 })
    }
    const buf = Buffer.from(await blob.arrayBuffer())
    let extracted: string
    try {
      extracted = await extractDocumentPlainText(buf, row.mime, row.original_name)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not read rubric file'
      return NextResponse.json({ error: msg }, { status: 422 })
    }
    const { text, truncated } = truncateForModel(extracted, rubricRemaining)
    rubricRemaining -= text.length
    if (truncated) rubricTruncated = true
    rubricParts.push(`### File: ${row.original_name}\n\n${text}`)
    if (rubricRemaining <= 0 && i < rubricFileList.length - 1) {
      rubricTruncated = true
    }
  }

  const rubricText = rubricParts.join('\n\n---\n\n')
  if (!rubricText.trim().length) {
    return NextResponse.json({ error: 'Could not extract text from rubric files' }, { status: 422 })
  }

  const { data: reportBlob, error: reportDlErr } = await supabase.storage
    .from('uploads')
    .download(reportFile.storage_path)
  if (reportDlErr || !reportBlob) {
    return NextResponse.json({ error: reportDlErr?.message || 'Could not download report' }, { status: 502 })
  }

  const reportBuf = Buffer.from(await reportBlob.arrayBuffer())
  let reportExtracted: string
  try {
    reportExtracted = await extractDocumentPlainText(reportBuf, reportFile.mime, reportFile.original_name)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not read report'
    return NextResponse.json({ error: msg }, { status: 422 })
  }

  const reportSlice = truncateForModel(reportExtracted, MAX_REPORT_CHARS)
  const reportTruncated = reportSlice.truncated
  const reportText = reportSlice.text

  const reportUploadId = reportFile.upload_id

  const { data: linkedRows, error: linkedErr } = await supabase
    .from('uploads')
    .select(
      `
      id,
      uploader_email,
      note,
      report_status,
      created_at,
      upload_files ( id, storage_path, original_name, mime ),
      upload_notes ( id, author_email, body, created_at )
    `,
    )
    .eq('team_id', teamId)
    .eq('is_rubric', false)
    .or(`linked_rubric_upload_id.eq.${rubricUploadId},id.eq.${reportUploadId}`)

  if (linkedErr) {
    return NextResponse.json({ error: linkedErr.message }, { status: 500 })
  }

  const packages = (linkedRows ?? []) as UploadPackageContext[]
  const byId = new Map(packages.map((p) => [p.id, p]))
  if (!byId.has(reportUploadId)) {
    return NextResponse.json({ error: 'Could not load report package context' }, { status: 500 })
  }

  const allowedUploadIds = new Set(packages.map((p) => p.id))
  const allowedFileIds = new Set<string>()
  for (const p of packages) {
    for (const f of p.upload_files || []) {
      allowedFileIds.add(f.id)
    }
  }

  const manifest = buildManifest(packages, reportUploadId)
  const notesDigest = buildNotesDigest(packages, reportUploadId)
  const { block: workspaceExtracts, truncated: workspaceTruncated } = await extractWorkspaceTexts(
    supabase,
    packages,
    reportUploadId,
    reportFileId,
  )

  const preamble = [
    rubricTruncated ? '[Rubric extract truncated for length.]\n' : '',
    reportTruncated ? '[Primary report extract truncated for length.]\n' : '',
    workspaceTruncated ? '[Some linked document extracts omitted or shortened for length.]\n' : '',
  ]
    .filter(Boolean)
    .join('')

  const userContent = `${preamble}
## RUBRIC (plain text)

${rubricText}

## PRIMARY REPORT (user-selected file)

upload_id: ${reportUploadId}
file_id: ${reportFileId}
file_name: ${reportFile.original_name}

${reportText}

${manifest}

${notesDigest}
${workspaceExtracts}
`.trim()

  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
  const openai = new OpenAI({ apiKey })

  let insights: z.infer<typeof fullInsightsSchema>
  try {
    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.28,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: INSIGHTS_WORKSPACE_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    })

    const raw = completion.choices[0]?.message?.content?.trim()
    if (!raw) {
      return NextResponse.json({ error: 'Model returned an empty response' }, { status: 502 })
    }

    const parsed = parseFullInsightsJson(raw)
    if (!parsed) {
      return NextResponse.json({ error: 'Model response was not valid JSON' }, { status: 502 })
    }
    insights = parsed
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'OpenAI request failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  const needsAttention = sanitizeNeedsAttention(
    insights.needsAttention as RubricInsightNeedsAttentionItem[],
    allowedUploadIds,
    allowedFileIds,
  )
  const quickBreakdown = insights.quickBreakdown as RubricInsightQuickBreakdown

  const rubricLabel =
    rubricFileList.length === 1
      ? rubricFileList[0].original_name
      : `${rubricFileList[0].original_name} (+${rubricFileList.length - 1} more)`

  let persistOk = true
  const persistErrors: string[] = []

  const { error: runErr } = await supabase.from('ai_insight_runs').insert({
    team_id: teamId,
    created_by: userId,
    rubric_upload_id: rubricUploadId,
    report_upload_id: reportUploadId,
    report_file_id: reportFileId,
    rubric_label_snapshot: rubricLabel,
    report_label_snapshot: reportFile.original_name,
    comment: insights.comment.trim(),
    score_percent: insights.scorePercent,
    model,
    needs_attention: needsAttention,
    quick_breakdown: quickBreakdown,
  })
  if (runErr) {
    persistOk = false
    persistErrors.push(runErr.message)
    console.error('[ai_insight_runs]', runErr)
  }

  const { error: snapErr } = await supabase.from('rubric_insight_snapshots').upsert(
    {
      team_id: teamId,
      rubric_upload_id: rubricUploadId,
      updated_by: userId,
      updated_at: new Date().toISOString(),
      last_eval_report_upload_id: reportUploadId,
      last_eval_report_file_id: reportFileId,
      last_eval_comment: insights.comment.trim(),
      last_eval_score_percent: insights.scorePercent,
      model,
      needs_attention: needsAttention,
      quick_breakdown: quickBreakdown,
    },
    { onConflict: 'team_id,rubric_upload_id' },
  )
  if (snapErr) {
    persistOk = false
    persistErrors.push(snapErr.message)
    console.error('[rubric_insight_snapshots]', snapErr)
  }

  const { error: linkErr } = await supabase.rpc('link_report_upload_to_rubric', {
    p_report_upload_id: reportUploadId,
    p_rubric_upload_id: rubricUploadId,
  })
  if (linkErr) {
    persistOk = false
    persistErrors.push(linkErr.message)
    console.error('[link_report_upload_to_rubric]', linkErr)
  }

  return NextResponse.json({
    comment: insights.comment.trim(),
    scorePercent: insights.scorePercent,
    needsAttention,
    quickBreakdown,
    model,
    rubricTruncated,
    reportTruncated,
    workspaceTruncated,
    rubricLabel,
    reportLabel: reportFile.original_name,
    persisted: persistOk,
    persistErrors: persistOk ? undefined : persistErrors,
  })
}

export async function POST(request: Request) {
  try {
    return await handlePost(request)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error'
    console.error('[insights-rubric-report]', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
