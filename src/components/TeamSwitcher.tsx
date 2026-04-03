'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabaseBrowser'
import { useUploadsWorkspace } from '@/contexts/UploadsWorkspaceContext'

export function TeamSwitcher() {
  const router = useRouter()
  const { teams, activeTeamId, refreshTeams } = useUploadsWorkspace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createName, setCreateName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)

  useEffect(() => {
    // If the initial server render returned no teams, re-check membership once.
    if (teams.length === 0) void refreshTeams()
  }, [refreshTeams, teams.length])

  const activeTeam = useMemo(
    () => teams.find((t) => t.id === activeTeamId) ?? null,
    [teams, activeTeamId],
  )

  useEffect(() => {
    setInviteCopied(false)
  }, [activeTeamId])

  const copyInviteCode = useCallback((code: string) => {
    if (!navigator.clipboard) {
      setError('Clipboard not available.')
      return
    }
    setError(null)
    void navigator.clipboard.writeText(code)
    setInviteCopied(true)
    window.setTimeout(() => setInviteCopied(false), 2000)
  }, [])

  const setActiveTeam = useCallback(
    async (teamId: string) => {
      setError(null)
      try {
        const res = await fetch('/api/team/active', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teamId }),
        })
        if (!res.ok) throw new Error('Could not switch team')
        await refreshTeams()
        router.refresh()
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Switch failed')
      }
    },
    [refreshTeams, router],
  )

  const createTeam = async () => {
    if (!supabaseBrowser) {
      setError('Supabase is not configured.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { data, error: rpcErr } = await supabaseBrowser.rpc('create_team', {
        p_name: createName.trim() || 'My team',
      })
      if (rpcErr) throw rpcErr
      const row = Array.isArray(data) ? data[0] : data
      const tid = (row as { team_id?: string }).team_id
      if (!tid) throw new Error('No team id returned')
      const res = await fetch('/api/team/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: tid }),
      })
      if (!res.ok) throw new Error('Could not set active team')
      setCreateName('')
      await refreshTeams()
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  const joinTeam = async () => {
    if (!supabaseBrowser) {
      setError('Supabase is not configured.')
      return
    }
    const code = joinCode.trim()
    if (!code) return
    setBusy(true)
    setError(null)
    try {
      const { data: teamId, error: rpcErr } = await supabaseBrowser.rpc('join_team_with_code', {
        p_code: code,
      })
      if (rpcErr) throw rpcErr
      if (!teamId) throw new Error('Join failed')
      const res = await fetch('/api/team/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId }),
      })
      if (!res.ok) throw new Error('Could not set active team')
      setJoinCode('')
      await refreshTeams()
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Invalid code')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="team-switcher">
      {teams.length > 0 ? (
        <>
          <label className="team-switcher-label" htmlFor="team-select">
            Active team
          </label>
          <select
            id="team-select"
            className="team-select"
            value={activeTeamId ?? ''}
            onChange={(e) => void setActiveTeam(e.target.value)}
            disabled={busy}
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {activeTeam ? (
            <div className="team-invite-block">
              <div className="team-invite-label">Invite code</div>
              <div className="team-invite-code-row">
                <code className="team-invite-code">{activeTeam.invite_code}</code>
                <button
                  type="button"
                  className="team-invite-copy"
                  onClick={() => copyInviteCode(activeTeam.invite_code)}
                >
                  {inviteCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="team-invite-hint">Share this code so others can join this team.</p>
            </div>
          ) : null}
        </>
      ) : (
        <p className="team-empty-hint">Create a team or join with a code to use file sharing.</p>
      )}

      <div className="team-actions">
        <div className="team-action-row">
          <input
            className="team-input"
            placeholder="New team name"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            disabled={busy}
          />
          <button type="button" className="team-action-btn" disabled={busy} onClick={() => void createTeam()}>
            Create
          </button>
        </div>
        <div className="team-action-row">
          <input
            className="team-input"
            placeholder="Invite code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            disabled={busy}
          />
          <button type="button" className="team-action-btn" disabled={busy} onClick={() => void joinTeam()}>
            Join
          </button>
        </div>
      </div>

      {error ? <div className="team-error">{error}</div> : null}
    </div>
  )
}
