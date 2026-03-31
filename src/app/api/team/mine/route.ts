import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { supabaseServerClientOrNull } from '@/lib/supabaseServer'
import type { TeamRow } from '@/types/team'

export async function GET() {
  const supabase = supabaseServerClientOrNull()
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  }

  const { data } = await supabase.auth.getUser()
  const user = data.user
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: membershipRows, error } = await supabase
    .from('team_members')
    .select('role, teams(id, name, invite_code)')
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const teams: TeamRow[] = (membershipRows ?? [])
    .map((row: any) => {
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
  if (cookieTeam && teams.some((t) => t.id === cookieTeam)) activeTeamId = cookieTeam
  else if (teams[0]) activeTeamId = teams[0].id

  return NextResponse.json({ teams, activeTeamId })
}

