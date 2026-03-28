'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

function initialsFromEmail(email: string | null): string {
  if (!email) return 'NR'
  const local = email.split('@')[0] || ''
  const parts = local.split(/[._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  if (local.length >= 2) return local.slice(0, 2).toUpperCase()
  return (local[0] || 'N').toUpperCase() + (local[1] || 'R').toUpperCase()
}

function displayNameFromEmail(email: string | null): string {
  if (!email) return 'Team Workspace'
  const local = email.split('@')[0] || ''
  const parts = local.split(/[._-]+/).filter(Boolean)
  if (parts.length >= 2) {
    return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ')
  }
  return local || 'Team Workspace'
}

export function MainPageShell({
  userEmail,
  children,
}: {
  userEmail: string | null
  children: ReactNode
}) {
  const [dark, setDark] = useState(false)
  const [signOutBusy, setSignOutBusy] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setDark(localStorage.getItem('theme') === 'dark')
  }, [])

  useEffect(() => {
    const el = document.getElementById('main-page-root')
    if (!el) return
    if (dark) el.classList.add('dark-mode')
    else el.classList.remove('dark-mode')
  }, [dark])

  const signOut = async () => {
    try {
      setSignOutBusy(true)
      if (!supabaseBrowser) return
      await supabaseBrowser.auth.signOut()
      window.location.href = '/login'
    } finally {
      setSignOutBusy(false)
    }
  }

  const avatar = initialsFromEmail(userEmail)
  const name = displayNameFromEmail(userEmail)

  return (
    <div id="main-page-root">
      <div className="shell">
        <aside className="sidebar">
          <div className="sidebar-logo">
            <div className="sidebar-logo-mark">
              <div className="icon">📁</div>
              <div>
                <div className="sidebar-wordmark">NoRedundancy</div>
                <div className="sidebar-sub">Secure file sharing</div>
              </div>
            </div>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-label">Workspace</div>
            <button type="button" className="nav-item active">
              <span>↗</span> File Share <span className="nav-badge">Live</span>
            </button>
            <button type="button" className="nav-item">
              <span>◌</span> Recent Transfers
            </button>
            <button type="button" className="nav-item">
              <span>◌</span> Activity Log
            </button>
            <button type="button" className="nav-item">
              <span>◌</span> Storage Policy
            </button>
          </div>

          <div className="sidebar-bottom">
            <div className="user-chip">
              <div className="user-avatar">{avatar}</div>
              <div>
                <div className="user-name">{name}</div>
                <div className="user-email">{userEmail ?? 'share@noredundancy.app'}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              disabled={signOutBusy}
              style={{
                marginTop: 10,
                width: '100%',
                padding: '8px 10px',
                background: 'none',
                border: 'none',
                color: 'rgba(255,255,255,.35)',
                fontSize: 12,
                cursor: signOutBusy ? 'wait' : 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
              }}
            >
              {signOutBusy ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </aside>

        <div className="main-content">
          <div className="topbar">
            <div className="topbar-title">File Share</div>
            <div className="topbar-actions">
              <button
                type="button"
                className="theme-toggle"
                onClick={() =>
                  setDark((d) => {
                    const next = !d
                    localStorage.setItem('theme', next ? 'dark' : 'light')
                    return next
                  })
                }
                id="theme-toggle"
              >
                {dark ? '☀️ Light mode' : '🌙 Dark mode'}
              </button>
              <div className="ai-badge">✦ Styled to match sign-in theme</div>
            </div>
          </div>

          <div className="content">{children}</div>
        </div>
      </div>
    </div>
  )
}
