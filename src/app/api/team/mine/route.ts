import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { supabaseServerClientOrNull } from '@/lib/supabaseServer'
import type { TeamRow } from '@/types/team'

/**
 * Returns teams the current user belongs to + active team id (nr-team-id cookie).
 * Uses two queries (memberships, then teams) so we do not rely on PostgREST embed naming.
 */
export async function GET() {
  const supabase = supabaseServerClientOrNull()
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr) {
    return NextResponse.json({ error: userErr.message }, { status: 500 })
  }
  const user = userData.user
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: memberships, error: memErr } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)

  if (memErr) {
    return NextResponse.json({ error: memErr.message }, { status: 500 })
  }

  const rows = memberships ?? []
  if (rows.length === 0) {
    return NextResponse.json({ teams: [] as TeamRow[], activeTeamId: null as string | null })
  }

  const teamIds = [...new Set(rows.map((r) => r.team_id).filter(Boolean))] as string[]
  const { data: teamRows, error: teamsErr } = await supabase
    .from('teams')
    .select('id, name, invite_code')
    .in('id', teamIds)

  if (teamsErr) {
    return NextResponse.json({ error: teamsErr.message }, { status: 500 })
  }

  const byId = new Map((teamRows ?? []).map((t) => [t.id, t]))
  const teams: TeamRow[] = rows
    .map((m) => {
      const t = byId.get(m.team_id)
      if (!t?.id) return null
      const role = m.role === 'owner' || m.role === 'member' ? m.role : undefined
      return { ...t, role } as TeamRow
    })
    .filter((t): t is TeamRow => t != null)

  const cookieStore = await cookies()
  const cookieTeam = cookieStore.get('nr-team-id')?.value
  let activeTeamId: string | null = null
  if (cookieTeam && teams.some((t) => t.id === cookieTeam)) activeTeamId = cookieTeam
  else if (teams[0]) activeTeamId = teams[0].id

  return NextResponse.json({ teams, activeTeamId })
}
