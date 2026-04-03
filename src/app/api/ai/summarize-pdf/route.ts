import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { z } from 'zod'
import { extractPdfText, isPdfMime } from '@/lib/documentText'
import { supabaseServerClientOrNull } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
/** Vercel: allow time for download + PDF parse + OpenAI */
export const maxDuration = 60

const bodySchema = z.object({
  fileId: z.string().uuid(),
})

/** ~30k tokens input guard; keeps well under model limits after prompt overhead */
const MAX_EXTRACTED_CHARS = 120_000

const SYSTEM_PROMPT = `You are an expert technical reader. Given the plain text extracted from a PDF (which may be imperfect or out of order), write a detailed, well-structured summary.

Requirements:
- Target up to about 100 short lines of prose (multiple paragraphs and bullet lists are fine).
- Cover the document's purpose, main sections or themes, key arguments or findings, important definitions, and conclusions or recommendations when present.
- If the extract is partial, fragmented, or looks like tables/legalese, say so briefly and summarize what is readable.
- Use clear headings or bold labels sparingly; prefer plain paragraphs and bullets.
- Do not invent facts that are not supported by the text.`

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

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'fileId (uuid) required' }, { status: 400 })
  }

  const { fileId } = parsed.data

  const { data: row, error: rowErr } = await supabase
    .from('upload_files')
    .select('id, storage_path, original_name, mime')
    .eq('id', fileId)
    .maybeSingle()

  if (rowErr) {
    return NextResponse.json({ error: rowErr.message }, { status: 500 })
  }
  if (!row) {
    return NextResponse.json({ error: 'File not found or access denied' }, { status: 404 })
  }

  if (!isPdfMime(row.mime, row.original_name)) {
    return NextResponse.json({ error: 'Only PDF files can be summarized' }, { status: 400 })
  }

  const { data: blob, error: dlErr } = await supabase.storage.from('uploads').download(row.storage_path)
  if (dlErr || !blob) {
    return NextResponse.json({ error: dlErr?.message || 'Could not download file' }, { status: 502 })
  }

  const buf = Buffer.from(await blob.arrayBuffer())

  let extracted: string
  try {
    extracted = await extractPdfText(buf)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'PDF parse failed'
    return NextResponse.json({ error: `Could not read PDF: ${msg}` }, { status: 422 })
  }

  if (!extracted.length) {
    return NextResponse.json(
      { error: 'No extractable text in this PDF (it may be scanned images only).' },
      { status: 422 },
    )
  }

  let bodyForModel = extracted
  let truncatedNote = ''
  if (extracted.length > MAX_EXTRACTED_CHARS) {
    bodyForModel = extracted.slice(0, MAX_EXTRACTED_CHARS)
    truncatedNote = '\n\n[Extract truncated for length; only the beginning of the document was sent.]'
  }

  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'

  const openai = new OpenAI({ apiKey })

  try {
    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.25,
      max_tokens: 4500,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `File name: ${row.original_name}${truncatedNote}\n\n---\n\n${bodyForModel}`,
        },
      ],
    })

    const summary = completion.choices[0]?.message?.content?.trim()
    if (!summary) {
      return NextResponse.json({ error: 'Model returned an empty summary' }, { status: 502 })
    }

    return NextResponse.json({
      summary,
      fileName: row.original_name,
      model,
      truncated: Boolean(truncatedNote),
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
    console.error('[summarize-pdf]', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
