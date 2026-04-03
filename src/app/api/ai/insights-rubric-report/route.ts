import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { z } from 'zod'
import { extractDocumentPlainText, isSupportedDocumentMime } from '@/lib/documentText'
import { supabaseServerClientOrNull } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const maxDuration = 120

const bodySchema = z.object({
  rubricUploadId: z.string().uuid(),
  reportFileId: z.string().uuid(),
})

/** Per-side cap so two documents + prompt stay within model context comfortably */
const MAX_RUBRIC_CHARS = 48_000
const MAX_REPORT_CHARS = 48_000

const SYSTEM_PROMPT = `You are an experienced educator grading work against a rubric.

You will receive plain-text extracts from (1) a rubric document and (2) a learner report. The extracts may be imperfect (OCR-like gaps, odd ordering, tables flattened).

Your job:
- Compare how well the report satisfies the rubric: criteria addressed, depth, gaps, and alignment.
- Respond with a single JSON object only (no markdown fences), with exactly these keys:
  - "comment": a concise paragraph (3–6 sentences) of actionable feedback in a supportive tone.
  - "scorePercent": an integer from 0 to 100 estimating how fully the report meets the rubric overall (100 = fully meets; 0 = does not address it). Use the rubric as the source of truth.

If an extract is too short or missing key sections, say so in "comment" and reflect uncertainty in "scorePercent" (do not guess specific facts that are not in the text).`

const insightsResponseSchema = z.object({
  comment: z.string().min(1),
  scorePercent: z.coerce.number().int().min(0).max(100),
})

type UploadFileRow = {
  id: string
  storage_path: string
  original_name: string
  mime: string | null
}

function truncateForModel(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  return {
    text: text.slice(0, maxChars),
    truncated: true,
  }
}

function parseInsightsJson(raw: string): z.infer<typeof insightsResponseSchema> | null {
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
  const out = insightsResponseSchema.safeParse(parsed)
  return out.success ? out.data : null
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
    .select('id, is_rubric')
    .eq('id', rubricUploadId)
    .maybeSingle()

  if (rubricUploadErr) {
    return NextResponse.json({ error: rubricUploadErr.message }, { status: 500 })
  }
  if (!rubricUpload) {
    return NextResponse.json({ error: 'Rubric package not found' }, { status: 404 })
  }
  if (!rubricUpload.is_rubric) {
    return NextResponse.json({ error: 'Selected package is not marked as a rubric' }, { status: 400 })
  }

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
    .select('id, is_rubric')
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

  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
  const openai = new OpenAI({ apiKey })

  const preamble = [
    rubricTruncated ? '[Rubric extract was truncated for length.]\n' : '',
    reportTruncated ? '[Report extract was truncated for length.]\n' : '',
  ]
    .filter(Boolean)
    .join('')

  const userContent = `${preamble}## RUBRIC (plain text)\n\n${rubricText}\n\n## REPORT (plain text)\n\n### File: ${reportFile.original_name}\n\n${reportText}`

  try {
    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.35,
      max_tokens: 900,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    })

    const raw = completion.choices[0]?.message?.content?.trim()
    if (!raw) {
      return NextResponse.json({ error: 'Model returned an empty response' }, { status: 502 })
    }

    const insights = parseInsightsJson(raw)
    if (!insights) {
      return NextResponse.json({ error: 'Model response was not valid JSON' }, { status: 502 })
    }

    return NextResponse.json({
      comment: insights.comment,
      scorePercent: insights.scorePercent,
      model,
      rubricTruncated,
      reportTruncated,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'OpenAI request failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
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
