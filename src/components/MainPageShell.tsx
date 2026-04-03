'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { supabaseBrowser } from '@/lib/supabaseBrowser'
import { ActivityLogPanel } from '@/components/ActivityLogPanel'
import { RecentTransfersPanel } from '@/components/RecentTransfersPanel'
import { TeamSwitcher } from '@/components/TeamSwitcher'

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

type WorkspacePage = 'file-share' | 'recent-transfers' | 'activity-log'

const TOPBAR_TITLES: Record<WorkspacePage, string> = {
  'file-share': 'File Share',
  'recent-transfers': 'Uploads',
  'activity-log': 'Activity Log',
}

export function MainPageShell({
  userEmail,
  fileShare,
}: {
  userEmail: string | null
  fileShare: ReactNode
}) {
  const [dark, setDark] = useState(true)
  const [signOutBusy, setSignOutBusy] = useState(false)
  const [activePage, setActivePage] = useState<WorkspacePage>('file-share')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isMobileLayout, setIsMobileLayout] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const nr = localStorage.getItem('nr-theme')
    if (nr === 'dark') {
      setDark(true)
      return
    }
    if (nr === 'light') {
      setDark(false)
      return
    }
    const legacy = localStorage.getItem('theme')
    if (legacy === 'light') {
      setDark(false)
      return
    }
    if (legacy === 'dark') {
      setDark(true)
      return
    }
    setDark(true)
  }, [])

  useEffect(() => {
    const el = document.getElementById('main-page-root')
    if (!el) return
    if (dark) el.classList.add('dark-mode')
    else el.classList.remove('dark-mode')
  }, [dark])

  const closeSidebar = useCallback(() => setSidebarOpen(false), [])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 980px)')
    const sync = () => {
      setIsMobileLayout(mq.matches)
      if (!mq.matches) setSidebarOpen(false)
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!sidebarOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [sidebarOpen])

  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sidebarOpen])

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
      <div className={`shell${sidebarOpen ? ' shell--nav-open' : ''}`}>
        {sidebarOpen ? (
          <button
            type="button"
            className="sidebar-backdrop"
            aria-label="Close menu"
            onClick={closeSidebar}
          />
        ) : null}
        <aside
          className="sidebar"
          aria-hidden={isMobileLayout && !sidebarOpen ? true : undefined}
        >
          <div className="sidebar-logo">
            <div className="sidebar-logo-mark">
              <div className="icon">📁</div>
              <div>
                <div className="sidebar-wordmark">NoRedundancy</div>
                <div className="sidebar-sub">AI-powered <br />Report Insights</div>
              </div>
            </div>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-label">Team</div>
            <TeamSwitcher />
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-label">Workspace</div>
            <button
              type="button"
              className={`nav-item${activePage === 'file-share' ? ' active' : ''}`}
              onClick={() => {
                setActivePage('file-share')
                closeSidebar()
              }}
            >
             <span>↗</span> File Share
            </button>
            <button
              type="button"
              className={`nav-item${activePage === 'activity-log' ? ' active' : ''}`}
              onClick={() => {
                setActivePage('activity-log')
                closeSidebar()
              }}
            >
              <span>◌</span> Activity Log
            </button>
            <button
              type="button"
              className={`nav-item${activePage === 'recent-transfers' ? ' active' : ''}`}
              onClick={() => {
                setActivePage('recent-transfers')
                closeSidebar()
              }}
            >
              <span>◌</span> Uploads
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
          </div>
        </aside>

        <main className="main-content">
          <div className="topbar">
            <div className="topbar-start">
              <button
                type="button"
                className="sidebar-menu-btn"
                aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={sidebarOpen}
                onClick={() => setSidebarOpen((o) => !o)}
              >
                <span className="sidebar-menu-icon" aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
              </button>
              <div className="topbar-title">{TOPBAR_TITLES[activePage]}</div>
            </div>
            <div className="topbar-actions">
              <button
                type="button"
                className="topbar-sign-out"
                onClick={() => void signOut()}
                disabled={signOutBusy}
              >
                {signOutBusy ? '…' : 'Sign out'}
              </button>
              <button
                type="button"
                className="theme-toggle"
                onClick={() =>
                  setDark((d) => {
                    const next = !d
                    localStorage.setItem('nr-theme', next ? 'dark' : 'light')
                    return next
                  })
                }
              >
                {dark ? '☀️ Light mode' : '🌙 Dark mode'}
              </button>
              
            </div>
          </div>

          <div className="content">
            <section className={`page-panel${activePage === 'file-share' ? ' active' : ''}`} id="page-file-share">
              {fileShare}
            </section>
            <section
              className={`page-panel${activePage === 'recent-transfers' ? ' active' : ''}`}
              id="page-recent-transfers"
            >
              <RecentTransfersPanel />
            </section>
            <section className={`page-panel${activePage === 'activity-log' ? ' active' : ''}`} id="page-activity-log">
              <ActivityLogPanel />
            </section>
          </div>
        </main>
      </div>
    </div>
  )
}
