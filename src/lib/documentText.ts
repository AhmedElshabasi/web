/** Must run before `pdf-parse` (Vercel / pdfjs worker). */
import 'pdf-parse/worker'
import { CanvasFactory } from 'pdf-parse/worker'
import { PDFParse } from 'pdf-parse'
import mammoth from 'mammoth'

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer), CanvasFactory })
  try {
    const result = await parser.getText()
    return (result.text || '').trim()
  } finally {
    await parser.destroy()
  }
}

export async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  return (result.value || '').trim()
}

export function isPdfMime(mime: string | null, filename: string): boolean {
  const m = (mime || '').toLowerCase()
  if (m === 'application/pdf') return true
  return filename.toLowerCase().endsWith('.pdf')
}

export function isDocxMime(mime: string | null, filename: string): boolean {
  const m = (mime || '').toLowerCase()
  if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return true
  return filename.toLowerCase().endsWith('.docx')
}

export function isSupportedDocumentMime(mime: string | null, filename: string): boolean {
  return isPdfMime(mime, filename) || isDocxMime(mime, filename)
}

/**
 * Extract plain text from a PDF or DOCX buffer. Throws if unsupported or empty extract.
 */
export async function extractDocumentPlainText(
  buffer: Buffer,
  mime: string | null,
  originalName: string,
): Promise<string> {
  if (isPdfMime(mime, originalName)) {
    const text = await extractPdfText(buffer)
    if (!text.length) {
      throw new Error('No extractable text in this PDF (it may be scanned images only).')
    }
    return text
  }
  if (isDocxMime(mime, originalName)) {
    const text = await extractDocxText(buffer)
    if (!text.length) {
      throw new Error('No extractable text in this document.')
    }
    return text
  }
  throw new Error('Only PDF and Word (.docx) files are supported for this action.')
}
