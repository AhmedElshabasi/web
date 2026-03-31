'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { TeamRow } from '@/types/team'
import type { UploadPackageRow } from '@/types/uploadWorkspace'

export type UploadsWorkspaceValue = {
  initialUploads: UploadPackageRow[]
  serverUploadCount: number
  serverTotalBytes: number
  loadError: string | null
  teams: TeamRow[]
  activeTeamId: string | null
  refreshTeams: () => Promise<void>
}

export type UploadsWorkspaceSeed = Omit<UploadsWorkspaceValue, 'refreshTeams'>

const UploadsWorkspaceContext = createContext<UploadsWorkspaceValue | null>(null)

export function UploadsWorkspaceProvider({
  value,
  children,
}: {
  value: UploadsWorkspaceSeed
  children: ReactNode
}) {
  const { initialUploads, serverUploadCount, serverTotalBytes, loadError } = value

  const [teams, setTeams] = useState<TeamRow[]>(value.teams)
  const [activeTeamId, setActiveTeamId] = useState<string | null>(value.activeTeamId)

  useEffect(() => {
    setTeams(value.teams)
    setActiveTeamId(value.activeTeamId)
  }, [value.teams, value.activeTeamId])

  const refreshTeams = useCallback(async () => {
    try {
      const res = await fetch('/api/team/mine', { method: 'GET' })
      if (!res.ok) return
      const json = (await res.json()) as { teams?: TeamRow[]; activeTeamId?: string | null }
      if (Array.isArray(json.teams)) setTeams(json.teams)
      if (json.activeTeamId === null || typeof json.activeTeamId === 'string') setActiveTeamId(json.activeTeamId)
    } catch {
      // Non-fatal: UI can continue showing the last known teams.
    }
  }, [])

  const ctxValue = useMemo<UploadsWorkspaceValue>(
    () => ({
      initialUploads,
      serverUploadCount,
      serverTotalBytes,
      loadError,
      teams,
      activeTeamId,
      refreshTeams,
    }),
    [activeTeamId, initialUploads, loadError, refreshTeams, serverTotalBytes, serverUploadCount, teams],
  )

  return <UploadsWorkspaceContext.Provider value={ctxValue}>{children}</UploadsWorkspaceContext.Provider>
}

export function useUploadsWorkspace(): UploadsWorkspaceValue {
  const ctx = useContext(UploadsWorkspaceContext)
  if (!ctx) {
    throw new Error('useUploadsWorkspace must be used within UploadsWorkspaceProvider')
  }
  return ctx
}
