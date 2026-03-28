import { headers } from 'next/headers'
import { supabaseServerClient } from '@/lib/supabaseServer'
import { FileShareDashboard, type UploadPackageRow } from '@/components/FileShareDashboard'

export const dynamic = 'force-dynamic'

export default async function ReceivePage() {
  const supabase = supabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: uploads, error } = await supabase
    .from('uploads')
    .select(
      `
        id,
        uploader_email,
        note,
        created_at,
        upload_files(
          id,
          original_name,
          mime,
          size,
          storage_path
        )
      `,
    )
    .order('created_at', { ascending: false })

  if (error) {
    return (
      <div className="empty-state" style={{ margin: 28 }}>
        {error.message}
      </div>
    )
  }

  const list = (uploads ?? []) as UploadPackageRow[]

  let serverTotalBytes = 0
  for (const u of list) {
    for (const f of u.upload_files || []) {
      serverTotalBytes += typeof f.size === 'number' ? f.size : 0
    }
  }

  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const publicBaseUrl = `${proto}://${host}`

  return (
    <FileShareDashboard
      initialUploads={list}
      serverUploadCount={list.length}
      serverTotalBytes={serverTotalBytes}
      publicBaseUrl={publicBaseUrl}
    />
  )
}
