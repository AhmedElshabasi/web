import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { supabaseServerClientOrNull } from '@/lib/supabaseServer'
import type { TeamRow } from '@/types/team'
import type { UploadPackageRow } from '@/types/uploadWorkspace'
import { UploadsWorkspaceProvider } from '@/contexts/UploadsWorkspaceContext'
import { MainPageShell } from '@/components/MainPageShell'
import '@/styles/nr-brand-logo.css'
import './main-page-reference.css'

export const dynamic = 'force-dynamic'

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const supabase = supabaseServerClientOrNull()
  if (!supabase) redirect('/login?missing_env=1')

  const { data } = await supabase.auth.getUser()
  const user = data.user
  if (!user) redirect('/login')

  const { data: membershipRows } = await supabase
    .from('team_members')
    .select('role, teams(id, name, invite_code)')
    .eq('user_id', user.id)

  const teams: TeamRow[] = (membershipRows ?? [])
    .map((row) => {
      const t = row.teams as TeamRow | TeamRow[] | null | undefined
      const team = Array.isArray(t) ? t[0] : t
      if (!team?.id) return null
      const role = row.role === 'owner' || row.role === 'member' ? row.role : undefined
      return { ...team, role } as TeamRow
    })
    .filter((t): t is TeamRow => t != null)

  const cookieStore = await cookies()
  const cookieTeam = cookieStore.get('nr-team-id')?.value
  let activeTeamId: string | null = null
  if (cookieTeam && teams.some((t) => t.id === cookieTeam)) {
    activeTeamId = cookieTeam
  } else if (teams[0]) {
    activeTeamId = teams[0].id
  }

  let list: UploadPackageRow[] = []
  let uploadsError: { message: string } | null = null

  if (activeTeamId) {
    const { data: uploads, error } = await supabase
      .from('uploads')
      .select(
        `
        id,
        uploader_email,
        note,
        is_rubric,
        report_status,
        linked_rubric_upload_id,
        created_at,
        team_id,
        upload_files(
          id,
          original_name,
          mime,
          size,
          storage_path
        ),
        upload_notes(
          id,
          author_email,
          body,
          created_at,
          priority
        )
      `,
      )
      .eq('team_id', activeTeamId)
      .order('created_at', { ascending: false })

    uploadsError = error
    list = (uploads ?? []) as UploadPackageRow[]
  }

  let serverTotalBytes = 0
  for (const u of list) {
    for (const f of u.upload_files || []) {
      serverTotalBytes += typeof f.size === 'number' ? f.size : 0
    }
  }

  return (
    <UploadsWorkspaceProvider
      value={{
        initialUploads: list,
        serverUploadCount: list.length,
        serverTotalBytes,
        loadError: uploadsError?.message ?? null,
        teams,
        activeTeamId,
      }}
    >
      <MainPageShell userEmail={user.email ?? null} fileShare={children} />
    </UploadsWorkspaceProvider>
  )
}
